/**
 * Foley Cue Scaffolder — neutral, editable structural cue scaffolds.
 *
 * V1 does not identify sounds, synthesize audio, or infer spatial placement.
 * It creates unassigned cues at boundaries of the primary unmuted visual
 * track, leaving the sound editor to author category and spatial meaning.
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
  TimelineSnapshot,
  TimelineTrackSummary,
} from '@reigh/editor-sdk';
import {
  clusterTimelineMarkers,
  moveTimelineMarkerCluster,
} from '../timelineMarkerClusters';

export const FOLEY_CONSTELLATION_EXTENSION_ID =
  'com.reigh.creative-lab.foley-constellation' as ExtensionId;
export const DROP_FOLEY_CUES_COMMAND =
  `${FOLEY_CONSTELLATION_EXTENSION_ID}.dropCues`;
export const FOLEY_CUES_DATA_KEY = 'foleyCues';
export const FOLEY_OVERLAY_RENDER_ID = 'foley-constellation/timeline-overlay';
export const FOLEY_SCHEMA_VERSION = 1;

export const MAX_FOLEY_CUES = 128;
export const MAX_FOLEY_CLIPS = 64;

export type FoleyBoundary = 'start' | 'end' | 'playhead';
/** User-authored category text; generated scaffolds always start unassigned. */
export type FoleyCategory = string;

export interface FoleyCue {
  id: string;
  sourceClipId: string | null;
  boundary: FoleyBoundary;
  category: FoleyCategory;
  time: number;
  /** Explicit user adjustment from the structural boundary. */
  offset: number;
  /** Neutral until an editor authors spatial placement. */
  pan: number;
  /** Neutral midpoint until an editor authors spatial placement. */
  distance: number;
  /** Structural prominence proxy, not a measured audio level. */
  intensity: number;
  label: string;
}

export interface FoleyEnvelope {
  schemaVersion: number;
  generatedFromVersion: number;
  entries: FoleyCue[];
}

export type FoleyPatchMode = 'build' | 'move';

export interface FoleyPatchOptions {
  mode?: FoleyPatchMode;
  generatedFromVersion?: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeFoleyTime(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.round(time * 1000) / 1000;
}

export function normalizeFoleyOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.round(offset * 1000) / 1000;
}

export function normalizeFoleyPan(pan: number): number {
  if (!Number.isFinite(pan)) return 0;
  return Math.round(Math.min(Math.max(pan, -1), 1) * 1000) / 1000;
}

export function normalizeFoleyDistance(distance: number): number {
  if (!Number.isFinite(distance)) return 0.5;
  return Math.round(Math.min(Math.max(distance, 0), 1) * 1000) / 1000;
}

export function normalizeFoleyIntensity(intensity: number): number {
  if (!Number.isFinite(intensity)) return 0;
  return Math.round(Math.min(Math.max(intensity, 0), 1) * 1000) / 1000;
}

function clipOrder(a: TimelineClipSummary, b: TimelineClipSummary): number {
  const atDelta = finiteOrZero(a.at) - finiteOrZero(b.at);
  return atDelta !== 0 ? atDelta : a.id.localeCompare(b.id);
}

function primaryEditorialTrack(
  tracks: readonly TimelineTrackSummary[],
): TimelineTrackSummary | undefined {
  return tracks.find((track) => track.kind === 'visual' && track.muted === false);
}

function isUsableClip(clip: TimelineClipSummary, trackId: string): boolean {
  return clip.track === trackId
    && typeof clip.id === 'string'
    && Number.isFinite(clip.at)
    && Number.isFinite(clip.duration)
    && clip.at >= 0
    && clip.duration >= 0;
}

