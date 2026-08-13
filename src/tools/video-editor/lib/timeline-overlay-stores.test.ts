/**
 * timeline-overlay-stores — unit tests for the provider-local viewport /
 * playhead stores and the imperative frame-time channel.
 *
 * Acceptance mapping:
 * - Multiple viewport writes in one frame publish one final snapshot.
 * - React playhead subscribers publish at no more than four times per
 *   second (the existing ≤250 ms cadence), with an immediate seek/scrub
 *   bypass.
 * - Frame-time subscribers receive every supplied update without per-frame
 *   React snapshot churn.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  TimelinePlayheadStore,
  TimelineViewportStore,
} from '@/sdk/video/families/timelineOverlays';
import {
  createTimelineFrameTimeChannel,
  createTimelineOverlayStores,
  createTimelinePlayheadStore,
  createTimelineViewportStore,
} from './timeline-overlay-stores';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Captures rAF callbacks so tests can drive animation frames
 * deterministically instead of waiting on real timers.
 */
function createFrameHarness() {
  const frames: FrameRequestCallback[] = [];
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => 0);
  return {
    raf,
    caf,
    frames,
    /** Execute the oldest queued frame, simulating a rAF tick. */
    tick(timestamp = 16): void {
      const callback = frames.shift();
      if (!callback) {
        throw new Error('no rAF frame was scheduled');
      }
      callback(timestamp);
    },
  };
}

const ZEROED_VIEWPORT = {
  scrollLeft: 0,
  scrollTop: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  totalWidth: 0,
  totalHeight: 0,
};

