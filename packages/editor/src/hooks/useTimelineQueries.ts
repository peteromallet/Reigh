import { useQuery } from '@tanstack/react-query';
import { loadTimelineJsonFromProvider } from '../lib/timeline-data.js';
import { assetRegistryQueryKey, timelineQueryKey } from './queryKeys.js';
import type { DataProvider } from '../data/DataProvider.js';

export function useTimelineQueries(provider: DataProvider, timelineId: string) {
  const timelineQuery = useQuery({
    queryKey: timelineQueryKey(timelineId),
    enabled: Boolean(timelineId),
    queryFn: () => loadTimelineJsonFromProvider(provider, timelineId),
    refetchInterval: 30_000,
  });

  const assetRegistryQuery = useQuery({
    queryKey: assetRegistryQueryKey(timelineId),
    enabled: Boolean(timelineId),
    queryFn: () => provider.loadAssetRegistry(timelineId),
    refetchInterval: 30_000,
  });

  return {
    timelineQuery,
    assetRegistryQuery,
  };
}
