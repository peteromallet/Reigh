import { useLastAffectedShot } from '@/shared/hooks/shots/useLastAffectedShot';
import { useQuickShotCreate } from '@/shared/hooks/useQuickShotCreate';
import { useMediaGalleryItemShotActions } from './useShotActions';
import type { GeneratedImageWithMetadata, SimplifiedShotOption } from '@/shared/components/MediaGallery/types';
import type { AddToShotHandler } from '@/shared/types/imageHandlers';

interface UseMediaGalleryItemShotWorkflowParams {
  image: GeneratedImageWithMetadata;
  generationIdForActions: string;
  simplifiedShotOptions: SimplifiedShotOption[];
  selectedShotIdLocal: string;
  setSelectedShotIdLocal: (shotId: string) => void;
  setAddingToShotImageId: (id: string | null) => void;
  setAddingToShotWithoutPositionImageId?: (id: string | null) => void;
  onAddToLastShot?: AddToShotHandler;
  onAddToLastShotWithoutPosition?: AddToShotHandler;
  onShowTick: (imageId: string) => void;
  onShowSecondaryTick?: (imageId: string) => void;
  onOptimisticUnpositioned?: (imageId: string, shotId: string) => void;
  onOptimisticPositioned?: (imageId: string, shotId: string) => void;
  isMobile: boolean;
}

export function useMediaGalleryItemShotWorkflow({
  image,
  generationIdForActions,
  simplifiedShotOptions,
  selectedShotIdLocal,
  setSelectedShotIdLocal,
  setAddingToShotImageId,
  setAddingToShotWithoutPositionImageId,
  onAddToLastShot,
  onAddToLastShotWithoutPosition,
  onShowTick,
  onShowSecondaryTick,
  onOptimisticUnpositioned,
  onOptimisticPositioned,
  isMobile,
}: UseMediaGalleryItemShotWorkflowParams) {
  const { setLastAffectedShotId: updateLastAffectedShotId } = useLastAffectedShot();
  const {
    quickCreateSuccess,
    handleQuickCreateAndAdd,
    handleVisitCreatedShot,
  } = useQuickShotCreate({
    generationId: generationIdForActions,
    generationPreview: {
      imageUrl: image.url ?? undefined,
      thumbUrl: image.thumbUrl ?? undefined,
      type: image.type,
      location: image.location,
    },
    shots: simplifiedShotOptions,
    onShotChange: (shotId) => {
      updateLastAffectedShotId(shotId);
      setSelectedShotIdLocal(shotId);
    },
    onLoadingStart: () => setAddingToShotImageId(image.id),
    onLoadingEnd: () => setAddingToShotImageId(null),
  });

  const { addToShot, addToShotWithoutPosition } = useMediaGalleryItemShotActions({
    imageId: image.id,
    generationId: generationIdForActions,
    imageUrl: image.url ?? '',
    thumbUrl: image.thumbUrl ?? image.url ?? '',
    displayUrl: image.url ?? '',
    selectedShotId: selectedShotIdLocal,
    isMobile,
    onAddToLastShot,
    onAddToLastShotWithoutPosition,
    onShowTick,
    onShowSecondaryTick,
    onOptimisticPositioned,
    onOptimisticUnpositioned,
    setAddingToShotImageId,
    setAddingToShotWithoutPositionImageId,
  });

  return {
    quickCreateSuccess,
    handleQuickCreateAndAdd,
    handleVisitCreatedShot,
    addToShot,
    addToShotWithoutPosition,
  };
}
