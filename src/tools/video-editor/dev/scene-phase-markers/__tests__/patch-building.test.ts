/**
 * scene-phase-markers — unit tests for the patch builders, the activation
 * wiring (B-key command -> project-data marker write; footer + timeline
 * overlay renderer registration through ctx.ui), the commit-once marker move,
 * the measured 64 KiB ceiling, and disposal that preserves project data.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  CommandHandler,
  CommandRegistrationOptions,
  DisposeHandle,
  ExtensionCommandService,
  ExtensionContext,
  ExtensionUiService,
  TimelineOps,
  TimelinePatch,
  TimelineReader,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import { createExtensionContext } from '@/tools/video-editor/runtime/extensionContextFactory';
import { validateTimelinePatch } from '@/tools/video-editor/lib/timeline-patch';
import { createTimelineViewStore } from '@/tools/video-editor/lib/timeline-view-store.ts';
import {
  FOOTER_RENDER_ID,
  MARK_PHASE_COMMAND,
  MARKER_TIME_PRECISION_DECIMALS,
  MARKERS_DATA_KEY,
  MAX_SCENE_MARKERS,
  MAX_SCENE_MARKER_SECONDS,
  OVERLAY_RENDER_ID,
  SCENE_MARKERS_64KB_LIMIT_BYTES,
  SCENE_PHASE_EXTENSION_ID,
  alignShotsToTransitions,
  buildAlignShotsPatch,
  buildCreateEmptyShotsPatch,
  buildCreateShotsPatch,
  buildMarkersPatch,
  collectTrackItemSpans,
  createShotsFromMarkers,
  isMarkerCoveredByItems,
  markPhaseAtPlayhead,
  measureMarkersPayloadBytes,
  moveExistingShotsToMarkers,
  moveMarkerToTime,
  normalizeMarkerTime,
  normalizeMarkers,
  notifyMarkersChanged,
  readMarkers,
  readTimelineSnapshot,
  scenePhaseMarkersExtension,
  visualClips,
  visualTrackIds,
  type ScenePhaseMarker,
} from '../extension';

function makeSnapshot(overrides: Partial<TimelineSnapshot> = {}): TimelineSnapshot {
  return {
    projectId: null,
    baseVersion: 7,
    currentVersion: 7,
    extensionRequirements: [],
    clips: [],
    tracks: [],
    assetKeys: [],
    app: {},
    ...overrides,
  };
}

function makeOps(): { ops: TimelineOps; applied: TimelinePatch[] } {
  const applied: TimelinePatch[] = [];
  const ops: TimelineOps = {
    validate: () => ({ valid: true, diagnostics: [] }),
    preview: () => ({
      diff: { version: 0, entries: [], affectedObjectIds: [] },
      fullyPreviewable: true,
      diagnostics: [],
    }),
    apply: (patch) => {
      applied.push(patch);
      return { version: patch.version, entries: [], affectedObjectIds: [] };
    },
    checkpoint: () => 'ckpt',
    rollback: () => null,
    setAllTracksMuted: () => ({ version: 0, entries: [], affectedObjectIds: [] }),
  };
  return { ops, applied };
}

function makeCommands(): {
  service: ExtensionCommandService;
  registered: Array<{ commandId: string; handler: CommandHandler }>;
} {
  const registered: Array<{ commandId: string; handler: CommandHandler }> = [];
  const service: ExtensionCommandService = {
    registerCommand(
      commandId: string,
      handler: CommandHandler,
      _options?: CommandRegistrationOptions,
    ) {
      registered.push({ commandId, handler });
      return { dispose: () => {} };
    },
  };
  return { service, registered };
}

/** A ctx.ui service stub that records registrations and disposes. */
function makeUiService(): {
  ui: ExtensionUiService;
  calls: Array<{ renderId: string; renderer: unknown; dispose: () => void }>;
} {
  const calls: Array<{ renderId: string; renderer: unknown; dispose: () => void }> = [];
  const ui: ExtensionUiService = {
    registerRenderer(renderId, renderer) {
      const entry = {
        renderId,
        renderer,
        dispose: vi.fn(() => {}),
      };
      calls.push(entry);
      return { dispose: entry.dispose } as DisposeHandle;
    },
  };
  return { ui, calls };
}

describe('readMarkers', () => {
  it('returns [] when the extension has no project data', () => {
    expect(readMarkers(makeSnapshot(), SCENE_PHASE_EXTENSION_ID)).toEqual([]);
  });

  it('drops malformed entries, sorts by time, and keeps valid markers', () => {
    const snapshot = makeSnapshot({
      app: {
        [SCENE_PHASE_EXTENSION_ID]: {
          [MARKERS_DATA_KEY]: [
            { id: 'late', time: 12.5 },
            { id: 'early', time: 1.25 },
            { time: 3 }, // missing id
            { id: 'nope', time: 'x' }, // non-numeric time
            null,
          ],
        },
      },
    });
    expect(readMarkers(snapshot, SCENE_PHASE_EXTENSION_ID)).toEqual([
      { id: 'early', time: 1.25 },
      { id: 'late', time: 12.5 },
    ]);
  });
});

describe('buildMarkersPatch', () => {
  it('writes the full marker list as a project-data.replace op', () => {
    const patch = buildMarkersPatch(SCENE_PHASE_EXTENSION_ID, [
      { id: 'a', time: 1 },
      { id: 'b', time: 2 },
    ], 9);
    expect(patch.version).toBe(9);
    expect(patch.operations).toEqual([
      {
        op: 'project-data.write',
        target: SCENE_PHASE_EXTENSION_ID,
        payload: {
          key: MARKERS_DATA_KEY,
          value: [
            { id: 'a', time: 1 },
            { id: 'b', time: 2 },
          ],
          mode: 'replace',
        },
      },
    ]);
  });
});

