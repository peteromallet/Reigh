import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/components/ui/contracts/cn';
import { getDisplayUrl } from '@/shared/lib/media/mediaUrl';
import type { SegmentSlot } from '@/shared/hooks/segments';
import type { useVideoScrubbing } from '@/shared/hooks/useVideoScrubbing';

type VideoScrubbingState = ReturnType<typeof useVideoScrubbing>;

interface DesktopScrubbingPreviewProps {
  activeScrubbingIndex: number | null;
  activeSegmentSlot: SegmentSlot | null;
  activeSegmentVideoUrl: string | null;
  clampedPreviewX: number;
  previewY: number;
  previewDimensions: {
    width: number;
    height: number;
  };
  previewVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  scrubbing: VideoScrubbingState;
}

export function DesktopScrubbingPreview({
  activeScrubbingIndex,
  activeSegmentSlot,
  activeSegmentVideoUrl,
  clampedPreviewX,
  previewY,
  previewDimensions,
  previewVideoRef,
  scrubbing,
}: DesktopScrubbingPreviewProps): React.ReactPortal | null {
  if (activeScrubbingIndex === null || !activeSegmentVideoUrl) {
    return null;
  }

  return createPortal(
    <div
      className="fixed pointer-events-none"
      style={{
        left: `${clampedPreviewX}px`,
        top: `${previewY - previewDimensions.height - 16}px`,
        transform: 'translateX(-50%)',
        zIndex: 999999,
      }}
    >
      <div
        className="relative bg-black rounded-lg overflow-hidden shadow-xl border-2 border-primary/50"
        style={{
          width: previewDimensions.width,
          height: previewDimensions.height,
        }}
      >
        <video
          ref={previewVideoRef}
          src={getDisplayUrl(activeSegmentVideoUrl)}
          className="w-full h-full object-contain"
          muted
          playsInline
          preload="auto"
          loop
          {...scrubbing.videoProps}
        />

        {scrubbing.scrubberPosition !== null && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div
              className={cn(
                'h-full bg-primary transition-opacity duration-200',
                scrubbing.scrubberVisible ? 'opacity-100' : 'opacity-50',
              )}
              style={{ width: `${scrubbing.scrubberPosition}%` }}
            />
          </div>
        )}

        <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
          Segment {(activeSegmentSlot?.index ?? 0) + 1}
          {scrubbing.duration > 0 && (
            <span className="ml-2 text-white/70">
              {scrubbing.currentTime.toFixed(1)}s / {scrubbing.duration.toFixed(1)}s
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
