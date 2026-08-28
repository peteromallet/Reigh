/**
 * useVideoRegenerateMode - Manages video segment regeneration
 *
 * Handles:
 * - Fetching shot data (aspect ratio, canonical structure settings)
 * - Computing effective resolution for regeneration
 * - Determining if regeneration is available
 * - Extracting segment images
 * - Reapplying canonical shot-level structure defaults onto regenerated tasks
 * - Computing all props for SegmentRegenerateForm
 */

import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { assertDeferredCloudShotOperation } from '@/shared/hooks/shots/shotAuthority';
import { isDeferredCloudDataAuthority } from '@/app/runtime/dataAuthority';
import { ASPECT_RATIO_TO_RESOLUTION } from '@/shared/lib/media/aspectRatios';
import {
  buildTravelGuidanceFromControls,
  getDefaultTravelGuidanceMode,
  getDefaultTravelGuidanceStrength,
  normalizeTravelGuidance,
  resolveTravelGuidanceControls,
} from '@/shared/lib/tasks/travelGuidance';
import { extractSegmentImages } from '@/shared/lib/tasks/travelBetweenImages/segmentImages';
import { updateToolSettingsSupabase } from '@/shared/hooks/settings/useToolSettings';
import { queryKeys } from '@/shared/lib/queryKeys';
import type { SegmentRegenerateFormProps } from '../components/SegmentRegenerateForm';
import type { SegmentSlotModeData } from '../types';
import { SETTINGS_IDS } from '@/shared/lib/settingsIds';
import { TOOL_IDS } from '@/shared/lib/tooling/toolIds';
import type { GenerationRow } from '@/domains/generation/types';
import type { TaskDetailsData } from '../types';
import {
  MODEL_DEFAULTS,
  type SelectedModel,
} from '@/tools/travel-between-images/settings';
import {
  stripDuplicateStructureDetailParams,
  stripLegacyStructureParams,
} from '@/shared/lib/tasks/legacyStructureParams';

interface CurrentSegmentImages {
  startUrl?: string;
  endUrl?: string;
  startGenerationId?: string;
  endGenerationId?: string;
  startShotGenerationId?: string;
  endShotGenerationId?: string;
  startVariantId?: string;
  endVariantId?: string;
  activeChildGenerationId?: string;
}

interface UseVideoRegenerateModeProps {
  isVideo: boolean;
  media: GenerationRow;
  shotId: string | undefined;
  selectedProjectId: string | null;
  actualGenerationId: string | null;
  adjustedTaskDetailsData: TaskDetailsData | undefined;
  primaryVariant: {
    id: string;
    params?: Record<string, unknown> | null;
  } | null;
  currentSegmentImages?: CurrentSegmentImages;
  segmentSlotMode?: SegmentSlotModeData | null;
  // For loading variant settings
  variantParamsToLoad: Record<string, unknown> | null;
  setVariantParamsToLoad: (params: Record<string, unknown> | null) => void;
  // For frame count updates
  onSegmentFrameCountChange?: (pairShotGenerationId: string, frameCount: number) => void;
  currentFrameCount?: number;
}

interface UseVideoRegenerateModeReturn {
  /** Whether regeneration is available for this video */
  canRegenerate: boolean;
  /** Props to pass to SegmentRegenerateForm (null if can't regenerate) */
  regenerateFormProps: SegmentRegenerateFormProps | null;
  /** Whether shot data is still loading */
  isLoadingShotData: boolean;
}

function sanitizeStoredStructureVideos(
  structureVideos: Array<Record<string, unknown>> | null | undefined,
): Array<Record<string, unknown>> {
  return (structureVideos ?? [])
    .filter((video): video is Record<string, unknown> => typeof video?.path === 'string' && video.path.length > 0)
    .map((video) => ({
      path: video.path,
      start_frame: typeof video.start_frame === 'number' ? video.start_frame : 0,
      end_frame: typeof video.end_frame === 'number' ? video.end_frame : null,
      treatment: video.treatment === 'clip' ? 'clip' : 'adjust',
      ...(video.metadata ? { metadata: video.metadata } : {}),
      ...(typeof video.resource_id === 'string' ? { resource_id: video.resource_id } : {}),
    }));
}

