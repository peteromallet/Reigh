/**
 * Structural Pacing Palette — timing-based color suggestions.
 *
 * V1 reads no pixels, audio, or GPU state. It classifies pacing on the first
 * unmuted visual track, preserves that track's real label/order, and presents
 * the result as read-only suggestions rather than emotional or media analysis.
 */

import { createElement } from 'react';
import { combineDisposeHandles, defineExtension } from '@reigh/editor-sdk';
import type {
  CommandRunContext,
  ContributionId,
  ExtensionContext,
  ExtensionId,
  ReighExtension,
  TimelineClipSummary,
  TimelineOverlayRenderProps,
  TimelinePatch,
  TimelineSnapshot,
  TimelineTrackSummary,
} from '@reigh/editor-sdk';
import { clusterTimelineMarkers } from '../timelineMarkerClusters';

export const CHROMATIC_CONSTELLATION_EXTENSION_ID =
  'com.reigh.creative-lab.chromatic-constellation' as ExtensionId;
export const BUILD_CHROMATIC_CONSTELLATION_COMMAND =
  `${CHROMATIC_CONSTELLATION_EXTENSION_ID}.buildConstellation`;
export const CHROMATIC_CONSTELLATION_DATA_KEY = 'constellation';
export const CHROMATIC_CONSTELLATION_OVERLAY_RENDER_ID =
  'chromatic-constellation/timeline-overlay';
export const CHROMATIC_CONSTELLATION_SCHEMA_VERSION = 1;
export const MAX_CHROMATIC_CONSTELLATION_MARKERS = 128;

const PALETTE_COLORS = {
  compact: '#ff5c8a',
  sustained: '#ffc857',
  steady: '#52e8d4',
  open: '#8f7cff',
} as const;

export type PacingClass = keyof typeof PALETTE_COLORS;

export interface ChromaticConstellationMarker {
  id: string;
  sourceClipId: string;
  trackId: string;
  trackLabel: string;
  trackOrder: number;
  pacingClass: PacingClass;
  time: number;
  duration: number;
  intensity: number;
  color: string;
  label: string;
}

export interface ChromaticCoverageSummary {
  totalCandidates: number;
  persistedCount: number;
  displayLimit: number;
  displayedCount: number;
  omittedCount: number;
  sourceTrackId: string | null;
  sourceTrackLabel: string | null;
  status: 'complete' | 'truncated';
}

export interface ChromaticConstellationEnvelope {
  schemaVersion: number;
  generatedFromVersion: number;
  coverage: ChromaticCoverageSummary;
  entries: ChromaticConstellationMarker[];
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeConstellationTime(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.round(time * 1000) / 1000;
}

function normalizeIntensity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(Math.max(value, 0), 1) * 1000) / 1000;
}

function clipOrder(a: TimelineClipSummary, b: TimelineClipSummary): number {
  const atDelta = finiteOrZero(a.at) - finiteOrZero(b.at);
  return atDelta !== 0 ? atDelta : a.id.localeCompare(b.id);
}

function primaryEditorialTrack(
  tracks: readonly TimelineTrackSummary[],
): { track: TimelineTrackSummary; order: number } | undefined {
  const order = tracks.findIndex((track) => track.kind === 'visual' && track.muted === false);
  const track = order >= 0 ? tracks[order] : undefined;
  return track ? { track, order } : undefined;
}

function isValidPrimaryClip(clip: TimelineClipSummary, trackId: string): boolean {
  return clip.track === trackId
    && typeof clip.id === 'string'
    && clip.id.length > 0
    && Number.isFinite(clip.at)
    && Number.isFinite(clip.duration)
    && clip.at >= 0
    && clip.duration >= 0;
}

function classifyPacing(durationSeconds: number, gapSeconds: number): PacingClass {
  if (gapSeconds >= 2) return 'open';
  if (durationSeconds >= 4) return 'sustained';
  if (durationSeconds <= 0.75) return 'compact';
  return 'steady';
}

