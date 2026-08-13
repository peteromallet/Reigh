/**
 * scene-phase-markers — dev-local extension for marking scene phases while
 * listening to audio, then converting those markers into shot positions.
 *
 * Workflow
 * --------
 * Phase 1 — Mark:
 *   Play the audio in the editor preview and press `B` at every phase/beat
 *   boundary. The current playhead time is appended to the extension's
 *   `sceneMarkers` project-data entry (sorted by time). Markers render ON the
 *   timeline ruler through the host-owned `markerLayer` primitive
 *   (draggable), and a status-bar panel exposes a "Mark (B)" button plus a
 *   marker-count/playhead summary.
 *
 * Phase 2 — Convert + align:
 *   The status-bar panel ("Scene Phase Markers") offers "Create shots from
 *   markers" (press B while playing to drop a transition marker on the ruler,
 *   draggable) and "Align shots to transitions" (create one shot between each
 *   pair of markers — each shot lasts until the next marker — or move
 *   existing shots onto the transition times and resize them to span
 *   marker-to-marker via `clip.move` + `clip.update`). "Clear/Delete Data"
 *   is the explicit, user-triggered project-data clear; generic disposal
 *   (disable, HMR, unmount) NEVER touches project data.
 *
 * All timeline mutations go through `ctx.creative.timeline.apply()` with the
 * public TimelinePatch vocabulary (project-data.write / clip.add /
 * clip.update / clip.move) — no host internals are touched.
 *
 * This file lives under src/tools/video-editor/dev/ (the author scratchpad
 * wired into VideoEditorPage via devLocalExtensions) and is excluded from the
 * video-editor-sdk-import governance check, but it still imports only the
 * public SDK plus the overlay render props, and registers both renderers
 * (footer slot + timeline overlay) through the public `ctx.ui` service.
 */

import { defineExtension } from '@reigh/editor-sdk';
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
  TimelineReader,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import type { TimelinePatchOperation } from '@/sdk/video/timeline/patch';
import { createElement } from 'react';
import { ScenePhaseMarkersOverlay } from './ScenePhaseMarkersOverlay';
import { ScenePhaseMarkersPanel } from './ScenePhaseMarkersPanel';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const SCENE_PHASE_EXTENSION_ID = 'com.reigh.scene-phase-markers' as ExtensionId;
export const MARK_PHASE_COMMAND = `${SCENE_PHASE_EXTENSION_ID}.markPhase`;
export const MARKERS_DATA_KEY = 'sceneMarkers';
export const FOOTER_RENDER_ID = 'scene-phase-markers/footer';
export const OVERLAY_RENDER_ID = 'scene-phase-markers/overlay';

// ---------------------------------------------------------------------------
// Marker count ceiling (measured, pinned below the 64 KB hard entry limit)
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on the number of persisted scene markers.
 *
 * Measured 2026-08-11 with the extension's real persisted shape — 36-char
 * crypto.randomUUID ids plus times clamped to
 * `[0, MAX_SCENE_MARKER_SECONDS]` and rounded to 3 decimals (1 ms) via
 * `normalizeMarkerTime()` — the worst-case serialized payload at this
 * ceiling is:
 *
 *   - 800 markers at the clamped maximum (the longest serialized form in
 *     the bounded domain, "9999.999"): 49,601 bytes — 75.7% of the 64 KiB
 *     (65,536 byte) hard entry limit for project-data values, i.e.
 *     ≥ 20% headroom. The total clamp guarantees no accepted input can
 *     serialize longer than that representation, so this is the true
 *     worst case by construction.
 *   - The old 1000-marker pin with realistic unrounded 24fps-snapped float
 *     times measured 67,487 bytes and overflows the limit; the quota test
 *     at the time only exercised rounded values and missed it. The ceiling
 *     therefore lives at 800, where normalization + the count gate keep the
 *     worst case bounded by construction.
 *
 * `markPhaseAtPlayhead` refuses to add markers beyond the ceiling (count
 * gate) and `buildMarkersPatch` normalizes every persisted time (single
 * persist seam), so no path can write raw floats; the host's
 * `validateTimelinePatch` (project-data.write entry-size check) rejects any
 * payload that would still exceed the hard limit.
 */
