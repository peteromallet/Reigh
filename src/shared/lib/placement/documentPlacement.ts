/**
 * Document-native placement primitives (B4 / C1-5, doc 24 Q1 RATIFIED).
 *
 * The timeline document is the ONLY placement authority: a placed generation
 * is a media clip in `config.clips` whose registry asset carries the
 * `generationId`, plus membership in the shot's `PinnedShotGroup`. An
 * unpositioned ("pooled") member lives in `poolGenerationIds` with a
 * registry entry but no clip. There is no relational junction table and no
 * placement RPC — this module replaces that machinery, it does not port it.
 *
 * Pure functions only: they take a `{config, registry}` document and return
 * the next document (plus a read model). All I/O (CAS load/save, retries,
 * display-URL building) lives in `./placementService.ts`.
 */

import type {
  AssetRegistry,
  AssetRegistryEntry,
  PinnedShotGroup,
  TimelineClip,
  TimelineConfig,
} from '@/tools/video-editor/types/index';

/** A document under mutation — the pair the CAS save route accepts. */
export interface PlacementDocument {
  config: TimelineConfig;
  registry: AssetRegistry;
}

/** Read model of one generation's placement inside one shot. */
export interface ShotPlacement {
  /** Stable per (shotId, generationId) — plays the role the junction-row id played. */
  entryId: string;
  shotId: string;
  generationId: string;
  /** Frame position; `null` = pooled (unpositioned). */
  timelineFrame: number | null;
  assetKey: string;
}

/** Registry asset key for a generation's primary media. Stable domain concept shared with reads/tests. */
export const placementAssetKey = (generationId: string): string => `gen:${generationId}`;

/** Deterministic entry id — idempotent under retries/replays like the old unique pair constraint. */
export const placementEntryId = (shotId: string, generationId: string): string =>
  `sg-${shotId}-${generationId}`;

export const clipIdForEntry = (entryId: string): string => `clip-${entryId}`;

/** Default on-screen duration for a newly placed image clip (seconds). */
export const DEFAULT_CLIP_HOLD = 4;

const DEFAULT_FPS = 30;
const DEFAULT_TRACK = 'V1';

function fpsOf(config: TimelineConfig): number {
  const fps = config.output?.fps;
  return typeof fps === 'number' && fps > 0 ? fps : DEFAULT_FPS;
}

// Frame <-> seconds conversion. Multiple call sites must round-trip in lockstep.
const frameToAt = (frame: number, fps: number): number => frame / fps;
const atToFrame = (at: number, fps: number): number => Math.round(at * fps);

// ---------------------------------------------------------------------------
// Group access
// ---------------------------------------------------------------------------

export function ensureShotGroup(config: TimelineConfig, shotId: string): PinnedShotGroup {
  const groups = config.pinnedShotGroups ?? [];
  const existing = groups.find((group) => group.shotId === shotId);
  if (existing) return existing;

  // First placed group picks the first visual track; contiguity repairs are
  // the editor's job (timeline-domain), not ours.
  const trackId = groups[0]?.trackId ?? config.tracks?.[0]?.id ?? DEFAULT_TRACK;
  const group: PinnedShotGroup = { shotId, trackId, clipIds: [], poolGenerationIds: [] };
  config.pinnedShotGroups = [...groups, group];
  return group;
}

