/**
 * Soundtrack Cartographer — a deterministic structural soundtrack proxy.
 *
 * V1 deliberately does not inspect audio. It derives a bounded cue map from
 * clip duration and the density of unique starts on unmuted visual tracks,
 * persists it in a versioned extension-owned envelope, and renders cues on
 * the host-owned timeline ruler.
 */

import { createElement } from 'react';
import { defineExtension } from '@reigh/editor-sdk';
import type {
  CommandRunContext,
  ContributionId,
  DisposeHandle,
  ExtensionContext,
  ExtensionId,
  ReighExtension,
  TimelineClipSummary,
  TimelineMarkerChange,
  TimelineOverlayRenderProps,
  TimelinePatch,
  TimelinePointMarker,
  TimelineSnapshot,
  TimelineTrackSummary,
} from '@reigh/editor-sdk';
import {
  clusterTimelineMarkers,
  moveTimelineMarkerCluster,
  type ClusteredTimelineMarkerData,
} from '../timelineMarkerClusters';

export const SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID =
  'com.reigh.creative-lab.soundtrack-cartographer' as ExtensionId;
export const BUILD_TERRAIN_COMMAND = `${SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID}.buildTerrain`;
export const TERRAIN_DATA_KEY = 'terrainCues';
export const TERRAIN_OVERLAY_RENDER_ID = 'soundtrack-cartographer/timeline-overlay';
export const TERRAIN_SCHEMA_VERSION = 1;
export const MAX_TERRAIN_CUES = 128;
export const CUT_DENSITY_WINDOW_SECONDS = 8;

const CUE_COLORS = {
  rise: '#52e8ff',
  peak: '#ffd166',
  release: '#b388ff',
} as const;

export type TerrainCueKind = 'rise' | 'peak' | 'release';

export interface TerrainCue {
  id: string;
  sourceClipId: string;
  edge: 'start' | 'release';
  kind: TerrainCueKind;
  time: number;
  /** Explicit user adjustment from the structural source boundary. */
  offset: number;
  intensity: number;
  color: string;
  label: string;
}

export interface TerrainEnvelope {
  schemaVersion: number;
  generatedFromVersion: number;
  entries: TerrainCue[];
}

export type TerrainPatchMode = 'build' | 'move';

export interface TerrainPatchOptions {
  mode?: TerrainPatchMode;
  generatedFromVersion?: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeTerrainTime(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.round(time * 1000) / 1000;
}

export function normalizeTerrainOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.round(offset * 1000) / 1000;
}

function normalizeIntensity(value: number): number {
  return Math.round(Math.min(Math.max(finiteOrZero(value), 0), 1) * 1000) / 1000;
}

function clipOrder(a: TimelineClipSummary, b: TimelineClipSummary): number {
  const atDelta = finiteOrZero(a.at) - finiteOrZero(b.at);
  return atDelta !== 0 ? atDelta : a.id.localeCompare(b.id);
}

function isUsableClip(clip: TimelineClipSummary): boolean {
  return typeof clip.id === 'string'
    && Number.isFinite(clip.at)
    && Number.isFinite(clip.duration);
}

function isUnmutedVisualTrack(track: TimelineTrackSummary | undefined): boolean {
  return track?.kind === 'visual' && track.muted === false;
}

function uniqueNearbyStarts(
  clip: TimelineClipSummary,
  eligibleClips: readonly TimelineClipSummary[],
): number {
  const starts = new Set<number>();
  const start = finiteOrZero(clip.at);
  for (const candidate of eligibleClips) {
    if (candidate.id === clip.id) continue;
    const candidateStart = finiteOrZero(candidate.at);
    if (Math.abs(candidateStart - start) <= CUT_DENSITY_WINDOW_SECONDS) {
      starts.add(normalizeTerrainTime(candidateStart));
    }
  }
  return starts.size;
}

function cueForBoundary(
  clip: TimelineClipSummary,
  edge: TerrainCue['edge'],
  kind: TerrainCueKind,
  intensity: number,
): TerrainCue {
  const baseTime = Math.max(0, finiteOrZero(clip.at))
    + (edge === 'release' ? Math.max(0, finiteOrZero(clip.duration)) : 0);
  return {
    // Stable source identity is independent of ordinal and classification.
    id: `terrain-${clip.id}-${edge}`,
    sourceClipId: clip.id,
    edge,
    kind,
    time: normalizeTerrainTime(baseTime),
    offset: 0,
    intensity,
    color: CUE_COLORS[kind],
    label: kind === 'peak' ? 'peak' : kind,
  };
}

/**
 * Derive a structural soundtrack proxy from eligible visual clips only.
 * Density counts unique starts of other eligible clips, explicitly excluding
 * the current clip and ignoring muted/audio tracks.
 */
