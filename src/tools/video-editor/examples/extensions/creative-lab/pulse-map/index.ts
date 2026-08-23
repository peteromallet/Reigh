/**
 * Pulse Map — deterministic VJ-style timeline pulses.
 *
 * V1 intentionally has no audio dependency. It turns the public
 * TimelineSnapshot's clip boundaries and durations into a bounded, repeatable
 * pulse map, stores it in a versioned extension-owned project-data envelope,
 * and exposes the map on the host-owned timeline ruler marker primitive.
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
} from '@reigh/editor-sdk';
import {
  clusterTimelineMarkers,
  moveTimelineMarkerCluster,
  type ClusteredTimelineMarkerData,
} from '../timelineMarkerClusters';

export const PULSE_MAP_EXTENSION_ID = 'com.reigh.creative-lab.pulse-map' as ExtensionId;
export const BUILD_PULSE_MAP_COMMAND = `${PULSE_MAP_EXTENSION_ID}.buildPulseMap`;
export const PULSE_MAP_DATA_KEY = 'pulseMap';
export const PULSE_MAP_OVERLAY_RENDER_ID = 'pulse-map/timeline-overlay';
export const PULSE_MAP_SCHEMA_VERSION = 1;
export const MAX_PULSE_MAP_ENTRIES = 128;

const PULSE_COLORS = ['#ff4d8d', '#52e8ff', '#ffd166', '#b388ff'] as const;

export interface PulseMapEntry {
  id: string;
  sourceClipId: string;
  edge: 'start' | 'end';
  time: number;
  /** Explicit user adjustment from the structural source boundary. */
  offset: number;
  intensity: number;
  color: string;
}

export interface PulseMapEnvelope {
  schemaVersion: number;
  generatedFromVersion: number;
  entries: PulseMapEntry[];
}

export type PulseMapPatchMode = 'build' | 'move';

export interface PulseMapPatchOptions {
  mode?: PulseMapPatchMode;
  generatedFromVersion?: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Round valid times without imposing an arbitrary maximum timeline length. */
export function normalizePulseTime(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.round(time * 1000) / 1000;
}

export function normalizePulseOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.round(offset * 1000) / 1000;
}

