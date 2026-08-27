/**
 * useMarkVariantViewed Hook
 *
 * Marks a variant as viewed in the database and invalidates all relevant queries.
 * Used when user views a variant in the lightbox to remove the NEW badge.
 *
 * Now includes optimistic update support - the badge count is decremented immediately
 * before the database update completes.
 *
 * Usage:
 *   const { markViewed, markAllViewed } = useMarkVariantViewed();
 *   markViewed({ variantId, generationId }); // generationId enables optimistic update
 *   markAllViewed(generationId); // marks all unviewed variants for a generation
 */

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { AstridLocalClient } from '@/integrations/astrid/client';
import { getLocalProjectSlug, hasLocalModeUrlParams } from '@/shared/dev/devSession';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { DerivedCountsResult } from '@/shared/lib/generationTransformers';
import { queryKeys } from '@/shared/lib/queryKeys';
import { withGenerationBadgeCount } from './variantBadgeCacheUtils';

interface MarkViewedParams {
  variantId: string;
  generationId?: string; // Optional: enables optimistic badge update
}

interface MarkAllViewedParams {
  generationId: string;
}

interface CachedVariant {
  id?: string;
  generation_id?: string;
  viewed_at?: string | null;
}

function isCachedVariant(value: unknown): value is CachedVariant {
  return !!value && typeof value === 'object';
}

function patchCachedVariants(
  queryClient: QueryClient,
  updateVariant: (variant: CachedVariant) => CachedVariant
): boolean {
  let didPatchAtLeastOneQuery = false;

  queryClient.setQueriesData(
    { queryKey: queryKeys.generations.variantsAll, exact: false },
    (oldData: unknown) => {
      if (!Array.isArray(oldData)) return oldData;

      let didPatchThisQuery = false;
      const nextData = oldData.map((entry) => {
        if (!isCachedVariant(entry)) return entry;
        const updated = updateVariant(entry);
        if (updated !== entry) {
          didPatchThisQuery = true;
        }
        return updated;
      });

      if (!didPatchThisQuery) {
        return oldData;
      }

      didPatchAtLeastOneQuery = true;
      return nextData;
    }
  );

  return didPatchAtLeastOneQuery;
}

function markVariantViewedInCache(
  queryClient: QueryClient,
  variantId: string,
  viewedAt: string
): boolean {
  return patchCachedVariants(queryClient, (variant) => {
    if (variant.id !== variantId || variant.viewed_at !== null) {
      return variant;
    }

    return {
      ...variant,
      viewed_at: viewedAt,
    };
  });
}

function markGenerationViewedInCache(
  queryClient: QueryClient,
  generationId: string,
  viewedAt: string
): boolean {
  return patchCachedVariants(queryClient, (variant) => {
    if (variant.generation_id !== generationId || variant.viewed_at !== null) {
      return variant;
    }

    return {
      ...variant,
      viewed_at: viewedAt,
    };
  });
}

function decrementBadgeCountOptimistically(
  queryClient: QueryClient,
  generationId: string
): void {
  queryClient.setQueriesData(
    { queryKey: queryKeys.generations.variantBadges, exact: false },
    (oldData: DerivedCountsResult | undefined) => {
      if (!oldData) return oldData;

      const currentCount = oldData.unviewedVariantCounts[generationId] || 0;
      const newCount = Math.max(0, currentCount - 1);
      return withGenerationBadgeCount(oldData, generationId, newCount);
    }
  );
}

function clearBadgeCountOptimistically(
  queryClient: QueryClient,
  generationId: string
): void {
  queryClient.setQueriesData(
    { queryKey: queryKeys.generations.variantBadges, exact: false },
    (oldData: DerivedCountsResult | undefined) => {
      if (!oldData) return oldData;

      return withGenerationBadgeCount(oldData, generationId, 0);
    }
  );
}

function localBridgeClientOrNull(): AstridLocalClient | null {
  if (typeof window === 'undefined' || !hasLocalModeUrlParams(window.location.search)) {
    return null;
  }
  const projectSlug = getLocalProjectSlug(window.location.search);
  if (!projectSlug) {
    throw new Error('localProject is required for local viewed mutations');
  }
  return new AstridLocalClient({ projectSlug });
}

export function useMarkVariantViewed() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ variantId, generationId }: MarkViewedParams) => {
      const localClient = localBridgeClientOrNull();
      if (localClient) {
        if (!generationId) {
          throw new Error('generationId is required for local viewed mutations');
        }
        await localClient.gallery.markViewed(generationId, variantId);
        return { variantId, generationId };
      }
      const { error } = await supabase().from('generation_variants')
        .update({ viewed_at: new Date().toISOString() })
        .eq('id', variantId)
        .is('viewed_at', null);

      if (error) {
        console.error('[useMarkVariantViewed] Error:', error);
        throw error;
      }

      return { variantId, generationId };
    },
    onMutate: async ({ variantId, generationId }) => {
      const viewedAt = new Date().toISOString();
      const didMarkVariantInCache = markVariantViewedInCache(queryClient, variantId, viewedAt);

      // Optimistic badge decrement only when we actually transitioned null -> viewed in cache.
      // This avoids double-decrement races when markViewed is called twice for the same variant.
      if (generationId && didMarkVariantInCache) {
        decrementBadgeCountOptimistically(queryClient, generationId);
      }
    },
    onSuccess: () => {
      // viewed_at affects both variant lists and generation-level NEW badges
      queryClient.invalidateQueries({ queryKey: queryKeys.generations.variantsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.generations.derivedAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.generations.variantBadges });
    },
    onError: (error) => {
      normalizeAndPresentError(error, { context: 'useMarkVariantViewed', showToast: false });
    },
  });

  // Bulk mutation: mark ALL unviewed variants for a generation
  const bulkMutation = useMutation({
    mutationFn: async ({ generationId }: MarkAllViewedParams) => {
      const localClient = localBridgeClientOrNull();
      if (localClient) {
        await localClient.gallery.markViewed(generationId);
        return { generationId };
      }
      const { error } = await supabase().from('generation_variants')
        .update({ viewed_at: new Date().toISOString() })
        .eq('generation_id', generationId)
        .is('viewed_at', null);

      if (error) {
        console.error('[useMarkVariantViewed] Bulk error:', error);
        throw error;
      }

      return { generationId };
    },
    onMutate: async ({ generationId }) => {
      const viewedAt = new Date().toISOString();

      // Optimistic update: mark all unviewed variants for this generation in loaded caches
      markGenerationViewedInCache(queryClient, generationId, viewedAt);

      // Optimistic update: immediately set unviewed count to 0 for this generation
      clearBadgeCountOptimistically(queryClient, generationId);
    },
    onSuccess: () => {
      // viewed_at affects both variant lists and generation-level NEW badges
      queryClient.invalidateQueries({ queryKey: queryKeys.generations.variantsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.generations.derivedAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.generations.variantBadges });
    },
    onError: (error) => {
      normalizeAndPresentError(error, { context: 'useMarkVariantViewed', showToast: false });
    },
  });

  return {
    markViewed: mutation.mutate,
    markAllViewed: (generationId: string) => bulkMutation.mutate({ generationId }),
    isMarking: mutation.isPending,
    isMarkingAll: bulkMutation.isPending,
  };
}

// NOTE: Default export removed - use named export { useMarkVariantViewed } instead
