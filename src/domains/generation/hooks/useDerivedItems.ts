import { useQuery, useQueryClient } from '@tanstack/react-query';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';
import { useSmartPollingConfig } from '@/shared/hooks/useSmartPolling';
import {
  mapDerivedItemsFromGenerationDetail,
  type DerivedItem,
} from '@/domains/generation/repository/derivedItemsRepository';
import { fetchGenerationDetailQuery } from '@/shared/hooks/generations/useGenerationDetail';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';

export type { DerivedItem } from '@/domains/generation/repository/derivedItemsRepository';

export function useDerivedItems(
  sourceGenerationId: string | null,
  enabled: boolean = true,
) {
  const queryClient = useQueryClient();
  const queryKey = generationQueryKeys.derived(sourceGenerationId ?? 'none');
  const smartPollingConfig = useSmartPollingConfig(queryKey);

  return useQuery<DerivedItem[], Error>({
    queryKey,
    queryFn: async () => {
      if (!sourceGenerationId) return [];
      const projectSlug = getProjectSelectionFallbackId();
      if (!projectSlug) return [];
      const detail = await fetchGenerationDetailQuery(queryClient, sourceGenerationId);
      return detail ? mapDerivedItemsFromGenerationDetail(detail, projectSlug) : [];
    },
    enabled: Boolean(sourceGenerationId) && enabled,
    gcTime: 5 * 60 * 1000,
    ...smartPollingConfig,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
