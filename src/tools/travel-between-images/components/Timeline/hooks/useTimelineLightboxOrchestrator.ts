import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/shared/hooks/mobile";
import { normalizeAndPresentError } from "@/shared/lib/errorHandling/runtimeError";
import { usePendingImageOpen } from "@/shared/hooks/usePendingImageOpen";
import { useDerivedNavigation } from "@/tools/travel-between-images/hooks/navigation/useDerivedNavigation";
import { useExternalGenerations } from "@/shared/components/ShotImageManager/hooks/useExternalGenerations";
import type { SegmentSlot } from "@/shared/hooks/segments";
import type { GenerationRow } from "@/domains/generation/types";
import { useAdjacentSegments } from "./segment/useAdjacentSegments";
import { useLightbox } from "./useLightbox";
import { useGenerationTaskDetails } from "@/shared/components/TaskDetails/hooks/useGenerationTaskDetails";

interface UseTimelineLightboxOrchestratorInput {
  shotId: string;
  projectId?: string;
  images: GenerationRow[];
  selectedShotId?: string;
  onAddToShot?: (
    targetShotId: string,
    generationId: string,
    imageUrl?: string,
    thumbUrl?: string,
  ) => Promise<boolean>;
  onAddToShotWithoutPosition?: (
    targetShotId: string,
    generationId: string,
    imageUrl?: string,
    thumbUrl?: string,
  ) => Promise<boolean>;
  segmentSlots?: SegmentSlot[];
  onOpenSegmentSlot?: (pairIndex: number) => void;
  pendingImageToOpen?: string | null;
  pendingImageVariantId?: string | null;
  onClearPendingImageToOpen?: () => void;
  navigateWithTransition?: (doNavigation: () => void) => void;
}

interface LightboxShotState {
  isExternalGen: boolean;
  positionedInSelectedShot: boolean | undefined;
  associatedWithoutPositionInSelectedShot: boolean | undefined;
}

interface GenerationWithShotAssociations extends GenerationRow {
  shot_id?: string;
  all_shot_associations?: Array<{
    shot_id: string;
    position: number | null;
    timeline_frame?: number | null;
  }>;
}

