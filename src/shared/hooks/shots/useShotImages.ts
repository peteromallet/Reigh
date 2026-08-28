/**
 * Shot-scoped image queries. Queries shot_generations JOIN generations.
 * Exports: useShotImages, useTimelineImages, useUnpositionedImages, useVideoOutputs.
 */

import { useQuery, useQueryClient, UseQueryResult } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { GenerationRow } from '@/domains/generation/types';
import { QUERY_PRESETS, STANDARD_RETRY, STANDARD_RETRY_DELAY } from '@/shared/lib/query/queryDefaults';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import React from 'react';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';
import { isDeferredCloudDataAuthority } from '@/app/runtime/dataAuthority';

import { mapShotGenerationToRow } from '@/shared/hooks/shots';
import {
  selectTimelineImages,
  selectUnpositionedImages,
  selectVideoOutputs,
} from '@/shared/lib/shotImageSelectors';
import { assertDeferredCloudShotOperation } from './shotAuthority';

/** Loads all shot_generations (positioned + unpositioned) for a shot. */
const useAllShotGenerations = (
  shotId: string | null,
  options?: {
    // When true, prevents query from refetching during sensitive operations (drag, persist, etc.)
    disableRefetch?: boolean;
  }
): UseQueryResult<GenerationRow[]> => {
  const stableShotId = React.useMemo(() => shotId, [shotId]);
  const isEnabled = React.useMemo(() => {
    if (options?.disableRefetch) {
      return false;
    }
    // Local Astrid shots are document-derived and are already supplied by the
    // local timeline adapter. Never fall through to the retired relational
    // shot_generations read path for those URLs.
    return !!stableShotId && isDeferredCloudDataAuthority() && !hasLocalModeUrlParams(
      typeof window === 'undefined' ? '' : window.location.search,
    );
  }, [stableShotId, options?.disableRefetch]);
  
  const queryClient = useQueryClient();

  const mainQuery = useQuery<GenerationRow[], Error>({
    queryKey: generationQueryKeys.byShot(stableShotId!),
    enabled: isEnabled,
    // Use realtimeBacked preset - data freshness from realtime + mutations
    // (invalidated by RealtimeProvider + useGenerationInvalidation)
    ...QUERY_PRESETS.realtimeBacked,
    // realtimeBacked provides staleTime: 30_000 — don't override to 0.
    // staleTime: 0 makes the query perpetually stale, which combined with React Query's
    // observer.setOptions() running every render causes a fetch→render→fetch loop.
    // refetchOnMount: 'always' ensures fresh data when opening a shot without the loop.
    refetchOnMount: 'always',
    retry: STANDARD_RETRY,
    // NOTE: Removed placeholderData: (previousData) => previousData
    // This was causing cross-shot data leakage - when navigating to a new shot,
    // the previous shot's images would briefly appear as "placeholder" data
    queryFn: async ({ signal }) => {
      assertDeferredCloudShotOperation('read shot images');
      // Query shot_generations with embedded generations data + primary variant
      // NOTE: Must specify FK explicitly to avoid ambiguous relationship error (PGRST201)
      // since there are two FKs between shot_generations and generations
      // We also fetch the primary_variant using the generations.primary_variant_id FK
      // to get the correct display URL (primary variant may differ from generation.location)
      const response = await supabase().from('shot_generations')
        .select(`
          id,
          generation_id,
          timeline_frame,
          metadata,
          generation:generations!shot_generations_generation_id_generations_id_fk (
            id,
            location,
            thumbnail_url,
            type,
            created_at,
            starred,
            name,
            based_on,
            params,
            primary_variant_id,
            primary_variant:generation_variants!generations_primary_variant_id_fkey (
              location,
              thumbnail_url
            )
          )
        `)
        .eq('shot_id', stableShotId!)
        .order('timeline_frame', { ascending: true, nullsFirst: false })
        .abortSignal(signal);
      
      if (response.error) {
        // Abort errors are expected during rapid invalidations - silently return cached data
        if (response.error.code === '20' || response.error.message?.includes('abort')) {
          const cachedData = queryClient.getQueryData<GenerationRow[]>(generationQueryKeys.byShot(stableShotId!));
          return cachedData || [];
        }
        normalizeAndPresentError(response.error, {
          context: 'useShotImages.queryFn',
          showToast: false,
          logData: { shotId: stableShotId },
        });
        throw response.error;
      }

      return (response.data || [])
        .map(mapShotGenerationToRow)
        .filter(Boolean) as GenerationRow[];
    },
    retryDelay: STANDARD_RETRY_DELAY,
  });

  return mainQuery as UseQueryResult<GenerationRow[]>;
};

/** Positioned, non-video images with valid location, sorted by timeline_frame. */
export const useTimelineImages = (
  shotId: string | null
): UseQueryResult<GenerationRow[]> => {
  const baseQuery = useAllShotGenerations(shotId);

  const filtered = React.useMemo(() => {
    if (!baseQuery.data) return undefined;

    return selectTimelineImages(baseQuery.data);
  }, [baseQuery.data]);

  return { ...baseQuery, data: filtered } as UseQueryResult<GenerationRow[]>;
};

/** Non-video images with no timeline_frame. */
export const useUnpositionedImages = (
  shotId: string | null
): UseQueryResult<GenerationRow[]> => {
  const baseQuery = useAllShotGenerations(shotId);

  const filtered = React.useMemo(() => {
    if (!baseQuery.data) return undefined;

    return selectUnpositionedImages(baseQuery.data);
  }, [baseQuery.data]);

  return { ...baseQuery, data: filtered } as UseQueryResult<GenerationRow[]>;
};

/** Video generations in the shot. */
export const useVideoOutputs = (
  shotId: string | null
): UseQueryResult<GenerationRow[]> => {
  const baseQuery = useAllShotGenerations(shotId);
  
  const filtered = React.useMemo(() => {
    if (!baseQuery.data) return undefined;
    
    return selectVideoOutputs(baseQuery.data);
  }, [baseQuery.data]);
  
  return { ...baseQuery, data: filtered } as UseQueryResult<GenerationRow[]>;
};

/** Seeds the shot-generations cache from ShotsContext for instant display on shot select. */
const usePrimeShotGenerationsCache = (
  shotId: string | null,
  contextImages: GenerationRow[] | undefined
) => {
  const queryClient = useQueryClient();
  
  React.useEffect(() => {
    if (!shotId || !contextImages || contextImages.length === 0) return;

    const existingData = queryClient.getQueryData<GenerationRow[]>(generationQueryKeys.byShot(shotId));
    if (existingData && existingData.length > 0) return;

    // Prime the cache with context data
    queryClient.setQueryData(generationQueryKeys.byShot(shotId), contextImages);
  }, [shotId, contextImages, queryClient]);
};

export const useShotImages = useAllShotGenerations;
export const usePrimeShotImagesCache = usePrimeShotGenerationsCache;