function clipById(config: TimelineConfig, clipId: string): TimelineClip | undefined {
  return config.clips.find((candidate) => candidate.id === clipId);
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/**
 * Derive every shot's placements from the document. Placed entries come from
 * clips resolved through the registry (`generationId`); pooled entries from
 * `poolGenerationIds`. Ordered by frame, pooled last.
 */
export function readPlacements(config: TimelineConfig, registry: AssetRegistry): Map<string, ShotPlacement[]> {
  const fps = fpsOf(config);
  const result = new Map<string, ShotPlacement[]>();

  for (const group of config.pinnedShotGroups ?? []) {
    const entries: ShotPlacement[] = [];

    for (const clipId of group.clipIds) {
      const clip = clipById(config, clipId);
      if (!clip?.asset) continue;
      const generationId = registry.assets[clip.asset]?.generationId;
      if (!generationId) continue;
      entries.push({
        entryId: clip.source_uuid ?? clipIdForEntry(clipId),
        shotId: group.shotId,
        generationId,
        timelineFrame: atToFrame(clip.at, fps),
        assetKey: clip.asset,
      });
    }

    for (const generationId of group.poolGenerationIds ?? []) {
      const assetKey = placementAssetKey(generationId);
      if (!registry.assets[assetKey]?.generationId) continue; // stale pool ref — invisible, not fatal
      entries.push({
        entryId: placementEntryId(group.shotId, generationId),
        shotId: group.shotId,
        generationId,
        timelineFrame: null,
        assetKey,
      });
    }

    entries.sort((a, b) => {
      if (a.timelineFrame === null && b.timelineFrame === null) return a.entryId.localeCompare(b.entryId);
      if (a.timelineFrame === null) return 1;
      if (b.timelineFrame === null) return -1;
      return a.timelineFrame - b.timelineFrame;
    });
    result.set(group.shotId, entries);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Mutations (each returns the affected read-model row(s))
// ---------------------------------------------------------------------------

export interface PlaceGenerationInput {
  shotId: string;
  generationId: string;
  /** Managed-media reference stored in the registry asset's `file`. */
  mediaRef: string;
  /** Display URL for the media (R9 content route) — built by the service layer. */
  displaySrc?: string;
  mimeType?: string;
  duration?: number;
  thumbnailRef?: string;
  /**
   * Full registry entry base (from R13 resolution). When present it replaces
   * any prior entry as merge base; the explicit media fields above still win
   * so the placement's own truth stays authoritative.
   */
  registryEntry?: AssetRegistryEntry;
  /**
   * `undefined` → auto-position (append after the group's last clip);
   * `null` → pooled (no position); a number → explicit frame.
   */
  timelineFrame?: number | null;
}

/** Merge (or refresh) the registry entry for a generation's primary media. */
export function mergeGenerationAsset(registry: AssetRegistry, input: PlaceGenerationInput): string {
  const assetKey = placementAssetKey(input.generationId);
  const existing = input.registryEntry ?? registry.assets[assetKey];
  const src = input.displaySrc ?? existing?.url;
  const entry: AssetRegistryEntry = {
    ...existing,
    file: input.mediaRef,
    ...(src !== undefined ? { src } : {}),
    type: input.mimeType ?? existing?.type,
    duration: input.duration ?? existing?.duration,
    thumbnailUrl: input.thumbnailRef ?? existing?.thumbnailUrl,
    generationId: input.generationId,
  };
  registry.assets = { ...registry.assets, [assetKey]: entry };
  return assetKey;
}

/** Frames occupied by the shot's placed clips. */
function occupiedFrames(config: TimelineConfig, shotId: string, fps: number): Set<number> {
  const group = config.pinnedShotGroups?.find((candidate) => candidate.shotId === shotId);
  const frames = new Set<number>();
  if (!group) return frames;
  for (const clipId of group.clipIds) {
    const clip = clipById(config, clipId);
    if (clip) frames.add(atToFrame(clip.at, fps));
  }
  return frames;
}

function nextFreeFrame(config: TimelineConfig, shotId: string, requested: number, fps: number): number {
  const taken = occupiedFrames(config, shotId, fps);
  let frame = Math.max(0, Math.round(requested));
  while (taken.has(frame)) frame += 1;
  return frame;
}

/** Last occupied frame of the shot's placed clips, or -1 when none. */
function latestOccupiedFrame(config: TimelineConfig, shotId: string, fps: number): number {
  const group = config.pinnedShotGroups?.find((candidate) => candidate.shotId === shotId);
  if (!group) return -1;
  let latest = -1;
  for (const clipId of group.clipIds) {
    const clip = clipById(config, clipId);
    if (!clip) continue;
    const holdFrames = Math.max(1, Math.round((clip.hold ?? DEFAULT_CLIP_HOLD) * fps));
    latest = Math.max(latest, atToFrame(clip.at, fps) + holdFrames - 1);
  }
  return latest;
}

/**
 * Place (or re-place) a generation into a shot. Idempotent on (shotId,
 * generationId): an existing expression of the pair is replaced, mirroring
 * the old unique-pair constraint instead of duplicating it.
 */
export function placeGenerationInDocument(
  document: PlacementDocument,
  input: PlaceGenerationInput,
): ShotPlacement {
  const { config } = document;
  const assetKey = mergeGenerationAsset(document.registry, input);
  const group = ensureShotGroup(config, input.shotId);
  const entryId = placementEntryId(input.shotId, input.generationId);

  // Drop any prior expression of this entry (clip or pool slot) — re-placement wins.
  removeEntryFromDocument(document, entryId);

  const fps = fpsOf(config);

  if (input.timelineFrame === null) {
    group.poolGenerationIds = [...(group.poolGenerationIds ?? []), input.generationId];
    return { entryId, shotId: input.shotId, generationId: input.generationId, timelineFrame: null, assetKey };
  }

  let frame: number;
  if (input.timelineFrame === undefined) {
    const end = latestOccupiedFrame(config, input.shotId, fps);
    frame = end < 0 ? 0 : end + 1;
  } else {
    frame = nextFreeFrame(config, input.shotId, input.timelineFrame, fps);
  }

  const clipId = clipIdForEntry(entryId);
  const clip: TimelineClip = {
    id: clipId,
    track: group.trackId,
    at: frameToAt(frame, fps),
    clipType: 'media',
    hold: DEFAULT_CLIP_HOLD,
    asset: assetKey,
    source_uuid: entryId,
  };
  config.clips = [...config.clips, clip];
  group.clipIds = [...group.clipIds, clipId];

  return { entryId, shotId: input.shotId, generationId: input.generationId, timelineFrame: frame, assetKey };
}

/**
 * Remove an entry's expression from the document: its clip (if placed) and
 * any pool slot. The registry entry survives — media bytes are not deleted.
 */
export function removeEntryFromDocument(document: PlacementDocument, entryId: string): void {
  const clipId = clipIdForEntry(entryId);
  const config = document.config;
  const hadClip = config.clips.some((candidate) => candidate.id === clipId);
  if (hadClip) {
    config.clips = config.clips.filter((candidate) => candidate.id !== clipId);
  }
  for (const group of config.pinnedShotGroups ?? []) {
    if (hadClip && group.clipIds.includes(clipId)) {
      group.clipIds = group.clipIds.filter((id) => id !== clipId);
    }
    const prefix = `sg-${group.shotId}-`;
    if (entryId.startsWith(prefix)) {
      const generationId = entryId.slice(prefix.length);
      if ((group.poolGenerationIds ?? []).includes(generationId)) {
        group.poolGenerationIds = (group.poolGenerationIds ?? []).filter((id) => id !== generationId);
      }
    }
  }
}

export interface FrameUpdate {
  entryId: string;
  timelineFrame: number;
}

function placementsOfShot(document: PlacementDocument, shotId: string): ShotPlacement[] {
  return readPlacements(document.config, document.registry).get(shotId) ?? [];
}

/**
 * Batch frame update across ONE shot's placements (the document equivalent
 * of the retired `batch_update_timeline_frames` RPC). Pooled entries are
 * promoted to clips. Applied sequentially so each update sees the frames its
 * predecessors took; collisions shift to the next free frame — never an
 * overwrite of a peer.
 */
export function batchUpdateFramesInDocument(
  document: PlacementDocument,
  shotId: string,
  updates: FrameUpdate[],
): ShotPlacement[] {
  const results: ShotPlacement[] = [];
  for (const update of updates) {
    const before = placementsOfShot(document, shotId).find((entry) => entry.entryId === update.entryId);
    if (!before) continue;
    const asset = document.registry.assets[before.assetKey];
    removeEntryFromDocument(document, update.entryId);
    results.push(placeGenerationInDocument(document, {
      shotId,
      generationId: before.generationId,
      mediaRef: asset?.file ?? before.assetKey,
      displaySrc: asset?.url,
      mimeType: asset?.type,
      duration: asset?.duration,
      thumbnailRef: asset?.thumbnailUrl,
      timelineFrame: update.timelineFrame,
    }));
  }
  return results;
}
