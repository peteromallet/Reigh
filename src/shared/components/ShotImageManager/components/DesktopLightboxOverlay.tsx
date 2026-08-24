import React from 'react';
import { MediaLightbox } from '@/domains/media-lightbox/MediaLightbox';
import type { Shot } from '@/domains/generation/types';
import type { GenerationRow } from '@/domains/generation/types';
import type { ShotImageManagerProps } from '@/shared/components/ShotImageManager/types';
import type { useLightbox } from '@/shared/components/ShotImageManager/hooks/useLightbox';
import type { useOptimisticOrder } from '@/shared/components/ShotImageManager/hooks/useOptimisticOrder';
import type { useExternalGenerations } from '@/shared/components/ShotImageManager/hooks/useExternalGenerations';

type MediaLightboxProps = React.ComponentProps<typeof MediaLightbox>;
type DesktopLightboxManagerProps = Pick<
  ShotImageManagerProps,
  | 'images'
  | 'shotId'
  | 'toolTypeOverride'
  | 'selectedShotId'
  | 'readOnly'
  | 'onImageDelete'
  | 'allShots'
  | 'onShotChange'
  | 'onAddToShot'
  | 'onAddToShotWithoutPosition'
  | 'onCreateShot'
>;

interface DesktopLightboxOverlayProps {
  lightbox: ReturnType<typeof useLightbox>;
  optimistic: ReturnType<typeof useOptimisticOrder>;
  externalGens: ReturnType<typeof useExternalGenerations>;
  managerProps: DesktopLightboxManagerProps;
  lightboxSelectedShotId?: string;
  setLightboxSelectedShotId?: (shotId: string | undefined) => void;
  taskDetailsData?: MediaLightboxProps['taskDetailsData'];
  capturedVariantIdRef: React.MutableRefObject<string | null>;
  showTickForImageId: string | null;
  onShowTick: (id: string | null) => void;
  showTickForSecondaryImageId: string | null;
  onShowSecondaryTick: (id: string | null) => void;
  onNavigateToShot?: (shot: Shot) => void;
  adjacentSegments: MediaLightboxProps['adjacentSegments'];
  includeDeleteAction?: boolean;
  onMissingGenerationNavigate?: (generationId: string) => void;
}

