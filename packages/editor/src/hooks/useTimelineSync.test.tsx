// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineSync } from './useTimelineSync.js';
import type { PreviewHandle, TimelineCanvasHandle } from './render-types.js';
import type { RefObject } from 'react';

describe('useTimelineSync', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof requestAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('syncs preview time updates into the timeline and throttled current time state', () => {
    const setTime = vi.fn();
    const seek = vi.fn();
    const setCurrentTime = vi.fn();
    const timelineRef = {
      current: { setTime },
    } as RefObject<TimelineCanvasHandle | null>;
    const previewRef = {
      current: { seek, play: vi.fn(), pause: vi.fn() },
    } as RefObject<PreviewHandle | null>;
    const isSyncingFromPreview = { current: false };
    const isSyncingFromTimeline = { current: false };

    const nowSpy = vi.spyOn(performance, 'now');

    const { result } = renderHook(() => useTimelineSync({
      timelineRef,
      previewRef,
      setCurrentTime,
      isSyncingFromPreview,
      isSyncingFromTimeline,
    }));

    act(() => {
      nowSpy.mockReturnValueOnce(1000);
      result.current.onPreviewTimeUpdate(1.25);
    });

    act(() => {
      nowSpy.mockReturnValueOnce(1100);
      result.current.onPreviewTimeUpdate(1.5);
    });

    act(() => {
      nowSpy.mockReturnValueOnce(1400);
      result.current.onPreviewTimeUpdate(2);
    });

    expect(setTime).toHaveBeenCalledTimes(3);
    expect(setTime).toHaveBeenNthCalledWith(1, 1.25);
    expect(setTime).toHaveBeenNthCalledWith(2, 1.5);
    expect(setTime).toHaveBeenNthCalledWith(3, 2);
    expect(setCurrentTime).toHaveBeenCalledTimes(2);
    expect(setCurrentTime).toHaveBeenNthCalledWith(1, 1.25);
    expect(setCurrentTime).toHaveBeenNthCalledWith(2, 2);
    expect(isSyncingFromPreview.current).toBe(false);
  });

  it('keeps preview and timeline drag updates from feeding back into each other', () => {
    const setTime = vi.fn();
    const seek = vi.fn();
    const setCurrentTime = vi.fn();
    const timelineRef = {
      current: { setTime },
    } as RefObject<TimelineCanvasHandle | null>;
    const previewRef = {
      current: { seek, play: vi.fn(), pause: vi.fn() },
    } as RefObject<PreviewHandle | null>;
    const isSyncingFromPreview = { current: false };
    const isSyncingFromTimeline = { current: true };

    const { result } = renderHook(() => useTimelineSync({
      timelineRef,
      previewRef,
      setCurrentTime,
      isSyncingFromPreview,
      isSyncingFromTimeline,
    }));

    act(() => {
      result.current.onPreviewTimeUpdate(3);
    });

    expect(setTime).not.toHaveBeenCalled();
    expect(setCurrentTime).not.toHaveBeenCalled();

    isSyncingFromTimeline.current = false;
    isSyncingFromPreview.current = true;

    act(() => {
      result.current.onCursorDrag(4);
    });

    expect(seek).not.toHaveBeenCalled();

    isSyncingFromPreview.current = false;

    act(() => {
      result.current.onCursorDrag(5);
      result.current.onClickTimeArea(6);
    });

    expect(seek).toHaveBeenNthCalledWith(1, 5);
    expect(seek).toHaveBeenNthCalledWith(2, 6);
    expect(setCurrentTime).toHaveBeenNthCalledWith(1, 5);
    expect(setCurrentTime).toHaveBeenNthCalledWith(2, 6);
    expect(isSyncingFromTimeline.current).toBe(false);
  });
});