describe('markPhaseAtPlayhead (B-key flow)', () => {
  it('appends the current playhead to the persisted marker list', () => {
    const { ops, applied } = makeOps();
    const snapshot = makeSnapshot({
      app: {
        [SCENE_PHASE_EXTENSION_ID]: {
          [MARKERS_DATA_KEY]: [{ id: 'existing', time: 5 }],
        },
      },
    });
    const reader: TimelineReader = { snapshot: () => snapshot };
    const { service, registered } = makeCommands();
    const { ui, calls } = makeUiService();
    const timelineView = createTimelineViewStore();

    const ctx = createExtensionContext(
      scenePhaseMarkersExtension,
      { timeline: ops, reader, timelineView },
      service,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ui,
    );

    const handle = scenePhaseMarkersExtension.activate!(ctx);

    // Phase 1 wiring: command registered, and BOTH renderers (footer slot +
    // timeline overlay) registered through ctx.ui.
    expect(registered.map((entry) => entry.commandId)).toEqual([MARK_PHASE_COMMAND]);
    expect(calls.map((entry) => entry.renderId)).toEqual([
      FOOTER_RENDER_ID,
      OVERLAY_RENDER_ID,
    ]);

    // Simulate pressing B while the playhead sits at 12.5s: the host has
    // published the playhead into the provider-owned timeline view store.
    timelineView.publish({ playhead: { time: 12.5, isPlaying: false }, surfaceMounted: true });
    const handler = registered[0]!.handler;
    handler({ commandId: MARK_PHASE_COMMAND });

    expect(applied).toHaveLength(1);
    const patch = applied[0]!;
    expect(patch.version).toBe(snapshot.baseVersion);
    expect(patch.source).toBe(SCENE_PHASE_EXTENSION_ID);
    const op = patch.operations[0]!;
    expect(op.op).toBe('project-data.write');
    const value = (op.payload as Record<string, unknown>).value as Array<{ id: string; time: number }>;
    expect(value).toHaveLength(2);
    expect(value[0]).toEqual({ id: 'existing', time: 5 });
    expect(value[1]!.time).toBe(12.5);
    expect(value[1]!.id).toBeTypeOf('string');

    handle.dispose();
  });
});

