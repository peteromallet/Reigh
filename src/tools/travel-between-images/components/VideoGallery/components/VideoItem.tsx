import React, { useState, useRef, useEffect } from 'react';

import { GenerationRow } from '@/domains/generation/types';
import { Layers, Film } from 'lucide-react';
import { HoverScrubVideo } from '@/shared/components/media/HoverScrubVideo';
import { TimeStamp } from '@/shared/components/TimeStamp';
import { useVideoLoader } from '../hooks/useVideoLoader';
import { useThumbnailLoader } from '../hooks/useThumbnailLoader';
import { useVideoElementIntegration } from '../hooks/useVideoElementIntegration';
import { useMobileVideoPreload } from '../hooks/useMobileVideoPreload';
import { useVideoItemJoinClips } from '../hooks/useVideoItemJoinClips';
import { JoinClipsModal } from './JoinClipsModal';
import { VideoItemActions } from './VideoItemActions';
import { videoItemPropsAreEqual } from './VideoItemMemo';
import { determineVideoPhase, createLoadingSummary } from '../utils/video-loading-utils';
import { getDisplayUrl } from '@/shared/lib/media/mediaUrl';
import { useGenerationTaskMapping } from '@/domains/generation/hooks/tasks/useGenerationTaskMapping';
import { useShareGeneration } from '@/shared/hooks/useShareGeneration';
import { getProjectAspectRatioStyle } from '@/tools/travel-between-images/components/shared/aspectRatio';

interface VideoItemProps {
  video: GenerationRow;
  index: number;
  originalIndex: number;
  shouldPreload: string;
  isMobile: boolean;
  projectAspectRatio?: string;
  onLightboxOpen: (index: number) => void;
  onMobileTap: (index: number) => void;
  onMobilePreload?: (index: number) => void;
  onDelete: (id: string) => void;
  deletingVideoId: string | null;
  onHoverStart: (video: GenerationRow, event: React.MouseEvent) => void;
  onHoverEnd: () => void;
  onMobileModalOpen: (video: GenerationRow) => void;
  selectedVideoForDetails: GenerationRow | null;
  showTaskDetailsModal: boolean;
  onApplySettingsFromTask: (taskId: string, replaceImages: boolean, inputImages: string[]) => void;
  existingShareSlug?: string;
  onShareCreated?: (videoId: string, shareSlug: string) => void;
  projectId?: string | null;
  hideActions?: boolean;
  /** Custom tooltip text for the delete button */
  deleteTooltip?: string;
  /** Optional data-tour attribute for product tour targeting */
  dataTour?: string;
}

