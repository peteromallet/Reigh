import { useQuery, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { BridgeGenerationDetailPayload } from '@/tools/video-editor/data/bridgeContract';
import {
  fetchGenerationDetailById,
} from '@/integrations/supabase/repositories/generationRepository';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';

export type GenerationDetail = BridgeGenerationDetailPayload['generation'];

/**
 * The one cache entry for a bridge generation detail read. Variants, source
 * generation metadata, and lineage all come from this payload, so mounting
 * those consumers together cannot issue duplicate R13 requests.
 */
export function createGenerationDetailQueryOptions(
  generationId: string,
): UseQueryOptions<GenerationDetail | null, Error> {
  return {
    queryKey: generationQueryKeys.detail(generationId),
    queryFn: () => fetchGenerationDetailById(generationId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
}

export function fetchGenerationDetailQuery(
  queryClient: QueryClient,
  generationId: string,
): Promise<GenerationDetail | null> {
  return queryClient.fetchQuery(createGenerationDetailQueryOptions(generationId));
}

export function useGenerationDetail(
  generationId: string | null,
  enabled = true,
) {
  return useQuery<GenerationDetail | null, Error>({
    ...createGenerationDetailQueryOptions(generationId ?? 'none'),
    enabled: enabled && Boolean(generationId),
  });
}