describe('moveMarkerToTime (commit-once drag persistence)', () => {
  it('replaces exactly one marker, sorts, and writes once with a FRESH baseVersion', () => {
    const { ops, applied } = makeOps();
    // A mutable version lets us simulate a concurrent writer bumping the
    // timeline between the overlay's render-time read and the commit.
    let baseVersion = 7;
    const reader: TimelineReader = {
      snapshot: () => makeSnapshot({
        baseVersion,
        app: {
          [SCENE_PHASE_EXTENSION_ID]: {
            [MARKERS_DATA_KEY]: [
              { id: 'm1', time: 2 },
              { id: 'm2', time: 8 },
              { id: 'm3', time: 5 },
            ],
          },
        },
      }),
    };
    const ctx = createExtensionContext(
      scenePhaseMarkersExtension,
      { timeline: ops, reader },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    // The timeline moved on while the user was dragging: the commit must use
    // the FRESH baseVersion, not a stale one captured earlier.
    baseVersion = 11;
    moveMarkerToTime(ctx, 'm2', 0.5);

    expect(applied).toHaveLength(1);
    const patch = applied[0]!;
    expect(patch.version).toBe(11);
    const op = patch.operations[0]!;
    expect(op.op).toBe('project-data.write');
    const value = (op.payload as Record<string, unknown>).value as Array<{ id: string; time: number }>;
    // Exactly one marker replaced; the array is re-sorted by time.
    expect(value).toEqual([
      { id: 'm2', time: 0.5 },
      { id: 'm1', time: 2 },
      { id: 'm3', time: 5 },
    ]);
  });

  it('is a no-op (no write at all) for an unknown marker id', () => {
    const { ops, applied } = makeOps();
    const reader: TimelineReader = {
      snapshot: () => makeSnapshot({
        app: {
          [SCENE_PHASE_EXTENSION_ID]: {
            [MARKERS_DATA_KEY]: [{ id: 'm1', time: 2 }],
          },
        },
      }),
    };
    const ctx = createExtensionContext(
      scenePhaseMarkersExtension,
      { timeline: ops, reader },
    );
    moveMarkerToTime(ctx, 'ghost', 9);
    expect(applied).toHaveLength(0);
  });
});

describe('marker payload ceiling (normalized, ≥20% headroom under the 64 KiB hard limit)', () => {
  it('pins MAX_SCENE_MARKERS inside a usable band below the old unsafe 1000 pin', () => {
    expect(MAX_SCENE_MARKERS).toBeGreaterThanOrEqual(500);
    expect(MAX_SCENE_MARKERS).toBeLessThanOrEqual(1000);
  });

  it('keeps the worst-case NORMALIZED payload below 80% of the 64 KiB hard entry limit', () => {
    // Hostile finite/infinite inputs must clamp to MAX_SCENE_MARKER_SECONDS,
    // whose serialized form ("9999.999") is the longest representation
    // reachable inside the bounded domain. Measured 2026-08-11 with real
    // 36-char crypto.randomUUID ids: 800 markers at the clamped maximum
    // serialize to 49,601 bytes — 75.7% of the 65,536 limit, ≥20% headroom.
    const hostile = Array.from({ length: MAX_SCENE_MARKERS }, (_, index) => ({
      id: crypto.randomUUID(),
      time: index % 2 === 0 ? Number.MAX_VALUE : Infinity,
    }));
    const normalized = normalizeMarkers(hostile);
    for (const marker of normalized) {
      expect(marker.time).toBe(MAX_SCENE_MARKER_SECONDS);
    }
    const bytes = measureMarkersPayloadBytes(normalized);
    // The total clamp means no accepted input can serialize longer than the
    // clamped maximum's representation: the true worst case is exactly the
    // 49,601-byte ceiling measurement (nothing can exceed it).
    expect(bytes).toBeLessThanOrEqual(49601);
    expect(bytes).toBeLessThan(SCENE_MARKERS_64KB_LIMIT_BYTES * 0.8);
  });

  it('normalizes EXACT 24fps frame-snapped input times at the persist seam and stays under the limit at the ceiling', () => {
    // 24fps-snapped playhead floats, deliberately EXACT (index / 24 — e.g.
    // 1/24 = 0.041666666666666664, 2/24 = 0.08333333333333333) — the input
    // shape that overflowed the limit before normalization (1000 raw
    // markers measured 67,487 bytes). The persist seam (buildMarkersPatch,
    // used by the Mark command and the overlay drag commit) must bound them.
    const input = Array.from({ length: MAX_SCENE_MARKERS }, (_, index) => ({
      id: crypto.randomUUID(),
      time: index / 24,
    }));
    const patch = buildMarkersPatch(SCENE_PHASE_EXTENSION_ID, input, 1);
    const value = (patch.operations[0]!.payload as Record<string, unknown>).value as ScenePhaseMarker[];
    // The exact frame-snapped floats are rounded to the bounded 3-decimal
    // representation at the seam (1/24 → 0.042, 2/24 → 0.083, 3/24 → 0.125,
    // 12/24 → 0.5) — never persisted raw.
    expect(value[0]!.time).toBe(0);
    expect(value[1]!.time).toBe(0.042);
    expect(value[2]!.time).toBe(0.083);
    expect(value[3]!.time).toBe(0.125);
    expect(value[12]!.time).toBe(0.5);
    // Normalization is idempotent and the serialized form has at most
    // MARKER_TIME_PRECISION_DECIMALS fractional digits.
    for (const marker of value) {
      expect(marker.time).toBe(normalizeMarkerTime(marker.time));
      const fractional = JSON.stringify(marker.time).split('.')[1];
      expect(
        fractional === undefined || fractional.length <= MARKER_TIME_PRECISION_DECIMALS,
      ).toBe(true);
    }
    const bytes = measureMarkersPayloadBytes(value);
    expect(bytes).toBeLessThan(SCENE_MARKERS_64KB_LIMIT_BYTES);
    expect(bytes).toBeLessThan(SCENE_MARKERS_64KB_LIMIT_BYTES * 0.8);
  });

  it('normalizeMarkerTime is TOTAL and IDEMPOTENT over every number input', () => {
    // Pathological inputs: extreme magnitudes, infinities, NaN, negatives,
    // scientific notation, and the domain edges. Each must normalize to a
    // finite bounded 3-decimal value that survives re-normalization.
    const cases: Array<{ input: number; expected: number }> = [
      { input: Number.MAX_VALUE, expected: MAX_SCENE_MARKER_SECONDS },
      { input: -Infinity, expected: 0 },
      { input: Infinity, expected: MAX_SCENE_MARKER_SECONDS },
      { input: NaN, expected: 0 },
      { input: -0, expected: 0 },
      { input: 0, expected: 0 },
      { input: -1e-7, expected: 0 },
      { input: -3.2872513831955945e+100, expected: 0 },
      { input: 1e-7, expected: 0 }, // rounds to 0.000 at 3 decimals
      { input: 1.7976931348623157e+308, expected: MAX_SCENE_MARKER_SECONDS },
      { input: 12345.678, expected: MAX_SCENE_MARKER_SECONDS }, // clamped
      { input: MAX_SCENE_MARKER_SECONDS, expected: MAX_SCENE_MARKER_SECONDS },
      { input: 0.041666666666666664, expected: 0.042 }, // 1/24 at 24fps
    ];
    for (const { input, expected } of cases) {
      const once = normalizeMarkerTime(input);
      expect(once).toBe(expected);
      expect(Number.isFinite(once)).toBe(true);
      expect(once).toBeGreaterThanOrEqual(0);
      expect(once).toBeLessThanOrEqual(MAX_SCENE_MARKER_SECONDS);
      const fractional = JSON.stringify(once).split('.')[1];
      expect(
        fractional === undefined || fractional.length <= MARKER_TIME_PRECISION_DECIMALS,
      ).toBe(true);
      // normalize(normalize(x)) === normalize(x): total + idempotent.
      expect(normalizeMarkerTime(once)).toBe(once);
    }
  });

  it('fires the hard 64 KiB reject diagnostic when a payload would exceed it (validateProjectDataWrite path)', () => {
    // The extension refuses to mark beyond MAX_SCENE_MARKERS, but the host
    // validator is the last line of defense: a payload over the entry limit
    // must be rejected with the project-data-overflow diagnostic.
    const markers = Array.from({ length: MAX_SCENE_MARKERS + 400 }, () => ({
      id: crypto.randomUUID(),
      time: 9999.999,
    }));
    expect(measureMarkersPayloadBytes(markers)).toBeGreaterThan(SCENE_MARKERS_64KB_LIMIT_BYTES);
    const result = validateTimelinePatch(
      buildMarkersPatch(SCENE_PHASE_EXTENSION_ID, markers, 1),
    );
    expect(result.valid).toBe(false);
    const overflow = result.diagnostics.find(
      (diagnostic) => diagnostic.code === 'timeline-patch/project-data-overflow',
    );
    expect(overflow).toBeDefined();
    expect(overflow!.severity).toBe('error');
  });

  it('refuses to mark beyond the ceiling', () => {
    const { ops, applied } = makeOps();
    const snapshot = makeSnapshot({
      app: {
        [SCENE_PHASE_EXTENSION_ID]: {
          [MARKERS_DATA_KEY]: Array.from({ length: MAX_SCENE_MARKERS }, (_, index) => ({
            id: `m-${index}`,
            time: index,
          })),
        },
      },
    });
    const reader: TimelineReader = { snapshot: () => snapshot };
    const { service, registered } = makeCommands();
    const timelineView = createTimelineViewStore();
    const ctx = createExtensionContext(
      scenePhaseMarkersExtension,
      { timeline: ops, reader, timelineView },
      service,
    );
    scenePhaseMarkersExtension.activate!(ctx);

    timelineView.publish({ playhead: { time: 42, isPlaying: false }, surfaceMounted: true });
    const handler = registered[0]!.handler;
    handler({ commandId: MARK_PHASE_COMMAND });

    // No write at the ceiling; the list stays at MAX.
    expect(applied).toHaveLength(0);
    expect(readMarkers(snapshot, SCENE_PHASE_EXTENSION_ID)).toHaveLength(MAX_SCENE_MARKERS);
  });
});

describe('generic disposal preserves project data', () => {
  it('disposes both registration handles and never issues project-data.delete', () => {
    const { ops, applied } = makeOps();
    const snapshot = makeSnapshot({
      app: {
        [SCENE_PHASE_EXTENSION_ID]: {
          [MARKERS_DATA_KEY]: [{ id: 'keep', time: 3 }],
        },
      },
    });
    const reader: TimelineReader = { snapshot: () => snapshot };
    const { ui, calls } = makeUiService();
    const ctx = createExtensionContext(
      scenePhaseMarkersExtension,
      { timeline: ops, reader },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ui,
    );

    const handle = scenePhaseMarkersExtension.activate!(ctx);
    expect(calls).toHaveLength(2);

    handle.dispose();
    // Every registration handle is composed into activation disposal.
    expect(calls[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(calls[1]!.dispose).toHaveBeenCalledTimes(1);
    // Disposal (disable / HMR / provider unmount / reload) never writes or
    // deletes project data; markers survive and no delete op ever appears.
    expect(applied).toHaveLength(0);
    expect(readMarkers(snapshot, SCENE_PHASE_EXTENSION_ID)).toEqual([{ id: 'keep', time: 3 }]);
  });
});

describe('buildCreateShotsPatch', () => {
  const markers = [
    { id: 'm1', time: 0 },
    { id: 'm2', time: 5 },
    { id: 'm3', time: 8 },
  ];
  const snapshot = makeSnapshot();

  it('uses the gap to the next marker as duration (2s default for last)', () => {
    const patch = buildCreateShotsPatch(snapshot, markers, SCENE_PHASE_EXTENSION_ID, {
      trackId: 'V1',
      durationSeconds: 0,
    });
    expect(patch.operations).toEqual([
      {
        op: 'clip.add', target: 'scene-phase-shot-m1',
        payload: { track: 'V1', at: 0, clipType: 'hold' }, order: 0,
      },
      {
        op: 'clip.update', target: 'scene-phase-shot-m1',
        payload: { hold: 5, label: 'Shot 1', mode: 'merge' }, order: 1,
      },
      {
        op: 'clip.add', target: 'scene-phase-shot-m2',
        payload: { track: 'V1', at: 5, clipType: 'hold' }, order: 2,
      },
      {
        op: 'clip.update', target: 'scene-phase-shot-m2',
        payload: { hold: 3, label: 'Shot 2', mode: 'merge' }, order: 3,
      },
      {
        op: 'clip.add', target: 'scene-phase-shot-m3',
        payload: { track: 'V1', at: 8, clipType: 'hold' }, order: 4,
      },
      {
        op: 'clip.update', target: 'scene-phase-shot-m3',
        payload: { hold: 2, label: 'Shot 3', mode: 'merge' }, order: 5,
      },
    ]);
  });

  it('uses the provided duration only for the tail shot (intervals tile to the next marker)', () => {
    const patch = buildCreateShotsPatch(snapshot, markers, SCENE_PHASE_EXTENSION_ID, {
      trackId: 'V1',
      durationSeconds: 3,
    });
    const updateOps = patch.operations.filter((op) => op.op === 'clip.update');
    // Intervals [0→5) and [5→8) keep their marker gaps; only the tail after 8 uses 3s.
    expect(updateOps.map((op) => (op.payload as Record<string, unknown>).hold)).toEqual([5, 3, 3]);
  });
});

describe('collectTrackItemSpans / isMarkerCoveredByItems', () => {
  const generationClip = (id: string, at: number, duration: number): TimelineSnapshot['clips'][number] => ({
    id,
    track: 'V1',
    at,
    duration,
    clipType: 'media',
    managed: false,
    sourceRefs: [{ id: `source.generation.${id}`, clipId: id, sourceKind: 'generation', generationId: `gen-${id}` }],
  });

  it('counts a shot with multiple generations inside as ONE item (shot prioritised over generation)', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [
        generationClip('g1', 0, 2),
        generationClip('g2', 2, 2),
      ],
      renderGroups: [{
        id: 'shot-1:V1',
        clipIds: ['g1', 'g2'],
        groupType: 'pinned-shot-group',
      }],
    });

    const spans = collectTrackItemSpans(snapshot, 'V1');
    // One span covering both generations, not two.
    expect(spans).toEqual([{ start: 0, end: 4 }]);
    expect(isMarkerCoveredByItems(1, spans)).toBe(true);
    expect(isMarkerCoveredByItems(5, spans)).toBe(false);
  });

  it('counts a standalone generation as one item when not inside a shot', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [generationClip('g1', 2, 3)],
    });

    const spans = collectTrackItemSpans(snapshot, 'V1');
    expect(spans).toEqual([{ start: 2, end: 5 }]);
    expect(isMarkerCoveredByItems(2, spans)).toBe(true);
    expect(isMarkerCoveredByItems(5, spans)).toBe(false);
  });

  it('ignores clips on other tracks and non-generation clips', () => {
    const snapshot = makeSnapshot({
      tracks: [
        { id: 'V1', kind: 'visual', label: 'V1', muted: false },
        { id: 'V2', kind: 'visual', label: 'V2', muted: false },
      ],
      clips: [
        generationClip('g1', 2, 3),
        { id: 'plain', track: 'V1', at: 10, duration: 2, clipType: 'hold', managed: false },
        { id: 'g-v2', track: 'V2', at: 0, duration: 4, clipType: 'media', managed: false, sourceRefs: [{ id: 's', clipId: 'g-v2', sourceKind: 'generation', generationId: 'gen-v2' }] },
      ],
    });

    const spans = collectTrackItemSpans(snapshot, 'V1');
    expect(spans).toEqual([{ start: 2, end: 5 }]);
  });
});