export const MAX_SCENE_MARKERS = 800;

/** The hard entry limit for a single project-data value (64 KiB). */
export const SCENE_MARKERS_64KB_LIMIT_BYTES = 65536;

/**
 * The bounded domain for persisted marker times, in seconds: every marker
 * time is clamped to `[0, MAX_SCENE_MARKER_SECONDS]` before rounding.
 *
 * 9999.999 s ≈ 2.78 h of audio — far beyond any phase-marking session —
 * and its serialized form ("9999.999", 8 characters) is the longest
 * representation reachable inside the domain (at most 4 integer digits + 3
 * decimals), pinning the 800-marker payload at 49,601 bytes (75.7% of the
 * 64 KiB hard entry limit, ≥ 20% headroom). A larger bound would admit
 * longer serialized forms (e.g. "12345.678") and grow the worst case.
 */
export const MAX_SCENE_MARKER_SECONDS = 9999.999;

/** Measure a marker list's JSON payload size in UTF-8 bytes. */
export function measureMarkersPayloadBytes(markers: readonly ScenePhaseMarker[]): number {
  return new TextEncoder().encode(JSON.stringify(markers)).length;
}

/** A single phase marker: an absolute playhead time in seconds. */
export interface ScenePhaseMarker {
  id: string;
  time: number;
}

/** Fixed decimal precision for persisted marker times (3 decimals = 1 ms). */
export const MARKER_TIME_PRECISION_DECIMALS = 3;

/**
 * Normalize a marker time to the BOUNDED persisted representation: clamp to
 * `[0, MAX_SCENE_MARKER_SECONDS]`, then round to
 * `MARKER_TIME_PRECISION_DECIMALS` decimals. TOTAL and IDEMPOTENT over
 * every number input:
 *
 *   - NaN → 0
 *   - -Infinity / negatives / -0 / 0 → 0
 *   - +Infinity → MAX_SCENE_MARKER_SECONDS
 *   - finite positives → min(time, MAX) rounded to 3 decimals
 *
 * The result is always a finite number in `[0, MAX_SCENE_MARKER_SECONDS]`
 * with at most 3 fractional digits, so `normalize(normalize(x)) ===
 * normalize(x)` for every input (including Number.MAX_VALUE, which can no
 * longer overflow `time * 1000` to Infinity because the clamp runs before
 * the multiply). Phase markers are audio-beat boundaries — 1 ms is far
 * finer than any phase transition — and the bound + rounding cap the
 * serialized payload so the marker ceiling can be pinned safely (a raw
 * 24fps-snapped float like 0.041666666666666664 serializes to 19
 * characters; the normalized "0.042" to 5). Every persist path funnels
 * through this helper — the Mark command, the overlay drag commit, and the
 * `buildMarkersPatch` seam itself — so nothing can write raw floats.
 */
export function normalizeMarkerTime(time: number): number {
  if (Number.isNaN(time) || time <= 0) {
    // NaN → 0; -Infinity / negatives / -0 / 0 → 0.
    return 0;
  }
  if (!Number.isFinite(time)) {
    // +Infinity → the clamped maximum.
    return MAX_SCENE_MARKER_SECONDS;
  }
  const factor = 10 ** MARKER_TIME_PRECISION_DECIMALS;
  return Math.round(Math.min(time, MAX_SCENE_MARKER_SECONDS) * factor) / factor;
}

/** Normalize every marker's time to the bounded persisted representation. */
export function normalizeMarkers(markers: readonly ScenePhaseMarker[]): ScenePhaseMarker[] {
  return markers.map((marker) => ({ id: marker.id, time: normalizeMarkerTime(marker.time) }));
}

// ---------------------------------------------------------------------------
// Playhead access
// ---------------------------------------------------------------------------

