/**
 * useSharedLightboxState
 *
 * Shared state orchestrator for ImageLightbox and VideoLightbox.
 */

import { useCallback, useMemo } from 'react';
import { useStarToggle } from './useStarToggle';
import { useReferences } from './useReferences';
import { useJoinClips } from './useJoinClips';
import { useGenerationLineage } from './useGenerationLineage';
import { useSourceGeneration } from './useSourceGeneration';
import { useMakeMainVariant } from './useMakeMainVariant';
import { useLightboxNavigation } from './useLightboxNavigation';
import { useSwipeNavigation } from './useSwipeNavigation';
import { useEffectiveMedia } from './useEffectiveMedia';
import { useLayoutMode } from './useLayoutMode';
import { invokeLightboxDelete } from '../utils/lightboxDelete';
import { useSharedLightboxShotState } from './sharedLightbox/useSharedLightboxShotState';
import { useSharedLightboxVariantState } from './sharedLightbox/useSharedLightboxVariantState';
import type {
  LightboxButtonGroupProps,
  UseSharedLightboxStateInput,
  UseSharedLightboxStateReturn,
} from './types';

export type { LightboxButtonGroupProps } from './types';

export function useSharedLightboxState(input: UseSharedLightboxStateInput): UseSharedLightboxStateReturn {
  const { core, navigation: navInput, shots: shotsInput, layout: layoutInput, actions, media: mediaInput } = input;
  const { media, isVideo, selectedProjectId, isMobile, isFormOnlyMode, onClose, readOnly } = core;
  const shotWorkflow = shotsInput.shotWorkflow;

  // --- Variants ---

  const variantState = useSharedLightboxVariantState({
    media,
    variantFetchGenerationId: core.variantFetchGenerationId,
    initialVariantId: core.initialVariantId,
    isFormOnlyMode,
    selectedProjectId,
  });

  // --- Star, references, join clips ---

  const star = useStarToggle({ media, starred: input.starred, shotId: shotsInput.shotId });

  const referencesState = useReferences({
    media,
    selectedProjectId,
    isVideo,
    selectedShotId: shotWorkflow?.selectedShotId,
  });

  const joinState = useJoinClips({ media, isVideo, selectedProjectId });

  // --- Lineage ---

  const lineageState = useGenerationLineage({ media, enabled: !isFormOnlyMode });

  // --- Shots ---

  const shotState = useSharedLightboxShotState({
    media,
    selectedProjectId,
    shotWorkflow,
    onClose,
  });

  // --- Source generation & make-main-variant ---

  const { sourceGenerationData, sourcePrimaryVariant } = useSourceGeneration({
    media,
    onOpenExternalGeneration: input.onOpenExternalGeneration,
  });

  const canMakeMainVariantFromChild = !!sourceGenerationData && !!media.location;
  const canMakeMainVariantFromVariant = variantState.isViewingNonPrimaryVariant && !!variantState.activeVariant?.location;
  const canMakeMainVariant = canMakeMainVariantFromChild || canMakeMainVariantFromVariant;

  const { isMakingMainVariant, handleMakeMainVariant } = useMakeMainVariant({
    media,
    sourceGenerationData,
    canMakeMainVariantFromChild,
    canMakeMainVariantFromVariant,
    activeVariant: variantState.activeVariant,
    setPrimaryVariant: variantState.setPrimaryVariant,
    refetchVariants: variantState.refetchVariants,
    shotId: shotsInput.shotId,
    selectedShotId: shotWorkflow?.selectedShotId,
    onClose,
  });

  // --- Navigation ---

  const { hasNext = false, hasPrevious = false, handleSlotNavNext, handleSlotNavPrev, swipeDisabled, showNavigation } = navInput;

  const { safeClose, activateClickShield } = useLightboxNavigation({
    onNext: handleSlotNavNext,
    onPrevious: handleSlotNavPrev,
    onClose,
  });

  const swipeNavigation = useSwipeNavigation({
    onSwipeLeft: () => {
      if (hasNext) handleSlotNavNext();
    },
    onSwipeRight: () => {
      if (hasPrevious) handleSlotNavPrev();
    },
    disabled: swipeDisabled || readOnly || !showNavigation,
    hasNext,
    hasPrevious,
    threshold: 50,
    velocityThreshold: 0.3,
  });

  // --- Effective media & layout ---

  const { effectiveVideoUrl, effectiveMediaUrl, effectiveImageDimensions } = useEffectiveMedia({
    isVideo,
    activeVariant: variantState.activeVariant,
    effectiveImageUrl: mediaInput.effectiveImageUrl,
    imageDimensions: mediaInput.imageDimensions,
    projectAspectRatio: mediaInput.projectAspectRatio,
  });

  const layout = useLayoutMode({
    isMobile,
    showTaskDetails: layoutInput.showTaskDetails ?? false,
    isSpecialEditMode: layoutInput.isSpecialEditMode,
    isVideo,
    isInpaintMode: layoutInput.isInpaintMode ?? false,
    isMagicEditMode: layoutInput.isMagicEditMode ?? false,
  });

  // --- Button group ---

  const { showDownload, isDownloading, onDelete, isDeleting, isUpscaling, handleUpscale } = actions;

  const handleDelete = useCallback(async () => {
    if (!onDelete) return;
    await invokeLightboxDelete(onDelete, media.id, 'MediaLightbox.delete');
  }, [onDelete, media.id]);

  const buttonGroupProps = useMemo<LightboxButtonGroupProps>(
    () => ({
      topRight: {
        showDownload: !!showDownload,
        isDownloading,
        onDelete,
        handleDelete,
        isDeleting,
        onClose,
      },
      bottomLeft: {
        isUpscaling,
        handleUpscale: async () => {
          handleUpscale();
        },
        localStarred: star.localStarred,
        handleToggleStar: star.handleToggleStar,
        toggleStarPending: star.toggleStarMutation.isPending,
      },
      bottomRight: {
        isAddingToReferences: referencesState.isAddingToReferences,
        addToReferencesSuccess: referencesState.addToReferencesSuccess,
        handleAddToReferences: referencesState.handleAddToReferences,
        handleAddToJoin: joinState.handleAddToJoin,
        isAddingToJoin: joinState.isAddingToJoin,
        addToJoinSuccess: joinState.addToJoinSuccess,
        onGoToJoin: joinState.handleGoToJoin,
      },
    }),
    [
      showDownload,
      isDownloading,
      onDelete,
      handleDelete,
      isDeleting,
      onClose,
      isUpscaling,
      handleUpscale,
      star.localStarred,
      star.handleToggleStar,
      star.toggleStarMutation.isPending,
      referencesState.isAddingToReferences,
      referencesState.addToReferencesSuccess,
      referencesState.handleAddToReferences,
      joinState.handleAddToJoin,
      joinState.isAddingToJoin,
      joinState.addToJoinSuccess,
      joinState.handleGoToJoin,
    ],
  );

  // --- Return ---

  return {
    variants: {
      list: variantState.variants || [],
      primaryVariant: variantState.primaryVariant,
      activeVariant: variantState.activeVariant,
      isLoading: variantState.isLoadingVariants,
      setActiveVariantId: variantState.setActiveVariantId,
      refetch: variantState.refetchVariants,
      setPrimaryVariant: variantState.setPrimaryVariant,
      deleteVariant: variantState.deleteVariant,
      isViewingNonPrimaryVariant: variantState.isViewingNonPrimaryVariant,
      promoteSuccess: variantState.promoteSuccess,
      isPromoting: variantState.isPromoting,
      handlePromoteToGeneration: variantState.handlePromoteToGeneration,
      handleAddVariantAsNewGenerationToShot: variantState.handleAddVariantAsNewGenerationToShot,
    },
    intendedActiveVariantIdRef: variantState.intendedActiveVariantIdRef,
    navigation: {
      safeClose,
      activateClickShield,
      swipeNavigation,
    },
    star: {
      localStarred: star.localStarred,
      setLocalStarred: star.setLocalStarred,
      toggleStarMutation: star.toggleStarMutation,
      handleToggleStar: star.handleToggleStar,
    },
    references: {
      isAddingToReferences: referencesState.isAddingToReferences,
      addToReferencesSuccess: referencesState.addToReferencesSuccess,
      handleAddToReferences: referencesState.handleAddToReferences,
      isAddingToJoin: joinState.isAddingToJoin,
      addToJoinSuccess: joinState.addToJoinSuccess,
      handleAddToJoin: joinState.handleAddToJoin,
      handleGoToJoin: joinState.handleGoToJoin,
    },
    lineage: {
      derivedItems: lineageState.derivedItems || [],
      derivedGenerations: lineageState.derivedGenerations || [],
      derivedPage: lineageState.derivedPage,
      derivedTotalPages: lineageState.derivedTotalPages,
      paginatedDerived: lineageState.paginatedDerived || [],
      setDerivedPage: lineageState.setDerivedPage,
    },
    shots: {
      isAlreadyPositionedInSelectedShot: shotState.isAlreadyPositionedInSelectedShot,
      isAlreadyAssociatedWithoutPosition: shotState.isAlreadyAssociatedWithoutPosition,
      handleAddToShot: shotState.handleAddToShot,
      handleAddToShotWithoutPosition: shotState.handleAddToShotWithoutPosition,
      isCreatingShot: shotState.isCreatingShot,
      quickCreateSuccess: shotState.quickCreateSuccess,
      handleQuickCreateAndAdd: shotState.handleQuickCreateAndAdd,
      handleVisitCreatedShot: shotState.handleVisitCreatedShot,
    },
    sourceGeneration: {
      data: sourceGenerationData,
      primaryVariant: sourcePrimaryVariant,
    },
    makeMainVariant: {
      canMake: canMakeMainVariant,
      canMakeFromChild: canMakeMainVariantFromChild,
      canMakeFromVariant: canMakeMainVariantFromVariant,
      isMaking: isMakingMainVariant,
      handle: handleMakeMainVariant,
    },
    effectiveMedia: {
      videoUrl: effectiveVideoUrl,
      mediaUrl: effectiveMediaUrl,
      imageDimensions: effectiveImageDimensions,
    },
    layout: {
      isTabletOrLarger: layout.isTabletOrLarger,
      isTouchLikeDevice: layout.isTouchLikeDevice,
      shouldShowSidePanel: layout.shouldShowSidePanel,
      isUnifiedEditMode: layout.isUnifiedEditMode,
      isPortraitMode: layout.isPortraitMode,
    },
    buttonGroupProps,
  };
}