export function deriveTerrainCues(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
): TerrainCue[] {
  const trackById = new Map(snapshot.tracks.map((track) => [track.id, track]));
  const clips = snapshot.clips
    .filter((clip) => isUsableClip(clip) && isUnmutedVisualTrack(trackById.get(clip.track)))
    .slice()
    .sort(clipOrder);
  const cues: TerrainCue[] = [];

  for (const clip of clips) {
    if (cues.length >= MAX_TERRAIN_CUES) break;
    const duration = Math.max(0, finiteOrZero(clip.duration));
    const nearbyStarts = uniqueNearbyStarts(clip, clips);
    const cutDensity = Math.min(nearbyStarts / 4, 1);
    const durationWeight = Math.min(duration / 5, 1);
    const intensity = normalizeIntensity(0.25 + durationWeight * 0.35 + cutDensity * 0.4);
    const kind: TerrainCueKind = intensity >= 0.75 ? 'peak' : 'rise';
    cues.push(cueForBoundary(clip, 'start', kind, intensity));

    if (duration > 0 && cues.length < MAX_TERRAIN_CUES) {
      cues.push(cueForBoundary(clip, 'release', 'release', intensity));
    }
  }

  return cues.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)).slice(0, MAX_TERRAIN_CUES);
}

export function rebuildTerrainCues(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
  previous: readonly TerrainCue[] = [],
): TerrainCue[] {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  return deriveTerrainCues(snapshot).map((entry) => {
    const prior = previousById.get(entry.id);
    const offset = normalizeTerrainOffset(prior?.offset ?? 0);
    return { ...entry, offset, time: normalizeTerrainTime(entry.time + offset) };
  });
}

function normalizeTerrainCue(cue: TerrainCue): TerrainCue {
  return {
    ...cue,
    edge: cue.edge ?? (cue.kind === 'release' ? 'release' : 'start'),
    time: normalizeTerrainTime(cue.time),
    offset: normalizeTerrainOffset(cue.offset),
    intensity: normalizeIntensity(cue.intensity),
  };
}

function isTerrainCue(value: unknown): value is TerrainCue {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.sourceClipId === 'string'
    && (candidate.edge === undefined || candidate.edge === 'start' || candidate.edge === 'release')
    && (candidate.kind === 'rise' || candidate.kind === 'peak' || candidate.kind === 'release')
    && typeof candidate.time === 'number'
    && Number.isFinite(candidate.time)
    && (candidate.offset === undefined || typeof candidate.offset === 'number')
    && typeof candidate.intensity === 'number'
    && Number.isFinite(candidate.intensity)
    && typeof candidate.color === 'string'
    && typeof candidate.label === 'string';
}

function readRawEnvelope(value: unknown): TerrainEnvelope | null {
  if (Array.isArray(value)) {
    return {
      schemaVersion: TERRAIN_SCHEMA_VERSION,
      generatedFromVersion: 0,
      entries: value.filter(isTerrainCue)
        .map((cue) => normalizeTerrainCue({ ...cue, offset: cue.offset ?? 0 })),
    };
  }
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.entries)) return null;
  const generatedFromVersion = typeof candidate.generatedFromVersion === 'number'
    && Number.isFinite(candidate.generatedFromVersion)
    ? candidate.generatedFromVersion
    : 0;
  return {
    schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 0,
    generatedFromVersion,
    entries: candidate.entries
      .filter(isTerrainCue)
      .map((cue) => normalizeTerrainCue({ ...cue, offset: cue.offset ?? 0 })),
  };
}

export function readTerrainEnvelope(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID,
): TerrainEnvelope {
  const app = snapshot.app[extensionId];
  if (app === null || typeof app !== 'object' || Array.isArray(app)) {
    return { schemaVersion: TERRAIN_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
  }
  const envelope = readRawEnvelope((app as Record<string, unknown>)[TERRAIN_DATA_KEY]);
  return envelope ?? { schemaVersion: TERRAIN_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
}

export function readTerrainCues(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID,
): TerrainCue[] {
  return readTerrainEnvelope(snapshot, extensionId).entries
    .slice(0, MAX_TERRAIN_CUES)
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function buildTerrainPatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>,
  cues: readonly TerrainCue[],
  options: TerrainPatchOptions = {},
): TimelinePatch {
  const mode = options.mode ?? 'build';
  const generatedFromVersion = options.generatedFromVersion ?? snapshot.baseVersion;
  const entries = cues.slice(0, MAX_TERRAIN_CUES).map(normalizeTerrainCue);
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: mode === 'move' ? 'soundtrack-cartographer-move' : 'soundtrack-cartographer-build',
      generatedFromVersion,
      analysis: 'structural-soundtrack-proxy',
    },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: TERRAIN_DATA_KEY,
        value: {
          schemaVersion: TERRAIN_SCHEMA_VERSION,
          generatedFromVersion,
          entries,
        } satisfies TerrainEnvelope,
        mode: 'replace',
      },
    }],
  };
}

