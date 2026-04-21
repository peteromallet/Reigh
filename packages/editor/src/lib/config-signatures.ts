import type { AssetRegistry, ResolvedTimelineConfig } from '@tbd/engine';
import type { TimelineConfig } from '@tbd/schema';

export const getConfigSignature = (
  config: ResolvedTimelineConfig | TimelineConfig,
): string => JSON.stringify(config);

const normalizeForStableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = normalizeForStableJson(item);
      return normalized === undefined ? null : normalized;
    });
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const normalized = normalizeForStableJson((value as Record<string, unknown>)[key]);
        if (normalized !== undefined) {
          acc[key] = normalized;
        }
        return acc;
      }, {});
  }

  return value;
};

export const getStableConfigSignature = (
  config: TimelineConfig,
  registry: AssetRegistry,
): string => {
  return JSON.stringify(normalizeForStableJson({
    config,
    registry,
  }));
};