function cueForBoundary(
  clip: TimelineClipSummary | null,
  boundary: FoleyBoundary,
  time: number,
): FoleyCue {
  const sourceClipId = clip?.id ?? null;
  const idSource = sourceClipId ?? 'playhead';
  const id = `foley-${idSource}-${boundary}`;
  const durationSeconds = clip ? Math.max(0, finiteOrZero(clip.duration)) : 0;
  const durationWeight = Math.min(durationSeconds / 5, 1);
  const intensity = normalizeFoleyIntensity(
    boundary === 'playhead' ? 0.5 : 0.25 + durationWeight * 0.5,
  );
  return {
    id,
    sourceClipId,
    boundary,
    category: 'unassigned',
    time: normalizeFoleyTime(time),
    offset: 0,
    pan: 0,
    distance: 0.5,
    intensity,
    label: sourceClipId
      ? `Unassigned Foley cue · ${sourceClipId} · ${boundary}`
      : 'Unassigned Foley cue · playhead',
  };
}

/** Derive deduped, neutral scaffolds from the primary visual editorial track. */
export function deriveFoleyCues(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
  playheadTime?: number,
): FoleyCue[] {
  const primary = primaryEditorialTrack(snapshot.tracks);
  const clips = primary
    ? snapshot.clips
      .filter((clip) => isUsableClip(clip, primary.id))
      .slice()
      .sort(clipOrder)
      .slice(0, MAX_FOLEY_CLIPS)
    : [];
  const cues: FoleyCue[] = [];
  const seen = new Set<string>();

  const add = (cue: FoleyCue): void => {
    if (seen.has(cue.id) || cues.length >= MAX_FOLEY_CUES) return;
    seen.add(cue.id);
    cues.push(cue);
  };

  for (const clip of clips) {
    const start = Math.max(0, finiteOrZero(clip.at));
    add(cueForBoundary(clip, 'start', start));
    const duration = Math.max(0, finiteOrZero(clip.duration));
    if (duration > 0) add(cueForBoundary(clip, 'end', start + duration));
  }

  if (cues.length === 0 && Number.isFinite(playheadTime)) {
    add(cueForBoundary(null, 'playhead', playheadTime as number));
  }

  return cues.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/** Rebuild structural scaffolds while preserving edits for surviving IDs. */
export function rebuildFoleyCues(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
  previous: readonly FoleyCue[] = [],
  playheadTime?: number,
): FoleyCue[] {
  const previousById = new Map(previous.map((cue) => [cue.id, cue]));
  return deriveFoleyCues(snapshot, playheadTime).map((cue) => {
    const prior = previousById.get(cue.id);
    const offset = normalizeFoleyOffset(prior?.offset ?? 0);
    return {
      ...cue,
      category: prior?.category ?? cue.category,
      label: prior?.label ?? cue.label,
      pan: normalizeFoleyPan(prior?.pan ?? cue.pan),
      distance: normalizeFoleyDistance(prior?.distance ?? cue.distance),
      intensity: normalizeFoleyIntensity(prior?.intensity ?? cue.intensity),
      offset,
      time: normalizeFoleyTime(cue.time + offset),
    };
  });
}

function normalizeFoleyCue(cue: FoleyCue): FoleyCue {
  return {
    ...cue,
    boundary: cue.boundary ?? (cue.sourceClipId === null ? 'playhead' : 'start'),
    category: cue.category?.trim() || 'unassigned',
    time: normalizeFoleyTime(cue.time),
    offset: normalizeFoleyOffset(cue.offset),
    pan: normalizeFoleyPan(cue.pan),
    distance: normalizeFoleyDistance(cue.distance),
    intensity: normalizeFoleyIntensity(cue.intensity),
  };
}

function isPersistedFoleyCue(value: unknown): value is FoleyCue {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && (candidate.sourceClipId === null || typeof candidate.sourceClipId === 'string')
    && (candidate.boundary === undefined
      || candidate.boundary === 'start' || candidate.boundary === 'end' || candidate.boundary === 'playhead')
    && typeof candidate.category === 'string'
    && typeof candidate.time === 'number'
    && Number.isFinite(candidate.time)
    && typeof candidate.pan === 'number'
    && typeof candidate.distance === 'number'
    && typeof candidate.intensity === 'number'
    && Number.isFinite(candidate.intensity)
    && typeof candidate.label === 'string';
}

function readFoleyEnvelopeValue(value: unknown): FoleyEnvelope | null {
  const candidateEntries = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).entries
    : undefined;
  const rawEntries = Array.isArray(value)
    ? value
    : Array.isArray(candidateEntries)
      ? candidateEntries
      : null;
  if (!rawEntries) return null;
  const generatedFromVersion = !Array.isArray(value)
    && value !== null
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>).generatedFromVersion === 'number'
    && Number.isFinite((value as Record<string, unknown>).generatedFromVersion)
    ? (value as Record<string, number>).generatedFromVersion
    : 0;
  const legacyArray = Array.isArray(value);
  return {
    schemaVersion: !Array.isArray(value)
      && value !== null
      && typeof value === 'object'
      && typeof (value as Record<string, unknown>).schemaVersion === 'number'
      ? (value as Record<string, number>).schemaVersion
      : FOLEY_SCHEMA_VERSION,
    generatedFromVersion,
    entries: rawEntries.filter(isPersistedFoleyCue)
      .map((cue) => normalizeFoleyCue({
        ...cue,
        // Raw-array state predates the neutral scaffold contract. Do not
        // carry forward its ordinal guesses as if they were authored data.
        category: legacyArray ? 'unassigned' : cue.category,
        boundary: cue.boundary ?? (cue.sourceClipId === null ? 'playhead' : 'start'),
        offset: cue.offset ?? 0,
      }))
      .slice(0, MAX_FOLEY_CUES),
  };
}