function methodLabel(pacingClass: PacingClass): string {
  switch (pacingClass) {
    case 'compact': return 'compact pacing (duration ≤ 0.75s)';
    case 'sustained': return 'sustained pacing (duration ≥ 4s)';
    case 'open': return 'open pacing (gap ≥ 2s)';
    default: return 'steady pacing (structural fallback)';
  }
}

/** Derive the complete scoped stream; the ruler bounds display separately. */
export function deriveChromaticConstellation(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
): ChromaticConstellationMarker[] {
  const primary = primaryEditorialTrack(snapshot.tracks);
  if (!primary) return [];
  const ordered = snapshot.clips
    .filter((clip) => isValidPrimaryClip(clip, primary.track.id))
    .slice()
    .sort(clipOrder);
  const markers: ChromaticConstellationMarker[] = [];
  let previousEndSeconds = 0;

  for (const clip of ordered) {
    const startSeconds = Math.max(0, finiteOrZero(clip.at));
    const durationSeconds = Math.max(0, finiteOrZero(clip.duration));
    const gapSeconds = Math.max(0, startSeconds - previousEndSeconds);
    const pacingClass = classifyPacing(durationSeconds, gapSeconds);
    const intensity = normalizeIntensity(
      pacingClass === 'open'
        ? 0.35 + Math.min(gapSeconds / 6, 0.65)
        : pacingClass === 'sustained'
          ? 0.35 + Math.min(durationSeconds / 12, 0.65)
          : pacingClass === 'compact'
            ? 0.35 + Math.min(1 / Math.max(durationSeconds, 0.25), 0.65)
            : 0.5,
    );
    markers.push({
      id: `constellation-${clip.id}`,
      sourceClipId: clip.id,
      trackId: primary.track.id,
      trackLabel: primary.track.label,
      trackOrder: primary.order,
      pacingClass,
      time: normalizeConstellationTime(startSeconds),
      duration: normalizeConstellationTime(durationSeconds),
      intensity,
      color: PALETTE_COLORS[pacingClass],
      label: `Pacing ${pacingClass} · ${primary.track.label} · ${methodLabel(pacingClass)}`,
    });
    previousEndSeconds = Math.max(previousEndSeconds, startSeconds + durationSeconds);
  }

  return markers.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

function legacyPacingClass(value: unknown): PacingClass | null {
  if (value === 'electric') return 'compact';
  if (value === 'luminous') return 'sustained';
  if (value === 'balanced') return 'steady';
  if (value === 'hushed') return 'open';
  return value === 'compact' || value === 'sustained' || value === 'steady' || value === 'open'
    ? value
    : null;
}

function isChromaticConstellationMarker(value: unknown): value is ChromaticConstellationMarker {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const pacingClass = legacyPacingClass(candidate.pacingClass ?? candidate.mood);
  return typeof candidate.id === 'string'
    && typeof candidate.sourceClipId === 'string'
    && typeof candidate.trackId === 'string'
    && pacingClass !== null
    && typeof candidate.time === 'number'
    && Number.isFinite(candidate.time)
    && typeof candidate.duration === 'number'
    && Number.isFinite(candidate.duration)
    && typeof candidate.intensity === 'number'
    && Number.isFinite(candidate.intensity)
    && typeof candidate.label === 'string';
}

function normalizeMarker(value: ChromaticConstellationMarker): ChromaticConstellationMarker {
  const candidate = value as ChromaticConstellationMarker & { mood?: string };
  const pacingClass = legacyPacingClass(candidate.pacingClass ?? candidate.mood) ?? 'steady';
  return {
    ...candidate,
    trackLabel: candidate.trackLabel || candidate.trackId,
    trackOrder: Number.isFinite(candidate.trackOrder) ? candidate.trackOrder : 0,
    pacingClass,
    time: normalizeConstellationTime(candidate.time),
    duration: normalizeConstellationTime(candidate.duration),
    intensity: normalizeIntensity(candidate.intensity),
    color: PALETTE_COLORS[pacingClass],
    label: candidate.label || `Pacing ${pacingClass} · ${candidate.trackLabel || candidate.trackId}`,
  };
}

function emptyCoverage(): ChromaticCoverageSummary {
  return {
    totalCandidates: 0,
    persistedCount: 0,
    displayLimit: MAX_CHROMATIC_CONSTELLATION_MARKERS,
    displayedCount: 0,
    omittedCount: 0,
    sourceTrackId: null,
    sourceTrackLabel: null,
    status: 'complete',
  };
}

function coverageFor(entries: readonly ChromaticConstellationMarker[]): ChromaticCoverageSummary {
  const source = entries[0];
  const displayedCount = Math.min(entries.length, MAX_CHROMATIC_CONSTELLATION_MARKERS);
  return {
    totalCandidates: entries.length,
    persistedCount: entries.length,
    displayLimit: MAX_CHROMATIC_CONSTELLATION_MARKERS,
    displayedCount,
    omittedCount: Math.max(0, entries.length - displayedCount),
    sourceTrackId: source?.trackId ?? null,
    sourceTrackLabel: source?.trackLabel ?? null,
    status: entries.length > MAX_CHROMATIC_CONSTELLATION_MARKERS ? 'truncated' : 'complete',
  };
}

function readEnvelopeValue(value: unknown): ChromaticConstellationEnvelope | null {
  const legacyArray = Array.isArray(value);
  const candidateEntries = value !== null && typeof value === 'object' && !legacyArray
    ? (value as Record<string, unknown>).entries
    : undefined;
  const rawEntries = Array.isArray(value)
    ? value
    : Array.isArray(candidateEntries)
      ? candidateEntries
      : null;
  if (!rawEntries) return null;
  const entries = rawEntries.filter(isChromaticConstellationMarker).map(normalizeMarker);
  const objectValue = !legacyArray && value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
  const rawCoverage = objectValue?.coverage;
  const coverage = rawCoverage !== null && typeof rawCoverage === 'object'
    ? { ...emptyCoverage(), ...(rawCoverage as Partial<ChromaticCoverageSummary>) }
    : coverageFor(entries);
  return {
    schemaVersion: typeof objectValue?.schemaVersion === 'number'
      ? objectValue.schemaVersion
      : CHROMATIC_CONSTELLATION_SCHEMA_VERSION,
    generatedFromVersion: typeof objectValue?.generatedFromVersion === 'number'
      && Number.isFinite(objectValue.generatedFromVersion)
      ? objectValue.generatedFromVersion
      : 0,
    coverage: {
      ...coverage,
      totalCandidates: Math.max(coverage.totalCandidates, entries.length),
      persistedCount: entries.length,
      displayedCount: Math.min(entries.length, MAX_CHROMATIC_CONSTELLATION_MARKERS),
      omittedCount: Math.max(0, entries.length - MAX_CHROMATIC_CONSTELLATION_MARKERS),
      status: entries.length > MAX_CHROMATIC_CONSTELLATION_MARKERS ? 'truncated' : 'complete',
    },
    entries,
  };
}

export function readChromaticConstellationEnvelope(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = CHROMATIC_CONSTELLATION_EXTENSION_ID,
): ChromaticConstellationEnvelope {
  const app = snapshot.app[extensionId];
  if (app === null || typeof app !== 'object' || Array.isArray(app)) {
    return { schemaVersion: CHROMATIC_CONSTELLATION_SCHEMA_VERSION, generatedFromVersion: 0, coverage: emptyCoverage(), entries: [] };
  }
  return readEnvelopeValue((app as Record<string, unknown>)[CHROMATIC_CONSTELLATION_DATA_KEY])
    ?? { schemaVersion: CHROMATIC_CONSTELLATION_SCHEMA_VERSION, generatedFromVersion: 0, coverage: emptyCoverage(), entries: [] };
}

export function readChromaticConstellation(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = CHROMATIC_CONSTELLATION_EXTENSION_ID,
): ChromaticConstellationMarker[] {
  return readChromaticConstellationEnvelope(snapshot, extensionId).entries
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function buildChromaticConstellationPatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>,
  markers: readonly ChromaticConstellationMarker[],
): TimelinePatch {
  const generatedFromVersion = snapshot.baseVersion;
  const entries = markers.map(normalizeMarker);
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: 'structural-pacing-palette-build',
      generatedFromVersion,
      analysis: 'timing-based-color-suggestions-primary-visual-only',
      readOnlyDerivedSuggestions: true,
    },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: CHROMATIC_CONSTELLATION_DATA_KEY,
        value: {
          schemaVersion: CHROMATIC_CONSTELLATION_SCHEMA_VERSION,
          generatedFromVersion,
          coverage: coverageFor(entries),
          entries,
        } satisfies ChromaticConstellationEnvelope,
        mode: 'replace',
      },
    }],
  };
}