/**
 * Playhead reads go through the provider-owned `ctx.creative.timelineView`
 * store (`TimelineViewStore`), NOT a module-level cache. The store is kept
 * fresh by the host canvas regardless of whether any renderer (panel or
 * overlay) is mounted, so the B command works renderer-independently.
 * There is deliberately NO preview DOM attribute fallback.
 */

// ---------------------------------------------------------------------------
// Marker-change notification (local freshness, no host coupling)
// ---------------------------------------------------------------------------

type MarkerChangeListener = () => void;

/** Module-local listeners notified after any successful marker-list write. */
const markerChangeListeners = new Set<MarkerChangeListener>();

/** A monotonic revision bumped on every successful marker-list write. */
let markersRevision = 0;

/**
 * Subscribe to marker-list writes. The timeline overlay uses this (via
 * useSyncExternalStore) so markers added while paused appear immediately
 * without waiting for a host re-render. Returns a DisposeHandle.
 */
export function subscribeMarkersChanged(listener: MarkerChangeListener): DisposeHandle {
  markerChangeListeners.add(listener);
  return {
    dispose(): void {
      markerChangeListeners.delete(listener);
    },
  };
}

/** Current marker-list revision (0 until the first write). */
export function getMarkersRevision(): number {
  return markersRevision;
}

/** Notify local subscribers after a successful marker-list write. */
export function notifyMarkersChanged(): void {
  markersRevision += 1;
  for (const listener of [...markerChangeListeners]) {
    listener();
  }
}