describe('buildCreateEmptyShotsPatch', () => {
  const markers = [
    { id: 'm1', time: 0 },
    { id: 'm2', time: 5 },
    { id: 'm3', time: 8 },
  ];
  const options = { trackId: 'V1', durationSeconds: 0, createEmptyShots: true };

  it('creates a shot only for markers not covered by a generation (markers beyond existing items)', () => {
    // One generation covers [1,4): marker m1 (0) is uncovered, m2 (5) is
    // uncovered, m3 (8) is uncovered — nothing covered here, all three created.
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [{
        id: 'g1', track: 'V1', at: 1, duration: 3, clipType: 'media', managed: false,
        sourceRefs: [{ id: 's', clipId: 'g1', sourceKind: 'generation', generationId: 'gen-1' }],
      }],
    });

    const patch = buildCreateEmptyShotsPatch(snapshot, markers, SCENE_PHASE_EXTENSION_ID, options);
    expect(patch.meta.kind).toBe('scene-phase-markers/create-empty-shots');
    const adds = patch.operations.filter((op) => op.op === 'clip.add');
    expect(adds.map((op) => (op.payload as Record<string, unknown>).at)).toEqual([0, 5, 8]);
  });

  it('skips markers covered by a shot whose generations absorb multiple items', () => {
    // Shot spans [0,4) containing two generations: marker m1 (0) covered,
    // m2 (5) and m3 (8) uncovered.
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [
        { id: 'g1', track: 'V1', at: 0, duration: 2, clipType: 'media', managed: false, sourceRefs: [{ id: 's1', clipId: 'g1', sourceKind: 'generation', generationId: 'gen-1' }] },
        { id: 'g2', track: 'V1', at: 2, duration: 2, clipType: 'media', managed: false, sourceRefs: [{ id: 's2', clipId: 'g2', sourceKind: 'generation', generationId: 'gen-2' }] },
      ],
      renderGroups: [{
        id: 'shot-1:V1',
        clipIds: ['g1', 'g2'],
        groupType: 'pinned-shot-group',
      }],
    });

    const patch = buildCreateEmptyShotsPatch(snapshot, markers, SCENE_PHASE_EXTENSION_ID, options);
    const adds = patch.operations.filter((op) => op.op === 'clip.add');
    // m1 covered by the shot; m2/m3 get empty shots.
    expect(adds.map((op) => (op.payload as Record<string, unknown>).at)).toEqual([5, 8]);
    const labels = patch.operations
      .filter((op) => op.op === 'clip.update')
      .map((op) => (op.payload as Record<string, unknown>).label);
    expect(labels).toEqual(['Shot 1', 'Shot 2']);
    // Add/update pairs stay adjacent with sequential order (0,1,2,3).
    expect(patch.operations.map((op) => op.order)).toEqual([0, 1, 2, 3]);
    expect(patch.operations.map((op) => op.op)).toEqual([
      'clip.add', 'clip.update', 'clip.add', 'clip.update',
    ]);
  });

  it('creates nothing when every marker is covered', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [{
        id: 'g1', track: 'V1', at: 0, duration: 10, clipType: 'media', managed: false,
        sourceRefs: [{ id: 's', clipId: 'g1', sourceKind: 'generation', generationId: 'gen-1' }],
      }],
    });

    const patch = buildCreateEmptyShotsPatch(snapshot, markers, SCENE_PHASE_EXTENSION_ID, options);
    expect(patch.operations).toEqual([]);
  });

  it('is idempotent: markers whose generated shot already exists are skipped', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      // m1 and m3 already have generated shots; m2 does not.
      clips: [
        { id: 'scene-phase-shot-m1', track: 'V1', at: 0, duration: 5, clipType: 'hold', managed: false },
        { id: 'scene-phase-shot-m3', track: 'V1', at: 8, duration: 2, clipType: 'hold', managed: false },
      ],
    });

    const patch = buildCreateEmptyShotsPatch(snapshot, markers, SCENE_PHASE_EXTENSION_ID, options);
    const adds = patch.operations.filter((op) => op.op === 'clip.add');
    expect(adds.map((op) => (op.payload as Record<string, unknown>).at)).toEqual([5]);
    expect(adds.map((op) => op.target)).toEqual(['scene-phase-shot-m2']);
  });
});

