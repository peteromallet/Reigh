import { useMemo } from 'react';
import { useLoadVariantImages } from '@/shared/hooks/variants/useLoadVariantImages';
import { useAdjustedTaskDetails } from '../useAdjustedTaskDetails';
import { useLightboxVariantBadges } from '../useLightboxVariantBadges';
import { useLightboxVideoMode } from '../useLightboxVideoMode';
import {
  buildVariantSegmentImages,
  buildVideoSharedLightboxInput,
} from '../lightboxSharedBuilders';
import { usePanelModeRestore } from '../usePanelModeRestore';
import { useSharedLightboxState } from '../useSharedLightboxState';
import { useVideoEditContextValue } from '../useVideoEditContextValue';
import { useVideoRegenerateMode } from '../useVideoRegenerateMode';
import type { VideoLightboxEnvironment, VideoLightboxModeModel } from './useVideoLightboxEnvironment';
import type { VideoLightboxPropsWithMedia } from '../../types';

function useVideoRegenerateAndMode(
  props: Pick<VideoLightboxPropsWithMedia, 'media' | 'segmentSlotMode' | 'shotId' | 'videoProps'>,
  env: VideoLightboxEnvironment,
  sharedState: ReturnType<typeof useVideoLightboxSharedState>,
  adjustedTaskDetailsData: ReturnType<typeof useAdjustedTaskDetails>['adjustedTaskDetailsData'],
) {
  const currentSegmentImages = props.videoProps?.currentSegmentImages;
  const onSegmentFrameCountChange = props.videoProps?.onSegmentFrameCountChange;
  const currentFrameCount = props.videoProps?.currentFrameCount;
  const onTrimModeChange = props.videoProps?.onTrimModeChange;

  const { canRegenerate, regenerateFormProps } = useVideoRegenerateMode({
    isVideo: true,
    media: props.media,
    shotId: props.shotId,
    selectedProjectId: env.selectedProjectId,
    actualGenerationId: env.actualGenerationId,
    adjustedTaskDetailsData,
    primaryVariant: sharedState.variants.primaryVariant,
    currentSegmentImages,
    segmentSlotMode: props.segmentSlotMode,
    variantParamsToLoad: env.variantParamsToLoad,
    setVariantParamsToLoad: env.setVariantParamsToLoad,
    onSegmentFrameCountChange: props.segmentSlotMode?.onFrameCountChange ?? onSegmentFrameCountChange,
    currentFrameCount,
  });

  const videoMode = useLightboxVideoMode({
    core: {
      media: props.media,
      isVideo: true,
      selectedProjectId: env.selectedProjectId,
      projectAspectRatio: env.projectAspectRatio,
      shotId: props.shotId,
      actualGenerationId: env.actualGenerationId,
      effectiveVideoUrl: sharedState.effectiveMedia.videoUrl ?? env.effectiveImageUrl,
    },
    variants: {
      activeVariant: sharedState.variants.activeVariant,
      setActiveVariantId: sharedState.variants.setActiveVariantId,
      refetchVariants: sharedState.variants.refetch,
    },
    editState: {
      videoEditSubMode: env.videoEditSubMode,
      setVideoEditSubMode: env.setVideoEditSubMode,
      persistedVideoEditSubMode: env.persistedVideoEditSubMode,
      setPersistedPanelMode: env.setPersistedPanelMode,
    },
    enhance: {
      settings: env.enhanceSettings,
      setSettings: env.setEnhanceSettings,
      canRegenerate,
    },
    onTrimModeChange,
  });

  return {
    currentSegmentImages,
    regenerateFormProps,
    videoMode,
  };
}

function useVideoVariantMedia(
  props: Pick<VideoLightboxPropsWithMedia, 'segmentSlotMode'>,
  env: Pick<VideoLightboxEnvironment, 'actualGenerationId' | 'selectedProjectId' | 'variantFetchGenerationId'>,
  sharedState: ReturnType<typeof useVideoLightboxSharedState>,
  currentSegmentImages: NonNullable<VideoLightboxPropsWithMedia['videoProps']>['currentSegmentImages'],
  regenerateFormProps: ReturnType<typeof useVideoRegenerateMode>['regenerateFormProps'],
) {
  const variantBadges = useLightboxVariantBadges({
    pendingTaskGenerationId: regenerateFormProps?.images.pairShotGenerationId || env.actualGenerationId,
    selectedProjectId: env.selectedProjectId,
    variants: sharedState.variants.list,
    variantFetchGenerationId: env.variantFetchGenerationId,
  });

  const variantSegmentImages = useMemo(() => {
    return buildVariantSegmentImages(props.segmentSlotMode, currentSegmentImages);
  }, [props.segmentSlotMode, currentSegmentImages]);

  const { loadVariantImages } = useLoadVariantImages({
    currentSegmentImages: variantSegmentImages,
  });

  return {
    loadVariantImages,
    variantBadges,
    variantSegmentImages,
  };
}

export function useVideoLightboxSharedState(
  props: VideoLightboxPropsWithMedia,
  modeModel: VideoLightboxModeModel,
  env: VideoLightboxEnvironment,
) {
  const input = buildVideoSharedLightboxInput({ props, modeModel, env });
  return useSharedLightboxState(input);
}

export function useVideoLightboxEditing(
  props: VideoLightboxPropsWithMedia,
  modeModel: VideoLightboxModeModel,
  env: VideoLightboxEnvironment,
  sharedState: ReturnType<typeof useVideoLightboxSharedState>,
) {
  const {
    media,
  } = props;
  const initialVideoTrimMode = props.videoProps?.initialVideoTrimMode;

  const { adjustedTaskDetailsData } = useAdjustedTaskDetails({
    projectId: env.selectedProjectId ?? null,
    activeVariant: sharedState.variants.activeVariant,
    taskDetailsData: props.taskDetailsData,
    isLoadingVariants: sharedState.variants.isLoading,
    initialVariantId: props.initialVariantId,
  });
  const {
    currentSegmentImages,
    regenerateFormProps,
    videoMode,
  } = useVideoRegenerateAndMode(props, env, sharedState, adjustedTaskDetailsData);

  usePanelModeRestore({
    mediaId: media?.id || '',
    persistedPanelMode: env.persistedPanelMode,
    isVideo: true,
    isSpecialEditMode: false,
    isInVideoEditMode: videoMode.isInVideoEditMode,
    initialVideoTrimMode,
    initialEditActive: false,
    handleEnterVideoEditMode: videoMode.handleEnterVideoEditMode,
  });

  const videoEditValue = useVideoEditContextValue({
    videoEditSubMode: env.videoEditSubMode,
    setVideoEditSubMode: env.setVideoEditSubMode,
    videoMode,
    isFormOnlyMode: modeModel.isFormOnlyMode,
    variantParamsToLoad: env.variantParamsToLoad,
    setVariantParamsToLoad: env.setVariantParamsToLoad,
    setEnhanceSettings: env.setEnhanceSettings,
  });

  const {
    loadVariantImages,
    variantBadges,
    variantSegmentImages,
  } = useVideoVariantMedia(props, env, sharedState, currentSegmentImages, regenerateFormProps);

  return {
    adjustedTaskDetailsData,
    regenerateFormProps,
    videoMode,
    videoEditValue,
    variantBadges,
    variantSegmentImages,
    loadVariantImages,
  };
}

export type VideoLightboxSharedStateModel = ReturnType<typeof useVideoLightboxSharedState>;
export type VideoLightboxEditModel = ReturnType<typeof useVideoLightboxEditing>;
