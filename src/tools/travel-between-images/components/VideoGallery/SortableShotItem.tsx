import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Shot } from '@/domains/generation/types';
import { VideoShotDisplay } from './VideoShotDisplay';
import { cn } from '@/shared/components/ui/contracts/cn';
import { Loader2, Check } from 'lucide-react';
import {
  createDragPreview,
  setShotDragData,
  type GenerationDropData,
} from '@/shared/lib/dnd/dragDrop';
import { getGenerationId } from '@/shared/lib/media/mediaTypeHelpers';
import { isVideoGeneration } from '@/shared/lib/typeGuards';
import {
  useSortableShotDropFeedback,
  type DropOptions,
} from './hooks/useSortableShotDropFeedback';
export type { DropOptions };

interface SortableShotItemProps {
  shot: Shot;
  onSelectShot: () => void;
  onDuplicateShot?: () => void;
  isHidden?: boolean;
  onToggleHidden?: (e?: React.MouseEvent) => void;
  currentProjectId: string | null;
  isDragDisabled?: boolean;
  disabledReason?: string;
  shouldLoadImages?: boolean;
  shotIndex?: number;
  projectAspectRatio?: string;
  isHighlighted?: boolean;
  onGenerationDrop?: (shotId: string, data: GenerationDropData, options?: DropOptions) => Promise<void>;
  onFilesDrop?: (shotId: string, files: File[], options?: DropOptions) => Promise<void>;
  initialPendingUploads?: number;
  initialPendingBaselineNonVideoCount?: number;
  onInitialPendingUploadsConsumed?: () => void;
  dataTour?: string;
  finalVideo?: import('../../hooks/video/useShotFinalVideos').ShotFinalVideo;
}

export const SortableShotItem: React.FC<SortableShotItemProps> = ({
  shot,
  onSelectShot,
  onDuplicateShot,
  isHidden = false,
  onToggleHidden,
  currentProjectId,
  isDragDisabled = false,
  shouldLoadImages = true,
  shotIndex = 0,
  projectAspectRatio,
  isHighlighted = false,
  onGenerationDrop,
  onFilesDrop,
  initialPendingUploads = 0,
  initialPendingBaselineNonVideoCount,
  onInitialPendingUploadsConsumed,
  dataTour,
  finalVideo,
}) => {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: shot.id,
    disabled: isDragDisabled,
  });

  const {
    isDropTarget,
    isOverWithoutPositionZone,
    withoutPositionDropState,
    withPositionDropState,
    pendingSkeletonCount,
    withoutPositionZoneRef,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleWithoutPositionDrop,
    handleWithoutPositionDragEnter,
    handleWithoutPositionDragOver,
    handleWithoutPositionDragLeave,
  } = useSortableShotDropFeedback({
    shot,
    onGenerationDrop,
    onFilesDrop,
    initialPendingUploads,
    initialPendingBaselineNonVideoCount,
    onInitialPendingUploadsConsumed,
  });

  const style = isDragDisabled
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      };
  const sharedShotDisplayProps = {
    shot,
    onSelectShot,
    onDuplicateShot,
    isHidden,
    onToggleHidden,
    currentProjectId,
    shouldLoadImages,
    shotIndex,
    projectAspectRatio,
    dataTour,
    finalVideo,
  } as const;

  const handleShotDragStart = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const imageGenerationIds = (shot.images ?? [])
      .filter((image) => !isVideoGeneration(image))
      .map((image) => getGenerationId(image))
      .filter((generationId): generationId is string => typeof generationId === 'string' && generationId.length > 0);

    setShotDragData(event, {
      shotId: shot.id,
      shotName: shot.name,
      imageGenerationIds,
    });

    const cleanup = createDragPreview(
      event,
      imageGenerationIds.length > 1 ? { badgeText: String(imageGenerationIds.length) } : undefined,
    );
    if (cleanup) {
      setTimeout(cleanup, 0);
    }
  }, [shot]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      draggable
      onDragStart={handleShotDragStart}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'transition-all duration-200 relative self-start',
        isDropTarget && 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.02]'
      )}
    >
      <VideoShotDisplay
        {...sharedShotDisplayProps}
        isHighlighted={isHighlighted || isDropTarget}
        pendingUploads={pendingSkeletonCount}
        dropLoadingState={withPositionDropState}
      />

      {(isDropTarget || withoutPositionDropState !== 'idle') && (
        <div
          ref={withoutPositionZoneRef}
          onDragEnter={handleWithoutPositionDragEnter}
          onDragOver={handleWithoutPositionDragOver}
          onDragLeave={handleWithoutPositionDragLeave}
          onDrop={handleWithoutPositionDrop}
          className={cn(
            'absolute bottom-2 left-2 px-2 py-1 rounded text-xs font-medium transition-all duration-150 z-10 flex items-center gap-1.5',
            withoutPositionDropState === 'idle' && 'bg-muted/90 text-muted-foreground border border-border/50',
            withoutPositionDropState === 'idle' && isOverWithoutPositionZone && 'bg-primary text-primary-foreground border-primary scale-105',
            withoutPositionDropState === 'loading' && 'bg-primary/90 text-primary-foreground border border-primary',
            withoutPositionDropState === 'success' && 'bg-green-600 text-white border border-green-600'
          )}
        >
          {withoutPositionDropState === 'loading' && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Adding...
            </>
          )}
          {withoutPositionDropState === 'success' && (
            <>
              <Check className="h-3 w-3" />
              Added
            </>
          )}
          {withoutPositionDropState === 'idle' && 'Without Position'}
        </div>
      )}
    </div>
  );
};