describe('createTimelineViewportStore', () => {
  it('publishes one final snapshot for many updates within a single frame', () => {
    const harness = createFrameHarness();
    const store = createTimelineViewportStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.update({ scrollLeft: 10, scrollTop: 20 });
    store.update({ scrollLeft: 30 });
    store.update({ scrollLeft: 40, viewportWidth: 800, totalWidth: 4000 });

    // All three writes coalesce onto exactly one scheduled frame, and the
    // writes themselves never notify synchronously.
    expect(harness.raf).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();

    harness.tick();

    // The single flush publishes exactly one snapshot with merged values.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({
      scrollLeft: 40,
      scrollTop: 20,
      viewportWidth: 800,
      viewportHeight: 0,
      totalWidth: 4000,
      totalHeight: 0,
    });
    unsubscribe.dispose();
  });

  it('keeps the published snapshot identity stable between frames', () => {
    const harness = createFrameHarness();
    const store = createTimelineViewportStore();
    store.update({ scrollLeft: 10 });
    harness.tick();

    const published = store.getSnapshot();
    expect(store.getSnapshot()).toBe(published);
    expect(store.getSnapshot()).toBe(published);

    // A later frame with a real change replaces the identity exactly once.
    store.update({ scrollLeft: 20 });
    harness.tick();
    expect(store.getSnapshot()).not.toBe(published);
    expect(store.getSnapshot().scrollLeft).toBe(20);
  });

  it('does not notify when the coalesced frame equals the last published snapshot', () => {
    const harness = createFrameHarness();
    const store = createTimelineViewportStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.update({ scrollLeft: 10 });
    harness.tick();
    expect(listener).toHaveBeenCalledTimes(1);
    const published = store.getSnapshot();

    // A change followed by a revert within the same frame nets out to the
    // published values: the flush publishes nothing and the identity holds.
    store.update({ scrollLeft: 20 });
    store.update({ scrollLeft: 10 });
    expect(harness.raf).toHaveBeenCalledTimes(2);
    harness.tick();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(published);
  });

  it('skips scheduling a frame for a no-op update', () => {
    const harness = createFrameHarness();
    const store = createTimelineViewportStore({
      initial: {
        scrollLeft: 5,
        scrollTop: 0,
        viewportWidth: 800,
        viewportHeight: 600,
        totalWidth: 2000,
        totalHeight: 1000,
      },
    });
    const listener = vi.fn();
    store.subscribe(listener);

    store.update({ scrollLeft: 5 }); // equals the initial snapshot

    expect(harness.raf).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot().scrollLeft).toBe(5);
  });

  it('starts from the provided initial snapshot', () => {
    const store = createTimelineViewportStore({
      initial: {
        scrollLeft: 100,
        scrollTop: 200,
        viewportWidth: 1280,
        viewportHeight: 720,
        totalWidth: 5000,
        totalHeight: 1500,
      },
    });
    expect(store.getSnapshot()).toEqual({
      scrollLeft: 100,
      scrollTop: 200,
      viewportWidth: 1280,
      viewportHeight: 720,
      totalWidth: 5000,
      totalHeight: 1500,
    });
  });

  it('defaults to a zeroed viewport snapshot', () => {
    const store = createTimelineViewportStore();
    expect(store.getSnapshot()).toEqual(ZEROED_VIEWPORT);
  });

  it('merges subsequent frames from the published snapshot', () => {
    const harness = createFrameHarness();
    const store = createTimelineViewportStore();

    store.update({ scrollLeft: 10 });
    harness.tick();
    store.update({ scrollTop: 25 }); // scrollLeft must survive the merge
    harness.tick();

    expect(store.getSnapshot()).toEqual({
      scrollLeft: 10,
      scrollTop: 25,
      viewportWidth: 0,
      viewportHeight: 0,
      totalWidth: 0,
      totalHeight: 0,
    });
  });

  it('dispose cancels the pending frame, ignores later writes, and stops notifications', () => {
    const harness = createFrameHarness();
    const store = createTimelineViewportStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.update({ scrollLeft: 10 });
    store.dispose();

    expect(harness.caf).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();

    // A stale frame firing after dispose must not notify.
    harness.tick();
    expect(listener).not.toHaveBeenCalled();

    // Writes after dispose are ignored entirely.
    store.update({ scrollLeft: 99 });
    expect(harness.raf).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns an idempotent dispose handle from subscribe', () => {
    const harness = createFrameHarness();
    const store = createTimelineViewportStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe.dispose();
    unsubscribe.dispose();

    store.update({ scrollLeft: 1 });
    harness.tick();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createTimelinePlayheadStore', () => {
  it('publishes the first position immediately (mount/seek path)', () => {
    const now = 0;
    const store = createTimelinePlayheadStore({ now: () => now });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(12.5, false);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ time: 12.5, isPlaying: false });
  });

  it('publishes React snapshots at no more than the 250 ms cadence', () => {
    let now = 0;
    const store = createTimelinePlayheadStore({ now: () => now });
    const publishTimes: number[] = [];
    store.subscribe(() => publishTimes.push(now));

    store.set(0, false);
    // ~1 second of 60 Hz playback updates (60 ticks × 16 ms ≈ 960 ms).
    for (let tick = 1; tick <= 60; tick += 1) {
      now += 16;
      store.set(tick / 60, true);
    }

    // Initial publish plus one per 250 ms window: at most four
    // React-visible publishes in the simulated second.
    expect(publishTimes.length).toBeLessThanOrEqual(4);
    expect(publishTimes[0]).toBe(0);
    for (let index = 1; index < publishTimes.length; index += 1) {
      expect(publishTimes[index] - publishTimes[index - 1]).toBeGreaterThanOrEqual(250);
    }
  });

  it('keeps the published snapshot identity stable between publishes', () => {
    let now = 0;
    const store = createTimelinePlayheadStore({ now: () => now });
    store.set(1, false);
    const published = store.getSnapshot();

    // Throttled 60 Hz writes within the cadence window: no new identity.
    for (let tick = 0; tick < 10; tick += 1) {
      now += 16;
      store.set(1 + tick / 10, true);
    }
    expect(store.getSnapshot()).toBe(published);
    expect(store.getSnapshot()).toEqual({ time: 1, isPlaying: false });

    // Once the cadence elapses, the latest position publishes as a new
    // immutable snapshot.
    now += 250;
    store.set(2.5, true);
    expect(store.getSnapshot()).not.toBe(published);
    expect(store.getSnapshot()).toEqual({ time: 2.5, isPlaying: true });
  });

  it('publishNow bypasses the cadence for explicit seeks and scrubs', () => {
    let now = 0;
    const store = createTimelinePlayheadStore({ now: () => now });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(1, false);
    now += 100;
    store.set(2, false); // inside the window → throttled
    expect(listener).toHaveBeenCalledTimes(1);

    store.publishNow(); // seek — immediate React publish
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toEqual({ time: 2, isPlaying: false });

    now += 100;
    store.set(3, true); // still inside the window after publishNow
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toEqual({ time: 2, isPlaying: false });

    now += 200; // 300 ms since publishNow → cadence publish
    store.set(4, true);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot()).toEqual({ time: 4, isPlaying: true });
  });

  it('dispose stops all future notifications', () => {
    let now = 0;
    const store = createTimelinePlayheadStore({ now: () => now });
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispose();
    now += 1000;
    store.set(9, true);
    store.publishNow();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createTimelineFrameTimeChannel', () => {
  it('delivers every supplied update, including duplicates, to every subscriber', () => {
    const channel = createTimelineFrameTimeChannel();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = channel.subscribe(first);
    channel.subscribe(second);

    const update = { timestamp: 16, scrollLeft: 100, scrollTop: 50 };
    channel.publish(update);
    channel.publish(update); // identical update still delivered
    channel.publish({ timestamp: 32, scrollLeft: 120, scrollTop: 60 });

    expect(first).toHaveBeenCalledTimes(3);
    expect(second).toHaveBeenCalledTimes(3);
    expect(first.mock.calls[1]![0]).toBe(update);

    unsubscribeFirst.dispose();
    channel.publish({ timestamp: 48, scrollLeft: 140, scrollTop: 70 });
    expect(first).toHaveBeenCalledTimes(3);
    expect(second).toHaveBeenCalledTimes(4);
  });

  it('delivers updates synchronously in publish order', () => {
    const channel = createTimelineFrameTimeChannel();
    const received: TimelineFrameTimeUpdate[] = [];
    channel.subscribe((update) => received.push(update));

    channel.publish({ timestamp: 0, scrollLeft: 0, scrollTop: 0 });
    channel.publish({ timestamp: 16, scrollLeft: 32, scrollTop: 8 });
    channel.publish({ timestamp: 32, scrollLeft: 64, scrollTop: 16 });

    expect(received).toEqual([
      { timestamp: 0, scrollLeft: 0, scrollTop: 0 },
      { timestamp: 16, scrollLeft: 32, scrollTop: 8 },
      { timestamp: 32, scrollLeft: 64, scrollTop: 16 },
    ]);
  });

  it('does not churn React viewport snapshots when frame-time updates are published', () => {
    const stores = createTimelineOverlayStores();
    const viewportListener = vi.fn();
    const channelListener = vi.fn();
    stores.viewport.subscribe(viewportListener);
    stores.frameTime.subscribe(channelListener);

    const snapshotBefore = stores.viewport.getSnapshot();

    for (let frame = 0; frame < 10; frame += 1) {
      stores.frameTime.publish({
        timestamp: frame * 16,
        scrollLeft: frame * 8,
        scrollTop: 0,
      });
    }

    // Every supplied update reaches frame-time subscribers...
    expect(channelListener).toHaveBeenCalledTimes(10);
    expect(channelListener.mock.calls[9]![0]).toEqual({
      timestamp: 144,
      scrollLeft: 72,
      scrollTop: 0,
    });

    // ...and the viewport store is untouched: zero notifications and a
    // stable snapshot identity (no per-frame React churn).
    expect(viewportListener).not.toHaveBeenCalled();
    expect(stores.viewport.getSnapshot()).toBe(snapshotBefore);
    stores.viewport.dispose();
  });

  it('does not notify channel subscribers when the viewport updates', () => {
    const harness = createFrameHarness();
    const stores = createTimelineOverlayStores();
    const channelListener = vi.fn();
    stores.frameTime.subscribe(channelListener);

    stores.viewport.update({ scrollLeft: 42 });
    harness.tick();

    expect(channelListener).not.toHaveBeenCalled();
    stores.viewport.dispose();
  });
});

describe('createTimelineOverlayStores', () => {
  it('creates one viewport store, one playhead store, and one frame-time channel', () => {
    const stores = createTimelineOverlayStores();

    expect(stores.viewport.getSnapshot()).toEqual(ZEROED_VIEWPORT);
    expect(stores.playhead.getSnapshot()).toEqual({ time: 0, isPlaying: false });
    expect(typeof stores.frameTime.publish).toBe('function');
  });

  it('exposes stores that conform to the SDK viewport/playhead contracts', () => {
    const stores = createTimelineOverlayStores();
    const viewport: TimelineViewportStore = stores.viewport;
    const playhead: TimelinePlayheadStore = stores.playhead;

    expect(typeof viewport.getSnapshot).toBe('function');
    expect(typeof viewport.subscribe).toBe('function');
    expect(typeof playhead.getSnapshot).toBe('function');
    expect(typeof playhead.subscribe).toBe('function');

    const handle = viewport.subscribe(() => {});
    expect(typeof handle.dispose).toBe('function');
    handle.dispose();
    handle.dispose(); // idempotent
  });
});
