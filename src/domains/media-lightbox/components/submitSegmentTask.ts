/**
 * submitSegmentTask - Shared segment task submission logic
 *
 * Extracts the duplicated ~200-line handleSubmit pattern from
 * SegmentRegenerateForm and SegmentSlotFormView into a single function.
 *
 * Both callers follow the same pattern:
 *   1. Validate inputs
 *   2. Add incoming task placeholder (for optimistic UI)
 *   3. Optionally enhance prompt via edge function
 *   4. Save enhanced prompt metadata
 *   5. Build task params
 *   6. Create the task
 *   7. Cleanup (refetch, remove placeholder)
 */

import { QueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { createTask as createTaskRequest } from '@/shared/lib/taskCreation';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { joinPromptParts } from '@/shared/lib/tasks/promptAssembly';
import { buildTaskParams, type SegmentSettings } from '@/shared/components/SegmentSettingsForm/segmentSettingsUtils';
import type { IndividualTravelSegmentParams } from '@/shared/types/individualTravelSegment';
import { persistSegmentEnhancedPrompt } from '@/shared/lib/tasks/segmentGenerationPersistence';
import {
  buildTravelGuidanceFromControls,
  type TravelGuidanceMode,
} from '@/shared/lib/tasks/travelGuidance';
import { queryKeys } from '@/shared/lib/queryKeys';
import {
  getModelSpec,
  resolveGenerationPolicy,
  resolveSelectedModelFromModelName,
} from '@/tools/travel-between-images/settings';
import type {
  StructureVideoConfig,
  TravelGuidance,
} from '@/shared/lib/tasks/travelBetweenImages';
import type { RunTaskPlaceholder } from '@/shared/hooks/tasks/useTaskPlaceholder';

// ============================================================================
// Structure Video Config Builder (shared between SegmentRegenerateForm & SegmentSlotFormView)
// ============================================================================

interface StructureVideoInputs {
  structureVideoUrl?: string;
  structureVideoType?: TravelGuidanceMode | null;
  modelName?: string;
  structureVideoFrameRange?: {
    segmentStart: number;
    segmentEnd: number;
    videoTotalFrames: number;
    videoFps: number;
  };
  structureVideoDefaults?: {
    motionStrength: number;
    treatment: 'adjust' | 'clip';
    uni3cEndPercent: number;
    cannyIntensity?: number;
    depthContrast?: number;
  } | null;
}

/**
 * Build a StructureVideoConfig from structure video props + effective settings.
 * Returns null when required fields are missing.
 */
export function buildStructureVideoForTask(
  inputs: StructureVideoInputs,
  getSettingsForTaskCreation: () => Pick<
    SegmentSettings,
    | 'guidanceTreatment'
    | 'guidanceMode'
    | 'guidanceStrength'
    | 'guidanceUni3cEndPercent'
    | 'guidanceCannyIntensity'
    | 'guidanceDepthContrast'
  >,
): { travelGuidance: TravelGuidance; structureVideos: StructureVideoConfig[] } | null {
  const { structureVideoUrl, structureVideoType, structureVideoFrameRange, structureVideoDefaults, modelName } = inputs;
  if (!structureVideoUrl || !structureVideoType || !structureVideoFrameRange) {
    return null;
  }

  const effectiveSettings = getSettingsForTaskCreation();
  const structureVideo: StructureVideoConfig = {
    path: structureVideoUrl,
    start_frame: structureVideoFrameRange.segmentStart,
    end_frame: structureVideoFrameRange.segmentEnd,
    treatment: effectiveSettings.guidanceTreatment ?? structureVideoDefaults?.treatment ?? 'adjust',
  };
  const travelGuidance = buildTravelGuidanceFromControls({
    modelName,
    structureVideos: [structureVideo],
    controls: {
      mode: effectiveSettings.guidanceMode ?? structureVideoType,
      strength: effectiveSettings.guidanceStrength ?? structureVideoDefaults?.motionStrength ?? 1.2,
      uni3cEndPercent: effectiveSettings.guidanceUni3cEndPercent ?? structureVideoDefaults?.uni3cEndPercent ?? 0.1,
      cannyIntensity: effectiveSettings.guidanceCannyIntensity ?? structureVideoDefaults?.cannyIntensity,
      depthContrast: effectiveSettings.guidanceDepthContrast ?? structureVideoDefaults?.depthContrast,
    },
    defaultVideoTreatment: structureVideo.treatment,
  });
  if (!travelGuidance) {
    return null;
  }
  return {
    travelGuidance,
    structureVideos: [structureVideo],
  };
}

// ============================================================================
// Segment Task Submission
// ============================================================================

/** Image context for the segment task */
interface SegmentTaskImageContext {
  startImageUrl?: string;
  endImageUrl?: string;
  startImageGenerationId?: string;
  endImageGenerationId?: string;
  startImageVariantId?: string;
  endImageVariantId?: string;
}

/** Task creation context */
interface SegmentTaskContext {
  projectId: string;
  shotId?: string;
  generationId?: string;
  childGenerationId?: string;
  segmentIndex: number;
  pairShotGenerationId?: string;
  projectResolution?: string;
  modelName?: string;
  generationTypeMode?: 'i2v' | 'vace';
  structureInput: { travelGuidance: TravelGuidance; structureVideos: StructureVideoConfig[] } | null;
  /** Original task params from the generation being retried — forwarded so the
   *  resolver can preserve pipeline layout fields (e.g. segment_frames_expanded). */
  originalParams?: Record<string, unknown>;
}

/** Submission configuration */
interface SubmitSegmentTaskInput {
  /** Label for the incoming task placeholder (e.g. "Segment 3") */
  taskLabel: string;
  /** Component name for error context (e.g. "SegmentRegenerateForm") */
  errorContext: string;
  /** Get effective settings from the form hook */
  getSettings: () => SegmentSettings;
  /** Save persisted settings before task creation */
  saveSettings: () => Promise<boolean>;
  /** Whether to save settings (requires pairShotGenerationId) */
  shouldSaveSettings: boolean;
  /** Current enhance prompt ref value */
  shouldEnhance: boolean;
  /** Enhanced prompt already available from the form */
  enhancedPrompt?: string;
  /** Default num frames for enhancement */
  defaultNumFrames: number;
  /** Image context */
  images: SegmentTaskImageContext;
  /** Task context */
  task: SegmentTaskContext;
  /** Task placeholder runner (from useTaskPlaceholder) */
  run: RunTaskPlaceholder;
  /** React Query client for invalidation (for metadata save) */
  queryClient: QueryClient;
  /** Optional callback when generation starts (for optimistic UI) */
  onGenerateStarted?: () => void;
  /** Optional reporting hook for non-fatal side-effect failures. */
  onNonFatalError?: (step: SegmentSubmissionNonFatalStep, error: unknown) => void;
}

type SegmentSubmissionNonFatalStep =
  | 'enhance_prompt'
  | 'metadata_fetch'
  | 'metadata_update';

type BuildTaskParams = (prompt: string, enhancedPromptParam?: string) => IndividualTravelSegmentParams;

interface SubmitSegmentRuntime {
  errorContext: string;
  shouldSaveSettings: boolean;
  saveSettings: () => Promise<boolean>;
  effectiveSettings: SegmentSettings;
  task: SegmentTaskContext;
  queryClient: QueryClient;
  buildParams: BuildTaskParams;
  reportNonFatalError?: (step: SegmentSubmissionNonFatalStep, error: unknown) => void;
}

function buildSubmitParamsBuilder(
  effectiveSettings: SegmentSettings,
  task: SegmentTaskContext,
  images: SegmentTaskImageContext,
): BuildTaskParams {
  const selectedModel = effectiveSettings.selectedModel
    ?? resolveSelectedModelFromModelName(task.modelName);
  const spec = getModelSpec(selectedModel);
  const policy = resolveGenerationPolicy(spec, {
    smoothContinuations: effectiveSettings.smoothContinuations ?? false,
    requestedExecutionMode: task.generationTypeMode ?? 'i2v',
    guidanceKind: (() => {
      const guidance = task.structureInput?.travelGuidance;
      if (!guidance || guidance.kind === 'none') {
        return effectiveSettings.guidanceMode;
      }
      if (guidance.kind === 'uni3c') {
        return 'uni3c';
      }
      return guidance.mode;
    })(),
  });
  const continuationEnabled = task.segmentIndex > 0
    && policy.continuation.enabled
    && policy.continuation.strategy !== undefined;

  return (prompt: string, enhancedPromptParam?: string) => {
    return buildTaskParams(
      { ...effectiveSettings, prompt },
      {
        projectId: task.projectId,
        shotId: task.shotId,
        generationId: task.generationId,
        childGenerationId: task.childGenerationId,
        segmentIndex: task.segmentIndex,
        startImageUrl: images.startImageUrl ?? '',
        endImageUrl: images.endImageUrl,
        startImageGenerationId: images.startImageGenerationId,
        endImageGenerationId: images.endImageGenerationId,
        startImageVariantId: images.startImageVariantId,
        endImageVariantId: images.endImageVariantId,
        pairShotGenerationId: task.pairShotGenerationId,
        projectResolution: task.projectResolution,
        modelName: task.modelName,
        modelType: policy.travelMode,
        ...(continuationEnabled
          ? {
            continuationConfig: {
              strategy: policy.continuation.strategy!,
              overlap_frames: policy.continuation.overlapFrames,
            },
            frameOverlapFromPrevious: policy.continuation.overlapFrames,
          }
          : {
            frameOverlapFromPrevious: 0,
          }),
        ...(enhancedPromptParam ? { enhancedPrompt: enhancedPromptParam } : {}),
        ...(task.structureInput?.travelGuidance ? { travelGuidance: task.structureInput.travelGuidance } : {}),
        skipMotionFields: !spec.supportsMotionFields,
        originalParams: task.originalParams,
      },
    );
  };
}

function applyPromptAffixes(settings: SegmentSettings, prompt: string): string {
  return joinPromptParts(
    [settings.textBeforePrompts, prompt, settings.textAfterPrompts],
    'segment_space',
  );
}

async function createTask(taskParams: ReturnType<BuildTaskParams>): Promise<string> {
  const { project_id, ...input } = taskParams;
  const result = await createTaskRequest({
    project_id,
    family: 'individual_travel_segment',
    input,
  });
  if (!result.task_id) {
    throw new Error('Failed to create task');
  }
  return result.task_id;
}

async function saveEnhancedPromptMetadata(
  runtime: SubmitSegmentRuntime,
  task: SegmentTaskContext,
  queryClient: QueryClient,
  enhancedPromptResult: string,
  promptToEnhance: string,
  basePrompt: string,
): Promise<void> {
  try {
    const updated = await persistSegmentEnhancedPrompt({
      pairShotGenerationId: task.pairShotGenerationId,
      enhancedPrompt: enhancedPromptResult,
      promptToEnhance,
      basePrompt,
      context: runtime.errorContext,
    });

    if (updated && task.pairShotGenerationId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.segments.pairMetadata(task.pairShotGenerationId) });
    }
  } catch (error) {
    const step = error instanceof Error && error.message.includes('load segment metadata')
      ? 'metadata_fetch'
      : 'metadata_update';
    runtime.reportNonFatalError?.(step, error);
  }
}