function buildTerrain(ctx: ExtensionContext): TerrainCue[] {
  const snapshot = ctx.creative.reader.snapshot();
  const cues = rebuildTerrainCues(snapshot, readTerrainCues(snapshot, ctx.extension.id as string));
  ctx.creative.timeline.apply(buildTerrainPatch(ctx.extension.id as string, snapshot, cues));
  ctx.chrome.toast(`Structural soundtrack proxy mapped: ${cues.length} cues.`, 'info');
  return cues;
}

function renderTerrainMarker(
  marker: TimelinePointMarker<ClusteredTimelineMarkerData<TerrainCue>>,
): unknown {
  const cue = marker.data;
  if (!cue) return null;
  return createElement('span', {
    'data-terrain-marker': cue.id,
    'aria-label': `Structural soundtrack proxy from ${cue.sourceClipId}, ${cue.edge}, ${cue.kind}, intensity ${cue.intensity.toFixed(2)}`,
    style: {
      display: 'inline-block',
      width: `${4 + cue.intensity * 8}px`,
      height: `${8 + cue.intensity * 12}px`,
      opacity: 0.45 + cue.intensity * 0.55,
      backgroundColor: cue.color,
      borderRadius: 2,
    },
  });
}

function renderTerrainOverlay(ctx: ExtensionContext, props: TimelineOverlayRenderProps): unknown {
  const snapshot = ctx.creative.reader.snapshot();
  const cues = readTerrainCues(snapshot, ctx.extension.id as string);
  const markers = clusterTimelineMarkers(cues, {
    getId: (cue) => cue.id,
    getTime: (cue) => cue.time,
    getLabel: (cue) => `${cue.kind} · ${cue.sourceClipId}`,
    getColor: (cue) => cue.color,
  });

  return props.primitives.markerLayer({
    markers,
    placement: 'ruler',
    interactive: true,
    snap: true,
    renderMarker: renderTerrainMarker,
    onChange: (change: TimelineMarkerChange): void => {
      if (change.phase !== 'commit') return;
      const freshSnapshot = ctx.creative.reader.snapshot();
      const freshCues = readTerrainCues(freshSnapshot, ctx.extension.id as string);
      const baseline = new Map(deriveTerrainCues(freshSnapshot).map((cue) => [cue.id, cue]));
      const moved = moveTimelineMarkerCluster(
        freshCues,
        change.id,
        normalizeTerrainTime(change.time),
        {
          getId: (cue) => cue.id,
          getTime: (cue) => cue.time,
          updateTime: (cue, nextTime) => {
            const base = baseline.get(cue.id);
            return {
              ...cue,
              time: nextTime,
              offset: normalizeTerrainOffset(nextTime - (base?.time ?? nextTime)),
            };
          },
        },
      );
      if (moved.moved) {
        const envelope = readTerrainEnvelope(freshSnapshot, ctx.extension.id as string);
        ctx.creative.timeline.apply(buildTerrainPatch(ctx.extension.id as string, freshSnapshot, moved.entries, {
          mode: 'move', generatedFromVersion: envelope.generatedFromVersion,
        }));
      }
    },
  });
}

function disposeTogether(ctx: ExtensionContext, handles: readonly DisposeHandle[]): void {
  for (const handle of handles) {
    try {
      handle.dispose();
    } catch (error) {
      ctx.services.diagnostics.report({
        severity: 'error',
        code: 'soundtrack-cartographer/dispose-failed',
        message: `Soundtrack Cartographer cleanup failed: ${String(error)}`,
      });
    }
  }
}

export const soundtrackCartographerExtension: ReighExtension = defineExtension({
  manifest: {
    id: SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID,
    version: '1.0.0',
    label: 'Soundtrack Cartographer',
    description:
      'Maps a deterministic structural soundtrack proxy from clip duration and unique starts on unmuted visual tracks, then renders it on the timeline ruler.',
    apiVersion: 1,
    contributions: [
      {
        id: 'build-terrain' as ContributionId,
        kind: 'command',
        command: BUILD_TERRAIN_COMMAND,
        label: 'Map Structural Soundtrack Proxy',
        category: 'Soundtrack Cartographer',
        order: 10,
      },
      {
        id: 'terrain-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: TERRAIN_OVERLAY_RENDER_ID,
        label: 'Soundtrack Terrain (timeline ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Soundtrack Cartographer ready — map a structural soundtrack proxy from current clips.',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const commandHandle = ctx.commands.registerCommand(
      BUILD_TERRAIN_COMMAND,
      (_run: CommandRunContext): void => { buildTerrain(ctx); },
      { label: 'Map Structural Soundtrack Proxy', category: 'Soundtrack Cartographer' },
    );
    const overlayHandle = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
      TERRAIN_OVERLAY_RENDER_ID,
      (props) => renderTerrainOverlay(ctx, props),
    );
    ctx.chrome.toast(ctx.services.i18n.t('ready'), 'info');
    let disposed = false;
    return {
      dispose(): void {
        if (disposed) return;
        disposed = true;
        disposeTogether(ctx, [commandHandle, overlayHandle]);
      },
    };
  },
});
