/**
 * Emotional Weather Map — a deterministic pacing forecast for the timeline.
 *
 * The V1 analysis deliberately uses only public timeline structure: clip
 * starts, durations, and the gaps between clips. It never inspects media,
 * captions, audio, or semantic/AI signals. Results live in this extension's
 * project-data namespace and are rendered as host-owned ruler markers.
 */

import { combineDisposeHandles, defineExtension } from '@reigh/editor-sdk';
import type {
  CommandRunContext,
  ContributionId,
  DisposeHandle,
  ExtensionContext,
  ExtensionId,
  ReighExtension,
  TimelineClipSummary,
  TimelineOverlayRenderProps,
  TimelinePatch,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import { clusterTimelineMarkers } from '../timelineMarkerClusters';

export const EMOTIONAL_WEATHER_MAP_EXTENSION_ID =
  'com.reigh.creative-lab.emotional-weather-map' as ExtensionId;
export const BUILD_EMOTIONAL_WEATHER_MAP_COMMAND =
  `${EMOTIONAL_WEATHER_MAP_EXTENSION_ID}.buildWeatherMap`;
export const EMOTIONAL_WEATHER_MAP_DATA_KEY = 'weatherMap';
export const EMOTIONAL_WEATHER_MAP_OVERLAY_RENDER_ID =
  'emotional-weather-map/timeline-overlay';

export const MAX_WEATHER_MAP_MARKERS = 128;
export const MAX_WEATHER_MAP_CLIPS = 512;

const WEATHER_COLORS = {
  breeze: '#52e8ff',
  fog: '#b8a9c9',
  lightning: '#ffd166',
  sunshine: '#ff9f43',
} as const;

export type WeatherKind = keyof typeof WEATHER_COLORS;

export interface WeatherMapMarker {
  id: string;
  sourceClipId: string;
  kind: WeatherKind;
  time: number;
  intensity: number;
  color: string;
  label: string;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Normalize persisted times without collapsing legitimate long timelines. */
export function normalizeWeatherTime(time: number): number {
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

function classifyWeather(durationSeconds: number, gapSeconds: number): WeatherKind {
  if (gapSeconds >= 2) return 'fog';
  if (durationSeconds >= 4) return 'sunshine';
  if (durationSeconds <= 0.75 || gapSeconds <= 0.15) return 'lightning';
  return 'breeze';
}

/**
 * Derive a bounded, deterministic weather forecast from clip pacing.
 *
 * Sorting first makes output independent of provider array order. The single
 * pass over at most MAX_WEATHER_MAP_CLIPS clips keeps analysis linear and
 * predictable even when a malformed/huge timeline is supplied.
 */
export function deriveWeatherMap(
  snapshot: Pick<TimelineSnapshot, 'clips'> & Partial<Pick<TimelineSnapshot, 'tracks'>>,
): WeatherMapMarker[] {
  const trackById = new Map(snapshot.tracks?.map((track) => [track.id, track]));
  const primaryVisualTrackId = snapshot.tracks?.find((track) => (
    track.kind === 'visual'
    && !track.muted
    && snapshot.clips.some((clip) => clip.track === track.id)
  ))?.id;
  const ordered = [...snapshot.clips]
    .filter((clip) => {
      if (!Number.isFinite(clip.at) || !Number.isFinite(clip.duration)) return false;
      if (primaryVisualTrackId) return clip.track === primaryVisualTrackId;
      const track = trackById.get(clip.track);
      return !track || (track.kind === 'visual' && !track.muted);
    })
    .filter((clip) => !['text', 'automation', 'effect', 'transition'].includes(
      clip.clipType?.trim().toLowerCase() ?? '',
    ))
    .sort(clipOrder);
  const markers: WeatherMapMarker[] = [];
  let previousEndSeconds = 0;

  for (const clip of ordered) {
    const startSeconds = Math.max(0, clip.at);
    const durationSeconds = Math.max(0, clip.duration);
    const gapSeconds = Math.max(0, startSeconds - previousEndSeconds);
    const kind = classifyWeather(durationSeconds, gapSeconds);
    const cutPressure = Math.min(1, 1 / Math.max(durationSeconds, 0.25));
    const gapPressure = Math.min(1, gapSeconds / 4);
    const intensity = normalizeIntensity(
      kind === 'fog'
        ? 0.35 + gapPressure * 0.65
        : kind === 'sunshine'
          ? 0.35 + Math.min(durationSeconds / 12, 0.65)
          : 0.35 + cutPressure * 0.65,
    );

    markers.push({
      id: `weather-${clip.id}`,
      sourceClipId: clip.id,
      kind,
      time: normalizeWeatherTime(startSeconds),
      intensity,
      color: WEATHER_COLORS[kind],
      label: kind,
    });

    previousEndSeconds = Math.max(previousEndSeconds, startSeconds + durationSeconds);
  }

  const sorted = markers.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  if (sorted.length <= MAX_WEATHER_MAP_MARKERS) return sorted;
  // Preserve coverage across the whole project instead of silently keeping
  // only the earliest markers.
  return Array.from({ length: MAX_WEATHER_MAP_MARKERS }, (_, index) => (
    sorted[Math.round(index * (sorted.length - 1) / (MAX_WEATHER_MAP_MARKERS - 1))]
  ));
}

function isWeatherMapMarker(value: unknown): value is WeatherMapMarker {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.sourceClipId === 'string'
    && (candidate.kind === 'breeze'
      || candidate.kind === 'fog'
      || candidate.kind === 'lightning'
      || candidate.kind === 'sunshine')
    && typeof candidate.time === 'number'
    && Number.isFinite(candidate.time)
    && typeof candidate.intensity === 'number'
    && Number.isFinite(candidate.intensity)
    && typeof candidate.color === 'string'
    && typeof candidate.label === 'string';
}

/** Read only well-formed values from this extension's project-data namespace. */
export function readWeatherMap(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = EMOTIONAL_WEATHER_MAP_EXTENSION_ID,
): WeatherMapMarker[] {
  const app = snapshot.app[extensionId];
  if (app === null || typeof app !== 'object' || Array.isArray(app)) return [];
  const raw = (app as Record<string, unknown>)[EMOTIONAL_WEATHER_MAP_DATA_KEY];
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(isWeatherMapMarker)
    .slice(0, MAX_WEATHER_MAP_MARKERS)
    .map((marker) => ({
      ...marker,
      time: normalizeWeatherTime(marker.time),
      intensity: normalizeIntensity(marker.intensity),
    }))
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/** Build the extension-owned project-data write used by commands and drags. */
export function buildWeatherMapPatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>,
  markers: readonly WeatherMapMarker[],
): TimelinePatch {
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: { kind: 'emotional-weather-map-build', analysis: 'structural-pacing-only' },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: EMOTIONAL_WEATHER_MAP_DATA_KEY,
        value: markers.slice(0, MAX_WEATHER_MAP_MARKERS),
        mode: 'replace',
      },
    }],
  };
}