describe('buildCreateShotsPatch idempotency', () => {
  const markers = [
    { id: 'm1', time: 0 },
    { id: 'm2', time: 5 },
  ];
  const options = { trackId: 'V1', durationSeconds: 0 };

  it('skips markers whose generated shot already exists (unchecked create at every marker)', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [
        { id: 'scene-phase-shot-m1', track: 'V1', at: 0, duration: 5, clipType: 'hold', managed: false },
      ],
    });

    const patch = buildCreateShotsPatch(snapshot, markers, SCENE_PHASE_EXTENSION_ID, options);
    const adds = patch.operations.filter((op) => op.op === 'clip.add');
    expect(adds.map((op) => (op.payload as Record<string, unknown>).at)).toEqual([5]);
    // m2 is the only created shot → labelled Shot 1.
    const labels = patch.operations
      .filter((op) => op.op === 'clip.update')
      .map((op) => (op.payload as Record<string, unknown>).label);
    expect(labels).toEqual(['Shot 1']);
  });
});

describe('buildAlignShotsPatch', () => {
  it('moves each clip to its chosen marker time with the snapshot base version', () => {
    const snapshot = makeSnapshot({ baseVersion: 4 });
    const patch = buildAlignShotsPatch(snapshot, [
      { clipId: 'clip-a', trackId: 'V1', time: 0 },
      { clipId: 'clip-b', trackId: 'V1', time: 5 },
    ], SCENE_PHASE_EXTENSION_ID);
    expect(patch.version).toBe(4);
    expect(patch.operations).toEqual([
      { op: 'clip.move', target: 'clip-a', payload: { track: 'V1', at: 0 } },
      { op: 'clip.move', target: 'clip-b', payload: { track: 'V1', at: 5 } },
    ]);
  });
});

