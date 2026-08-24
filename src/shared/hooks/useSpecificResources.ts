import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { mapResourceRow, type Resource } from '@/features/resources/hooks/useResources';
import { isNotFoundError } from '@/shared/constants/supabaseErrors';
import { resourceQueryKeys } from '@/shared/lib/queryKeys/resources';

export interface ResourceGenerationRecord {
  id: string;
  location: string | null;
  thumbnail_url: string | null;
  type: string | null;
}

export type SpecificResource = Resource & {
  generation?: ResourceGenerationRecord | null;
};

const RESOURCE_WITH_GENERATION_SELECT = `
  *,
  generation:generations!resources_generation_id_fkey (
    id,
    location,
    thumbnail_url,
    type
  )
`;

/**
 * Fetch a single resource by ID
 * Used internally by useSpecificResources for individual caching
 */
const fetchResourceById = async (id: string): Promise<SpecificResource | null> => {
  const { data, error } = await supabase().from('resources')
    .select(RESOURCE_WITH_GENERATION_SELECT)
    .eq('id', id)
    .single();
  
  if (error) {
    if (isNotFoundError(error)) {
      // Resource not found - return null instead of throwing
      return null;
    }
    console.error('[SpecificResources] Error fetching resource:', id, error);
    throw error;
  }
  
  const resource = mapResourceRow(data);
  return {
    ...resource,
    generation: data.generation,
  };
};

/**
 * Optimized hook to fetch only specific resources by their IDs
 * Each resource is cached individually so removing one resource from the list
 * doesn't cause other resources to be refetched.
 */
export const useSpecificResources = (resourceIds: string[]) => {
  // Deduplicate IDs and filter out empty strings
  const uniqueIds = useMemo(() => 
    [...new Set(resourceIds)].filter(Boolean),
    [resourceIds]
  );
  
  // Use individual queries per resource for normalized caching
  const queries = useQueries({
    queries: uniqueIds.map(id => ({
      queryKey: resourceQueryKeys.detail(id),
      queryFn: () => fetchResourceById(id),
      // Keep data fresh but cache for a while
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    })),
  });
  
  // Combine results
  const result = useMemo(() => {
    // Only report loading if we have NO data yet
    // Once we have some data, new fetches happen in the background without blocking UI
    const data = queries
      .map(q => q.data)
      .filter((r): r is SpecificResource => r !== null && r !== undefined);
    const isLoading = data.length === 0 && queries.some(q => q.isLoading);

    return { data, isLoading };
  }, [queries]);

  return result;
};