export function DesktopLightboxOverlay({
  lightbox,
  optimistic,
  externalGens,
  managerProps,
  lightboxSelectedShotId,
  setLightboxSelectedShotId,
  taskDetailsData,
  capturedVariantIdRef,
  showTickForImageId,
  onShowTick,
  showTickForSecondaryImageId,
  onShowSecondaryTick,
  onNavigateToShot,
  adjacentSegments,
  includeDeleteAction = true,
  onMissingGenerationNavigate,
}: DesktopLightboxOverlayProps): React.ReactElement | null {
  if (lightbox.lightboxIndex === null || !lightbox.currentImages[lightbox.lightboxIndex]) {
    return null;
  }

  const lightboxIndex = lightbox.lightboxIndex;
  const baseImagesCount =
    optimistic.optimisticOrder && optimistic.optimisticOrder.length > 0
      ? optimistic.optimisticOrder.length
      : (managerProps.images || []).length;
  const isExternalGen = lightboxIndex >= baseImagesCount;

  let hasNext: boolean;
  let hasPrevious: boolean;

  if (externalGens.derivedNavContext) {
    const currentId = lightbox.currentImages[lightboxIndex]?.id;
    if (!currentId) {
      hasNext = false;
      hasPrevious = false;
    } else {
      const currentDerivedIndex = externalGens.derivedNavContext.derivedGenerationIds.indexOf(currentId);
      hasNext =
        currentDerivedIndex !== -1 &&
        currentDerivedIndex < externalGens.derivedNavContext.derivedGenerationIds.length - 1;
      hasPrevious = currentDerivedIndex !== -1 && currentDerivedIndex > 0;
    }
  } else {
    hasNext = lightboxIndex < lightbox.currentImages.length - 1;
    hasPrevious = lightboxIndex > 0;
  }

  const currentImage = lightbox.currentImages[lightboxIndex];
  const currentImageShotId = (currentImage as GenerationRow & { shot_id?: string }).shot_id;
  const currentImageAssociations = (
    currentImage as GenerationRow & {
      all_shot_associations?: Array<{ shot_id: string; timeline_frame?: number | null }>;
    }
  ).all_shot_associations;
  const effectiveSelectedShotId = lightboxSelectedShotId || managerProps.selectedShotId;
  const isInSelectedShot =
    !isExternalGen &&
    Boolean(effectiveSelectedShotId) &&
    (managerProps.shotId === effectiveSelectedShotId ||
      currentImageShotId === effectiveSelectedShotId ||
      (Array.isArray(currentImageAssociations) &&
        currentImageAssociations.some((assoc) => assoc.shot_id === effectiveSelectedShotId)));

  const positionedInSelectedShot = isInSelectedShot
    ? currentImage.timeline_frame !== null && currentImage.timeline_frame !== undefined
    : undefined;
  const associatedWithoutPositionInSelectedShot = isInSelectedShot
    ? currentImage.timeline_frame === null || currentImage.timeline_frame === undefined
    : undefined;

  return (
    <MediaLightbox
      media={lightbox.currentImages[lightboxIndex]}
      shotId={managerProps.shotId}
      toolTypeOverride={managerProps.toolTypeOverride}
      initialVariantId={capturedVariantIdRef.current ?? undefined}
      onClose={() => {
        capturedVariantIdRef.current = null;
        lightbox.setLightboxIndex(null);
        lightbox.setShouldAutoEnterInpaint(false);
        externalGens.setDerivedNavContext(null);
        externalGens.setTempDerivedGenerations([]);
        if (isExternalGen) {
          externalGens.setExternalGenLightboxSelectedShot(managerProps.selectedShotId);
        }
        setLightboxSelectedShotId?.(managerProps.selectedShotId);
      }}
      navigation={{
        onNext: lightbox.handleNext,
        onPrevious: lightbox.handlePrevious,
        showNavigation: true,
        hasNext,
        hasPrevious,
      }}
      features={{
        showImageEditTools: true,
        showDownload: true,
        showMagicEdit: true,
        showTaskDetails: true,
        initialEditActive: lightbox.shouldAutoEnterInpaint,
      }}
      actions={{
        onDelete: includeDeleteAction && !managerProps.readOnly
          ? () => {
              const activeImage = lightbox.currentImages[lightboxIndex];
              managerProps.onImageDelete(activeImage.id);
            }
          : undefined,
        starred: lightbox.currentImages[lightboxIndex]?.starred || false,
      }}
      readOnly={managerProps.readOnly}
      taskDetailsData={taskDetailsData}
      onNavigateToGeneration={(generationId: string) => {
        const index = lightbox.currentImages.findIndex((img: GenerationRow) => img.id === generationId);
        if (index !== -1) {
          lightbox.setLightboxIndex(index);
        } else if (onMissingGenerationNavigate) {
          onMissingGenerationNavigate(generationId);
        }
      }}
      onOpenExternalGeneration={externalGens.handleOpenExternalGeneration}
      shotWorkflow={{
        allShots: managerProps.allShots,
        selectedShotId: isExternalGen
          ? externalGens.externalGenLightboxSelectedShot
          : lightboxSelectedShotId || managerProps.selectedShotId,
        onShotChange: isExternalGen
          ? (shotId) => {
              externalGens.setExternalGenLightboxSelectedShot(shotId);
            }
          : (shotId) => {
              setLightboxSelectedShotId?.(shotId);
              managerProps.onShotChange?.(shotId);
            },
        onAddToShot: isExternalGen ? externalGens.handleExternalGenAddToShot : managerProps.onAddToShot,
        onAddToShotWithoutPosition: isExternalGen
          ? externalGens.handleExternalGenAddToShotWithoutPosition
          : managerProps.onAddToShotWithoutPosition,
        onCreateShot: managerProps.onCreateShot,
        positionedInSelectedShot,
        associatedWithoutPositionInSelectedShot,
        onShowTick,
        onShowSecondaryTick,
        onNavigateToShot,
      }}
      showTickForImageId={showTickForImageId}
      showTickForSecondaryImageId={showTickForSecondaryImageId}
      adjacentSegments={adjacentSegments}
    />
  );
}
