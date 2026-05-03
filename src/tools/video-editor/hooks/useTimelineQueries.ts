import { useQuery } from '@tanstack/react-query';
import { loadTimelineJsonFromProvider } from '@/tools/video-editor/lib/timeline-data';
import { assetRegistryQueryKey, timelineQueryKey } from '@/tools/video-editor/hooks/useTimeline';
import type { AssetResolver } from '@/tools/video-editor/data/AssetResolver';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';

export function useTimelineQueries(
  provider: DataProvider,
  assetResolver: AssetResolver,
  timelineId: string,
) {
  const timelineQuery = useQuery({
    queryKey: timelineQueryKey(timelineId),
    enabled: Boolean(timelineId),
    queryFn: () => loadTimelineJsonFromProvider(provider, assetResolver, timelineId),
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
