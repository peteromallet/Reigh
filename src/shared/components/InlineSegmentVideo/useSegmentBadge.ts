import { useCallback, useMemo } from 'react';
import { useMarkVariantViewed } from '@/shared/hooks/variants/useMarkVariantViewed';
import { useVariantBadges } from '@/shared/hooks/variants/useVariantBadges';
import type { GenerationRow } from '@/domains/generation/types';

const RECENTLY_CREATED_THRESHOLD_MS = 10 * 60 * 100 * 10;

export function useSegmentBadge(child: GenerationRow | null) {
  const generationId = child?.id ?? null;

  const { getBadgeData } = useVariantBadges(generationId ? [generationId] : [], true);
  const badgeData = generationId ? getBadgeData(generationId) : undefined;

  const { markAllViewed } = useMarkVariantViewed();
  const onMarkAllViewed = useCallback(() => {
    if (generationId) {
      markAllViewed(generationId);
    }
  }, [generationId, markAllViewed]);

  const isRecentlyCreated = useMemo(() => {
    if (!child) {
      return false;
    }

    const createdAt = child.createdAt;
    if (!createdAt) {
      return false;
    }

    const createdTime = new Date(createdAt).getTime();
    const cutoff = Date.now() - RECENTLY_CREATED_THRESHOLD_MS;
    return createdTime > cutoff;
  }, [child]);

  const hasUnviewedFromBadge =
    !!badgeData?.hasUnviewedVariants && (badgeData?.unviewedVariantCount || 0) > 0;
  const isNewWithNoVariants = isRecentlyCreated && (badgeData?.derivedCount || 0) === 0;
  const showNewBadge = hasUnviewedFromBadge || isNewWithNoVariants;
  const unviewedCount = hasUnviewedFromBadge ? badgeData?.unviewedVariantCount || 0 : isNewWithNoVariants ? 1 : 0;

  return {
    badgeData,
    showNewBadge,
    isNewWithNoVariants,
    unviewedCount,
    onMarkAllViewed,
  };
}