export function readFoleyEnvelope(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = FOLEY_CONSTELLATION_EXTENSION_ID,
): FoleyEnvelope {
  const app = snapshot.app[extensionId];
  if (app === null || typeof app !== 'object' || Array.isArray(app)) {
    return { schemaVersion: FOLEY_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
  }
  return readFoleyEnvelopeValue((app as Record<string, unknown>)[FOLEY_CUES_DATA_KEY])
    ?? { schemaVersion: FOLEY_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
}

export function readFoleyCues(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = FOLEY_CONSTELLATION_EXTENSION_ID,
): FoleyCue[] {
  return readFoleyEnvelope(snapshot, extensionId).entries
    .slice(0, MAX_FOLEY_CUES)
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function buildFoleyPatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>,
  cues: readonly FoleyCue[],
  options: FoleyPatchOptions = {},
): TimelinePatch {
  const mode = options.mode ?? 'build';
  const generatedFromVersion = options.generatedFromVersion ?? snapshot.baseVersion;
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: mode === 'move' ? 'foley-cue-scaffolder-move' : 'foley-cue-scaffolder-build',
      generatedFromVersion,
      analysis: 'structural-foley-cue-scaffolds-no-audio-synthesis',
    },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: FOLEY_CUES_DATA_KEY,
        value: {
          schemaVersion: FOLEY_SCHEMA_VERSION,
          generatedFromVersion,
          entries: cues.slice(0, MAX_FOLEY_CUES).map(normalizeFoleyCue),
        } satisfies FoleyEnvelope,
        mode: 'replace',
      },
    }],
  };
}

function readPlayheadTime(ctx: ExtensionContext): number | undefined {
  try {
    const time = ctx.creative.timelineView.getSnapshot().playhead.time;
    return Number.isFinite(time) ? time : undefined;
  } catch {
    return undefined;
  }
}

function dropFoleyCues(ctx: ExtensionContext): void {
  const snapshot = ctx.creative.reader.snapshot();
  const cues = rebuildFoleyCues(
    snapshot,
    readFoleyCues(snapshot, ctx.extension.id as string),
    readPlayheadTime(ctx),
  );
  ctx.creative.timeline.apply(buildFoleyPatch(ctx.extension.id as string, snapshot, cues));
  ctx.chrome.toast(`Foley cue scaffolder: ${cues.length} neutral cues.`, 'info');
}

