/**
 * ScenePhaseMarkersOverlay — ruler marker canary tests.
 *
 * Covers the overlay's contract with the host marker layer:
 * - persisted markers are rendered through `primitives.markerLayer`
 * - the playhead store is subscribed to (no preview DOM attribute reads)
 * - preview changes stay local: zero writes, merged into the local list
 * - a commit performs EXACTLY one write, built from a FRESH snapshot's
 *   baseVersion, replacing one marker and re-sorting
 * - marker-list writes (e.g. the B-key mark) refresh the overlay through
 *   the local change subscription without a host re-render
 */

import { act, render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  TimelineMarkerLayerOptions,
  TimelineOps,
  TimelineOverlayPrimitives,
  TimelineOverlayRenderProps,
  TimelineReader,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import { createTimelineOverlayGeometry } from '@reigh/editor-sdk';
import { createTimelineOverlayStores } from '@/tools/video-editor/lib/timeline-overlay-stores.ts';
import { createTimelineViewStore, type TimelineViewStoreApi } from '@/tools/video-editor/lib/timeline-view-store.ts';
import { createExtensionContext } from '@/tools/video-editor/runtime/extensionContextFactory';
import { ScenePhaseMarkersOverlay } from '../ScenePhaseMarkersOverlay';
import {
  MARKERS_DATA_KEY,
  SCENE_PHASE_EXTENSION_ID,
  markPhaseAtPlayhead,
  scenePhaseMarkersExtension,
  type ScenePhaseMarker,
} from '../extension';

const geometry = createTimelineOverlayGeometry({
  scale: 10,
  scaleWidth: 100,
  startLeft: 60,
  extentStart: 0,
  extentEnd: 100,
});

function makeSnapshot(
  baseVersion: number,
  markers: ScenePhaseMarker[],
): TimelineSnapshot {
  return {
    projectId: null,
    baseVersion,
    currentVersion: baseVersion,
    extensionRequirements: [],
    clips: [],
    tracks: [],
    assetKeys: [],
    app: {
      [SCENE_PHASE_EXTENSION_ID]: {
        [MARKERS_DATA_KEY]: markers,
      },
    },
  };
}

interface TimelineHarness {
  ctx: ReturnType<typeof createExtensionContext>;
  timelineView: TimelineViewStoreApi;
  applied: TimelinePatchLike[];
  setBaseVersion: (version: number) => void;
  stored: () => ScenePhaseMarker[];
  markAt: (time: number) => void;
}

interface TimelinePatchLike {
  version: number;
  source: string;
  operations: Array<{ op: string; target: string; payload: Record<string, unknown> }>;
}

/** A timeline whose stored markers mutate as patches are applied. */
function makeTimelineHarness(initialMarkers: ScenePhaseMarker[]): TimelineHarness {
  let baseVersion = 7;
  let stored: ScenePhaseMarker[] = [...initialMarkers];
  const applied: TimelinePatchLike[] = [];

  const ops: TimelineOps = {
    validate: () => ({ valid: true, diagnostics: [] }),
    preview: () => ({
      diff: { version: 0, entries: [], affectedObjectIds: [] },
      fullyPreviewable: true,
      diagnostics: [],
    }),
    apply: (patch) => {
      applied.push(patch as unknown as TimelinePatchLike);
      for (const operation of patch.operations) {
        if (operation.op === 'project-data.write') {
          const payload = operation.payload as Record<string, unknown> | undefined;
          if (payload?.key === MARKERS_DATA_KEY && payload.mode === 'replace') {
            stored = (payload.value as ScenePhaseMarker[]).map((marker) => ({ ...marker }));
          }
        }
      }
      return { version: patch.version, entries: [], affectedObjectIds: [] };
    },
    checkpoint: () => 'ckpt',
    rollback: () => null,
    setAllTracksMuted: () => ({ version: 0, entries: [], affectedObjectIds: [] }),
  };

  const reader: TimelineReader = {
    snapshot: () => makeSnapshot(baseVersion, stored),
  };

  // Provider-owned timeline view store: the B-key command reads the playhead
  // from here, renderer-independently.
  const timelineView = createTimelineViewStore();

  const ctx = createExtensionContext(
    scenePhaseMarkersExtension,
    { timeline: ops, reader, timelineView },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  return {
    ctx,
    applied,
    timelineView,
    setBaseVersion: (version) => { baseVersion = version; },
    stored: () => stored,
    markAt: (time) => {
      // Reuse the real B-key path so notifyMarkersChanged() fires. The host
      // publishes the playhead into the provider store; the command reads it.
      timelineView.publish({
        playhead: { time, isPlaying: false },
        surfaceMounted: true,
      });
      markPhaseAtPlayhead(ctx);
    },
  };
}

interface OverlayHarness {
  props: TimelineOverlayRenderProps;
  markerLayer: ReturnType<typeof vi.fn>;
  lastOptions: () => TimelineMarkerLayerOptions;
}

function makeOverlayHarness(): OverlayHarness {
  const stores = createTimelineOverlayStores({
    viewport: { scheduleFrame: (callback) => { callback(); return 1; } },
  });
  const markerLayer = vi.fn(() => null);
  const primitives: TimelineOverlayPrimitives = {
    markerLayer: markerLayer as unknown as TimelineOverlayPrimitives['markerLayer'],
  };
  const props: TimelineOverlayRenderProps = {
    geometry,
    viewport: stores.viewport,
    playhead: stores.playhead,
    selection: { selectedClipIds: new Set<string>(), hasSelection: false },
    pointerClaimed: false,
    claimPointer: () => true,
    releasePointer: () => {},
    primitives,
  };
  return {
    props,
    markerLayer,
    lastOptions: () =>
      markerLayer.mock.calls.at(-1)![0] as TimelineMarkerLayerOptions,
  };
}

afterEach(() => {
  cleanup();
});

describe('ScenePhaseMarkersOverlay', () => {
  it('renders persisted markers through primitives.markerLayer', () => {
    const harness = makeTimelineHarness([
      { id: 'm1', time: 2 },
      { id: 'm2', time: 8 },
    ]);
    const overlay = makeOverlayHarness();

    render(<ScenePhaseMarkersOverlay ctx={harness.ctx} props={overlay.props} />);

    expect(overlay.markerLayer).toHaveBeenCalledTimes(1);
    const options = overlay.lastOptions();
    expect(options.placement).toBe('ruler');
    expect(options.interactive).toBe(true);
    expect(options.snap).toBe(true);
    expect(options.markers.map((marker) => ({ id: marker.id, time: marker.time }))).toEqual([
      { id: 'm1', time: 2 },
      { id: 'm2', time: 8 },
    ]);
  });

  it('reads the playhead from the provider-owned timeline view store (renderer-independent)', () => {
    const harness = makeTimelineHarness([]);
    const overlay = makeOverlayHarness();

    render(<ScenePhaseMarkersOverlay ctx={harness.ctx} props={overlay.props} />);

    // The host publishes a playhead update through the provider store.
    act(() => {
      harness.timelineView.publish({
        playhead: { time: 12.5, isPlaying: false },
        surfaceMounted: true,
      });
    });

    // The B command reads the same store: no renderer mount required.
    act(() => {
      markPhaseAtPlayhead(harness.ctx);
    });
    const patch = harness.applied.at(-1)!;
    const value = patch.operations[0]!.payload.value as ScenePhaseMarker[];
    expect(value[0]!.time).toBe(12.5);
  });

  it('keeps previews local: zero writes, merged into the rendered list', () => {
    const harness = makeTimelineHarness([
      { id: 'm1', time: 2 },
      { id: 'm2', time: 8 },
    ]);
    const overlay = makeOverlayHarness();

    render(<ScenePhaseMarkersOverlay ctx={harness.ctx} props={overlay.props} />);
    const onChange = overlay.lastOptions().onChange!;

    act(() => {
      onChange({ id: 'm2', time: 3.5, phase: 'preview' });
    });

    // Zero writes during preview…
    expect(harness.applied).toHaveLength(0);
    // …and the preview is merged into the local marker list.
    const options = overlay.lastOptions();
    const moved = options.markers.find((marker) => marker.id === 'm2')!;
    expect(moved.time).toBe(3.5);
    // The other marker is untouched.
    expect(options.markers.find((marker) => marker.id === 'm1')!.time).toBe(2);
  });

  it('commits exactly one write from a fresh snapshot, replacing one marker and sorting', () => {
    const harness = makeTimelineHarness([
      { id: 'm1', time: 2 },
      { id: 'm2', time: 8 },
      { id: 'm3', time: 5 },
    ]);
    const overlay = makeOverlayHarness();

    render(<ScenePhaseMarkersOverlay ctx={harness.ctx} props={overlay.props} />);
    const onChange = overlay.lastOptions().onChange!;

    // A preview happened first and must not persist.
    act(() => {
      onChange({ id: 'm2', time: 0.25, phase: 'preview' });
    });
    expect(harness.applied).toHaveLength(0);

    // The timeline moved on while dragging: the commit must use the FRESH
    // baseVersion, not the render-time one.
    harness.setBaseVersion(11);
    act(() => {
      onChange({ id: 'm2', time: 0.25, phase: 'commit' });
    });

    expect(harness.applied).toHaveLength(1);
    const patch = harness.applied[0]!;
    expect(patch.version).toBe(11);
    expect(patch.operations).toHaveLength(1);
    expect(patch.operations[0]!.op).toBe('project-data.write');
    const value = patch.operations[0]!.payload.value as ScenePhaseMarker[];
    // One marker replaced, array re-sorted by time.
    expect(value).toEqual([
      { id: 'm2', time: 0.25 },
      { id: 'm1', time: 2 },
      { id: 'm3', time: 5 },
    ]);
    // The stored timeline now reflects the committed move.
    expect(harness.stored()).toEqual([
      { id: 'm2', time: 0.25 },
      { id: 'm1', time: 2 },
      { id: 'm3', time: 5 },
    ]);
  });

  it('committing an unknown marker id performs no write', () => {
    const harness = makeTimelineHarness([{ id: 'm1', time: 2 }]);
    const overlay = makeOverlayHarness();

    render(<ScenePhaseMarkersOverlay ctx={harness.ctx} props={overlay.props} />);
    const onChange = overlay.lastOptions().onChange!;

    act(() => {
      onChange({ id: 'ghost', time: 9, phase: 'commit' });
    });
    expect(harness.applied).toHaveLength(0);
  });

  it('refreshes when markers change locally (B-key mark while paused)', () => {
    const harness = makeTimelineHarness([{ id: 'm1', time: 2 }]);
    const overlay = makeOverlayHarness();

    render(<ScenePhaseMarkersOverlay ctx={harness.ctx} props={overlay.props} />);
    expect(overlay.lastOptions().markers).toHaveLength(1);

    // Press B at 6s: markPhaseAtPlayhead writes and notifies locally.
    act(() => {
      harness.markAt(6);
    });

    // The overlay re-renders without any host involvement and shows both.
    const options = overlay.lastOptions();
    expect(options.markers.map((marker) => marker.time)).toEqual([2, 6]);
  });

  it('disposal/unmount never touches project data', () => {
    const harness = makeTimelineHarness([
      { id: 'm1', time: 2 },
      { id: 'm2', time: 8 },
    ]);
    const overlay = makeOverlayHarness();

    const { unmount } = render(
      <ScenePhaseMarkersOverlay ctx={harness.ctx} props={overlay.props} />,
    );
    unmount();

    expect(harness.applied).toHaveLength(0);
    expect(harness.stored()).toEqual([
      { id: 'm1', time: 2 },
      { id: 'm2', time: 8 },
    ]);
  });
});