describe('alignShotsToTransitions (unified panel action)', () => {
  function makeCtx(
    snapshot: TimelineSnapshot,
  ): { ctx: ExtensionContext; applied: TimelinePatch[] } {
    const { ops, applied } = makeOps();
    const reader: TimelineReader = { snapshot: () => snapshot };
    const ctx = createExtensionContext(
      scenePhaseMarkersExtension,
      { timeline: ops, reader },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    return { ctx, applied };
  }

  it('creates one shot per interval when no visual clips exist', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      app: {
        [SCENE_PHASE_EXTENSION_ID]: {
          [MARKERS_DATA_KEY]: [
            { id: 'm1', time: 0 },
            { id: 'm2', time: 5 },
            { id: 'm3', time: 8 },
          ],
        },
      },
    });
    const { ctx, applied } = makeCtx(snapshot);
    alignShotsToTransitions(ctx, { trackId: 'V1', durationSeconds: 0 });
    expect(applied).toHaveLength(1);
    const patch = applied[0]!;
    expect(patch.meta.kind).toBe('scene-phase-markers/create-shots');
    const adds = patch.operations.filter((op) => op.op === 'clip.add');
    expect(adds.map((op) => (op.payload as Record<string, unknown>).at)).toEqual([0, 5, 8]);
    const updates = patch.operations.filter((op) => op.op === 'clip.update');
    // Interval holds: [0→5) = 5s, [5→8) = 3s, tail = 2s default.
    expect(updates.map((op) => (op.payload as Record<string, unknown>).hold)).toEqual([5, 3, 2]);
  });

  it('moves existing visual clips to marker starts and resizes each to last until the next marker', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [
        { id: 'clip-a', track: 'V1', at: 12, duration: 4 },
        { id: 'clip-b', track: 'V1', at: 20, duration: 4 },
      ],
      app: {
        [SCENE_PHASE_EXTENSION_ID]: {
          [MARKERS_DATA_KEY]: [
            { id: 'm1', time: 3 },
            { id: 'm2', time: 9 },
          ],
        },
      },
    });
    const { ctx, applied } = makeCtx(snapshot);
    alignShotsToTransitions(ctx, { trackId: 'V1', durationSeconds: 0 });
    expect(applied).toHaveLength(1);
    const patch = applied[0]!;
    expect(patch.meta.kind).toBe('scene-phase-markers/align-shots');
    // clip-a -> marker 1 (3s), hold [3→9) = 6s; clip-b -> marker 2 (9s), tail = 2s default.
    expect(patch.operations).toEqual([
      { op: 'clip.move', target: 'clip-a', payload: { track: 'V1', at: 3 } },
      { op: 'clip.update', target: 'clip-a', payload: { hold: 6, mode: 'merge' } },
      { op: 'clip.move', target: 'clip-b', payload: { track: 'V1', at: 9 } },
      { op: 'clip.update', target: 'clip-b', payload: { hold: 2, mode: 'merge' } },
    ]);
  });

  it('uses the tail duration for the last aligned shot when provided', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [
        { id: 'clip-a', track: 'V1', at: 12, duration: 4 },
        { id: 'clip-b', track: 'V1', at: 20, duration: 4 },
      ],
      app: {
        [SCENE_PHASE_EXTENSION_ID]: {
          [MARKERS_DATA_KEY]: [
            { id: 'm1', time: 3 },
            { id: 'm2', time: 9 },
          ],
        },
      },
    });
    const { ctx, applied } = makeCtx(snapshot);
    alignShotsToTransitions(ctx, { trackId: 'V1', durationSeconds: 5 });
    const patch = applied[0]!;
    const updates = patch.operations.filter((op) => op.op === 'clip.update');
    // Interval [3→9) = 6s; tail = 5s from the input.
    expect(updates.map((op) => (op.payload as Record<string, unknown>).hold)).toEqual([6, 5]);
  });

  it('is a no-op warning when there are no markers', () => {
    const { ctx, applied } = makeCtx(makeSnapshot());
    alignShotsToTransitions(ctx, { trackId: 'V1', durationSeconds: 0 });
    expect(applied).toHaveLength(0);
  });
});

