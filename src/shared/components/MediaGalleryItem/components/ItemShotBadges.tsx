import React from 'react';
import { VariantBadge } from '@/shared/components/VariantBadge';
import type { GeneratedImageWithMetadata, SimplifiedShotOption } from '../../MediaGallery/types';

interface ItemShotBadgesProps {
  image: GeneratedImageWithMetadata;
  isVideoContent: boolean;
  simplifiedShotOptions: SimplifiedShotOption[];
  onMarkAllVariantsViewed: () => void;
  onNavigateToShot: (shotId: string) => void;
}

export const ItemShotBadges: React.FC<ItemShotBadgesProps> = ({
  image,
  isVideoContent,
  simplifiedShotOptions,
  onMarkAllVariantsViewed,
  onNavigateToShot,
}) => {
  const shouldShow =
    isVideoContent &&
    (image.name ||
      (image.shot_id && simplifiedShotOptions.length > 0) ||
      (image.derivedCount && image.derivedCount > 0));

  if (!shouldShow) {
    return null;
  }

  return (
    <div className="absolute top-1.5 left-1.5 flex flex-col items-start gap-1 z-20">
      {image.name && (
        <div className="bg-black/50 text-white text-xs sm:text-sm px-2 py-0.5 rounded-md mb-1 font-medium backdrop-blur-sm preserve-case">
          {image.name}
        </div>
      )}

      <VariantBadge
        derivedCount={image.derivedCount}
        unviewedVariantCount={image.unviewedVariantCount}
        hasUnviewedVariants={image.hasUnviewedVariants}
        variant="inline"
        size="md"
        onMarkAllViewed={onMarkAllVariantsViewed}
      />

      {image.shot_id && simplifiedShotOptions.length > 0 && (
        <button
          className="px-2 py-1 rounded-md bg-black/40 hover:bg-black/60 text-white/90 hover:text-white text-xs font-normal transition-all backdrop-blur-sm flex items-center gap-1.5 preserve-case opacity-0 group-hover:opacity-100"
          onClick={() => onNavigateToShot(image.shot_id!)}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          {simplifiedShotOptions.find((shot) => shot.id === image.shot_id)?.name || 'Unknown Shot'}
        </button>
      )}
    </div>
  );
};
