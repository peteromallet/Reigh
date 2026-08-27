import type {
  AssetRegistry,
  AssetRegistryEntry,
  TimelineClip,
  TimelineConfig,
  TrackDefinition,
} from '@/tools/video-editor/types/index.ts';
import { getClipTimelineDuration } from '@/tools/video-editor/lib/config-utils.ts';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl.ts';
import type { GenerationRow, Shot } from '@/domains/generation/types';

export type LocalTimelineShotClip = {
  clipId: string;
  clip: TimelineClip;
  durationSeconds: number;
  startSeconds: number;
  /** Start relative to this shot's first visual clip. */
  relativeStartSeconds: number;
  /** Collision lane used by the compact positioned timeline. */
  lane: number;
  asset: AssetRegistryEntry | undefined;
  thumbnailUrl: string | undefined;
  /** True when the group points at a visual clip with no registry entry. */
  missingAsset: boolean;
};

export type LocalTimelineShot = {
  id: string;
  name: string;
  trackId: string;
  clips: LocalTimelineShotClip[];
  /** Number of group members that cannot be rendered as visual clips. */
  nonVisualClipCount: number;
  /** Number of clip IDs in the group that are absent from the document. */
  missingClipCount: number;
  durationSeconds: number;
  laneCount: number;
};

/**
 * The legacy Shots editor consumes GenerationRow/Shot records.  Astrid owns
 * these values in the timeline document instead of relational shot tables, so
 * keep this adapter next to the document selector.  It is deliberately pure:
 * callers can provide the selected group's rows to the existing editor
 * without opening a second (Supabase) source of truth.
 */
export type LocalTimelineShotModel = Shot & {
  images: GenerationRow[];
};

type RegistryEntryWithSource = AssetRegistryEntry & { src?: string };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const positiveNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
);

const assetIsAudio = (asset: AssetRegistryEntry | undefined): boolean => (
  typeof asset?.type === 'string' && asset.type.toLowerCase().startsWith('audio/')
);

const clipIsAudio = (clip: TimelineClip, asset: AssetRegistryEntry | undefined, track?: TrackDefinition): boolean => (
  track?.kind === 'audio'
  || assetIsAudio(asset)
  || clip.clipType?.toLowerCase() === 'audio'
);

const normalizedLabel = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

function groupDisplayName(
  group: Record<string, unknown>,
  clips: LocalTimelineShotClip[],
  shotId: string,
  groupIndex: number,
): string {
  if (typeof group.name === 'string' && group.name.trim() !== '') return group.name;

  const anchor = group.emptyShotAnchor;
  if (typeof anchor === 'string' && anchor.trim() !== '') return anchor;
  if (isRecord(anchor)) {
    for (const key of ['name', 'label', 'title']) {
      if (typeof anchor[key] === 'string' && anchor[key].trim() !== '') return anchor[key];
    }
  }

  const matchingLabel = clips.find((item) => (
    typeof item.clip.label === 'string'
    && normalizedLabel(item.clip.label) === normalizedLabel(shotId)
  ));
  const firstLabel = matchingLabel?.clip.label ?? clips.find((item) => item.clip.label?.trim())?.clip.label;
  return firstLabel?.trim() || `Shot ${groupIndex + 1}`;
}

function clipDurationSeconds(clip: TimelineClip, asset: AssetRegistryEntry | undefined): number {
  try {
    const duration = positiveNumber(getClipTimelineDuration(clip));
    if (duration !== undefined) return duration;
  } catch {
    // A malformed clip should not prevent the other groups from rendering.
  }
  return positiveNumber(asset?.duration) ?? 0;
}

function assetThumbnailUrl(
  asset: AssetRegistryEntry | undefined,
  projectSlug: string | undefined,
): string | undefined {
  if (!asset) return undefined;
  const sourceEntry = asset as RegistryEntryWithSource;
  const reference = sourceEntry.thumbnailUrl
    ?? sourceEntry.src
    ?? sourceEntry.url
    ?? sourceEntry.file
    ?? sourceEntry.media_id;
  if (typeof reference !== 'string' || reference.trim().length === 0) return undefined;
  return bridgeMediaUrl(projectSlug, reference.trim());
}

function assetDisplayUrl(
  asset: AssetRegistryEntry | undefined,
  projectSlug: string | undefined,
): string | undefined {
  if (!asset) return undefined;
  const sourceEntry = asset as RegistryEntryWithSource;
  const reference = sourceEntry.src
    ?? sourceEntry.url
    ?? sourceEntry.file
    ?? sourceEntry.media_id;
  if (typeof reference !== 'string' || reference.trim().length === 0) return undefined;
  return bridgeMediaUrl(projectSlug, reference.trim());
}

