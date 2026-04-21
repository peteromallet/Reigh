import {
  getClipDurationInFrames as getClipDurationInFramesShared,
  getClipSourceDuration as getClipSourceDurationShared,
  getClipTimelineDuration as getClipTimelineDurationShared,
  getSanitizedAssetFile as getSanitizedAssetFileShared,
  getSanitizedMediaSrc as getSanitizedMediaSrcShared,
  getSanitizedMediaTrimProps as getSanitizedMediaTrimPropsShared,
  getSanitizedPlaybackRate as getSanitizedPlaybackRateShared,
  getSanitizedVolume as getSanitizedVolumeShared,
  getTimelineDurationInFrames as getTimelineDurationInFramesShared,
  parseResolution as parseResolutionShared,
  resolveTimelineConfig as resolveTimelineConfigShared,
  secondsToFrames as secondsToFramesShared,
  type UrlResolver,
} from '@tbd/engine';
import type {
  AssetRegistry,
  PinnedShotGroup,
  ResolvedTimelineConfig,
  TimelineClip,
  TimelinePinnedShotGroups,
  TimelineConfig,
  TimelineApp,
} from '@/tools/video-editor/types';

export const REIGH_TIMELINE_APP_NAMESPACE = 'x-reigh';

type TimelineConfigLoadInput = TimelineConfig & {
  pinnedShotGroups?: TimelinePinnedShotGroups;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const clonePinnedShotImageSnapshots = (
  imageClipSnapshot: PinnedShotGroup['imageClipSnapshot'],
): PinnedShotGroup['imageClipSnapshot'] => imageClipSnapshot?.map((snapshot) => ({
  ...snapshot,
  meta: { ...snapshot.meta },
}));

const clonePinnedShotGroups = (
  pinnedShotGroups: TimelinePinnedShotGroups | undefined,
): TimelinePinnedShotGroups | undefined => pinnedShotGroups?.map((group) => ({
  shotId: group.shotId,
  trackId: group.trackId,
  clipIds: [...group.clipIds],
  mode: group.mode,
  videoAssetKey: group.videoAssetKey,
  imageClipSnapshot: clonePinnedShotImageSnapshots(group.imageClipSnapshot),
}));

export const getTimelineAppNamespace = (
  config: Pick<TimelineConfig, 'app'> | null | undefined,
  namespace: string,
): Record<string, unknown> | undefined => {
  if (!isRecord(config?.app)) {
    return undefined;
  }

  const value = config.app[namespace];
  return isRecord(value) ? value : undefined;
};

export const getPinnedShotGroups = (
  config: { app?: TimelineApp } | null | undefined,
): TimelinePinnedShotGroups | undefined => {
  const namespacedPinnedShotGroups = getTimelineAppNamespace(config, REIGH_TIMELINE_APP_NAMESPACE)?.pinnedShotGroups;
  return Array.isArray(namespacedPinnedShotGroups)
    ? (namespacedPinnedShotGroups as TimelinePinnedShotGroups)
    : undefined;
};

export const setPinnedShotGroups = (
  config: TimelineConfigLoadInput,
  pinnedShotGroups: TimelinePinnedShotGroups | undefined,
): TimelineConfig => {
  const { app, pinnedShotGroups: _legacyPinnedShotGroups, ...rest } = config;
  const nextApp: TimelineApp = isRecord(app) ? { ...app } : {};
  const currentReighApp = getTimelineAppNamespace(config, REIGH_TIMELINE_APP_NAMESPACE);
  const nextReighApp: Record<string, unknown> = currentReighApp ? { ...currentReighApp } : {};

  if (pinnedShotGroups && pinnedShotGroups.length > 0) {
    nextReighApp.pinnedShotGroups = clonePinnedShotGroups(pinnedShotGroups);
  } else {
    delete nextReighApp.pinnedShotGroups;
  }

  if (Object.keys(nextReighApp).length > 0) {
    nextApp[REIGH_TIMELINE_APP_NAMESPACE] = nextReighApp;
  } else {
    delete nextApp[REIGH_TIMELINE_APP_NAMESPACE];
  }

  return Object.keys(nextApp).length > 0
    ? { ...rest, app: nextApp }
    : { ...rest };
};

export const canonicalizeTimelineConfig = (
  config: TimelineConfigLoadInput,
): TimelineConfig => {
  if (!Object.prototype.hasOwnProperty.call(config, 'pinnedShotGroups')) {
    return config;
  }

  return setPinnedShotGroups(
    config,
    Array.isArray(config.pinnedShotGroups) ? config.pinnedShotGroups : getPinnedShotGroups(config),
  );
};

export const parseResolution = parseResolutionShared;
export const getClipSourceDuration = getClipSourceDurationShared;
export const getClipTimelineDuration = getClipTimelineDurationShared;
export const secondsToFrames = secondsToFramesShared;
export const getSanitizedMediaTrimProps = getSanitizedMediaTrimPropsShared;
export const getSanitizedPlaybackRate = getSanitizedPlaybackRateShared;
export const getSanitizedVolume = getSanitizedVolumeShared;
export const getSanitizedAssetFile = getSanitizedAssetFileShared;
export const getSanitizedMediaSrc = getSanitizedMediaSrcShared;
export const getClipDurationInFrames = getClipDurationInFramesShared;
export const getTimelineDurationInFrames = getTimelineDurationInFramesShared;

export const getEffectValue = (
  effects: TimelineClip['effects'],
  name: 'fade_in' | 'fade_out',
): number | null => {
  if (!effects) {
    return null;
  }

  if (!Array.isArray(effects)) {
    return typeof effects[name] === 'number' ? effects[name] : null;
  }

  for (const effect of effects) {
    if (typeof effect[name] === 'number') {
      return effect[name] ?? null;
    }
  }

  return null;
};

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

export const isRemoteUrl = (url: string): boolean => /^https?:\/\//.test(url);

export const resolveTimelineConfig = async (
  config: TimelineConfig,
  registry: AssetRegistry,
  resolveUrl: UrlResolver,
): Promise<ResolvedTimelineConfig> => {
  return resolveTimelineConfigShared(config, registry, resolveUrl);
};

export type { UrlResolver };
