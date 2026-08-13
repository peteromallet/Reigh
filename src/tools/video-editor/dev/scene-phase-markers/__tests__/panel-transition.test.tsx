/**
 * Panel-transition regression: the footer panel must survive the timeline
 * not-ready → ready transition without a React hook-count mismatch.
 *
 * `reader.snapshot()` throws while timeline data is not loaded; the panel
 * renders an inert placeholder. When data arrives the panel re-renders with
 * the full UI. If hooks were declared after the early return, the second
 * render would throw "Rendered more hooks than during the previous render"
 * and the panel would land in the host error boundary.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  TimelineOps,
  TimelinePatch,
  TimelineReader,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import { createExtensionContext } from '@/tools/video-editor/runtime/extensionContextFactory';
import { ScenePhaseMarkersPanel } from '../ScenePhaseMarkersPanel';
import {
  MARKERS_DATA_KEY,
  SCENE_PHASE_EXTENSION_ID,
  scenePhaseMarkersExtension,
  subscribeMarkersChanged,
  type ScenePhaseMarker,
} from '../extension';

function makeSnapshot(): TimelineSnapshot {
  return {
    projectId: null,
    baseVersion: 1,
    currentVersion: 1,
    extensionRequirements: [],
    clips: [],
    tracks: [
      { id: 'V1', kind: 'visual', label: 'V1', muted: false },
      { id: 'A1', kind: 'audio', label: 'A1', muted: false },
    ],
    assetKeys: [],
    app: {},
  };
}

function makeOps(): TimelineOps {
  return {
    validate: () => ({ valid: true, diagnostics: [] }),
    preview: () => ({
      diff: { version: 0, entries: [], affectedObjectIds: [] },
      fullyPreviewable: true,
      diagnostics: [],
    }),
    apply: () => ({ version: 0, entries: [], affectedObjectIds: [] }),
    checkpoint: () => 'ckpt',
    rollback: () => null,
    setAllTracksMuted: () => ({ version: 0, entries: [], affectedObjectIds: [] }),
  };
}

describe('ScenePhaseMarkersPanel transition', () => {
  it('renders the placeholder while data is not ready, then the full panel without crashing', () => {
    let snapshotCalls = 0;
    const reader: TimelineReader = {
      snapshot: () => {
        snapshotCalls += 1;
        if (snapshotCalls === 1) {
          throw new Error('Timeline data is not ready.');
        }
        return makeSnapshot();
      },
    };

    const ctx = createExtensionContext(
      scenePhaseMarkersExtension,
      { timeline: makeOps(), reader },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { registerRenderer: () => ({ dispose: () => {} }) },
    );

    const { rerender } = render(
      <ScenePhaseMarkersPanel ctx={ctx} playback={{ currentTime: 0 }} />,
    );
    expect(screen.getByText(/timeline not ready/i)).toBeTruthy();

    // Data arrives: the panel must re-render with the full UI, not crash on
    // a hook-count mismatch (hooks are declared before the early return).
    rerender(<ScenePhaseMarkersPanel ctx={ctx} playback={{ currentTime: 1.5 }} />);
    expect(screen.getByTestId('scene-markers-mark-button')).toBeTruthy();
    expect(screen.getByText(/no markers/i)).toBeTruthy();
    expect(snapshotCalls).toBeGreaterThanOrEqual(2);
  });

  it('Clear builds its patch from a FRESH snapshot (post-ack baseVersion) and notifies marker subscribers', () => {
    // A save receipt advances the live version channel WITHOUT touching the
    // data slice: the render-time cached snapshot still carries the OLD
    // baseVersion. Clear must re-snapshot so its CAS write does not fail
    // stale-version rejection — and must notify subscribers so the overlay
    // drops the cleared markers without a host re-render.
    let liveVersion = 1;
    let baseVersion = 1;
    let storedMarkers: ScenePhaseMarker[] = [{ id: 'm1', time: 2 }];
    const applied: TimelinePatch[] = [];
    const ops: TimelineOps = {
      ...makeOps(),
      apply: (patch) => {
        applied.push(patch);
        return { version: patch.version, entries: [], affectedObjectIds: [] };
      },
    };
    const reader: TimelineReader = {
      snapshot: () => ({
        ...makeSnapshot(),
        baseVersion,
        currentVersion: baseVersion,
        app: {
          [SCENE_PHASE_EXTENSION_ID]: {
            [MARKERS_DATA_KEY]: storedMarkers,
          },
        },
      }),
      configVersion: () => liveVersion,
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
      { registerRenderer: () => ({ dispose: () => {} }) },
    );

    render(<ScenePhaseMarkersPanel ctx={ctx} playback={{ currentTime: 0 }} />);
    expect(screen.getByText(/1 marker/)).toBeTruthy();

    // The ack lands between renders: live version advances, data untouched.
    liveVersion = 5;
    baseVersion = 5;

    const onMarkersChanged = vi.fn();
    const subscription = subscribeMarkersChanged(onMarkersChanged);
    fireEvent.click(screen.getByTestId('scene-markers-clear'));

    // Patch built from the FRESH snapshot's baseVersion, not the cached 1.
    expect(applied).toHaveLength(1);
    expect(applied[0]!.version).toBe(5);
    const value = (applied[0]!.operations[0]!.payload as Record<string, unknown>).value as ScenePhaseMarker[];
    expect(value).toEqual([]);
    // Subscribers (the overlay's useSyncExternalStore) were notified.
    expect(onMarkersChanged).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });
});