function buildConstellation(ctx: ExtensionContext): void {
  const snapshot = ctx.creative.reader.snapshot();
  const markers = deriveChromaticConstellation(snapshot);
  ctx.creative.timeline.apply(buildChromaticConstellationPatch(ctx.extension.id as string, snapshot, markers));
  const displayed = Math.min(markers.length, MAX_CHROMATIC_CONSTELLATION_MARKERS);
  ctx.chrome.toast(`Structural Pacing Palette built: ${displayed}/${markers.length} timing suggestions shown.`, 'info');
}

function renderPacingMarker(marker: { data?: ChromaticConstellationMarker }): unknown {
  const item = marker.data;
  if (!item) return null;
  return createElement('span', {
    'data-pacing-marker': item.id,
    'aria-label': `${item.label}; source ${item.sourceClipId}; intensity ${item.intensity.toFixed(2)}; read-only suggestion`,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      color: item.color,
      fontSize: 10,
      fontWeight: 600,
    },
  }, `● ${item.pacingClass}`);
}

function renderChromaticConstellation(
  ctx: ExtensionContext,
  props: TimelineOverlayRenderProps,
): unknown {
  const envelope = readChromaticConstellationEnvelope(ctx.creative.reader.snapshot(), ctx.extension.id as string);
  const visible = envelope.entries.slice(0, MAX_CHROMATIC_CONSTELLATION_MARKERS);
  const pointMarkers = clusterTimelineMarkers(visible, {
    getId: (marker) => marker.id,
    getTime: (marker) => marker.time,
    getLabel: (marker) => marker.label,
    getColor: (marker) => marker.color,
  });
  return props.primitives.markerLayer({
    markers: pointMarkers,
    placement: 'ruler',
    interactive: false,
    snap: false,
    renderMarker: renderPacingMarker,
  });
}