function normalizeIntensity(durationSeconds: number): number {
  const duration = Math.max(0, finiteOrZero(durationSeconds));
  return Math.round(Math.min(duration / 5, 1) * 1000) / 1000;
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

function entryForBoundary(
  clip: TimelineClipSummary,
  edge: PulseMapEntry['edge'],
  index: number,
): PulseMapEntry {
  const baseTime = Math.max(0, finiteOrZero(clip.at))
    + (edge === 'end' ? Math.max(0, finiteOrZero(clip.duration)) : 0);
  return {
    // Source-based identity survives insertion and classification changes.
    id: `pulse-${clip.id}-${edge}`,
    sourceClipId: clip.id,
    edge,
    time: normalizePulseTime(baseTime),
    offset: 0,
    intensity: normalizeIntensity(clip.duration),
    color: PULSE_COLORS[index % PULSE_COLORS.length],
  };
}

export function derivePulseMap(
  snapshot: Pick<TimelineSnapshot, 'clips'>,
): PulseMapEntry[] {
  const ordered = snapshot.clips.filter(isUsableClip).slice().sort(clipOrder);
  const entries: PulseMapEntry[] = [];

  for (const [index, clip] of ordered.entries()) {
    if (entries.length >= MAX_PULSE_MAP_ENTRIES) break;
    entries.push(entryForBoundary(clip, 'start', index));
    if (Math.max(0, finiteOrZero(clip.duration)) > 0 && entries.length < MAX_PULSE_MAP_ENTRIES) {
      entries.push(entryForBoundary(clip, 'end', index));
    }
  }

  return entries.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/** Rebuild structural entries while retaining offsets for surviving source IDs. */
export function rebuildPulseMap(
  snapshot: Pick<TimelineSnapshot, 'clips'>,
  previous: readonly PulseMapEntry[] = [],
): PulseMapEntry[] {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  return derivePulseMap(snapshot).map((entry) => {
    const prior = previousById.get(entry.id);
    const offset = normalizePulseOffset(prior?.offset ?? 0);
    return { ...entry, offset, time: normalizePulseTime(entry.time + offset) };
  });
}

function normalizePulseEntry(entry: PulseMapEntry): PulseMapEntry {
  return {
    ...entry,
    time: normalizePulseTime(entry.time),
    offset: normalizePulseOffset(entry.offset),
    intensity: Math.round(Math.min(Math.max(finiteOrZero(entry.intensity), 0), 1) * 1000) / 1000,
  };
}

function isPulseMapEntry(value: unknown): value is PulseMapEntry {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.sourceClipId === 'string'
    && (candidate.edge === 'start' || candidate.edge === 'end')
    && typeof candidate.time === 'number'
    && Number.isFinite(candidate.time)
    && (candidate.offset === undefined || typeof candidate.offset === 'number')
    && typeof candidate.intensity === 'number'
    && Number.isFinite(candidate.intensity)
    && typeof candidate.color === 'string';
}

function readRawEnvelope(value: unknown): PulseMapEnvelope | null {
  if (Array.isArray(value)) {
    return {
      schemaVersion: PULSE_MAP_SCHEMA_VERSION,
      generatedFromVersion: 0,
      entries: value.filter(isPulseMapEntry).map((entry) => normalizePulseEntry({ ...entry, offset: entry.offset ?? 0 })),
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
      .filter(isPulseMapEntry)
      .map((entry) => normalizePulseEntry({ ...entry, offset: entry.offset ?? 0 })),
  };
}

export function readPulseMapEnvelope(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = PULSE_MAP_EXTENSION_ID,
): PulseMapEnvelope {
  const app = snapshot.app[extensionId];
  if (app === null || typeof app !== 'object' || Array.isArray(app)) {
    return { schemaVersion: PULSE_MAP_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
  }
  const envelope = readRawEnvelope((app as Record<string, unknown>)[PULSE_MAP_DATA_KEY]);
  return envelope ?? { schemaVersion: PULSE_MAP_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
}

export function readPulseMap(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = PULSE_MAP_EXTENSION_ID,
): PulseMapEntry[] {
  return readPulseMapEnvelope(snapshot, extensionId).entries
    .slice(0, MAX_PULSE_MAP_ENTRIES)
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function buildPulseMapPatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>,
  pulseMap: readonly PulseMapEntry[],
  options: PulseMapPatchOptions = {},
): TimelinePatch {
  const mode = options.mode ?? 'build';
  const generatedFromVersion = options.generatedFromVersion ?? snapshot.baseVersion;
  const entries = pulseMap.slice(0, MAX_PULSE_MAP_ENTRIES).map(normalizePulseEntry);
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: { kind: mode === 'move' ? 'pulse-map-move' : 'pulse-map-build', generatedFromVersion },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: PULSE_MAP_DATA_KEY,
        value: {
          schemaVersion: PULSE_MAP_SCHEMA_VERSION,
          generatedFromVersion,
          entries,
        } satisfies PulseMapEnvelope,
        mode: 'replace',
      },
    }],
  };
}

function buildPulseMap(ctx: ExtensionContext): PulseMapEntry[] {
  const snapshot = ctx.creative.reader.snapshot();
  const pulseMap = rebuildPulseMap(snapshot, readPulseMap(snapshot, ctx.extension.id as string));
  ctx.creative.timeline.apply(buildPulseMapPatch(ctx.extension.id as string, snapshot, pulseMap));
  ctx.chrome.toast(`Pulse Map built: ${pulseMap.length} deterministic pulses.`, 'info');
  return pulseMap;
}

function renderPulseMarker(
  marker: TimelinePointMarker<ClusteredTimelineMarkerData<PulseMapEntry>>,
): unknown {
  const pulse = marker.data;
  if (!pulse) return null;
  const summary = pulse.cluster
    ? pulse.cluster.entries
      .map((entry) => `${entry.sourceClipId} ${entry.edge}`)
      .join(' · ')
    : `${pulse.sourceClipId} ${pulse.edge}`;
  return createElement('span', {
    'data-pulse-marker': pulse.id,
    'aria-label': `Pulse${pulse.cluster ? ' cluster' : ''}: ${summary}, intensity ${pulse.intensity.toFixed(2)}`,
    style: {
      display: 'inline-block',
      width: `${4 + pulse.intensity * 8}px`,
      height: `${8 + pulse.intensity * 12}px`,
      opacity: 0.45 + pulse.intensity * 0.55,
      backgroundColor: pulse.color,
      borderRadius: 2,
    },
  });
}

function renderPulseMapOverlay(ctx: ExtensionContext, props: TimelineOverlayRenderProps): unknown {
  const snapshot = ctx.creative.reader.snapshot();
  const pulseMap = readPulseMap(snapshot, ctx.extension.id as string);
  const markers = clusterTimelineMarkers(pulseMap, {
    getId: (pulse) => pulse.id,
    getTime: (pulse) => pulse.time,
    getLabel: (pulse) => `${pulse.edge} · ${pulse.sourceClipId}`,
    getColor: (pulse) => pulse.color,
  });

  return props.primitives.markerLayer({
    markers,
    placement: 'ruler',
    interactive: true,
    snap: true,
    renderMarker: renderPulseMarker,
    onChange: (change: TimelineMarkerChange): void => {
      if (change.phase !== 'commit') return;
      const freshSnapshot = ctx.creative.reader.snapshot();
      const freshEntries = readPulseMap(freshSnapshot, ctx.extension.id as string);
      const baseline = new Map(derivePulseMap(freshSnapshot).map((entry) => [entry.id, entry]));
      const moved = moveTimelineMarkerCluster(
        freshEntries,
        change.id,
        normalizePulseTime(change.time),
        {
          getId: (pulse) => pulse.id,
          getTime: (pulse) => pulse.time,
          updateTime: (pulse, nextTime) => {
            const base = baseline.get(pulse.id);
            return {
              ...pulse,
              time: nextTime,
              offset: normalizePulseOffset(nextTime - (base?.time ?? nextTime)),
            };
          },
        },
      );
      const nextMap = moved.entries;
      if (moved.moved) {
        const envelope = readPulseMapEnvelope(freshSnapshot, ctx.extension.id as string);
        ctx.creative.timeline.apply(buildPulseMapPatch(ctx.extension.id as string, freshSnapshot, nextMap, {
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
        code: 'pulse-map/dispose-failed',
        message: `Pulse Map cleanup failed: ${String(error)}`,
      });
    }
  }
}

export const pulseMapExtension: ReighExtension = defineExtension({
  manifest: {
    id: PULSE_MAP_EXTENSION_ID,
    version: '1.0.0',
    label: 'Beat-Synesthesia Pulse Map',
    description:
      'Builds a deterministic VJ-style pulse map from clip boundaries and durations, then renders it on the timeline ruler.',
    apiVersion: 1,
    contributions: [
      {
        id: 'build-pulse-map' as ContributionId,
        kind: 'command',
        command: BUILD_PULSE_MAP_COMMAND,
        label: 'Build Pulse Map',
        category: 'Pulse Map',
        order: 10,
      },
      {
        id: 'pulse-map-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: PULSE_MAP_OVERLAY_RENDER_ID,
        label: 'Pulse Map (timeline ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Pulse Map ready — build a deterministic map from the current clips.',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const commandHandle = ctx.commands.registerCommand(
      BUILD_PULSE_MAP_COMMAND,
      (_run: CommandRunContext): void => { buildPulseMap(ctx); },
      { label: 'Build Pulse Map', category: 'Pulse Map' },
    );
    const overlayHandle = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
      PULSE_MAP_OVERLAY_RENDER_ID,
      (props) => renderPulseMapOverlay(ctx, props),
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
