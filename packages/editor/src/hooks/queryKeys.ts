export const timelineQueryKey = (timelineId: string | null | undefined) => ['timeline', timelineId] as const;
export const assetRegistryQueryKey = (timelineId: string | null | undefined) => ['asset-registry', timelineId] as const;