function buildWeatherMap(ctx: ExtensionContext): WeatherMapMarker[] {
  const snapshot = ctx.creative.reader.snapshot();
  const markers = deriveWeatherMap(snapshot);
  ctx.creative.timeline.apply(
    buildWeatherMapPatch(ctx.extension.id as string, snapshot, markers),
  );
  ctx.chrome.toast(`Weather map built: ${markers.length} pacing markers.`, 'info');
  return markers;
}

function renderWeatherMapOverlay(
  ctx: ExtensionContext,
  props: TimelineOverlayRenderProps,
): unknown {
  const markers = readWeatherMap(
    ctx.creative.reader.snapshot(),
    ctx.extension.id as string,
  );
  const pointMarkers = clusterTimelineMarkers(markers, {
    getId: (marker) => marker.id,
    getTime: (marker) => marker.time,
    getLabel: (marker) => `timing proxy: ${marker.label} · ${marker.sourceClipId} · ${Math.round(marker.intensity * 100)}%`,
    getColor: (marker) => marker.color,
  });

  return props.primitives.markerLayer({
    markers: pointMarkers,
    placement: 'ruler',
    // The marker is derived from source clip pacing. Repositioning it alone
    // would detach the displayed fact from the underlying edit.
    interactive: false,
    snap: false,
  });
}

export const emotionalWeatherMapExtension: ReighExtension = defineExtension({
  manifest: {
    id: EMOTIONAL_WEATHER_MAP_EXTENSION_ID,
    version: '1.0.0',
    label: 'Structural Pacing Weather Map',
    description:
      'Maps a bounded timing metaphor from the primary unmuted visual track; no emotion, semantic, audio, or pixel analysis is used.',
    apiVersion: 1,
    contributions: [
      {
        id: 'build-emotional-weather-map' as ContributionId,
        kind: 'command',
        command: BUILD_EMOTIONAL_WEATHER_MAP_COMMAND,
        label: 'Build Structural Pacing Weather Map',
        category: 'Structural Pacing',
        order: 10,
      },
      {
        id: 'emotional-weather-map-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: EMOTIONAL_WEATHER_MAP_OVERLAY_RENDER_ID,
        label: 'Structural Pacing Weather (timeline ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Structural Pacing Weather ready — a timing metaphor, not emotion analysis.',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const commandHandle = ctx.commands.registerCommand(
      BUILD_EMOTIONAL_WEATHER_MAP_COMMAND,
      (_run: CommandRunContext): void => {
        buildWeatherMap(ctx);
      },
      { label: 'Build Structural Pacing Weather Map', category: 'Structural Pacing' },
    );
    let overlayHandle: DisposeHandle;
    try {
      overlayHandle = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
        EMOTIONAL_WEATHER_MAP_OVERLAY_RENDER_ID,
        (props) => renderWeatherMapOverlay(ctx, props),
      );
    } catch (error) {
      commandHandle.dispose();
      throw error;
    }
    ctx.chrome.toast(ctx.services.i18n.t('ready'), 'info');
    return combineDisposeHandles(commandHandle, overlayHandle);
  },
});
