/**
 * SegmentOutputStrip - Compact strip showing segment outputs above timeline
 *
 * Displays generated video segments aligned with their corresponding image pairs.
 * Each segment is positioned to match the timeline pair below it.
 *
 * Logic extracted to useSegmentOutputStrip hook — this file is rendering-only.
 */

import React from 'react';
import { Loader2, X } from 'lucide-react';
import { MediaLightbox } from '@/domains/media-lightbox/MediaLightbox';
import { DesktopScrubbingPreview } from '@/shared/components/ShotImageManager/components/DesktopScrubbingPreview';
import { InlineSegmentVideo } from '@/shared/components/InlineSegmentVideo';
import { TIMELINE_HORIZONTAL_PADDING } from './constants';

import type { PairData } from '@/shared/types/pairData';
import type { SegmentSlot } from '@/shared/hooks/segments';
import { useSegmentOutputStrip } from './hooks/segment/useSegmentOutputStrip';

interface PairInfo {
  index: number;
  startId: string;
  endId: string;
  startFrame: number;
  endFrame: number;
  frames: number;
}

interface SegmentOutputStripProps {
  shotId: string;
  projectId?: string | null;
  projectAspectRatio?: string;
  pairInfo: PairInfo[];
  fullMin: number;
  fullMax: number;
  fullRange: number;
  containerWidth: number;
  zoomLevel: number;
  segmentSlots: SegmentSlot[];
  isLoading?: boolean;
  localShotGenPositions?: Map<string, number>;
  hasPendingTask?: (pairShotGenerationId: string | null | undefined) => boolean;
  onOpenPairSettings?: (pairIndex: number) => void;
  selectedParentId?: string | null;
  pairDataByIndex?: Map<number, PairData>;
  onSegmentFrameCountChange?: (pairShotGenerationId: string, frameCount: number) => void;
  trailingSegmentMode?: {
    imageId: string;
    imageFrame: number;
    endFrame: number;
  };
  readOnly?: boolean;
  onAddTrailingSegment?: () => void;
  onRemoveTrailingSegment?: () => void;
  isMultiImage?: boolean;
  lastImageFrame?: number;
  onTrailingVideoInfo?: (videoUrl: string | null) => void;
}

