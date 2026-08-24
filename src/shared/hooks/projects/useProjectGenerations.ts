/**
 * Project-Wide Generation Queries
 * ================================
 *
 * This module provides hooks for querying generations at the PROJECT level.
 * Mutations live in `useGenerationMutations.ts`.
 *
 * ## Data Source
 * Bridge gallery reads (doc-27 §4.1): bounded keyset pages from
 * `GET /projects/:slug/generations` (R12) via the frozen `AstridLocalClient`.
 * The project id doubles as the bridge project slug — the composition point
 * is the existing project-selection context, not a new singleton.
 *
 * ## Filter posture
 * The v1 route supports only the `starred` filter server-side; `mediaType`
 * is applied client-side on the row `type`. Tool/search/shot filters have no
 * v1 route (summary rows carry no params/shot placement) and are accepted for
 * API compatibility but not applied — see .oracle/evidence/c3-b-reads.md.
 *
 * @module useProjectGenerations
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { GeneratedImageWithMetadata } from '@/shared/components/MediaGallery/types';
import { AstridLocalClient } from '@/integrations/astrid/client';
import type { BridgeGenerationSummary } from '@/tools/video-editor/data/bridgeContract';
import { useSmartPollingConfig } from '../useSmartPolling';
import { unifiedGenerationQueryKeys } from '@/shared/lib/queryKeys/unified';
import { transformGeneration, type RawGeneration } from '@/shared/lib/generationTransformers';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { useAstridCapabilityCensus } from '@/integrations/astrid/capabilityCensus.ts';

/** Cache garbage collection time for paginated generation queries */
const GENERATIONS_GC_TIME_MS = 10 * 60 * 1000; // 10 minutes

/** The bridge caps one gallery page at 200 rows (doc-27 §4.1). */
const BRIDGE_MAX_PAGE_LIMIT = 200;


export interface GenerationFilters {
  toolType?: string;
  mediaType?: 'all' | 'image' | 'video';
  shotId?: string;
  excludePositioned?: boolean;
  starredOnly?: boolean;
  searchTerm?: string;
}

/**
 * Map one bridge summary row into the raw record shape `transformGeneration`
 * consumes. Display URLs are resolved here: the primary variant's managed
 * media id becomes a same-origin R9 content-route address.
 */
function toRawGeneration(row: BridgeGenerationSummary, projectSlug: string): RawGeneration {
  const primaryMediaUrl = row.primary ? bridgeMediaUrl(projectSlug, row.primary.media_id) : null;
  return {
    id: row.generation_id,
    location: primaryMediaUrl,
    thumbnail_url: primaryMediaUrl,
    type: row.type,
    created_at: row.created_at,
    updated_at: row.updated_at,
    starred: row.starred,
    name: row.name,
    derivedCount: row.variant_count,
  };
}

/**
 * Client-side filter over mapped rows for predicates expressible on summary
 * data. Only the media-type split is derivable (row `type`, mirroring the
 * previous `%video%` SQL match).
 */
function matchesClientSideFilters(
  item: GeneratedImageWithMetadata,
  filters?: GenerationFilters,
): boolean {
  if (filters?.mediaType && filters.mediaType !== 'all') {
    const isVideo = (item.type ?? '').includes('video');
    if (filters.mediaType === 'video' && !isVideo) return false;
    if (filters.mediaType === 'image' && isVideo) return false;
  }
  return true;
}

async function fetchGenerationsForProject(
  projectId: string,
  limit: number = 100,
  offset: number = 0,
  filters?: GenerationFilters
): Promise<{
  items: GeneratedImageWithMetadata[];
  total: number;
  hasMore: boolean;
}> {
  const client = new AstridLocalClient({ projectSlug: projectId });
  // Route-level filtering: R12 supports exactly `starred`.
  const starred = filters?.starredOnly ? true : undefined;
  const pageLimit = Math.min(Math.max(limit, 1), BRIDGE_MAX_PAGE_LIMIT);

  // Walk keyset pages until the requested [offset, offset+limit) window is
  // covered or the project is exhausted. Cursor pagination has no random
  // access, so page N costs N sequential reads — bounded and honest.
  const collected: GeneratedImageWithMetadata[] = [];
  let cursor: string | undefined;
  let exhausted = false;

  while (collected.length < offset + limit && !exhausted) {
    const page = await client.gallery.list({ limit: pageLimit, cursor, starred });
    for (const row of page.generations) {
      const item = transformGeneration(toRawGeneration(row, projectId));
      if (matchesClientSideFilters(item, filters)) {
        collected.push(item);
      }
    }
    cursor = page.next_cursor ?? undefined;
    exhausted = cursor === undefined;
  }

  const items = collected.slice(offset, offset + limit);
  const hasMore = !exhausted;

  // The route returns no total count. On the last page the total is exact;
  // before that it degrades to a lower bound (one past the covered window)
  // so "next page" stays reachable until the true end is observed.
  const total = hasMore ? offset + items.length + 1 : offset + items.length;

  return { items, total, hasMore };
}

export function fetchGenerations(
  projectId: string | null,
  limit: number = 100,
  offset: number = 0,
  filters?: GenerationFilters
): Promise<{
  items: GeneratedImageWithMetadata[];
  total: number;
  hasMore: boolean;
}> {
  if (!projectId) {
    return Promise.resolve({ items: [], total: 0, hasMore: false });
  }
  return fetchGenerationsForProject(projectId, limit, offset, filters);
}


export type GenerationsPaginatedResponse = {
  items: GeneratedImageWithMetadata[];
  total: number;
  hasMore: boolean;
};

export function useProjectGenerations(
  projectId: string | null,
  page: number = 1,
  limit: number = 100,
  enabled: boolean = true,
  filters?: GenerationFilters,
  options?: {
    disablePolling?: boolean; // Disable smart polling (useful for long-running tasks)
  }
) {
  const capabilityCensus = useAstridCapabilityCensus();
  const offset = (page - 1) * limit;
  const effectiveProjectId = projectId ?? getProjectSelectionFallbackId();
  const filtersKey = filters ? JSON.stringify(filters) : null;
  const queryKey = unifiedGenerationQueryKeys.byProject(
    effectiveProjectId ?? '__no-project__',
    page,
    limit,
    filtersKey
  );


  // Use DataFreshnessManager for intelligent polling decisions.
  const smartPollingConfig = useSmartPollingConfig(['generations', effectiveProjectId ?? '__no-project__']);
  const pollingDisabled = Boolean(options?.disablePolling)
    || capabilityCensus.capabilities.generations === 'unavailable';
  const pollingConfig: { refetchInterval: number | false; staleTime: number } = pollingDisabled
    ? { refetchInterval: false, staleTime: Infinity }
    : smartPollingConfig;

  const result = useQuery<GenerationsPaginatedResponse, Error>({
    queryKey: queryKey,
    queryFn: () => fetchGenerationsForProject(effectiveProjectId!, limit, offset, filters),
    enabled: !!effectiveProjectId && enabled
      && capabilityCensus.capabilities.generations !== 'unavailable',
    // Use `placeholderData` with `keepPreviousData` to prevent UI flashes on pagination/filter changes
    placeholderData: keepPreviousData,
    // Cache management to prevent memory leaks as pagination grows
    gcTime: GENERATIONS_GC_TIME_MS,
    refetchOnWindowFocus: false, // Prevent double-fetches

    // Intelligent polling based on realtime health (or disabled)
    ...pollingConfig,
    refetchIntervalInBackground: !pollingDisabled, // Only poll in background if polling is enabled
    refetchOnReconnect: false, // Prevent double-fetches
  });

  return result;
}