const SELECTED_MODELS: SelectedModel[] = ['wan-2.2', 'ltx-2.3', 'ltx-2.3-fast'];

type StructureVideoDefaultsValue = NonNullable<
  NonNullable<SegmentRegenerateFormProps['structure']>['structureVideoDefaults']
>;

function resolveStructureVideoDefaultsForModel(input: {
  selectedModel: SelectedModel;
  structureVideos: Array<Record<string, unknown>> | null | undefined;
  travelGuidance?: unknown;
  structureGuidance?: unknown;
}): StructureVideoDefaultsValue | undefined {
  const modelName = MODEL_DEFAULTS[input.selectedModel].modelName;
  const shotStructureVideos = sanitizeStoredStructureVideos(input.structureVideos);
  const firstStructureVideo = shotStructureVideos[0];
  if (!firstStructureVideo) {
    return undefined;
  }

  const travelGuidance = normalizeTravelGuidance({
    modelName,
    travelGuidance: input.travelGuidance,
    structureGuidance: input.structureGuidance,
    structureVideos: input.structureVideos,
    defaultVideoTreatment: 'adjust',
    defaultUni3cEndPercent: 0.1,
  });

  const controls = resolveTravelGuidanceControls(travelGuidance, {
    defaultMode: getDefaultTravelGuidanceMode(modelName),
    defaultStrength: getDefaultTravelGuidanceStrength(
      modelName,
      getDefaultTravelGuidanceMode(modelName),
    ),
    defaultUni3cEndPercent: 0.1,
  }, modelName);

  return {
    mode: controls.mode,
    motionStrength: controls.strength,
    treatment: ((firstStructureVideo.treatment as string) ?? 'adjust') as 'adjust' | 'clip',
    uni3cEndPercent: controls.uni3cEndPercent,
    cannyIntensity: controls.cannyIntensity,
    depthContrast: controls.depthContrast,
  };
}