describe('split panel entry points (createShotsFromMarkers / moveExistingShotsToMarkers)', () => {
  function makeCtx(
    snapshot: TimelineSnapshot,
  ): { ctx: ExtensionContext; applied: TimelinePatch[] } {
    const { ops, applied } = makeOps();
    const reader: TimelineReader = { snapshot: () => snapshot };
    const ctx = createExtensionContext(
      scenePhaseMarkersExtension,
      { timeline: ops, reader },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    return { ctx, applied };
  }

  const markerApp = (): TimelineSnapshot['app'] => ({
    [SCENE_PHASE_EXTENSION_ID]: {
      [MARKERS_DATA_KEY]: [
        { id: 'm1', time: 0 },
        { id: 'm2', time: 5 },
        { id: 'm3', time: 8 },
      ],
    },
  });

  it('createShotsFromMarkers creates at every marker regardless of existing clips (unchecked)', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [{ id: 'clip-a', track: 'V1', at: 12, duration: 4, managed: false }],
      app: markerApp(),
    });
    const { ctx, applied } = makeCtx(snapshot);
    createShotsFromMarkers(ctx, { trackId: 'V1', durationSeconds: 0 });
    expect(applied).toHaveLength(1);
    expect(applied[0]!.meta.kind).toBe('scene-phase-markers/create-shots');
    const adds = applied[0]!.operations.filter((op) => op.op === 'clip.add');
    expect(adds.map((op) => (op.payload as Record<string, unknown>).at)).toEqual([0, 5, 8]);
  });

  it('createShotsFromMarkers with createEmptyShots skips covered markers', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [{
        id: 'g1', track: 'V1', at: 0, duration: 6, clipType: 'media', managed: false,
        sourceRefs: [{ id: 's', clipId: 'g1', sourceKind: 'generation', generationId: 'gen-1' }],
      }],
      app: markerApp(),
    });
    const { ctx, applied } = makeCtx(snapshot);
    createShotsFromMarkers(ctx, {
      trackId: 'V1',
      durationSeconds: 0,
      createEmptyShots: true,
    });
    expect(applied).toHaveLength(1);
    expect(applied[0]!.meta.kind).toBe('scene-phase-markers/create-empty-shots');
    const adds = applied[0]!.operations.filter((op) => op.op === 'clip.add');
    // Generation covers [0,6): m1 (0) and m2 (5) covered; m3 (8) uncovered.
    expect(adds.map((op) => (op.payload as Record<string, unknown>).at)).toEqual([8]);
  });

  it('moveExistingShotsToMarkers aligns existing clips even when the checkbox is on', () => {
    const snapshot = makeSnapshot({
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [
        { id: 'clip-a', track: 'V1', at: 12, duration: 4, managed: false },
        { id: 'clip-b', track: 'V1', at: 20, duration: 4, managed: false },
      ],
      app: markerApp(),
    });
    const { ctx, applied } = makeCtx(snapshot);
    moveExistingShotsToMarkers(ctx, { trackId: 'V1', durationSeconds: 0 });
    expect(applied).toHaveLength(1);
    expect(applied[0]!.meta.kind).toBe('scene-phase-markers/align-shots');
    // clip-a -> m1 (0s) hold 5; clip-b -> m2 (5s) hold 3.
    expect(applied[0]!.operations).toEqual([
      { op: 'clip.move', target: 'clip-a', payload: { track: 'V1', at: 0 } },
      { op: 'clip.update', target: 'clip-a', payload: { hold: 5, mode: 'merge' } },
      { op: 'clip.move', target: 'clip-b', payload: { track: 'V1', at: 5 } },
      { op: 'clip.update', target: 'clip-b', payload: { hold: 3, mode: 'merge' } },
    ]);
  });
});

describe('visual helpers', () => {
  it('visualTrackIds lists only visual tracks; visualClips only clips on them', () => {
    const snapshot = makeSnapshot({
      tracks: [
        { id: 'V1', kind: 'visual', label: 'V1', muted: false },
        { id: 'A1', kind: 'audio', label: 'A1', muted: false },
      ],
      clips: [
        { id: 'c1', track: 'V1', at: 0, duration: 10 },
        { id: 'c2', track: 'A1', at: 0, duration: 10 },
        { id: 'c3', track: 'V1', at: 5, duration: 10 },
      ],
    });
    expect(visualTrackIds(snapshot)).toEqual(['V1']);
    expect(visualClips(snapshot).map((clip) => clip.id)).toEqual(['c1', 'c3']);
  });
});