/** Convert one document-derived shot group into the legacy editor's model. */
export function toDocumentDerivedShotModel(
  shot: LocalTimelineShot,
  config: TimelineConfig,
  projectSlug?: string,
): LocalTimelineShotModel {
  const fps = Number.isFinite(config.output?.fps) && config.output.fps > 0 ? config.output.fps : 30;
  const images = shot.clips.flatMap((item, index) => {
    const location = assetDisplayUrl(item.asset, projectSlug);
    if (!location) return [];
    const thumbnail = item.thumbnailUrl ?? location;
    const generationId = item.asset?.generationId ?? item.asset?.variantId ?? item.clip.asset ?? item.clipId;
    const frame = Math.max(0, Math.round(item.startSeconds * fps));
    return [{
      id: `${shot.id}:${item.clipId}`,
      shot_generation_id: `${shot.id}:${item.clipId}`,
      generation_id: generationId,
      location,
      imageUrl: location,
      thumbUrl: thumbnail,
      type: item.asset?.type ?? 'image',
      createdAt: new Date(index).toISOString(),
      name: item.clip.label ?? item.clipId,
      timeline_frame: frame,
      metadata: {
        source: 'astrid-timeline',
        projectSlug,
        timelineShotId: shot.id,
        clipId: item.clipId,
        timelineRef: config.app?.timelineRef,
      },
      params: item.clip.params,
    } satisfies GenerationRow];
  });

  return {
    id: shot.id,
    name: shot.name,
    created_at: '1970-01-01T00:00:00.000Z',
    updated_at: null,
    project_id: projectSlug,
    aspect_ratio: null,
    position: 0,
    settings: {},
    images,
    imageCount: images.length,
    positionedImageCount: images.filter((image) => image.timeline_frame != null).length,
    unpositionedImageCount: images.filter((image) => image.timeline_frame == null).length,
    hasUnpositionedImages: images.some((image) => image.timeline_frame == null),
  };
}

export function selectDocumentDerivedShotModels(
  config: TimelineConfig | null | undefined,
  registry: AssetRegistry | null | undefined,
  projectSlug?: string,
): LocalTimelineShotModel[] {
  if (!config) return [];
  return selectDocumentDerivedShots(config, registry, projectSlug)
    .map((shot) => toDocumentDerivedShotModel(shot, config, projectSlug));
}

/**
 * Build the local shot view directly from the timeline document.
 *
 * This deliberately has no shots repository input: a group's clipIds are the
 * complete scope of its mini timeline, and ordering comes from the document's
 * clip positions (with the persisted clipIds order as a deterministic tie-break).
 */
export function selectDocumentDerivedShots(
  config: TimelineConfig | null | undefined,
  registry: AssetRegistry | null | undefined = undefined,
  projectSlug?: string,
): LocalTimelineShot[] {
  const groups = config?.pinnedShotGroups;
  if (!Array.isArray(groups)) return [];

  const clipsById = new Map((config?.clips ?? []).map((clip) => [clip.id, clip]));
  const tracksById = new Map((config?.tracks ?? []).map((track) => [track.id, track]));
  const assets = registry?.assets ?? {};

  return groups.flatMap((rawGroup, groupIndex) => {
    if (!isRecord(rawGroup) || typeof rawGroup.shotId !== 'string' || rawGroup.shotId.trim() === '') {
      return [];
    }

    const shotId = rawGroup.shotId;
    const trackId = typeof rawGroup.trackId === 'string' ? rawGroup.trackId : '';
    const clipIds = Array.isArray(rawGroup.clipIds)
      ? rawGroup.clipIds.filter((clipId): clipId is string => typeof clipId === 'string')
      : [];
    const track = tracksById.get(trackId);
    let missingClipCount = 0;
    let nonVisualClipCount = 0;

    const clips = clipIds.flatMap((clipId, clipIndex) => {
      const clip = clipsById.get(clipId);
      if (!clip) {
        missingClipCount += 1;
        return [];
      }
      const asset = clip.asset ? assets[clip.asset] : undefined;
      if (clipIsAudio(clip, asset, track)) {
        nonVisualClipCount += 1;
        return [];
      }
      return [{
        clipId,
        clip,
        durationSeconds: clipDurationSeconds(clip, asset),
        startSeconds: typeof clip.at === 'number' && Number.isFinite(clip.at) ? clip.at : clipIndex,
        relativeStartSeconds: 0,
        lane: 0,
        asset,
        thumbnailUrl: assetThumbnailUrl(asset, projectSlug),
        missingAsset: Boolean(clip.asset && !asset),
      } satisfies LocalTimelineShotClip];
    }).sort((left, right) => left.startSeconds - right.startSeconds || clipIds.indexOf(left.clipId) - clipIds.indexOf(right.clipId));

    const timelineStart = clips.length > 0 ? Math.min(...clips.map((clip) => clip.startSeconds)) : 0;
    const laneEnds: number[] = [];
    clips.forEach((clip) => {
      clip.relativeStartSeconds = Math.max(0, clip.startSeconds - timelineStart);
      const end = clip.relativeStartSeconds + clip.durationSeconds;
      const availableLane = laneEnds.findIndex((laneEnd) => laneEnd <= clip.relativeStartSeconds);
      clip.lane = availableLane >= 0 ? availableLane : laneEnds.length;
      laneEnds[clip.lane] = end;
    });
    const timelineEnd = clips.reduce(
      (latest, clip) => Math.max(latest, clip.relativeStartSeconds + clip.durationSeconds),
      0,
    );

    return [{
      id: shotId,
      name: groupDisplayName(rawGroup, clips, shotId, groupIndex),
      trackId,
      clips,
      nonVisualClipCount,
      missingClipCount,
      durationSeconds: timelineEnd,
      laneCount: Math.max(1, laneEnds.length),
    }];
  });
}
