import { QueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { isCancellationError } from '@/shared/lib/errorHandling/errorUtils';
import { normalizeAndPresentError, type RuntimeErrorOptions } from '@/shared/lib/errorHandling/runtimeError';
import { ValidationError } from '@/shared/lib/errorHandling/errors';
import { queryKeys } from '@/shared/lib/queryKeys';
import { createTask } from '@/shared/lib/taskCreation';
import { toJson } from '@/shared/lib/supabaseTypeHelpers';
import {
  DEFAULT_STRUCTURE_GUIDANCE_CONTROLS,
  DEFAULT_STRUCTURE_VIDEO,
} from '@/shared/lib/tasks/travelBetweenImages';
import { normalizeStructureGuidance } from '@/shared/lib/tasks/structureGuidance';
import { normalizeTravelGuidance } from '@/shared/lib/tasks/travelGuidance';
import { ASPECT_RATIO_TO_RESOLUTION, LTX_ASPECT_RATIO_TO_RESOLUTION } from '@/shared/lib/media/aspectRatios';
import { DEFAULT_RESOLUTION } from '../utils/dimension-utils';
import { stripModeFromPhaseConfig } from '@/shared/components/SegmentSettingsForm/segmentSettingsUtils';
import type { GenerationRow, Shot } from '@/domains/generation/types';
import {
  operationFailure,
  operationSuccess,
} from '@/shared/lib/operationResult';
import {
  buildBasicModeGenerationRequest,
  resolveLtxModelSelection,
  resolveModelPhaseSelection,
  validatePhaseConfigConsistency,
} from './generateVideo/modelPhase';
import {
  clampFrameCountToPolicy,
  getModelSpec,
  resolveGenerationPolicy,
} from '@/tools/travel-between-images/settings';
import {
  buildImagePayload,
  buildTimelinePairConfig,
  buildBatchPairConfig,
  buildByPairConfig,
  extractPairOverrides,
  filterImageShotGenerations,
} from './generateVideo/pairPayload';
import { enhancePromptsForBatch } from './generateVideo/enhancePromptsForBatch';
import { buildTravelRequestBodyV2 } from './generateVideo/requestBody';
import type {
  GenerateVideoParams,
  GenerateVideoResult,
  ShotGenRow,
  ImagePayload,
  PairConfigPayload,
  ModelPhaseSelection,
} from './generateVideo/types';
import type {
  StructureVideoConfigWithMetadata,
  StitchConfig,
  TravelGuidance,
} from '@/shared/lib/tasks/travelBetweenImages';

export type { StitchConfig };

/**
 * Build legacy structure-guidance data when older internal consumers still need it.
 * New task writes should go through canonical `travel_guidance`.
 */
function buildStructureGuidance(
  structureGuidanceOrVideos: Record<string, unknown> | StructureVideoConfigWithMetadata[] | undefined,
  structureVideosArg?: StructureVideoConfigWithMetadata[] | undefined,
): Record<string, unknown> | null {
  const structureGuidance = Array.isArray(structureGuidanceOrVideos)
    ? undefined
    : structureGuidanceOrVideos;
  const structureVideos = Array.isArray(structureGuidanceOrVideos)
    ? structureGuidanceOrVideos
    : structureVideosArg;

  if (structureGuidance) {
    return structureGuidance;
  }
  const normalized = normalizeStructureGuidance({
    structureVideos,
    defaultVideoTreatment: DEFAULT_STRUCTURE_VIDEO.treatment,
    defaultUni3cEndPercent: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.uni3cEndPercent,
  });
  return normalized ?? null;
}

/** Shared Supabase query shape for shot_generations with joined generation data */
const SHOT_GEN_QUERY = `
  id,
  generation_id,
  timeline_frame,
  metadata,
  generation:generations!shot_generations_generation_id_generations_id_fk (
    id,
    location,
    type,
    primary_variant_id
  )
`;

function failureResult(error: unknown, options: RuntimeErrorOptions): GenerateVideoResult {
  const appError = normalizeAndPresentError(error, options);
  return operationFailure(appError, {
    errorCode: 'generate_video_failed',
    policy: 'fail_closed',
    recoverable: true,
    message: appError.message,
    cause: {
      context: options.context,
      toastTitle: options.toastTitle,
      logData: options.logData,
    },
  });
}

function resolveGenerationResolution(
  selectedShot: Shot,
  effectiveAspectRatio: string | null,
  useLtxHd: boolean = false,
): string {
  const resolutionMap = useLtxHd ? LTX_ASPECT_RATIO_TO_RESOLUTION : ASPECT_RATIO_TO_RESOLUTION;
  if (selectedShot?.aspect_ratio) {
    const shotResolution = resolutionMap[selectedShot.aspect_ratio];
    if (shotResolution) return shotResolution;
  }
  if (effectiveAspectRatio) {
    const projectResolution = resolutionMap[effectiveAspectRatio];
    if (projectResolution) return projectResolution;
  }
  return useLtxHd ? '1280x720' : DEFAULT_RESOLUTION;
}

async function waitForPendingMutations(queryClient: QueryClient, timeoutMs = 5000): Promise<void> {
  if (queryClient.isMutating() === 0) return;

  const start = Date.now();
  while (queryClient.isMutating() > 0) {
    if (Date.now() - start > timeoutMs) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function fetchFreshShotGenerations(selectedShotId: string): Promise<ShotGenRow[]> {
  const { data, error } = await supabase().from('shot_generations')
    .select(SHOT_GEN_QUERY)
    .eq('shot_id', selectedShotId)
    .order('timeline_frame', { ascending: true });

  if (error) throw error;
  return (data || []) as ShotGenRow[];
}

async function persistEnhancedPromptsMetadata(
  shotId: string,
  queryClient: QueryClient,
  allShotGenerations: ShotGenRow[],
  enhancedPrompts: string[],
): Promise<void> {
  if (enhancedPrompts.length === 0) {
    return;
  }

  const sourceShotGenerations = filterImageShotGenerations(allShotGenerations)
    .slice(0, enhancedPrompts.length);

  if (sourceShotGenerations.length === 0) {
    return;
  }

  const metadataUpdates = sourceShotGenerations.map((shotGeneration, index) => ({
    shotGenerationId: shotGeneration.id,
    metadata: {
      ...((shotGeneration.metadata as Record<string, unknown> | null) || {}),
      enhanced_prompt: enhancedPrompts[index] ?? '',
    },
  }));

  const metadataByShotGenerationId = new Map(
    metadataUpdates.map((update) => [update.shotGenerationId, update.metadata]),
  );

  queryClient.setQueryData<GenerationRow[]>(
    queryKeys.generations.byShot(shotId),
    (oldData) => oldData?.map((row) => {
      const updatedMetadata = metadataByShotGenerationId.get(row.id);
      return updatedMetadata
        ? { ...row, metadata: updatedMetadata }
        : row;
    }),
  );

  const results = await Promise.all(metadataUpdates.map((update) =>
    supabase().from('shot_generations')
      .update({ metadata: toJson(update.metadata) })
      .eq('id', update.shotGenerationId),
  ));

  const firstError = results.find((result) => result.error)?.error;
  if (firstError) {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: queryKeys.generations.byShot(shotId) }),
      queryClient.refetchQueries({ queryKey: queryKeys.generations.meta(shotId) }),
    ]);
    throw firstError;
  }

  await Promise.all([
    queryClient.refetchQueries({ queryKey: queryKeys.generations.byShot(shotId) }),
    queryClient.refetchQueries({ queryKey: queryKeys.generations.meta(shotId) }),
    ...metadataUpdates.map((update) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.segments.pairMetadata(update.shotGenerationId) })),
  ]);
}