// Codex sense-check MUST-FIX 1: the render-time snapshot cache must invalidate
// when the LIVE config version advances (receipt-only ack — data untouched),
// when the backing document is replaced (undo/reload/poll adoption), and on
// any marker-list write — while still serving repeated render-time reads from
// the cache so the O(clips) projection is not rebuilt per editor render.
describe('readTimelineSnapshot cache invalidation', () => {
  function makeCtxWithReader(reader: TimelineReader): ExtensionContext {
    return createExtensionContext(
      scenePhaseMarkersExtension,
      { timeline: makeOps().ops, reader },
    );
  }

  it('serves repeated render-time reads from the cache (projection built once)', () => {
    let snapshotCalls = 0;
    const reader: TimelineReader = {
      snapshot: () => {
        snapshotCalls += 1;
        return makeSnapshot({
          app: {
            [SCENE_PHASE_EXTENSION_ID]: {
              [MARKERS_DATA_KEY]: [{ id: 'm1', time: 1 }],
            },
          },
        });
      },
      configVersion: () => 7,
      documentRevision: () => 'doc-1',
    };
    const ctx = makeCtxWithReader(reader);

    const first = readTimelineSnapshot(ctx);
    const second = readTimelineSnapshot(ctx);
    const third = readTimelineSnapshot(ctx);

    expect(snapshotCalls).toBe(1);
    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(readMarkers(first!, SCENE_PHASE_EXTENSION_ID)).toEqual([{ id: 'm1', time: 1 }]);
  });

  it('rebuilds when the LIVE config version advances (receipt-only ack)', () => {
    let liveVersion = 7;
    let snapshotBaseVersion = 7;
    const reader: TimelineReader = {
      snapshot: () => makeSnapshot({ baseVersion: snapshotBaseVersion, currentVersion: snapshotBaseVersion }),
      configVersion: () => liveVersion,
      documentRevision: () => 'doc-1',
    };
    const ctx = makeCtxWithReader(reader);

    const before = readTimelineSnapshot(ctx)!;
    expect(before.baseVersion).toBe(7);
    // Cache hit: version/reader/revision all unchanged.
    expect(readTimelineSnapshot(ctx)).toBe(before);

    // A save receipt advances the version channel WITHOUT touching the data
    // object (the ack bug this regression guards): the next render must not
    // be served the stale cached snapshot.
    liveVersion = 8;
    snapshotBaseVersion = 8;
    const after = readTimelineSnapshot(ctx)!;
    expect(after).not.toBe(before);
    expect(after.baseVersion).toBe(8);
  });

  it('rebuilds when the document is replaced (undo/reload) even if the version is unchanged', () => {
    let document: { id: string; markers: ScenePhaseMarker[] } = {
      id: 'doc-a',
      markers: [{ id: 'old', time: 1 }],
    };
    const reader: TimelineReader = {
      snapshot: () => makeSnapshot({
        app: {
          [SCENE_PHASE_EXTENSION_ID]: { [MARKERS_DATA_KEY]: document.markers },
        },
      }),
      // The replaced document happens to carry the same version: the cache
      // key must still notice the replacement via the document revision.
      configVersion: () => 7,
      documentRevision: () => document,
    };
    const ctx = makeCtxWithReader(reader);

    const before = readTimelineSnapshot(ctx)!;
    expect(readMarkers(before, SCENE_PHASE_EXTENSION_ID)).toEqual([{ id: 'old', time: 1 }]);

    // Undo replaces the backing document object; version stays 7.
    document = { id: 'doc-b', markers: [{ id: 'new', time: 9 }] };
    const after = readTimelineSnapshot(ctx)!;
    expect(after).not.toBe(before);
    expect(readMarkers(after, SCENE_PHASE_EXTENSION_ID)).toEqual([{ id: 'new', time: 9 }]);
  });

  it('rebuilds after a marker-list write (notifyMarkersChanged bumps the revision)', () => {
    let storedMarkers: ScenePhaseMarker[] = [{ id: 'm1', time: 1 }];
    const reader: TimelineReader = {
      snapshot: () => makeSnapshot({
        app: {
          [SCENE_PHASE_EXTENSION_ID]: { [MARKERS_DATA_KEY]: storedMarkers },
        },
      }),
      configVersion: () => 7,
      documentRevision: () => 'doc-1',
    };
    const ctx = makeCtxWithReader(reader);

    const before = readTimelineSnapshot(ctx)!;
    expect(readMarkers(before, SCENE_PHASE_EXTENSION_ID)).toHaveLength(1);

    // Marker add / drag-commit / clear all funnel through this notification.
    storedMarkers = [...storedMarkers, { id: 'm2', time: 2 }];
    notifyMarkersChanged();
    const after = readTimelineSnapshot(ctx)!;
    expect(after).not.toBe(before);
    expect(readMarkers(after, SCENE_PHASE_EXTENSION_ID)).toHaveLength(2);
  });

  it('does not cache a null (timeline-not-ready) result', () => {
    let ready = false;
    const reader: TimelineReader = {
      snapshot: () => {
        if (!ready) {
          throw new Error('Timeline data is not ready.');
        }
        return makeSnapshot();
      },
      configVersion: () => 7,
      documentRevision: () => 'doc-1',
    };
    const ctx = makeCtxWithReader(reader);

    expect(readTimelineSnapshot(ctx)).toBeNull();
    // A later successful read is never masked by the uncached null.
    ready = true;
    expect(readTimelineSnapshot(ctx)).not.toBeNull();
  });
});