async function maybeSaveSettings(runtime: SubmitSegmentRuntime): Promise<void> {
  if (runtime.shouldSaveSettings) {
    const didSave = await runtime.saveSettings();
    if (!didSave) {
      throw new Error('Failed to save segment settings before task submission');
    }
  }
}

async function submitStandardSegmentTask(runtime: SubmitSegmentRuntime): Promise<string> {
  await maybeSaveSettings(runtime);
  const finalPrompt = applyPromptAffixes(runtime.effectiveSettings, runtime.effectiveSettings.prompt?.trim() || '');
  const taskParams = runtime.buildParams(finalPrompt);
  return createTask(taskParams);
}

async function enhanceSegmentPrompt(
  runtime: SubmitSegmentRuntime,
  promptToEnhance: string,
  defaultNumFrames: number,
): Promise<string> {
  const { data: enhanceResult, error: enhanceError } = await supabase().functions.invoke('ai-prompt', {
    body: {
      task: 'enhance_segment_prompt',
      prompt: promptToEnhance,
      temperature: 0.7,
      numFrames: runtime.effectiveSettings.numFrames || defaultNumFrames,
    },
  });

  if (enhanceError) {
    runtime.reportNonFatalError?.('enhance_prompt', enhanceError);
    normalizeAndPresentError(enhanceError, {
      context: `${runtime.errorContext}.enhancePrompt`,
      showToast: false,
    });
  }

  return enhanceResult?.enhanced_prompt?.trim() || promptToEnhance;
}