export const VideoItem = React.memo<VideoItemProps>(({
  video,
  index,
  originalIndex,
  shouldPreload,
  isMobile,
  projectAspectRatio,
  onLightboxOpen,
  onMobileTap,
  onMobilePreload,
  onDelete,
  deletingVideoId,
  onHoverStart,
  onHoverEnd,
  onMobileModalOpen,
  onApplySettingsFromTask,
  existingShareSlug,
  onShareCreated,
  projectId,
  hideActions = false,
  deleteTooltip,
  dataTour
}) => {
  // Track touch start position to distinguish taps from drags/scrolls
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const TOUCH_MOVE_THRESHOLD = 10; // px - movement beyond this = drag, not tap
  // Get task mapping for this video to enable Apply Settings button
  const { data: taskMapping } = useGenerationTaskMapping(video.id || '');

  // Share functionality (delegated to shared hook)
  const { handleShare, isCreatingShare, shareCopied, shareSlug } = useShareGeneration(
    video.id, taskMapping?.taskId, undefined,
    { initialShareSlug: existingShareSlug, onShareCreated }
  );

  // Join clips feature (child generation fetching, join modal state, join task creation)
  const {
    childGenerations, showCollage, isJoiningClips, showJoinModal, setShowJoinModal,
    handleConfirmJoin, joinSettings,
  } = useVideoItemJoinClips(video, projectId, projectAspectRatio);

  // ===============================================================================
  // HOOKS - Use extracted hooks for cleaner separation of concerns
  // ===============================================================================

  const videoLoader = useVideoLoader(video, index, shouldPreload);
  const thumbnailLoader = useThumbnailLoader(video);

  // Destructure for easier access
  const { shouldLoad, videoMetadataLoaded, videoPosterLoaded, logVideoEvent } = videoLoader;
  const {
    thumbnailLoaded,
    setThumbnailLoaded,
    thumbnailError,
    setThumbnailError,
    hasThumbnail,
    isInitiallyCached,
  } = thumbnailLoader;

  // Hook for video element integration
  const containerRef = useRef<HTMLDivElement>(null);
  useVideoElementIntegration(video, index, shouldLoad, shouldPreload, videoLoader, isMobile, containerRef);

  // ===============================================================================
  // VIDEO TRANSITION STATE - Smooth transition from thumbnail to video
  // ===============================================================================

  // Track when video is fully visible to prevent flashing
  const [videoFullyVisible, setVideoFullyVisible] = useState(false);

  // Reset transition state when video changes to prevent cross-video state contamination
  const prevVideoIdRef = useRef(video.id);
  useEffect(() => {
    if (prevVideoIdRef.current !== video.id) {
      setVideoFullyVisible(false);
      prevVideoIdRef.current = video.id;
    }
  }, [video.id]);

  // Mobile video preloading (hidden <video> element on first tap)
  useMobileVideoPreload(video, originalIndex, isMobile, onMobilePreload);

  // Use ref to persist timeout across re-renders and prevent race conditions
  const transitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing timeout to prevent stale callbacks
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    if (videoPosterLoaded) {
      // Delay hiding thumbnail until video transition completes
      transitionTimeoutRef.current = setTimeout(() => {
        setVideoFullyVisible(true);
        transitionTimeoutRef.current = null;
      }, 350); // Slightly longer than the 200ms transition

      return () => {
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
          transitionTimeoutRef.current = null;
        }
      };
    } else {
      setVideoFullyVisible(false);
    }
  }, [videoPosterLoaded, index, video.id]);

  // ===============================================================================
  // STATE TRACKING - Unified video lifecycle logging
  // ===============================================================================

  const lastLoggedStateRef = useRef<string>('');
  useEffect(() => {
    const currentState = `${shouldLoad}-${videoPosterLoaded}-${videoMetadataLoaded}-${thumbnailLoaded}-${hasThumbnail}`;
    if (currentState !== lastLoggedStateRef.current && import.meta.env.DEV) {
      const { phase, readyToShow } = determineVideoPhase(shouldLoad, videoPosterLoaded, videoMetadataLoaded, thumbnailLoaded, hasThumbnail);

      logVideoEvent(phase, {
        readyToShow,
        shouldLoad,
        videoPosterLoaded,
        videoMetadataLoaded,
        hasThumbnail,
        thumbnailLoaded,
        thumbnailError,
        thumbnailUrl: video.thumbUrl,
        videoUrl: video.location,
        summary: createLoadingSummary(hasThumbnail, thumbnailLoaded, videoPosterLoaded, shouldLoad)
      });

      lastLoggedStateRef.current = currentState;
    }
  }, [shouldLoad, videoPosterLoaded, videoMetadataLoaded, thumbnailLoaded, hasThumbnail, thumbnailError, logVideoEvent, video.thumbUrl, video.location]);

  // ===============================================================================
  // ASPECT RATIO CALCULATION - Dynamic aspect ratio based on project settings
  // ===============================================================================

  const aspectRatioStyle = React.useMemo(
    () => getProjectAspectRatioStyle(projectAspectRatio),
    [projectAspectRatio],
  );

  // ===============================================================================
  // GRID LAYOUT CALCULATION - Dynamic grid based on project aspect ratio
  // ===============================================================================

  // Calculate grid classes based on project aspect ratio
  // ===============================================================================
  // RENDER - Clean component rendering
  // ===============================================================================

  // MOBILE OPTIMIZATION: Use poster images instead of video elements on mobile to prevent autoplay budget exhaustion
  // ALL gallery videos use posters on mobile to leave maximum budget for lightbox autoplay
  const shouldUsePosterOnMobile = isMobile;

  // Determine poster image source: prefer thumbnail, fallback to video poster frame
  const posterImageSrc = (() => {
    if (video.thumbUrl) return video.thumbUrl; // Use thumbnail if available
    if (video.imageUrl) return video.imageUrl; // Try imageUrl next
    if (video.location) return video.location; // Use video URL as final fallback (browser will extract first frame)
    return null; // No source available
  })();

  // Normalize URLs - don't add query parameters as they break browser caching
  const resolvedPosterUrl = posterImageSrc ? getDisplayUrl(posterImageSrc) : '/placeholder.svg';
  const posterSrcStable = resolvedPosterUrl;

  const resolvedThumbUrl = video.thumbUrl ? getDisplayUrl(video.thumbUrl) : null;
  const thumbSrcStable = resolvedThumbUrl;

  return (
    <div className="relative group" style={{ contain: 'layout style paint' }} data-tour={dataTour}>
      <div
        className="bg-gray-100 rounded-lg overflow-hidden shadow-sm border relative"
        style={aspectRatioStyle}
      >

        {showCollage ? (
          // COLLAGE MODE: Show grid of segments for parents without output
          <div
            className="absolute inset-0 w-full h-full cursor-pointer bg-black/5 grid grid-cols-2 gap-0.5 overflow-hidden"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onLightboxOpen(originalIndex);
            }}
            // On mobile/touch devices, use onTouchEnd for immediate response (no double-tap needed)
            onTouchStart={isMobile ? (e) => {
              const touch = e.touches[0];
              touchStartRef.current = { x: touch.clientX, y: touch.clientY };
            } : undefined}
            onTouchEnd={isMobile ? (e) => {
              // Ignore drags/scrolls - only handle taps
              const touch = e.changedTouches[0];
              if (touchStartRef.current) {
                const dx = Math.abs(touch.clientX - touchStartRef.current.x);
                const dy = Math.abs(touch.clientY - touchStartRef.current.y);
                if (dx > TOUCH_MOVE_THRESHOLD || dy > TOUCH_MOVE_THRESHOLD) {
                  touchStartRef.current = null;
                  return;
                }
              }
              touchStartRef.current = null;
              e.stopPropagation();
              e.preventDefault();
              onLightboxOpen(originalIndex);
            } : undefined}
          >
            {childGenerations.slice(0, 4).map((child, idx) => (
              <div key={child.id || idx} className="relative w-full h-full overflow-hidden bg-black/20">
                {(child.thumbUrl || child.imageUrl) && (
                  <img
                    src={getDisplayUrl(child.thumbUrl || child.imageUrl || '')}
                    className="w-full h-full object-cover transition-opacity duration-300"
                    alt={`Segment ${idx + 1}`}
                    loading="lazy"
                    style={{ opacity: 0 }}
                    onLoad={(e) => {
                      (e.target as HTMLImageElement).style.opacity = '0.8';
                    }}
                    onMouseEnter={(e) => {
                      (e.target as HTMLImageElement).style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLImageElement).style.opacity = '0.8';
                    }}
                  />
                )}
              </div>
            ))}
            {/* Overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/10 hover:bg-black/5 transition-colors group-hover:bg-black/20">
              <div className="bg-black/70 backdrop-blur-md text-white px-2 py-1 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-medium flex items-center gap-1 md:gap-2 shadow-lg border border-white/10 transform transition-transform group-hover:scale-105">
                <Layers className="w-3 h-3 md:w-4 md:h-4" />
                View {childGenerations.length} Segments
              </div>
            </div>
          </div>
        ) : shouldUsePosterOnMobile ? (
          // MOBILE POSTER MODE: Show static image - clickable to open lightbox
          <div
            className="absolute inset-0 w-full h-full cursor-pointer bg-gray-100"
            onClick={(e) => {
              // Don't interfere with touches inside action buttons
              const path = e.nativeEvent?.composedPath?.() as HTMLElement[] | undefined;
              const isInsideButton = path ? path.some((el) => (el as HTMLElement)?.tagName === 'BUTTON' || (el as HTMLElement)?.closest?.('button')) : !!(e.target as HTMLElement).closest('button');
              if (isInsideButton) return;
              e.preventDefault();
              e.stopPropagation();
              onMobileTap(originalIndex);
            }}
            onTouchStart={isMobile ? (e) => {
              const touch = e.touches[0];
              touchStartRef.current = { x: touch.clientX, y: touch.clientY };
            } : undefined}
            onTouchEnd={isMobile ? (e) => {
              // Don't interfere with touches inside action buttons
              const path = e.nativeEvent?.composedPath?.() as HTMLElement[] | undefined;
              const isInsideButton = path ? path.some((el) => (el as HTMLElement)?.tagName === 'BUTTON' || (el as HTMLElement)?.closest?.('button')) : !!(e.target as HTMLElement).closest('button');
              if (isInsideButton) {
                touchStartRef.current = null;
                return;
              }
              // Ignore drags/scrolls - only handle taps
              const touch = e.changedTouches[0];
              if (touchStartRef.current) {
                const dx = Math.abs(touch.clientX - touchStartRef.current.x);
                const dy = Math.abs(touch.clientY - touchStartRef.current.y);
                if (dx > TOUCH_MOVE_THRESHOLD || dy > TOUCH_MOVE_THRESHOLD) {
                  touchStartRef.current = null;
                  return;
                }
              }
              touchStartRef.current = null;
              e.preventDefault();
              e.stopPropagation();
              onMobileTap(originalIndex);
            } : undefined}
          >
            {posterImageSrc ? (
              <img
                key={`poster-${video.id}`}
                src={posterSrcStable || resolvedPosterUrl}
                alt="Video poster"
                loading="eager"
                decoding="async"
                className="w-full h-full object-cover transition-opacity duration-200"
                style={{ opacity: 0 }}
                onLoad={(e) => {
                  (e.target as HTMLImageElement).style.opacity = '1';
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300">
                <Film className="h-8 w-8" />
              </div>
            )}
          </div>
        ) : (
          // DESKTOP OR PRIORITY VIDEO MODE: Use actual video element
          <>
            {/* Thumbnail - shows immediately if available, stays visible until video fully transitions */}
            {hasThumbnail && !thumbnailError && (
              <img
                key={`thumb-${video.id}`}
                src={thumbSrcStable || resolvedThumbUrl || ''}
                alt="Video thumbnail"
                loading="eager"
                decoding="async"
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 pointer-events-none ${videoFullyVisible ? 'opacity-0' : 'opacity-100'
                  }`}
                onLoad={() => {
                  setThumbnailLoaded(true);
                }}
                onError={() => {
                  setThumbnailError(true);
                }}
              />
            )}

            {/* Loading placeholder - shows until thumbnail or video poster is ready */}
            {/* Only show spinner if we truly have nothing to display yet */}
            {!thumbnailLoaded && !videoPosterLoaded && !isInitiallyCached && hasThumbnail && (
              <div className={`absolute inset-0 bg-gray-200 flex items-center justify-center z-10 transition-opacity duration-300 pointer-events-none ${videoFullyVisible ? 'opacity-0' : 'opacity-100'}`}>
                <div className="w-6 h-6 border-2 border-gray-400 border-t-gray-600 rounded-full animate-spin"></div>
              </div>
            )}

            {/* Only render video when it's time to load */}
            {shouldLoad && (
              <div
                ref={containerRef}
                className="relative w-full h-full"
                onTouchStart={isMobile ? (e) => {
                  const touch = e.touches[0];
                  touchStartRef.current = { x: touch.clientX, y: touch.clientY };
                } : undefined}
              >
                {/* HoverScrubVideo with loading optimization integration */}
                <HoverScrubVideo
                  key={`video-${video.id}`}
                  src={video.location || video.imageUrl || ''}
                  preload={shouldPreload as 'auto' | 'metadata' | 'none'}
                  loadOnDemand={true}
                  className={`w-full h-full transition-opacity duration-500 ${videoPosterLoaded ? 'opacity-100' : 'opacity-0'
                    }`}
                  videoClassName="object-cover cursor-pointer"
                  poster={thumbSrcStable || video.thumbUrl}
                  data-video-id={video.id}
                  // Interaction events
                  onDoubleClick={isMobile ? undefined : () => {
                    onLightboxOpen(originalIndex);
                  }}
                  onTouchEnd={isMobile ? (e) => {
                    // Don't interfere with touches inside action buttons
                    const path = e.nativeEvent?.composedPath?.() as HTMLElement[] | undefined;
                    const isInsideButton = path ? path.some((el) => (el as HTMLElement)?.tagName === 'BUTTON' || (el as HTMLElement)?.closest?.('button')) : !!(e.target as HTMLElement).closest('button');
                    if (isInsideButton) {
                      touchStartRef.current = null;
                      return;
                    }
                    // Ignore drags/scrolls - only handle taps
                    const touch = e.changedTouches[0];
                    if (touchStartRef.current) {
                      const dx = Math.abs(touch.clientX - touchStartRef.current.x);
                      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
                      if (dx > TOUCH_MOVE_THRESHOLD || dy > TOUCH_MOVE_THRESHOLD) {
                        touchStartRef.current = null;
                        return;
                      }
                    }
                    touchStartRef.current = null;
                    e.preventDefault();
                    onMobileTap(originalIndex);
                  } : undefined}
                />
              </div>
            )}
          </>
        )}

        {/* Top Overlay - Timestamp in top-left (always visible on mobile, hover-only on desktop) */}
        <div className="absolute top-0 left-0 p-3 transition-opacity duration-300 z-20 pointer-events-none">
          <div className="pointer-events-auto inline-flex whitespace-nowrap">
            <TimeStamp createdAt={video.createdAt} showOnHover={!isMobile} />
          </div>
        </div>

        {/* Bottom Overlay - Variant Name */}
        <div className="absolute bottom-0 left-0 right-0 pb-2 pl-3 pr-3 pt-6 flex justify-between items-end bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 pointer-events-none">
          <div className="flex flex-col items-start gap-2 pointer-events-auto">
            {/* Variant Name Display */}
            {video.name && (
              <div className="text-[10px] font-medium text-white/90 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/10 max-w-[120px] truncate preserve-case">
                {video.name}
              </div>
            )}
          </div>
        </div>
        
        {/* Join Clips Settings Modal */}
        <JoinClipsModal
          open={showJoinModal}
          onOpenChange={setShowJoinModal}
          segmentCount={childGenerations.length}
          isJoiningClips={isJoiningClips}
          onConfirmJoin={handleConfirmJoin}
          settings={joinSettings}
        />

        {/* Action buttons – positioned directly on the video/poster container */}
        {!hideActions && (
          <VideoItemActions
            video={video}
            originalIndex={originalIndex}
            isMobile={isMobile}
            deletingVideoId={deletingVideoId}
            deleteTooltip={deleteTooltip}
            taskId={taskMapping?.taskId ?? undefined}
            onLightboxOpen={onLightboxOpen}
            onDelete={onDelete}
            onHoverStart={onHoverStart}
            onHoverEnd={onHoverEnd}
            onMobileModalOpen={onMobileModalOpen}
            onApplySettingsFromTask={onApplySettingsFromTask}
            handleShare={(e) => {
              void handleShare(e);
            }}
            isCreatingShare={isCreatingShare}
            shareCopied={shareCopied}
            shareSlug={shareSlug}
          />
        )}
      </div>
    </div>

  );
}, videoItemPropsAreEqual);
