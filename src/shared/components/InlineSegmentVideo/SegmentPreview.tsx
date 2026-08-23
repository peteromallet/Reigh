import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ImageOff, Loader2, Play, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { VariantBadge } from '@/shared/components/VariantBadge';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { cn } from '@/shared/components/ui/contracts/cn';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import type { SegmentPreviewProps } from './types';

const FRAMES_PER_SECOND = 16;

export const SegmentPreview: React.FC<SegmentPreviewProps> = ({
  layoutProps,
  child,
  pairIndex,
  onClick,
  projectAspectRatio,
  onDelete,
  isDeleting,
  isPending,
  hasSourceChanged,
  scrubbing,
  badge,
}) => {
  const {
    isActive: isScrubbingActive,
    onStart: onScrubbingStart,
    containerRef: scrubbingContainerRef,
    containerProps: scrubbingContainerProps,
    progress: scrubbingProgress,
  } = scrubbing;
  const {
    data: badgeData,
    showNew: showNewBadge,
    isNewWithNoVariants,
    unviewedCount,
    onMarkAllViewed: handleMarkAllVariantsViewed,
  } = badge;
  const { layout, compact, isMobile, roundedClass, flowContainerClasses, adjustedPositionStyle } = layoutProps;

  const [isHovering, setIsHovering] = useState(false);
  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [imageError, setImageError] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const localContainerRef = useRef<HTMLDivElement>(null);

  const thumbUrl = child.thumbUrl || child.location;
  const videoUrl = child.location;

  const previewStyle = useMemo(() => {
    const baseWidth = compact ? 180 : 240;
    if (!projectAspectRatio) {
      return { width: baseWidth, aspectRatio: '16/9' };
    }

    const [w, h] = projectAspectRatio.split(':').map(Number);
    if (w && h) {
      return { width: baseWidth, aspectRatio: `${w}/${h}` };
    }

    return { width: baseWidth, aspectRatio: '16/9' };
  }, [projectAspectRatio, compact]);

  const estimatedPreviewHeight = useMemo(() => {
    const baseWidth = compact ? 180 : 240;
    if (!projectAspectRatio) {
      return Math.round((baseWidth * 9) / 16);
    }

    const [w, h] = projectAspectRatio.split(':').map(Number);
    if (w && h) {
      return Math.round((baseWidth * h) / w);
    }

    return Math.round((baseWidth * 9) / 16);
  }, [projectAspectRatio, compact]);

  const containerBorderClasses =
    layout === 'flow' ? 'border-[3px] border-primary ring-2 ring-primary/20 shadow-lg' : 'border-2 border-primary/30 shadow-md';

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      if (isMobile) {
        return;
      }

      setIsHovering(true);
      const target = e.currentTarget as HTMLElement;
      if (target && onScrubbingStart) {
        onScrubbingStart(target.getBoundingClientRect());
      }

      scrubbingContainerProps?.onMouseEnter?.();
    },
    [isMobile, onScrubbingStart, scrubbingContainerProps],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isMobile) {
        return;
      }

      setHoverPosition({ x: e.clientX, y: e.clientY });
      scrubbingContainerProps?.onMouseMove?.(e);
    },
    [isMobile, scrubbingContainerProps],
  );

  const handleMouseLeave = useCallback(() => {
    if (isMobile) {
      return;
    }

    setIsHovering(false);
    setDeleteConfirmPending(false);
    setCurrentTime(0);
    scrubbingContainerProps?.onMouseLeave?.();

    if (videoRef.current && !isScrubbingActive) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [isMobile, scrubbingContainerProps, isScrubbingActive]);

  useEffect(() => {
    const video = videoRef.current;
    if (!isHovering || !video) {
      return;
    }

    if (child.location) {
      video.play().catch(() => {});
    }

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);

    if (video.duration) {
      setDuration(video.duration);
    }

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [isHovering, child.location]);

  const currentFrame = Math.floor(currentTime * FRAMES_PER_SECOND);
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const containerRefToUse = isScrubbingActive && scrubbingContainerRef ? scrubbingContainerRef : localContainerRef;

  return (
    <>
      <div
        ref={containerRefToUse}
        className={cn(
          'cursor-pointer overflow-hidden bg-muted/20',
          roundedClass,
          'transition-all duration-150 relative',
          containerBorderClasses,
          isHovering && 'z-10 border-primary shadow-xl',
          layout === 'flow' && isHovering && 'ring-primary/40',
          isScrubbingActive && 'ring-2 ring-primary ring-offset-1',
          flowContainerClasses,
        )}
        style={adjustedPositionStyle}
        onClick={() => {
          try {
            onClick();
          } catch (err) {
            normalizeAndPresentError(err, { context: 'SegmentPreview.onClick' });
          }
        }}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {thumbUrl && !imageError ? (
          <img
            src={bridgeMediaUrl(getProjectSelectionFallbackId(), thumbUrl)}
            alt={`Segment ${pairIndex + 1}`}
            className={cn('absolute inset-0 w-full h-full object-cover', isHovering && 'brightness-110')}
            onError={() => setImageError(true)}
          />
        ) : imageError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
            <ImageOff className={cn(layout === 'flow' && compact ? 'w-4 h-4' : 'w-8 h-8', 'text-muted-foreground')} />
          </div>
        ) : (
          <div className="absolute inset-0 bg-muted animate-pulse" />
        )}

        {(badgeData || showNewBadge) && (
          <VariantBadge
            derivedCount={badgeData?.derivedCount || 0}
            unviewedVariantCount={unviewedCount}
            hasUnviewedVariants={showNewBadge}
            alwaysShowNew={isNewWithNoVariants}
            variant="overlay"
            size="lg"
            position={layout === 'flow' && compact ? 'top-1.5 left-1.5' : 'top-2 left-2'}
            onMarkAllViewed={handleMarkAllVariantsViewed}
          />
        )}

        {onDelete && (
          <button
            className={cn(
              'absolute top-1 right-1 z-20 w-6 h-6 rounded-md flex items-center justify-center',
              'transition-all duration-150',
              isDeleting ? 'opacity-100' : isHovering ? 'opacity-100' : 'opacity-0',
              deleteConfirmPending
                ? 'bg-amber-500/90 hover:bg-amber-600 text-white'
                : 'bg-destructive/90 hover:bg-destructive text-destructive-foreground',
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (isDeleting) return;
              if (deleteConfirmPending) {
                onDelete(child.id);
                setDeleteConfirmPending(false);
              } else {
                setDeleteConfirmPending(true);
              }
            }}
            disabled={isDeleting}
            title={deleteConfirmPending ? 'Click again to confirm' : 'Delete segment'}
          >
            {isDeleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : deleteConfirmPending ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}

        {!isPending && (
          <div className={cn('absolute inset-0 flex items-center justify-center', 'transition-opacity duration-150', isHovering ? 'opacity-0' : 'opacity-100')}>
            <div className={cn('rounded-full bg-black/50 flex items-center justify-center', layout === 'flow' && compact ? 'w-6 h-6' : 'w-12 h-12')}>
              <Play className={cn('text-white ml-0.5', layout === 'flow' && compact ? 'w-3 h-3' : 'w-6 h-6')} fill="white" />
            </div>
          </div>
        )}

        {isPending && (
          <div
            className="absolute bottom-1 right-1 z-20 flex items-center justify-center bg-background/95 p-1.5 rounded-md border shadow-sm cursor-default"
            title="A generation is pending"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          </div>
        )}

        {hasSourceChanged && !isPending && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="absolute bottom-1 left-1 z-20 flex items-center justify-center bg-amber-500/90 hover:bg-amber-600/95 p-1 rounded-md shadow-sm cursor-default transition-colors">
                <AlertTriangle className="w-3 h-3 text-white" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p>Source image has changed since this video was created. Consider regenerating.</p>
            </TooltipContent>
          </Tooltip>
        )}

        {isHovering && <div className="absolute inset-0 ring-2 ring-primary ring-inset pointer-events-none" />}

        {isHovering && (scrubbingProgress !== undefined || duration > 0) && (
          <div className={cn('absolute bottom-0 left-0 right-0 bg-black/30 pointer-events-none', layout === 'flow' && compact ? 'h-0.5' : 'h-1')}>
            <div
              className="h-full bg-primary transition-all duration-75"
              style={{ width: `${scrubbingProgress !== undefined ? scrubbingProgress * 100 : progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {isHovering &&
        !isMobile &&
        videoUrl &&
        !isScrubbingActive &&
        createPortal(
          <div
            className="fixed pointer-events-none"
            style={{
              left: `${hoverPosition.x}px`,
              top: `${hoverPosition.y - estimatedPreviewHeight - 40}px`,
              transform: 'translateX(-50%)',
              zIndex: 999999,
            }}
          >
            <div className="bg-background border-2 border-primary rounded-lg shadow-2xl overflow-hidden">
              <div className="relative bg-black" style={{ width: previewStyle.width, aspectRatio: previewStyle.aspectRatio }}>
                <video
                  ref={videoRef}
                  src={bridgeMediaUrl(getProjectSelectionFallbackId(), videoUrl)}
                  className="w-full h-full object-cover"
                  muted
                  loop
                  playsInline
                  preload="auto"
                />
              </div>

              <div className="px-3 py-1.5 bg-background/95 border-t border-primary/40 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Segment {pairIndex + 1}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">Frame {currentFrame}</span>
                  {(badgeData || showNewBadge) && (
                    <VariantBadge
                      derivedCount={badgeData?.derivedCount || 0}
                      unviewedVariantCount={unviewedCount}
                      hasUnviewedVariants={showNewBadge}
                      alwaysShowNew={isNewWithNoVariants}
                      variant="inline"
                      size="md"
                      tooltipSide="top"
                      onMarkAllViewed={handleMarkAllVariantsViewed}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