function renderFoleyMarker(marker: { data?: FoleyCue }): unknown {
  const cue = marker.data;
  if (!cue) return null;
  return createElement('span', {
    'data-foley-marker': cue.id,
    'aria-label': `Unassigned Foley cue from ${cue.sourceClipId ?? 'playhead'}, ${cue.boundary}, structural intensity ${cue.intensity.toFixed(2)}, neutral spatial placement`,
    style: {
      display: 'inline-block',
      width: `${4 + cue.intensity * 8}px`,
      height: `${8 + cue.intensity * 12}px`,
      opacity: 0.5 + cue.intensity * 0.5,
      backgroundColor: '#a7a7a7',
      borderRadius: 2,
    },
  });
}

function renderFoleyOverlay(
  ctx: ExtensionContext,
  props: TimelineOverlayRenderProps,
): unknown {
  const snapshot = ctx.creative.reader.snapshot();
  const cues = readFoleyCues(snapshot, ctx.extension.id as string);
  const markers = clusterTimelineMarkers(cues, {
    getId: (cue) => cue.id,
    getTime: (cue) => cue.time,
    getLabel: (cue) => `${cue.boundary} · ${cue.sourceClipId ?? 'playhead'} · unassigned`,
    getColor: () => '#a7a7a7',
  });

  return props.primitives.markerLayer({
    markers,
    placement: 'ruler',
    interactive: true,
    snap: true,
    renderMarker: renderFoleyMarker,
    onChange: (change: TimelineMarkerChange): void => {
      if (change.phase !== 'commit') return;
      const freshSnapshot = ctx.creative.reader.snapshot();
      const freshCues = readFoleyCues(freshSnapshot, ctx.extension.id as string);
      const baseline = new Map(deriveFoleyCues(freshSnapshot).map((cue) => [cue.id, cue]));
      const moved = moveTimelineMarkerCluster(
        freshCues,
        change.id,
        normalizeFoleyTime(change.time),
        {
          getId: (cue) => cue.id,
          getTime: (cue) => cue.time,
          updateTime: (cue, nextTime) => {
            const base = baseline.get(cue.id);
            return {
              ...cue,
              time: nextTime,
              offset: normalizeFoleyOffset(nextTime - (base?.time ?? nextTime)),
            };
          },
        },
      );
      if (moved.moved) {
        const envelope = readFoleyEnvelope(freshSnapshot, ctx.extension.id as string);
        ctx.creative.timeline.apply(buildFoleyPatch(ctx.extension.id as string, freshSnapshot, moved.entries, {
          mode: 'move',
          generatedFromVersion: envelope.generatedFromVersion,
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
        code: 'foley-cue-scaffolder/dispose-failed',
        message: `Foley Cue Scaffolder cleanup failed: ${String(error)}`,
      });
    }
  }
}

export const foleyConstellationExtension: ReighExtension = defineExtension({
  manifest: {
    id: FOLEY_CONSTELLATION_EXTENSION_ID,
    version: '1.0.0',
    label: 'Foley Cue Scaffolder',
    description:
      'Creates neutral, editable Foley cue scaffolds on primary unmuted visual boundaries; it does not identify sounds, infer spatial placement, or synthesize audio.',
    apiVersion: 1,
    contributions: [
      {
        id: 'drop-foley-cues' as ContributionId,
        kind: 'command',
        command: DROP_FOLEY_CUES_COMMAND,
        label: 'Drop Foley Cue Scaffolds',
        category: 'Foley Cue Scaffolder',
        order: 10,
      },
      {
        id: 'foley-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: FOLEY_OVERLAY_RENDER_ID,
        label: 'Foley Cue Scaffolds (timeline ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Foley Cue Scaffolder ready — drop neutral editable cues on primary visual boundaries.',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const commandHandle = ctx.commands.registerCommand(
      DROP_FOLEY_CUES_COMMAND,
      (_run: CommandRunContext): void => { dropFoleyCues(ctx); },
      { label: 'Drop Foley Cue Scaffolds', category: 'Foley Cue Scaffolder' },
    );
    const overlayHandle = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
      FOLEY_OVERLAY_RENDER_ID,
      (props) => renderFoleyOverlay(ctx, props),
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