// ---------------------------------------------------------------------------
// Marker persistence (project-data)
// ---------------------------------------------------------------------------

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `marker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Type guard: does this unknown value look like a persisted scene marker? */
function isScenePhaseMarker(value: unknown): value is ScenePhaseMarker {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  // Persisted project data is JSON-shaped; narrow the record fields directly.
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.time === 'number'
    && Number.isFinite(candidate.time)
  );
}

/** Read the extension's sorted marker list from a timeline snapshot. */
export function readMarkers(
  snapshot: TimelineSnapshot,
  extensionId: string,
): ScenePhaseMarker[] {
  const app = snapshot.app[extensionId];
  if (app === null || typeof app !== 'object' || Array.isArray(app)) {
    return [];
  }
  if (!(MARKERS_DATA_KEY in app)) {
    return [];
  }
  const raw = app[MARKERS_DATA_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  const markers = raw.filter(isScenePhaseMarker).map((marker) => ({
    id: marker.id,
    time: marker.time,
  }));
  return markers.sort((a, b) => a.time - b.time);
}

/** Build a patch that replaces the extension's marker list atomically. */
export function buildMarkersPatch(
  extensionId: string,
  markers: ScenePhaseMarker[],
  version: number,
): TimelinePatch {
  // The single persist seam for the marker list (Mark command, drag commit,
  // clear all): normalize every time here so no persist path can write raw
  // floats, even if a caller forgot to normalize at its own boundary.
  const value = normalizeMarkers(markers);
  return {
    version,
    source: extensionId,
    meta: { kind: 'scene-phase-markers/write' },
    operations: [
      {
        op: 'project-data.write',
        target: extensionId,
        payload: { key: MARKERS_DATA_KEY, value, mode: 'replace' },
      },
    ],
  };
}

/**
 * Defensive snapshot read: while the editor is loading (or when a load
 * fails), `reader.snapshot()` throws, which would crash the renderer inside
 * the host's error boundary. Returns null so callers can render an inert
 * placeholder instead.
 *
 * Render-time reads (the footer panel and the timeline overlay both call this
 * during EVERY host render) are served from a module-level cache keyed on the
 * reader identity + marker-list revision + LIVE config version + document
 * revision, so the O(clips) snapshot projection is rebuilt only when one of
 * those changes — not once per editor render (playhead ticks, pointer moves,
 * zoom). The live version and document revision come from the reader's cheap
 * getters (the SAME sources `snapshot().baseVersion` and the data object
 * use), so:
 *   - a receipt-only ack (version advances, data untouched) invalidates the
 *     cache, keeping `Clear`'s patch built from a current baseVersion;
 *   - undo / reload / poll adoption (document replaced, version possibly
 *     unchanged) invalidates it, so stale markers are never shown.
 * Marker writes already bump the marker-list revision, which invalidates too.
 * A null (timeline-not-ready) result is deliberately NOT cached so a later
 * successful read is never masked; write paths that need a
 * guaranteed-fresh snapshot call `ctx.creative.reader.snapshot()` directly.
 */
let cachedSnapshotReader: TimelineReader | null = null;
let cachedSnapshotRevision = -1;
let cachedSnapshotLiveVersion: number | null = null;
let cachedSnapshotDocumentRevision: unknown = null;
let cachedSnapshot: TimelineSnapshot | null = null;

export function readTimelineSnapshot(ctx: ExtensionContext): TimelineSnapshot | null {
  const reader = ctx.creative.reader;
  const revision = getMarkersRevision();

  // Cheap live signals for the cache key (no snapshot projection): the
  // canonical version and the backing document's identity. Readers without
  // the optional getters (static mocks) report null, which keeps the old
  // reader + marker-revision behavior.
  let liveVersion: number | null = null;
  try {
    liveVersion = typeof reader.configVersion === 'function' ? reader.configVersion() : null;
  } catch {
    liveVersion = null;
  }
  let documentRevision: unknown = null;
  try {
    documentRevision = typeof reader.documentRevision === 'function' ? reader.documentRevision() : null;
  } catch {
    documentRevision = null;
  }

  if (
    cachedSnapshotReader === reader
    && cachedSnapshotRevision === revision
    && cachedSnapshotLiveVersion === liveVersion
    && cachedSnapshotDocumentRevision === documentRevision
    && cachedSnapshot !== null
  ) {
    return cachedSnapshot;
  }

  let snapshot: TimelineSnapshot | null = null;
  try {
    snapshot = reader.snapshot();
  } catch {
    snapshot = null;
  }
  cachedSnapshotReader = reader;
  cachedSnapshotRevision = revision;
  cachedSnapshotLiveVersion = liveVersion;
  cachedSnapshotDocumentRevision = documentRevision;
  cachedSnapshot = snapshot;
  return snapshot;
}

/**
 * Commit a marker move: take a FRESH snapshot, replace only the matching
 * marker's time (normalized to the bounded 3-decimal representation), sort
 * the array by time, and issue exactly one `project-data.write` using the
 * fresh snapshot's `baseVersion`. Previews are kept local by the caller and
 * never reach this function — this is the only path that persists a drag,
 * and it writes once. Unknown marker ids are a no-op (no write at all).
 */
export function moveMarkerToTime(
  ctx: ExtensionContext,
  markerId: string,
  time: number,
): void {
  const snapshot = ctx.creative.reader.snapshot();
  const markers = readMarkers(snapshot, ctx.extension.id);
  if (!markers.some((marker) => marker.id === markerId)) {
    return;
  }
  const next = markers
    .map((marker) => (
      marker.id === markerId ? { id: marker.id, time: normalizeMarkerTime(time) } : marker
    ))
    .sort((a, b) => a.time - b.time);
  ctx.creative.timeline.apply(
    buildMarkersPatch(ctx.extension.id, next, snapshot.baseVersion),
  );
  notifyMarkersChanged();
}

// ---------------------------------------------------------------------------
// Phase 2 — marker -> shot conversion and alignment
// ---------------------------------------------------------------------------

/** Options controlling shot creation from markers. */
export interface ShotPlacementOptions {
  /** Visual track id that receives the created shots. */
  trackId: string;
  /**
   * Tail duration in seconds for the shot after the LAST marker. Every
   * other shot spans exactly from its marker to the next marker (min 0.5s);
   * only the final shot has no next marker, so it takes this duration
   * (default 2s when 0 or negative).
   */
  durationSeconds: number;
}

/**
 * Duration of the shot that starts at `markers[index]`: the gap to the next
 * marker (min 0.5s), or the tail duration for the last marker — every shot
 * plays marker-to-marker so the timeline tiles with no gaps or overlaps.
 */
function shotDurationAt(
  markers: readonly ScenePhaseMarker[],
  index: number,
  options: ShotPlacementOptions,
): number {
  const marker = markers[index]!;
  const next = markers[index + 1];
  const gap = next ? next.time - marker.time : 0;
  if (!next) {
    return Math.max(0.5, options.durationSeconds > 0 ? options.durationSeconds : 2);
  }
  return Math.max(0.5, gap > 0 ? gap : 2);
}

/**
 * Build a patch that creates one hold clip per marker on the given track —
 * markers are transition points, so each shot plays BETWEEN transitions:
 * shot i starts at marker i and holds until the next marker (the tail after
 * the last marker takes `options.durationSeconds`, default 2s). Each clip is
 * added, then updated with its duration and label (clip.add only carries
 * track/at/clipType through the compiler; clip.update merges the remaining
 * fields).
 */
export function buildCreateShotsPatch(
  snapshot: TimelineSnapshot,
  markers: ScenePhaseMarker[],
  extensionId: string,
  options: ShotPlacementOptions,
): TimelinePatch {
  const operations: TimelinePatchOperation[] = [];
  markers.forEach((marker, index) => {
    const clipId = `scene-phase-shot-${marker.id}`;
    const duration = shotDurationAt(markers, index, options);
    operations.push(
      {
        op: 'clip.add',
        target: clipId,
        payload: { track: options.trackId, at: marker.time, clipType: 'hold' },
        order: index * 2,
      },
      {
        op: 'clip.update',
        target: clipId,
        payload: {
          hold: duration,
          label: `Shot ${index + 1}`,
          mode: 'merge',
        },
        order: index * 2 + 1,
      },
    );
  });
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: { kind: 'scene-phase-markers/create-shots' },
    operations,
  };
}

/** One shot-to-marker alignment: move clip `clipId` to start at `time`. */
export interface ShotAlignment {
  clipId: string;
  trackId: string;
  time: number;
  /** Resized hold in seconds; emitted as a clip.update when present. */
  hold?: number;
}

/**
 * Build a patch that moves each listed clip so it starts at its marker time,
 * and resizes it to the given hold (when provided) so it lasts until the
 * next marker.
 */
export function buildAlignShotsPatch(
  snapshot: TimelineSnapshot,
  alignments: readonly ShotAlignment[],
  extensionId: string,
): TimelinePatch {
  const operations: TimelinePatchOperation[] = [];
  alignments.forEach((alignment) => {
    operations.push({
      op: 'clip.move',
      target: alignment.clipId,
      payload: { track: alignment.trackId, at: alignment.time },
    });
    if (alignment.hold !== undefined) {
      operations.push({
        op: 'clip.update',
        target: alignment.clipId,
        payload: { hold: alignment.hold, mode: 'merge' },
      });
    }
  });
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: { kind: 'scene-phase-markers/align-shots' },
    operations,
  };
}

/** Ids of every visual track in the snapshot, in timeline order. */
export function visualTrackIds(snapshot: TimelineSnapshot): string[] {
  return snapshot.tracks.filter((track) => track.kind === 'visual').map((track) => track.id);
}

/** Clips that live on visual tracks, in timeline order. */
export function visualClips(snapshot: TimelineSnapshot): TimelineClipSummary[] {
  const visual = new Set(visualTrackIds(snapshot));
  return snapshot.clips.filter((clip) => visual.has(clip.track));
}

/**
 * Unified "Align shots to transitions" action behind the panel's single
 * button:
 *
 * - No visual clips yet → CREATE one shot per interval: shot i starts at
 *   marker i and runs until the next marker (the tail after the last marker
 *   uses the provided duration, default 2s). Markers are transition points;
 *   a shot plays BETWEEN transitions.
 * - Visual clips exist → MOVE each existing shot so it STARTS at its
 *   corresponding transition time (shot i -> marker i), keeping its track,
 *   and RESIZE it so it lasts until the next marker (the last shot takes
 *   the tail duration).
 *
 * Toasts the outcome; no-op with a warning when there are no markers.
 */
export function alignShotsToTransitions(
  ctx: ExtensionContext,
  options: ShotPlacementOptions,
): void {
  const snapshot = ctx.creative.reader.snapshot();
  const markers = readMarkers(snapshot, ctx.extension.id);
  if (markers.length === 0) {
    ctx.chrome.toast('No markers yet — press B during playback first.', 'warning');
    return;
  }
  const clips = visualClips(snapshot);
  if (clips.length === 0) {
    const patch = buildCreateShotsPatch(snapshot, markers, ctx.extension.id, options);
    ctx.creative.timeline.apply(patch);
    ctx.chrome.toast(
      `Created ${markers.length} shot${markers.length === 1 ? '' : 's'} between transitions on ${options.trackId}.`,
      'info',
    );
    return;
  }
  const alignments: ShotAlignment[] = clips.map((clip, index) => {
    const markerIndex = Math.min(index, markers.length - 1);
    const marker = markers[markerIndex]!;
    return {
      clipId: clip.id,
      trackId: clip.track,
      time: marker.time,
      hold: shotDurationAt(markers, markerIndex, options),
    };
  });
  const patch = buildAlignShotsPatch(snapshot, alignments, ctx.extension.id);
  ctx.creative.timeline.apply(patch);
  ctx.chrome.toast(
    `Aligned ${alignments.length} shot${alignments.length === 1 ? '' : 's'} to transitions.`,
    'info',
  );
}

// ---------------------------------------------------------------------------
// Phase 1 — command handler
// ---------------------------------------------------------------------------

/** Append a marker at the current playhead position and persist it. */
export function markPhaseAtPlayhead(ctx: ExtensionContext): void {
  const view = ctx.creative.timelineView.getSnapshot();
  if (!view.surfaceMounted) {
    ctx.chrome.toast(
      'Scene Phase Markers: playhead unavailable — open the editor preview first.',
      'error',
    );
    return;
  }
  const time = view.playhead.time;
  const snapshot = ctx.creative.reader.snapshot();
  const existing = readMarkers(snapshot, ctx.extension.id);
  if (existing.length >= MAX_SCENE_MARKERS) {
    ctx.chrome.toast(
      `Scene Phase Markers: limit of ${MAX_SCENE_MARKERS} markers reached — Clear/Delete Data to start over.`,
      'warning',
    );
    return;
  }
  const markers = [
    ...existing,
    { id: uid(), time: normalizeMarkerTime(time) },
  ].sort((a, b) => a.time - b.time);
  // Payload backstop: the count gate above is the primary enforcement, but
  // refuse outright if the NORMALIZED list would still hit the hard 64 KiB
  // entry limit (guards legacy unnormalized entries / future ceiling bumps).
  if (measureMarkersPayloadBytes(normalizeMarkers(markers)) >= SCENE_MARKERS_64KB_LIMIT_BYTES) {
    ctx.chrome.toast(
      'Scene Phase Markers: marker payload would exceed the 64 KiB project-data entry limit — Clear/Delete Data to start over.',
      'error',
    );
    return;
  }

  ctx.creative.timeline.apply(
    buildMarkersPatch(ctx.extension.id, markers, snapshot.baseVersion),
  );
  notifyMarkersChanged();
  ctx.chrome.toast(
    `Scene phase marked at ${time.toFixed(2)}s (${markers.length} total).`,
    'info',
  );
}

// ---------------------------------------------------------------------------
// Extension definition
// ---------------------------------------------------------------------------

export const scenePhaseMarkersExtension: ReighExtension = defineExtension({
  manifest: {
    id: SCENE_PHASE_EXTENSION_ID,
    version: '1.0.0',
    label: 'Scene Phase Markers',
    description:
      'Mark scene phases with the B key while playing audio, drag markers on the '
      + 'timeline ruler, then convert markers into shot positions and align shots '
      + 'to them.',
    apiVersion: 1,
    contributions: [
      {
        id: 'mark-phase-command' as ContributionId,
        kind: 'command',
        command: MARK_PHASE_COMMAND,
        label: 'Mark Scene Phase at Playhead',
        category: 'Scene Phase Markers',
        order: 10,
      },
      {
        id: 'mark-phase-keybinding' as ContributionId,
        kind: 'keybinding',
        command: MARK_PHASE_COMMAND,
        key: 'B',
        order: 10,
      },
      {
        id: 'scene-markers-footer' as ContributionId,
        kind: 'slot',
        slot: 'statusBar',
        render: FOOTER_RENDER_ID,
        order: 10,
        label: 'Scene Phase Markers',
      },
      {
        id: 'scene-markers-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: OVERLAY_RENDER_ID,
        order: 10,
        label: 'Scene Phase Markers (timeline ruler)',
      },
    ],
    settingsDefaults: {
      'marker.defaultDuration': 2,
    },
    messages: {
      'mark.ready': 'Scene phase marking ready — press B during playback.',
      'mark.done': 'Scene phase marked at {{time}}s ({{count}} total).',
      'mark.failed': 'Scene Phase Markers: {{error}}',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const handles: DisposeHandle[] = [];

    // Phase 1: B key / palette command -> marker at the current playhead.
    const commandHandle = ctx.commands.registerCommand(
      MARK_PHASE_COMMAND,
      (_run: CommandRunContext): void => {
        try {
          markPhaseAtPlayhead(ctx);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.services.diagnostics.report({
            severity: 'error',
            code: 'scene-phase-markers/command-error',
            message,
          });
          ctx.chrome.toast(ctx.services.i18n.t('mark.failed', { error: message }), 'error');
        }
      },
      {
        label: 'Mark Scene Phase at Playhead',
        category: 'Scene Phase Markers',
      },
    );
    handles.push(commandHandle);

    // Both renderers register through the public ctx.ui service — the
    // manifest declares one slot (footer) and one timelineOverlay, each with
    // its required render id, so both registrations are bound.
    const footerHandle = ctx.ui.registerRenderer(
      FOOTER_RENDER_ID,
      (renderContext: unknown) => createElement(
        ScenePhaseMarkersPanel,
        { ctx, playback: resolvePlaybackFromRenderContext(renderContext) },
      ),
    );
    handles.push(footerHandle);

    const overlayHandle = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
      OVERLAY_RENDER_ID,
      (props: TimelineOverlayRenderProps) => createElement(
        ScenePhaseMarkersOverlay,
        { ctx, props },
      ),
    );
    handles.push(overlayHandle);

    ctx.chrome.toast(ctx.services.i18n.t('mark.ready'), 'info');

    return {
      dispose(): void {
        // Compose every registration handle into activation disposal.
        // Deliberately NEVER touches project data (no project-data.delete):
        // this runs on disable, HMR, provider unmount, and reload. Clearing
        // markers is only ever user-triggered via the panel's
        // Clear/Delete Data action.
        for (const handle of handles) {
          handle.dispose();
        }
      },
    };
  },
});

/** Narrow the renderer's context argument to the minimal playback shape. */
function resolvePlaybackFromRenderContext(
  renderContext: unknown,
): { currentTime: number } {
  if (
    renderContext !== null
    && typeof renderContext === 'object'
    && 'playback' in renderContext
    && renderContext.playback !== null
    && typeof renderContext.playback === 'object'
    && 'currentTime' in renderContext.playback
    && typeof renderContext.playback.currentTime === 'number'
  ) {
    return { currentTime: renderContext.playback.currentTime };
  }
  return { currentTime: 0 };
}
