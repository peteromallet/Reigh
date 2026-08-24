import React from 'react';
import { GenerationRow } from '@/domains/generation/types';
import { useProgressiveImage } from '@/shared/hooks/ui-image/useProgressiveImage';
import { isProgressiveLoadingEnabled } from '@/shared/settings/progressiveLoading';
import { cn } from '@/shared/components/ui/contracts/cn';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';

interface ImagePreviewProps {
  image: GenerationRow;
}

export const SingleImagePreview: React.FC<ImagePreviewProps> = ({ image }) => {
  // Progressive loading for drag preview - use thumbnail only for performance during drag
  const progressiveEnabled = isProgressiveLoadingEnabled();
  const { src: progressiveSrc, isThumbShowing, ref: progressiveRef } = useProgressiveImage(
    progressiveEnabled ? image.thumbUrl : null,
    image.imageUrl,
    {
      priority: true, // High priority for drag preview
      lazy: false,
      enabled: progressiveEnabled,
      crossfadeMs: 100, // Fast crossfade for drag
      prefetch: true // Only load thumbnail for drag performance
    }
  );

  // Use progressive src if available, otherwise fallback to display URL
  const displaySrc = progressiveEnabled && progressiveSrc ? progressiveSrc : bridgeMediaUrl(getProjectSelectionFallbackId(), image.thumbUrl || image.imageUrl);

  return (
    <div className="bg-muted/50 rounded border p-1 flex flex-col items-center justify-center aspect-square overflow-hidden shadow-sm w-32 h-32">
      <img
        ref={progressiveRef}
        src={displaySrc}
        alt={`Image ${image.id}`}
        className={cn(
          "max-w-full max-h-full object-contain rounded-sm transition-opacity duration-100",
          progressiveEnabled && isThumbShowing && "opacity-95"
        )}
      />
    </div>
  );
};

interface MultiImagePreviewProps {
  count: number;
  image: GenerationRow; // To show one of the images on top
}

export const MultiImagePreview: React.FC<MultiImagePreviewProps> = ({ count, image }) => {
  // Progressive loading for multi-image drag preview
  const progressiveEnabled = isProgressiveLoadingEnabled();
  const { src: progressiveSrc, isThumbShowing, ref: progressiveRef } = useProgressiveImage(
    progressiveEnabled ? image.thumbUrl : null,
    image.imageUrl,
    {
      priority: true,
      lazy: false,
      enabled: progressiveEnabled,
      crossfadeMs: 100,
      prefetch: true // Only load thumbnail for drag performance
    }
  );

  const displaySrc = progressiveEnabled && progressiveSrc ? progressiveSrc : bridgeMediaUrl(getProjectSelectionFallbackId(), image.thumbUrl || image.imageUrl);

  return (
    <div className="relative w-32 h-32">
      <div className="absolute top-2 left-2 w-full h-full bg-muted/80 rounded border p-1 shadow-lg" />
      <div className="absolute top-1 left-1 w-full h-full bg-muted/90 rounded border p-1 shadow-md" />
      <div className="absolute top-0 left-0 w-full h-full bg-muted rounded border p-1 flex flex-col items-center justify-center aspect-square overflow-hidden shadow-sm">
        <img
          ref={progressiveRef}
          src={displaySrc}
          alt={`Image ${image.id}`}
          className={cn(
            "max-w-full max-h-full object-contain rounded-sm transition-opacity duration-100",
            progressiveEnabled && isThumbShowing && "opacity-95"
          )}
        />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-orange-500 text-white rounded-full h-8 w-8 flex items-center justify-center text-sm font-bold shadow-lg">
          {count}
        </div>
      </div>
    </div>
  );
}; 