async function submitEnhancedSegmentTask(
  runtime: SubmitSegmentRuntime,
  promptToEnhance: string,
  defaultNumFrames: number,
): Promise<string> {
  await maybeSaveSettings(runtime);

  const enhancedPromptResult = await enhanceSegmentPrompt(runtime, promptToEnhance, defaultNumFrames);
  const originalPrompt = runtime.effectiveSettings.prompt?.trim() || '';
  const originalPromptWithAffixes = applyPromptAffixes(runtime.effectiveSettings, originalPrompt);
  const enhancedPromptWithAffixes = applyPromptAffixes(runtime.effectiveSettings, enhancedPromptResult);

  await saveEnhancedPromptMetadata(
    runtime,
    runtime.task,
    runtime.queryClient,
    enhancedPromptResult,
    promptToEnhance,
    originalPrompt,
  );

  const taskParams = runtime.buildParams(originalPromptWithAffixes, enhancedPromptWithAffixes);
  return createTask(taskParams);
}

/**
 * Submit a segment task, handling both enhanced and standard prompt paths.
 * Uses the task placeholder runner for lifecycle management.
 * Returns immediately — task creation runs in the background (fire-and-forget).
 */
export function submitSegmentTask(input: SubmitSegmentTaskInput): void {
  const {
    taskLabel,
    errorContext,
    getSettings,
    saveSettings,
    shouldSaveSettings,
    shouldEnhance,
    enhancedPrompt,
    defaultNumFrames,
    images,
    task,
    run,
    queryClient,
    onGenerateStarted,
    onNonFatalError,
  } = input;

  const effectiveSettings = getSettings();
  const promptToEnhance = enhancedPrompt?.trim() || effectiveSettings.prompt?.trim() || '';
  const buildParams = buildSubmitParamsBuilder(effectiveSettings, task, images);

  // Notify parent for optimistic UI
  onGenerateStarted?.();

  const runtime: SubmitSegmentRuntime = {
    errorContext,
    shouldSaveSettings,
    saveSettings,
    effectiveSettings,
    task,
    queryClient,
    buildParams,
    reportNonFatalError: onNonFatalError,
  };

  // Fire and forget — run() handles add/resolve/refetch/remove/error lifecycle
  void run({
    taskType: 'individual_travel_segment',
    label: taskLabel,
    context: errorContext,
    toastTitle: 'Failed to create task',
    create: async () => {
      if (shouldEnhance && promptToEnhance) {
        return submitEnhancedSegmentTask(runtime, promptToEnhance, defaultNumFrames);
      }
      return submitStandardSegmentTask(runtime);
    },
  });
}
