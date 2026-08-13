// @vitest-environment jsdom
/**
 * useDragCoordinator — sync-first-show hardening regression tests.
 *
 * The ghost used to render only via a deferred rAF. A burst-delivered fast
 * drag (move+up in the same tick — e.g. a save landing mid-drag coalescing
 * events) never got a frame before `end()` cancelled it, so the commit ran
 * with no visible ghost. Fix: the FIRST sample of each drag shows
 * SYNCHRONOUSLY (latch reset in end()); later samples keep rAF coalescing.
 */
import React, { useEffect, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DropIndicatorHandle } from '@/tools/video-editor/components/TimelineEditor/DropIndicator';
import { useDragCoordinator, type DragCoordinator } from './useDragCoordinator';
import type { DropPosition } from '@/tools/video-editor/lib/drop-position';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data';

// The position math is already covered elsewhere; this test targets the
// coordinator's show/hide cadence, so stub the pure computation.
const mocks = vi.hoisted(() => ({
  computeDropPosition: vi.fn(),
}));

vi.mock('@/tools/video-editor/lib/drop-position.ts', () => ({
  computeDropPosition: mocks.computeDropPosition,
}));

const makePosition = (clientX: number): DropPosition => ({
  time: clientX,
  rowIndex: 0,
  trackId: 'V1',
  trackKind: 'visual',
  trackName: 'V1',
  isNewTrack: false,
  isReject: false,
  newTrackKind: null,
  screenCoords: {
    rowTop: 0,
    rowLeft: 0,
    rowWidth: 100,
    rowHeight: 40,
    clipLeft: clientX,
    clipWidth: 20,
    ghostCenter: clientX * 2,
  },
});

interface HarnessApi {
  update: DragCoordinator['update'];
  end: () => void;
}

function renderCoordinator(): {
  api: HarnessApi;
  handle: { show: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn> };
  calls: string[];
} {
  const calls: string[] = [];
  const handle: DropIndicatorHandle = {
    show: vi.fn(() => { calls.push('show'); }),
    showSecondaryGhosts: vi.fn(),
    hide: vi.fn(() => { calls.push('hide'); }),
  };
  let api: HarnessApi = { update: () => makePosition(0), end: () => {} };

  function Harness() {
    const dataRef = useRef<TimelineData | null>(null);
    const { coordinator, indicatorRef, editAreaRef } = useDragCoordinator({
      dataRef,
      scale: 1,
      scaleWidth: 100,
      startLeft: 0,
      rowHeight: 40,
    });

    useEffect(() => {
      indicatorRef.current = handle;
      api = { update: coordinator.update, end: coordinator.end };
    }, [coordinator, indicatorRef]);

    return (
      <div className="timeline-wrapper">
        <div
          data-testid="edit-area"
          ref={editAreaRef as React.MutableRefObject<HTMLDivElement | null>}
        />
      </div>
    );
  }

  render(<Harness />);
  return { api, handle, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDragCoordinator — sync-first-show', () => {
  it('update(); end() WITHOUT draining frames still produces show before hide', () => {
    // Never run the rAF callback: this is the burst-delivered fast drag —
    // pointerup arrives in the same tick, end() cancels the pending frame.
    let rafCalls = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      rafCalls += 1;
      return rafCalls;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    mocks.computeDropPosition.mockReturnValue(makePosition(10));
    const { api, handle, calls } = renderCoordinator();

    act(() => {
      api.update({ clientX: 10, clientY: 10, sourceKind: 'visual' });
    });
    act(() => {
      api.end();
    });

    // The first sample showed SYNCHRONOUSLY — no frame was ever drained.
    expect(handle.show).toHaveBeenCalledTimes(1);
    expect(handle.hide).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['show', 'hide']);
    // The coalescing rAF was still scheduled for subsequent moves.
    expect(rafCalls).toBe(1);
  });

  it('subsequent samples coalesce through rAF (only the first sample shows synchronously)', () => {
    const rafQueue: Array<() => void> = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(() => cb(0));
      return rafQueue.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    mocks.computeDropPosition.mockImplementation((params: { clientX: number }) => makePosition(params.clientX));
    const { api, handle, calls } = renderCoordinator();

    act(() => {
      api.update({ clientX: 10, clientY: 10, sourceKind: 'visual' });
    });
    act(() => {
      api.update({ clientX: 20, clientY: 20, sourceKind: 'visual' });
    });
    // Second sample: no sync show (latch), no second frame (coalescing).
    expect(handle.show).toHaveBeenCalledTimes(1);
    expect(rafQueue).toHaveLength(1);

    // Draining the frame flushes the NEWEST position (not the first).
    act(() => {
      rafQueue.shift()!();
    });
    expect(handle.show).toHaveBeenCalledTimes(2);
    expect(handle.show.mock.calls[1]![0].lineLeft).toBe(40); // 20 * 2

    act(() => {
      api.end();
    });
    expect(calls).toEqual(['show', 'show', 'hide']);
  });

  it('end() resets the first-sample latch so the NEXT drag shows synchronously again', () => {
    let rafCalls = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      rafCalls += 1;
      return rafCalls;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    mocks.computeDropPosition.mockImplementation((params: { clientX: number }) => makePosition(params.clientX));
    const { api, handle, calls } = renderCoordinator();

    // Drag 1: sync show, then end without draining.
    act(() => { api.update({ clientX: 10, clientY: 10, sourceKind: 'visual' }); });
    act(() => { api.end(); });

    // Drag 2 (new session): the latch must be reset by end().
    act(() => { api.update({ clientX: 30, clientY: 30, sourceKind: 'visual' }); });
    expect(handle.show).toHaveBeenCalledTimes(2);
    expect(handle.show.mock.calls[1]![0].lineLeft).toBe(60);

    act(() => { api.end(); });
    expect(calls).toEqual(['show', 'hide', 'show', 'hide']);
  });
});