export const chromaticConstellationExtension: ReighExtension = defineExtension({
  manifest: {
    id: CHROMATIC_CONSTELLATION_EXTENSION_ID,
    version: '1.0.0',
    label: 'Structural Pacing Palette',
    description:
      'Provides read-only timing-based color suggestions from the primary unmuted visual track; no emotional, pixel, audio, or GPU analysis is claimed.',
    apiVersion: 1,
    contributions: [
      {
        id: 'build-chromatic-constellation' as ContributionId,
        kind: 'command',
        command: BUILD_CHROMATIC_CONSTELLATION_COMMAND,
        label: 'Build Timing-Based Color Suggestions',
        category: 'Structural Pacing Palette',
        order: 10,
      },
      {
        id: 'chromatic-constellation-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: CHROMATIC_CONSTELLATION_OVERLAY_RENDER_ID,
        label: 'Timing-Based Color Suggestions (read-only ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Structural Pacing Palette ready — inspect read-only timing-based color suggestions.',
    },
  },

  activate(ctx: ExtensionContext) {
    const commandHandle = ctx.commands.registerCommand(
      BUILD_CHROMATIC_CONSTELLATION_COMMAND,
      (_run: CommandRunContext): void => buildConstellation(ctx),
      { label: 'Build Timing-Based Color Suggestions', category: 'Structural Pacing Palette' },
    );
    const overlayHandle = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
      CHROMATIC_CONSTELLATION_OVERLAY_RENDER_ID,
      (props) => renderChromaticConstellation(ctx, props),
    );
    ctx.chrome.toast(ctx.services.i18n.t('ready'), 'info');
    return combineDisposeHandles(commandHandle, overlayHandle);
  },
});
