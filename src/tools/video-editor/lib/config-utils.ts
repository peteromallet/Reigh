import type {
  AssetRegistry,
  AssetRegistryEntry,
  ResolvedAssetRegistryEntry,
  ResolvedTimelineConfig,
  TimelineClip,
  TimelineConfig,
} from '@/tools/video-editor/types/index.ts';
import {
  getConfigSignature,
  getStableConfigSignature,
  type StableTimelineAssetRegistryInput,
  type StableTimelineConfigSignatureInput,
  type TimelineConfigSignatureInput,
} from '@/sdk/video/timeline/configSignature.ts';
import {
  getCanonicalClipPlaybackRate,
  getConfigTimelineClipDuration,
  getConfigTimelineClipSourceDuration,
  getConfigTimelineDuration,
} from './timeline-domain.ts';
import { mediaDurationInFrames, secondsToFrames } from './time-grid.ts';

// Frame math is owned by `lib/time-grid.ts`; re-exported here because the
// composition layer historically imports it from config-utils.
export { secondsToFrames };

export const parseResolution = (resolution: string): { width: number; height: number } => {
  const [width, height] = resolution.toLowerCase().split('x');
  return {
    width: Number(width),
    height: Number(height),
  };
};

export const getClipSourceDuration = (clip: TimelineClip): number => {
  return getConfigTimelineClipSourceDuration(clip);
};

export const getClipTimelineDuration = (clip: TimelineClip): number => {
  return getConfigTimelineClipDuration(clip);
};

export const getSanitizedMediaTrimProps = (
  clip: Pick<TimelineClip, 'from' | 'to'>,
  fps: number,
): { trimBefore: number; trimAfter?: number } => {
  const trimBeforeSeconds = typeof clip.from === 'number' && Number.isFinite(clip.from)
    ? Math.max(0, clip.from)
    : 0;
  const trimAfterSeconds = typeof clip.to === 'number' && Number.isFinite(clip.to) && clip.to > trimBeforeSeconds
    ? clip.to
    : undefined;

  return {
    trimBefore: secondsToFrames(trimBeforeSeconds, fps),
    ...(trimAfterSeconds === undefined ? {} : { trimAfter: secondsToFrames(trimAfterSeconds, fps) }),
  };
};

export const getSanitizedPlaybackRate = (speed: TimelineClip['speed']): number => {
  return getCanonicalClipPlaybackRate(speed);
};

export const getSanitizedVolume = (volume: number | undefined, fallback = 1): number => {
  return typeof volume === 'number' && Number.isFinite(volume)
    ? Math.max(0, volume)
    : fallback;
};

export const getSanitizedAssetFile = (file: string | undefined): string | null => {
  return typeof file === 'string' && file.trim().length > 0 ? file.trim() : null;
};

export const getSanitizedMediaSrc = (src: string | undefined): string | null => {
  if (typeof src !== 'string') {
    return null;
  }

  const trimmed = src.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^(?:https?:\/\/|\/)/.test(trimmed)) {
    try {
      const url = new URL(trimmed, 'http://localhost');
      if (url.pathname.endsWith('/')) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return trimmed;
};

export const getClipDurationInFrames = (clip: TimelineClip, fps: number): number => {
  // Media clips (a real trim window, not hold-timed) derive their Sequence
  // duration from the same rounded trim window the player cuts at — see
  // `mediaDurationInFrames` in `lib/time-grid.ts` for why rounding the
  // seconds-duration independently produced a blank final frame on 8-9% of
  // trimmed clips. The condition mirrors `getSanitizedMediaTrimProps`: this
  // branch applies exactly when that helper would emit a `trimAfter`.
  const trimBeforeSeconds = typeof clip.from === 'number' && Number.isFinite(clip.from)
    ? Math.max(0, clip.from)
    : 0;
  if (
    typeof clip.hold !== 'number'
    && typeof clip.to === 'number'
    && Number.isFinite(clip.to)
    && clip.to > trimBeforeSeconds
  ) {
    return mediaDurationInFrames({
      from: trimBeforeSeconds,
      to: clip.to,
      speed: getCanonicalClipPlaybackRate(clip.speed),
      fps,
    });
  }

  return Math.max(1, secondsToFrames(getClipTimelineDuration(clip), fps));
};

export const getTimelineDurationInFrames = (config: ResolvedTimelineConfig, fps: number): number => {
  return Math.max(1, secondsToFrames(getConfigTimelineDuration(config.clips), fps));
};

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

export {
  getConfigSignature,
  getStableConfigSignature,
};

export type {
  StableTimelineAssetRegistryInput,
  StableTimelineConfigSignatureInput,
  TimelineConfigSignatureInput,
};

export type UrlResolver = (
  file: string,
  entry?: AssetRegistryEntry,
  assetId?: string,
) => string | Promise<string>;

export const isRemoteUrl = (url: string): boolean => /^https?:\/\//.test(url);

export const resolveTimelineConfig = async (
  config: TimelineConfig,
  registry: AssetRegistry,
  resolveUrl: UrlResolver,
): Promise<ResolvedTimelineConfig> => {
  const resolvedRegistry: Record<string, ResolvedAssetRegistryEntry> = {};

  await Promise.all(
    Object.entries(registry.assets ?? {}).map(async ([assetId, entry]) => {
      const sanitizedFile = getSanitizedAssetFile(entry.file);
      // Managed media identity is canonical. A file locator is retained for
      // compatibility, but must not win when both fields are present.
      const resolutionToken = getSanitizedAssetFile(entry.media_id) ?? sanitizedFile;
      if (!resolutionToken) {
        console.warn(`Asset '${assetId}' has no file path or media identity - skipping`);
        return;
      }

      let resolvedSrc: string;
      try {
        // A managed identity is authoritative even when a stale/foreign URL
        // remains as a compatibility locator; only URL-only entries bypass
        // the resolver.
        resolvedSrc = isRemoteUrl(resolutionToken) && !entry.media_id
          ? resolutionToken
          : await resolveUrl(resolutionToken, entry, assetId);
      } catch (error) {
        console.warn(`Asset '${assetId}' failed to resolve URL - skipping`, error);
        return;
      }

      const sanitizedSrc = getSanitizedMediaSrc(resolvedSrc);
      if (!sanitizedSrc) {
        console.warn(`Asset '${assetId}' resolved to an invalid media URL - skipping`, {
          file: resolutionToken,
          src: resolvedSrc,
        });
        return;
      }

      resolvedRegistry[assetId] = {
        ...entry,
        ...(sanitizedFile ? { file: sanitizedFile } : {}),
        src: sanitizedSrc,
      };
    }),
  );

  const clips = config.clips.map((clip) => {
    if (!clip.asset) {
      return {
        ...clip,
        assetEntry: undefined,
      };
    }

    const assetEntry = resolvedRegistry[clip.asset];
    if (!assetEntry) {
      console.warn(`Clip '${clip.id}' references missing asset '${clip.asset}' - skipping`);
      return {
        ...clip,
        assetEntry: undefined,
      };
    }

    return {
      ...clip,
      assetEntry,
    };
  });

  return {
    output: { ...config.output },
    tracks: config.tracks ?? [],
    clips,
    registry: resolvedRegistry,
    ...(config.theme !== undefined ? { theme: config.theme } : {}),
    ...(config.theme_overrides !== undefined ? { theme_overrides: config.theme_overrides } : {}),
    ...(config.generation_defaults !== undefined ? { generation_defaults: config.generation_defaults } : {}),
  };
};