export {
  stripModeFromPhaseConfig,
  extractPairOverrides,
  filterImageShotGenerations,
  buildTravelRequestBodyV2,
  buildImagePayload,
  buildTimelinePairConfig,
  buildBatchPairConfig,
  buildByPairConfig,
  resolveLtxModelSelection,
  resolveModelPhaseSelection,
  validatePhaseConfigConsistency,
  buildBasicModeGenerationRequest as buildBasicModePhaseConfig,
};
export { resolveGenerationResolution, buildStructureGuidance };
export type { ShotGenRow, ImagePayload, PairConfigPayload, ModelPhaseSelection };

function resolveGuidanceKind(travelGuidance?: TravelGuidance): string | undefined {
  if (!travelGuidance || travelGuidance.kind === 'none') {
    return undefined;
  }

  if (travelGuidance.kind === 'uni3c') {
    return 'uni3c';
  }

  return travelGuidance.mode;
}

/**
 * Prepare and submit a video generation task.
 * Handles resolution, fresh DB queries, per-pair overrides, model selection,
 * structure guidance, and task creation.
 */
export async function generateVideo(params: GenerateVideoParams): Promise<GenerateVideoResult> {
  const {
    projectId,
    selectedShotId,
    selectedShot,
    queryClient,
    effectiveAspectRatio,
    generationMode,
    promptConfig,
    motionConfig,
    modelConfig,
    batchVideoFrames,
    selectedLoras,
    variantNameParam,
    clearAllEnhancedPrompts,
    parentGenerationId,
    stitchConfig,
    travelGuidance,
    structureGuidance,
    structureVideos,
  } = params;
  const resolvedStructureVideos = structureVideos ?? [];

  if (!projectId) {
    return failureResult(
      new ValidationError('No project selected. Please select a project first.', { field: 'projectId' }),
      { context: 'generateVideoService', toastTitle: 'No project selected' },
    );
  }

  await waitForPendingMutations(queryClient);
  const spec = getModelSpec(modelConfig.selectedModel);
  const policy = resolveGenerationPolicy(spec, {
    smoothContinuations: modelConfig.smoothContinuations ?? false,
    requestedExecutionMode: modelConfig.generation_type_mode ?? 'i2v',
    guidanceKind: resolveGuidanceKind(travelGuidance),
    hasStructureVideo: resolvedStructureVideos.length > 0,
  });
  const useLtxHd = spec.modelFamily === 'ltx' && modelConfig.ltxHdResolution !== false;
  const resolution = resolveGenerationResolution(selectedShot, effectiveAspectRatio, useLtxHd);
  const amountOfMotion = motionConfig.amount_of_motion ?? 50;
  const effectiveBatchVideoFrames = clampFrameCountToPolicy(batchVideoFrames, spec, {
    smoothContinuations: modelConfig.smoothContinuations ?? false,
    requestedExecutionMode: modelConfig.generation_type_mode ?? 'i2v',
    guidanceKind: resolveGuidanceKind(travelGuidance),
    hasStructureVideo: resolvedStructureVideos.length > 0,
  });

  let allShotGenerations: ShotGenRow[];
  try {
    allShotGenerations = await fetchFreshShotGenerations(selectedShotId);
  } catch (error) {
    return failureResult(error, {
      context: 'TaskSubmission',
      toastTitle: 'Failed to fetch current images',
    });
  }

  const imagePayload = buildImagePayload(allShotGenerations);
  const pairConfig = (() => {
    switch (generationMode) {
      case 'timeline':
        return buildTimelinePairConfig(allShotGenerations, effectiveBatchVideoFrames, promptConfig.default_negative_prompt, policy.frameOverlap);
      case 'by-pair':
        return buildByPairConfig(allShotGenerations, effectiveBatchVideoFrames, promptConfig.default_negative_prompt, policy.frameOverlap);
      case 'batch':
      default:
        return buildBatchPairConfig(imagePayload.absoluteImageUrls, effectiveBatchVideoFrames, promptConfig.default_negative_prompt, policy.frameOverlap);
    }
  })();

  if (promptConfig.enhance_prompt) {
    try {
      pairConfig.enhancedPromptsArray = await enhancePromptsForBatch({
        batchBasePrompt: promptConfig.base_prompt,
        pairCount: pairConfig.basePrompts.length,
        pairOverridePrompts: pairConfig.basePrompts,
        numFrames: pairConfig.segmentFrames[0],
        onProgress: promptConfig.onEnhancementProgress,
        signal: promptConfig.enhancementAbortSignal,
      });

      try {
        await persistEnhancedPromptsMetadata(
          selectedShotId,
          queryClient,
          allShotGenerations,
          pairConfig.enhancedPromptsArray.map((prompt) => prompt ?? ''),
        );
      } catch (persistError) {
        normalizeAndPresentError(persistError, {
          context: 'generateVideoService.persistEnhancedPromptsMetadata',
          showToast: false,
        });
      }
    } catch (error) {
      return failureResult(error, {
        context: 'generateVideoService.enhancePromptsForBatch',
        toastTitle: 'Failed to enhance prompts',
        showToast: !isCancellationError(error),
      });
    }

    // If all prompts were blank (nothing to enhance), disable the flag
    // so the worker doesn't fall back to its own VLM enhancement.
    const hasAnyEnhanced = pairConfig.enhancedPromptsArray.some(p => p && p.trim().length > 0);
    if (!hasAnyEnhanced) {
      promptConfig.enhance_prompt = false;
    }
  }

  const modelPhaseSelection = spec.modelFamily === 'ltx'
    ? resolveLtxModelSelection(modelConfig.selectedModel)
    : resolveModelPhaseSelection(
      amountOfMotion,
      motionConfig.advanced_mode,
      motionConfig.phase_config,
      motionConfig.motion_mode,
      selectedLoras,
    );

  if (modelPhaseSelection.effectivePhaseConfig) {
    try {
      validatePhaseConfigConsistency(modelPhaseSelection.effectivePhaseConfig);
    } catch (error) {
      return failureResult(error, {
        context: 'generateVideoService',
        toastTitle: 'Invalid phase configuration',
      });
    }
  }

  const requestBody = buildTravelRequestBodyV2({
    projectId,
    selectedShot,
    imagePayload,
    pairConfig,
    parentGenerationId,
    actualModelName: modelPhaseSelection.actualModelName,
    selectedModel: modelConfig.selectedModel,
    policy,
    generationTypeMode: modelConfig.generation_type_mode,
    motionParams: {
      amountOfMotion,
      motionMode: motionConfig.motion_mode,
      useAdvancedMode: modelPhaseSelection.useAdvancedMode,
      effectivePhaseConfig: modelPhaseSelection.effectivePhaseConfig,
      selectedPhasePresetId: motionConfig.selected_phase_preset_id,
      numInferenceSteps: modelConfig.num_inference_steps,
      guidanceScale: modelConfig.guidance_scale,
    },
    generationParams: {
      generationMode,
      batchVideoPrompt: promptConfig.base_prompt,
      enhancePrompt: promptConfig.enhance_prompt,
      variantNameParam,
      textBeforePrompts: promptConfig.text_before_prompts,
      textAfterPrompts: promptConfig.text_after_prompts,
    },
    seedParams: {
      seed: modelConfig.seed,
      randomSeed: modelConfig.random_seed,
      turboMode: modelConfig.turbo_mode,
      debug: modelConfig.debug,
    },
  });

  if (selectedLoras && selectedLoras.length > 0) {
    requestBody.loras = selectedLoras.map(lora => ({
      path: lora.path,
      strength: parseFloat(lora.strength?.toString() ?? '1') || 1.0,
    }));
  }

  requestBody.resolution = resolution;
  if (stitchConfig) requestBody.stitch_config = stitchConfig;

  const normalizedTravelGuidance = normalizeTravelGuidance({
    modelName: modelPhaseSelection.actualModelName,
    travelGuidance,
    structureGuidance: buildStructureGuidance(
      structureGuidance as Record<string, unknown> | undefined,
      structureVideos,
    ) ?? undefined,
    structureVideos,
    defaultVideoTreatment: DEFAULT_STRUCTURE_VIDEO.treatment,
    defaultUni3cEndPercent: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.uni3cEndPercent,
  });
  if (normalizedTravelGuidance) requestBody.travel_guidance = normalizedTravelGuidance;

  try {
    if (!promptConfig.enhance_prompt) {
      try {
        await clearAllEnhancedPrompts();
      } catch (clearError) {
        normalizeAndPresentError(clearError, { context: 'generateVideoService', showToast: false });
      }
    }

    const normalizedRequestBody = requestBody.model_name?.includes('ltx2')
      ? { ...requestBody, turbo_mode: false }
      : requestBody;
    const { project_id, ...input } = normalizedRequestBody;
    const result = await createTask({
      project_id,
      family: 'travel_between_images',
      input,
    });
    return operationSuccess(
      {
        parentGenerationId: typeof result.meta?.parentGenerationId === 'string'
          ? result.meta.parentGenerationId
          : normalizedRequestBody.parent_generation_id,
      },
      { policy: 'best_effort' },
    );
  } catch (error) {
    return failureResult(error, {
      context: 'generateVideoService',
      toastTitle: 'Failed to create video generation task',
    });
  }
}