export function useVideoRegenerateMode({
  isVideo,
  media,
  shotId,
  selectedProjectId,
  actualGenerationId,
  adjustedTaskDetailsData,
  primaryVariant,
  currentSegmentImages,
  segmentSlotMode,
  variantParamsToLoad,
  setVariantParamsToLoad,
  onSegmentFrameCountChange,
  currentFrameCount,
}: UseVideoRegenerateModeProps): UseVideoRegenerateModeReturn {
  const queryClient = useQueryClient();
  const currentModelName = useMemo(() => {
    const primaryParams = primaryVariant?.params as Record<string, unknown> | undefined;
    const primaryOrchestrator = primaryParams?.orchestrator_details as Record<string, unknown> | undefined;
    const taskParams = adjustedTaskDetailsData?.task?.params as Record<string, unknown> | undefined;
    const taskOrchestrator = taskParams?.orchestrator_details as Record<string, unknown> | undefined;
    const mediaParams = media.params as Record<string, unknown> | undefined;
    const mediaOrchestrator = mediaParams?.orchestrator_details as Record<string, unknown> | undefined;

    return [
      primaryParams?.model_name,
      primaryOrchestrator?.model_name,
      taskParams?.model_name,
      taskOrchestrator?.model_name,
      mediaParams?.model_name,
      mediaOrchestrator?.model_name,
    ].find((value): value is string => typeof value === 'string');
  }, [adjustedTaskDetailsData?.task?.params, media.params, primaryVariant?.params]);

  // Fetch shot's aspect ratio AND structure videos for regeneration
  const { data: shotDataForRegen, isLoading: isLoadingShotData } = useQuery({
    queryKey: queryKeys.shots.regenData(shotId!),
    queryFn: async () => {
      assertDeferredCloudShotOperation('read shot regeneration settings');
      if (!shotId) return null;
      const { data, error } = await supabase().from('shots')
        .select('aspect_ratio, settings')
        .eq('id', shotId)
        .single();
      if (error) {
        return null;
      }

      const allSettings = data?.settings as Record<string, unknown>;
      // Structure videos are stored under 'travel-structure-video' key
      const structureVideoSettings = (allSettings?.[SETTINGS_IDS.TRAVEL_STRUCTURE_VIDEO] ?? {}) as Record<string, unknown>;

      return {
        aspect_ratio: data?.aspect_ratio,
        selected_model: ((allSettings?.[TOOL_IDS.TRAVEL_BETWEEN_IMAGES] ?? {}) as Record<string, unknown>).selectedModel ?? null,
        structure_videos: (structureVideoSettings.structure_videos as unknown[]) ?? null,
        travel_guidance: structureVideoSettings.travel_guidance ?? null,
        travel_guidance_by_model: structureVideoSettings.travel_guidance_by_model ?? null,
        structure_guidance: structureVideoSettings.structure_guidance ?? null,
      };
    },
    enabled: !!shotId && isVideo && isDeferredCloudDataAuthority(),
    staleTime: 60000,
  });

  // Callback to update structure video defaults when "Set as Shot Defaults" is clicked
  const handleUpdateStructureVideoDefaults = useCallback(async (updates: {
    selectedModel?: SelectedModel;
    motionStrength?: number;
    treatment?: 'adjust' | 'clip';
    uni3cEndPercent?: number;
    mode?: ReturnType<typeof getDefaultTravelGuidanceMode>;
    cannyIntensity?: number;
    depthContrast?: number;
  }): Promise<void> => {
    if (!shotId) return;

    const targetSelectedModel = updates.selectedModel ?? 'wan-2.2';
    const targetModelName = MODEL_DEFAULTS[targetSelectedModel].modelName;
    const shotStructureVideos = sanitizeStoredStructureVideos(
      shotDataForRegen?.structure_videos as Array<Record<string, unknown>> | null,
    );
    if (!shotStructureVideos || shotStructureVideos.length === 0) {
      return;
    }

    const currentGuidance = normalizeTravelGuidance({
      modelName: targetModelName,
      travelGuidance: (
        shotDataForRegen?.travel_guidance_by_model as Partial<Record<SelectedModel, unknown>> | undefined
      )?.[targetSelectedModel] ?? shotDataForRegen?.travel_guidance ?? undefined,
      structureGuidance: shotDataForRegen?.structure_guidance ?? undefined,
      structureVideos: shotDataForRegen?.structure_videos ?? undefined,
      defaultVideoTreatment: 'adjust',
      defaultUni3cEndPercent: 0.1,
    });
    const currentControls = resolveTravelGuidanceControls(currentGuidance, {
      defaultMode: getDefaultTravelGuidanceMode(targetModelName),
      defaultStrength: getDefaultTravelGuidanceStrength(
        targetModelName,
        getDefaultTravelGuidanceMode(targetModelName),
      ),
      defaultUni3cEndPercent: 0.1,
    }, targetModelName);

    const updatedVideos = shotStructureVideos.map((video, index) => {
      if (index === 0) {
        return {
          ...video,
          ...(updates.treatment !== undefined && { treatment: updates.treatment }),
        };
      }
      return video;
    });
    const updatedGuidance = buildTravelGuidanceFromControls({
      modelName: targetModelName,
      structureVideos: updatedVideos,
      controls: {
        ...currentControls,
        ...(updates.mode !== undefined ? { mode: updates.mode } : {}),
        ...(updates.motionStrength !== undefined ? { strength: updates.motionStrength } : {}),
        ...(updates.uni3cEndPercent !== undefined ? { uni3cEndPercent: updates.uni3cEndPercent } : {}),
        ...(updates.cannyIntensity !== undefined ? { cannyIntensity: updates.cannyIntensity } : {}),
        ...(updates.depthContrast !== undefined ? { depthContrast: updates.depthContrast } : {}),
      },
      defaultVideoTreatment: updatedVideos[0]?.treatment === 'clip' ? 'clip' : 'adjust',
    });

    const shotSelectedModel = (shotDataForRegen?.selected_model === 'wan-2.2'
      || shotDataForRegen?.selected_model === 'ltx-2.3'
      || shotDataForRegen?.selected_model === 'ltx-2.3-fast'
      ? shotDataForRegen.selected_model
      : 'wan-2.2') as SelectedModel;

    // Update structure video settings and await completion
    await updateToolSettingsSupabase({
      scope: 'shot',
      id: shotId,
      toolId: SETTINGS_IDS.TRAVEL_STRUCTURE_VIDEO,
      patch: {
        structure_videos: updatedVideos,
        travel_guidance: targetSelectedModel === shotSelectedModel ? updatedGuidance ?? null : shotDataForRegen?.travel_guidance ?? null,
        travel_guidance_by_model: {
          ...((shotDataForRegen?.travel_guidance_by_model as Record<string, unknown> | null) ?? {}),
          [targetSelectedModel]: updatedGuidance ?? null,
        },
        structure_guidance: null,
      },
    }, { mode: 'immediate' });

    // Refetch to update UI - await so caller knows when complete
    await Promise.all([
      queryClient.refetchQueries({ queryKey: queryKeys.shots.regenData(shotId!) }),
      queryClient.refetchQueries({ queryKey: queryKeys.settings.byTool(SETTINGS_IDS.TRAVEL_STRUCTURE_VIDEO) }),
    ]);

  }, [
    queryClient,
    shotDataForRegen?.selected_model,
    shotDataForRegen?.structure_guidance,
    shotDataForRegen?.structure_videos,
    shotDataForRegen?.travel_guidance,
    shotDataForRegen?.travel_guidance_by_model,
    shotId,
  ]);

  // Compute effective resolution for regeneration
  const effectiveRegenerateResolution = useMemo(() => {
    const aspectRatio = typeof shotDataForRegen?.aspect_ratio === 'string'
      ? shotDataForRegen.aspect_ratio
      : undefined;

    if (aspectRatio) {
      const shotResolution = ASPECT_RATIO_TO_RESOLUTION[aspectRatio];
      if (shotResolution) {
        return shotResolution;
      }
    }
    return undefined;
  }, [shotDataForRegen?.aspect_ratio]);

  // Determine if regenerate mode is available
  const canRegenerate = useMemo(() => {
    if (!isVideo) return false;

    // Root parent videos cannot be regenerated
    const isRootParent = !media.parent_generation_id;
    if (isRootParent) return false;

    // Join-clips outputs cannot be regenerated
    const mediaParams = media.params as Record<string, unknown> | undefined;
    const toolType = (media.metadata as Record<string, unknown>)?.tool_type || mediaParams?.tool_type;
    if (toolType === TOOL_IDS.JOIN_CLIPS) return false;

    // Need task params to regenerate
    const taskDataParams = adjustedTaskDetailsData?.task?.params;
    if (!taskDataParams && !mediaParams) return false;

    return true;
  }, [isVideo, media, adjustedTaskDetailsData]);

  // Build regenerate form props
  const regenerateFormProps = useMemo((): SegmentRegenerateFormProps | null => {
    if (!canRegenerate || !isVideo) return null;

    const mediaParams = media.params as Record<string, unknown> | undefined;
    const taskDataParams = adjustedTaskDetailsData?.task?.params;

    // Prefer primary variant's params if it has task data
    const primaryParams = primaryVariant?.params as Record<string, unknown> | undefined;
    const primaryHasTaskData = primaryParams && (
      primaryParams.source_task_id ||
      primaryParams.orchestrator_details ||
      primaryParams.additional_loras
    );

    let taskParams = primaryHasTaskData
      ? primaryParams
      : ((taskDataParams ?? mediaParams) as Record<string, unknown>);

    if (!taskParams) return null;

    // Inject the shot-level canonical structure contract back onto the task.
    const shotStructureVideos = sanitizeStoredStructureVideos(
      shotDataForRegen?.structure_videos as Array<Record<string, unknown>> | null,
    );
    const shotSelectedModel = (
      shotDataForRegen?.selected_model === 'wan-2.2'
      || shotDataForRegen?.selected_model === 'ltx-2.3'
      || shotDataForRegen?.selected_model === 'ltx-2.3-fast'
        ? shotDataForRegen.selected_model
        : 'wan-2.2'
    ) as SelectedModel;
    const shotTravelGuidance = normalizeTravelGuidance({
      modelName: MODEL_DEFAULTS[shotSelectedModel].modelName,
      travelGuidance: (
        shotDataForRegen?.travel_guidance_by_model as Partial<Record<SelectedModel, unknown>> | undefined
      )?.[shotSelectedModel] ?? shotDataForRegen?.travel_guidance ?? undefined,
      structureGuidance: shotDataForRegen?.structure_guidance ?? undefined,
      structureVideos: shotDataForRegen?.structure_videos ?? undefined,
      defaultVideoTreatment: 'adjust',
      defaultUni3cEndPercent: 0.1,
    });

    const structureVideoDefaultsByModel = SELECTED_MODELS.reduce((acc, model) => {
      const defaultsForModel = resolveStructureVideoDefaultsForModel({
        selectedModel: model,
        structureVideos: shotDataForRegen?.structure_videos as Array<Record<string, unknown>> | null | undefined,
        travelGuidance: (
          shotDataForRegen?.travel_guidance_by_model as Partial<Record<SelectedModel, unknown>> | undefined
        )?.[model] ?? (model === shotSelectedModel ? shotDataForRegen?.travel_guidance : undefined),
        structureGuidance: shotDataForRegen?.structure_guidance,
      });
      if (defaultsForModel) {
        acc[model] = defaultsForModel;
      }
      return acc;
    }, {} as Partial<Record<SelectedModel, StructureVideoDefaultsValue>>);

    if (shotTravelGuidance) {
      const cleanedTaskParams = { ...taskParams };
      stripLegacyStructureParams(cleanedTaskParams);
      const cleanedOrchestratorDetails = {
        ...((cleanedTaskParams.orchestrator_details as Record<string, unknown>) || {}),
      };
      stripLegacyStructureParams(cleanedOrchestratorDetails);
      stripDuplicateStructureDetailParams(cleanedOrchestratorDetails);
      taskParams = {
        ...cleanedTaskParams,
        travel_guidance: shotTravelGuidance,
        orchestrator_details: {
          ...cleanedOrchestratorDetails,
          travel_guidance: shotTravelGuidance,
        },
      };
    }

    const orchestratorDetails = (taskParams.orchestrator_details || {}) as Record<string, unknown>;

    // Extract segment images
    // CRITICAL: In segment slot mode, ALWAYS use pairData from timeline (fresh data).
    // Task params are stale and may have different images from when the video was generated.
    const segmentIndex = (taskParams.segment_index as number) ?? 0;
    let segmentImageInfo: {
      startUrl?: string;
      endUrl?: string;
      startGenId?: string;
      endGenId?: string;
      startVariantId?: string;
      endVariantId?: string;
      hasImages: boolean;
    };

    if (segmentSlotMode?.pairData) {
      // Segment slot mode: Use timeline pairData (source of truth for current pair)
      segmentImageInfo = {
        startUrl: segmentSlotMode.pairData.startImage?.url,
        endUrl: segmentSlotMode.pairData.endImage?.url,
        startGenId: segmentSlotMode.pairData.startImage?.generationId,
        endGenId: segmentSlotMode.pairData.endImage?.generationId,
        startVariantId: segmentSlotMode.pairData.startImage?.primaryVariantId,
        endVariantId: segmentSlotMode.pairData.endImage?.primaryVariantId,
        hasImages: !!(segmentSlotMode.pairData.startImage?.url || segmentSlotMode.pairData.endImage?.url),
      };
    } else if (currentSegmentImages && (currentSegmentImages.startUrl || currentSegmentImages.endUrl)) {
      // Non-slot mode with currentSegmentImages prop (fresh timeline data)
      segmentImageInfo = {
        startUrl: currentSegmentImages.startUrl,
        endUrl: currentSegmentImages.endUrl,
        startGenId: currentSegmentImages.startGenerationId,
        endGenId: currentSegmentImages.endGenerationId,
        startVariantId: currentSegmentImages.startVariantId,
        endVariantId: currentSegmentImages.endVariantId,
        hasImages: !!(currentSegmentImages.startUrl || currentSegmentImages.endUrl),
      };
    } else {
      // Fallback: Extract from task params (only when not in segment slot mode)
      segmentImageInfo = extractSegmentImages(taskParams, segmentIndex);

      // Last resort: Fall back to inputImages from task details
      if (!segmentImageInfo.hasImages && adjustedTaskDetailsData?.inputImages?.length) {
        const passedImages = adjustedTaskDetailsData.inputImages;
        segmentImageInfo = {
          startUrl: passedImages[0],
          endUrl: passedImages.length > 1 ? passedImages[passedImages.length - 1] : passedImages[0],
          startGenId: undefined,
          endGenId: undefined,
          hasImages: passedImages.length > 0,
        };
      }
    }

    // Extract pair_shot_generation_id
    const pairShotGenerationId = [
      segmentSlotMode?.pairData?.startImage?.id,
      currentSegmentImages?.startShotGenerationId,
      taskParams.pair_shot_generation_id,
      (taskParams.individual_segment_params as Record<string, unknown>)?.pair_shot_generation_id,
    ].find((v): v is string => typeof v === 'string') || undefined;

    // Get childGenerationId
    const parentGenerationId = media.parent_generation_id ||
      (orchestratorDetails.parent_generation_id as string) ||
      (taskParams.parent_generation_id as string) ||
      actualGenerationId ||
      media.id;

    const isChildSegment = parentGenerationId !== actualGenerationId;
    const videoPairShotGenId = (taskParams.pair_shot_generation_id as string) ||
      (taskParams.individual_segment_params as Record<string, unknown>)?.pair_shot_generation_id as string;
    const videoMatchesCurrentSlot = !pairShotGenerationId || !videoPairShotGenId ||
      pairShotGenerationId === videoPairShotGenId;

    const childGenerationId = videoMatchesCurrentSlot
      ? (
        currentSegmentImages?.activeChildGenerationId
        || (isChildSegment ? actualGenerationId ?? undefined : undefined)
      )
      : undefined;

    // Extract structure video props
    // In Timeline Mode with segmentSlotMode, prefer segment-level structure video data
    // over shot-level defaults (since segmentSlotMode has per-segment coverage info)
    const firstStructureVideo = shotStructureVideos?.[0];
    const shotStructureControls = resolveTravelGuidanceControls(shotTravelGuidance, {
      defaultMode: getDefaultTravelGuidanceMode(MODEL_DEFAULTS[shotSelectedModel].modelName),
      defaultStrength: getDefaultTravelGuidanceStrength(
        MODEL_DEFAULTS[shotSelectedModel].modelName,
        getDefaultTravelGuidanceMode(MODEL_DEFAULTS[shotSelectedModel].modelName),
      ),
      defaultUni3cEndPercent: 0.1,
    }, MODEL_DEFAULTS[shotSelectedModel].modelName);
    const shotStructureVideoType = shotStructureControls.mode;
    const shotStructureVideoDefaults = firstStructureVideo ? {
      mode: shotStructureControls.mode,
      motionStrength: shotStructureControls.strength,
      treatment: ((firstStructureVideo.treatment as string) ?? 'adjust') as 'adjust' | 'clip',
      uni3cEndPercent: shotStructureControls.uni3cEndPercent,
      cannyIntensity: shotStructureControls.cannyIntensity,
      depthContrast: shotStructureControls.depthContrast,
    } : undefined;
    const shotStructureVideoUrl = firstStructureVideo?.path as string | undefined;

    // When segmentSlotMode is present (Timeline Mode), it's the authority for structure video data.
    // Its structureVideoType is null (not undefined) when no covering video exists,
    // so we must NOT use ?? which would fall through null to stale shot-level cache.
    const structureVideoType = segmentSlotMode
      ? segmentSlotMode.structureVideoType
      : shotStructureVideoType;
    const structureVideoDefaults = segmentSlotMode
      ? segmentSlotMode.structureVideoDefaults
      : shotStructureVideoDefaults;
    const structureVideoUrl = segmentSlotMode
      ? segmentSlotMode.structureVideoUrl
      : shotStructureVideoUrl;

    // Get frame count from segmentSlotMode.pairData (source of truth for timeline)
    // Fall back to currentFrameCount prop for non-slot-mode usage
    const effectiveFrameCount = segmentSlotMode?.pairData?.frames ?? currentFrameCount;

    return {
      task: {
        params: taskParams as SegmentRegenerateFormProps['task']['params'],
        projectId: selectedProjectId ?? null,
        generationId: parentGenerationId,
        shotId,
        childGenerationId,
        segmentIndex,
      },
      images: {
        startImageUrl: segmentImageInfo.startUrl,
        endImageUrl: segmentImageInfo.endUrl,
        startImageGenerationId: segmentImageInfo.startGenId,
        endImageGenerationId: segmentImageInfo.endGenId,
        startImageVariantId: segmentImageInfo.startVariantId,
        endImageVariantId: segmentImageInfo.endVariantId,
        pairShotGenerationId,
      },
      frame: {
        projectResolution: effectiveRegenerateResolution,
        onFrameCountChange: onSegmentFrameCountChange,
        currentFrameCount: effectiveFrameCount,
        maxFrames: segmentSlotMode?.maxFrameLimit,
      },
      variant: {
        variantParamsToLoad:
          variantParamsToLoad as NonNullable<
            SegmentRegenerateFormProps['variant']
          >['variantParamsToLoad'],
        onVariantParamsLoaded: () => setVariantParamsToLoad(null),
      },
      structure: {
        structureVideoType,
        structureVideoDefaults,
        structureVideoDefaultsByModel,
        structureVideoUrl,
        structureVideoFrameRange: segmentSlotMode?.structureVideoFrameRange,
        onUpdateStructureVideoDefaults: handleUpdateStructureVideoDefaults,
      },
      navigation: {
        endImageShotGenerationId:
          segmentSlotMode?.pairData?.endImage?.id ||
          currentSegmentImages?.endShotGenerationId,
        onNavigateToImage: segmentSlotMode?.onNavigateToImage,
      },
      timeline: {
        isTimelineMode: segmentSlotMode?.isTimelineMode,
        onAddSegmentStructureVideo: segmentSlotMode?.onAddSegmentStructureVideo,
        onUpdateSegmentStructureVideo: segmentSlotMode?.onUpdateSegmentStructureVideo,
        onRemoveSegmentStructureVideo: segmentSlotMode?.onRemoveSegmentStructureVideo,
      },
    };
  }, [
    canRegenerate,
    isVideo,
    media,
    adjustedTaskDetailsData,
    primaryVariant,
    shotDataForRegen,
    selectedProjectId,
    actualGenerationId,
    effectiveRegenerateResolution,
    currentSegmentImages,
    segmentSlotMode,
    variantParamsToLoad,
    setVariantParamsToLoad,
    onSegmentFrameCountChange,
    currentFrameCount,
    shotId,
    handleUpdateStructureVideoDefaults,
  ]);

  return {
    canRegenerate,
    regenerateFormProps,
    isLoadingShotData,
  };
}