export function useTimelineLightboxOrchestrator({
  shotId,
  projectId,
  images,
  selectedShotId,
  onAddToShot,
  onAddToShotWithoutPosition,
  segmentSlots,
  onOpenSegmentSlot,
  pendingImageToOpen,
  pendingImageVariantId,
  onClearPendingImageToOpen,
  navigateWithTransition,
}: UseTimelineLightboxOrchestratorInput) {
  const isMobile = useIsMobile();
  const [lightboxSelectedShotId, setLightboxSelectedShotId] = useState<string | undefined>(selectedShotId || shotId);
  const setLightboxIndexRef = useRef<(index: number) => void>(() => {});

  const externalGens = useExternalGenerations({
    selectedShotId: shotId,
    optimisticOrder: images,
    images,
    setLightboxIndexRef,
  });

  const currentImages = useMemo(() => {
    return [...images, ...externalGens.externalGenerations, ...externalGens.tempDerivedGenerations];
  }, [images, externalGens.externalGenerations, externalGens.tempDerivedGenerations]);

  const {
    lightboxIndex,
    initialEditActive,
    goNext,
    goPrev,
    closeLightbox: closeBaseLightbox,
    openLightbox,
    openLightboxWithInpaint,
    handleDesktopDoubleClick,
    handleMobileTap,
    showNavigation,
    setLightboxIndex,
  } = useLightbox({ images: currentImages, shotId, isMobile });

  useEffect(() => {
    setLightboxIndexRef.current = setLightboxIndex;
  }, [setLightboxIndex]);

  const closeLightbox = useCallback(() => {
    externalGens.setExternalGenerations([]);
    externalGens.setTempDerivedGenerations([]);
    externalGens.setDerivedNavContext(null);
    closeBaseLightbox();
  }, [
    closeBaseLightbox,
    externalGens.setDerivedNavContext,
    externalGens.setExternalGenerations,
    externalGens.setTempDerivedGenerations,
  ]);

  const capturedVariantIdRef = usePendingImageOpen({
    pendingImageToOpen,
    pendingImageVariantId,
    images: currentImages,
    openLightbox,
    onClear: onClearPendingImageToOpen,
  });

  const {
    wrappedGoNext,
    wrappedGoPrev,
    hasNext,
    hasPrevious,
  } = useDerivedNavigation({
    derivedNavContext: externalGens.derivedNavContext,
    lightboxIndex,
    currentImages,
    handleOpenExternalGeneration: externalGens.handleOpenExternalGeneration,
    goNext,
    goPrev,
  });

  const currentLightboxImage = lightboxIndex !== null ? currentImages[lightboxIndex] : null;

  const adjacentSegmentsData = useAdjacentSegments({
    segmentSlots,
    onOpenSegmentSlot,
    lightboxIndex,
    images,
    currentImages,
    closeLightbox,
    navigateWithTransition,
  });

  const handleAddToShotAdapter = useCallback(async (
    targetShotId: string,
    generationId: string,
  ): Promise<boolean> => {
    if (!onAddToShot || !targetShotId) return false;
    try {
      await onAddToShot(targetShotId, generationId, undefined);
      return true;
    } catch (error) {
      normalizeAndPresentError(error, { context: "Timeline", toastTitle: "Failed to add to shot" });
      return false;
    }
  }, [onAddToShot]);

  const handleAddToShotWithoutPositionAdapter = useCallback(async (
    targetShotId: string,
    generationId: string,
  ): Promise<boolean> => {
    if (!onAddToShotWithoutPosition || !targetShotId) return false;
    try {
      await onAddToShotWithoutPosition(targetShotId, generationId);
      return true;
    } catch (error) {
      normalizeAndPresentError(error, { context: "Timeline", toastTitle: "Failed to add to shot" });
      return false;
    }
  }, [onAddToShotWithoutPosition]);

  const {
    task,
    isLoadingTask,
    taskError,
    inputImages,
  } = useGenerationTaskDetails({
    generationId: currentLightboxImage?.generation_id || null,
    projectId: projectId ?? null,
    enabled: lightboxIndex !== null,
  });

  useEffect(() => {
    if (!currentLightboxImage || lightboxIndex === null) return;

    const nextImage = hasNext ? currentImages[lightboxIndex + 1] : null;
    if (nextImage?.imageUrl) {
      const img = new window.Image();
      img.src = nextImage.imageUrl;
    }

    const prevImage = hasPrevious ? currentImages[lightboxIndex - 1] : null;
    if (prevImage?.imageUrl) {
      const img = new window.Image();
      img.src = prevImage.imageUrl;
    }
  }, [currentImages, currentLightboxImage, hasNext, hasPrevious, lightboxIndex]);

  useEffect(() => {
    if (lightboxIndex !== null && !currentLightboxImage) {
      closeLightbox();
    }
  }, [closeLightbox, currentLightboxImage, lightboxIndex]);

  const lightboxShotState = useMemo<LightboxShotState | null>(() => {
    if (lightboxIndex === null || !currentLightboxImage) return null;

    const isExternalGen = lightboxIndex >= images.length;
    const imageWithAssociations = currentLightboxImage as GenerationWithShotAssociations;
    const isInSelectedShot = !isExternalGen && lightboxSelectedShotId && (
      shotId === lightboxSelectedShotId
      || imageWithAssociations.shot_id === lightboxSelectedShotId
      || (Array.isArray(imageWithAssociations.all_shot_associations)
        && imageWithAssociations.all_shot_associations.some((assoc) => assoc.shot_id === lightboxSelectedShotId))
    );

    return {
      isExternalGen,
      positionedInSelectedShot: isInSelectedShot
        ? currentLightboxImage.timeline_frame !== null && currentLightboxImage.timeline_frame !== undefined
        : undefined,
      associatedWithoutPositionInSelectedShot: isInSelectedShot
        ? currentLightboxImage.timeline_frame === null || currentLightboxImage.timeline_frame === undefined
        : undefined,
    };
  }, [currentLightboxImage, images.length, lightboxIndex, lightboxSelectedShotId, shotId]);

  return {
    lightbox: {
      lightboxIndex,
      initialEditActive,
      showNavigation,
      openLightbox,
      openLightboxWithInpaint,
      closeLightbox,
      handleDesktopDoubleClick,
      handleMobileTap,
      goNext: wrappedGoNext,
      goPrev: wrappedGoPrev,
      hasNext,
      hasPrevious,
      capturedVariantIdRef,
    },
    media: {
      currentImages,
      currentLightboxImage,
    },
    external: externalGens,
    shotSelection: {
      lightboxSelectedShotId,
      setLightboxSelectedShotId,
      lightboxShotState,
      addToShot: onAddToShot ? handleAddToShotAdapter : undefined,
      addToShotWithoutPosition: onAddToShotWithoutPosition ? handleAddToShotWithoutPositionAdapter : undefined,
      adjacentSegmentsData,
    },
    taskDetails: {
      task,
      isLoadingTask,
      taskError,
      inputImages,
    },
  };
}