export const SegmentOutputStrip: React.FC<SegmentOutputStripProps> = ({
  shotId,
  projectAspectRatio,
  pairInfo,
  fullMin,
  fullRange,
  containerWidth,
  zoomLevel,
  segmentSlots: rawSegmentSlots,
  isLoading = false,
  hasPendingTask: hasPendingTaskProp,
  onOpenPairSettings,
  selectedParentId,
  pairDataByIndex,
  onSegmentFrameCountChange,
  trailingSegmentMode,
  readOnly = false,
  onAddTrailingSegment,
  onRemoveTrailingSegment,
  isMultiImage = false,
  lastImageFrame,
  onTrailingVideoInfo,
}) => {
  const {
    // Refs
    previewVideoRef,
    stripContainerRef,
    // Mobile
    isMobile,
    // Display data
    positionedSlots,
    addTrailingButtonLeftPercent,
    hasPendingTask,
    hasRecentMismatch,
    // Scrubbing
    activeScrubbingIndex,
    activeSegmentSlot,
    activeSegmentVideoUrl,
    scrubbing,
    previewPosition,
    previewDimensions,
    clampedPreviewX,
    handleScrubbingStart,
    // Lightbox
    lightboxMedia,
    lightboxCurrentSegmentImages,
    lightboxCurrentFrameCount,
    currentLightboxMedia,
    childSlotIndices,
    handleSegmentClick,
    handleLightboxNext,
    handleLightboxPrev,
    handleLightboxClose,
    // Deletion
    deletingSegmentId,
    handleDeleteSegment,
  } = useSegmentOutputStrip({
    shotId,
    projectAspectRatio,
    containerWidth,
    fullMin,
    fullRange,
    pairInfo,
    rawSegmentSlots,
    trailingSegmentMode,
    pairDataByIndex,
    hasPendingTaskProp,
    readOnly,
    onTrailingVideoInfo,
    selectedParentId,
    onSegmentFrameCountChange,
    isMultiImage,
    lastImageFrame,
  });

  // Don't render if no pairs AND not in single-image mode
  if (pairInfo.length === 0 && !trailingSegmentMode) {
    return null;
  }

  return (
    <div className="w-full relative" ref={stripContainerRef}>
      <DesktopScrubbingPreview
        activeScrubbingIndex={activeScrubbingIndex}
        activeSegmentSlot={activeSegmentSlot}
        activeSegmentVideoUrl={activeSegmentVideoUrl ?? null}
        clampedPreviewX={clampedPreviewX}
        previewY={previewPosition.y}
        previewDimensions={previewDimensions}
        previewVideoRef={previewVideoRef}
        scrubbing={scrubbing}
      />

      {/* Segment output strip - compact height for segment thumbnails */}
      <div
        className="relative h-32 mt-3 mb-1"
        style={{
          width: zoomLevel > 1 ? `${zoomLevel * 100}%` : '100%',
          minWidth: '100%',
          paddingLeft: `${TIMELINE_HORIZONTAL_PADDING}px`,
          paddingRight: `${TIMELINE_HORIZONTAL_PADDING}px`,
          overflow: 'visible',
        }}
      >
        {/* Segment thumbnails - positioned to align with timeline pairs */}
        <div className="absolute left-0 right-0 top-5 bottom-1 overflow-visible">
          {positionedSlots.length > 0 ? (
            <div className="relative w-full h-full">
              {positionedSlots.map((positioned, index) => {
                const { slot } = positioned;
                const isActiveScrubbing = activeScrubbingIndex === index;

                // Check if source images have recent changes (for warning indicator)
                const segmentId = slot.type === 'child' ? slot.child.id : null;
                const hasSourceChanged = segmentId ? hasRecentMismatch(segmentId) : false;

                return (
                  <React.Fragment key={slot.type === 'child' ? slot.child.id : `placeholder-${index}`}>
                    <InlineSegmentVideo
                      slot={slot}
                      pairIndex={index}
                      onClick={() => {
                        handleSegmentClick(slot, index, onOpenPairSettings);
                      }}
                      projectAspectRatio={projectAspectRatio}
                      isMobile={isMobile}
                      leftPercent={positioned.leftPercent}
                      widthPercent={positioned.widthPercent}
                      onOpenPairSettings={onOpenPairSettings}
                      onDelete={handleDeleteSegment}
                      isDeleting={slot.type === 'child' && slot.child.id === deletingSegmentId}
                      isPending={hasPendingTask(slot.pairShotGenerationId)}
                      hasSourceChanged={hasSourceChanged}
                      // Scrubbing props
                      isScrubbingActive={isActiveScrubbing}
                      onScrubbingStart={(rect: DOMRect) => handleScrubbingStart(index, rect)}
                      scrubbingContainerRef={isActiveScrubbing ? scrubbing.containerRef : undefined}
                      scrubbingContainerProps={isActiveScrubbing ? scrubbing.containerProps : undefined}
                      scrubbingProgress={isActiveScrubbing ? scrubbing.progress : undefined}
                      readOnly={readOnly}
                    />
                    {/* X button to remove trailing segment */}
                    {positioned.isTrailing && onRemoveTrailingSegment && !readOnly &&
                      slot.type !== 'child' && !hasPendingTask(slot.pairShotGenerationId) && (
                      <button
                        className="absolute z-20 w-5 h-5 rounded-full bg-muted/90 hover:bg-destructive border border-border/50 hover:border-destructive flex items-center justify-center text-muted-foreground hover:text-destructive-foreground transition-all duration-150"
                        style={{
                          left: `calc(${positioned.leftPercent + positioned.widthPercent}% - 8px)`,
                          top: '-4px',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveTrailingSegment();
                        }}
                        title="Remove trailing segment"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </React.Fragment>
                );
              })}

              {/* Add trailing segment button */}
              {addTrailingButtonLeftPercent !== null && onAddTrailingSegment && !readOnly && (
                <button
                  className="absolute top-0 bottom-0 w-7 rounded-md bg-muted/30 border-2 border-dashed border-border/40 hover:bg-muted/50 hover:border-primary/40 flex items-center justify-center cursor-pointer transition-all duration-150 group"
                  style={{ left: `calc(${addTrailingButtonLeftPercent}% + 2px)` }}
                  onClick={onAddTrailingSegment}
                  title="Add trailing video segment"
                >
                  <span className="text-xl font-light leading-none text-muted-foreground group-hover:text-foreground transition-colors">+</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex-1 h-full flex items-center justify-center text-xs text-muted-foreground">
              {isLoading ? (
                <div className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Loading segments...</span>
                </div>
              ) : (
                <span>No segments generated yet</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox for segment videos */}
      {lightboxMedia && (
        <MediaLightbox
          media={lightboxMedia}
          onClose={handleLightboxClose}
          navigation={{
            onNext: handleLightboxNext,
            onPrevious: handleLightboxPrev,
            showNavigation: true,
            hasNext: childSlotIndices.length > 1,
            hasPrevious: childSlotIndices.length > 1,
          }}
          features={{
            showImageEditTools: false,
            showDownload: true,
            showTaskDetails: true,
          }}
          actions={{
            starred: currentLightboxMedia?.starred ?? false,
          }}
          shotId={shotId}
          videoProps={{
            fetchVariantsForSelf: true,
            currentSegmentImages: lightboxCurrentSegmentImages,
            onSegmentFrameCountChange,
            currentFrameCount: lightboxCurrentFrameCount,
          }}
        />
      )}

    </div>
  );
};
