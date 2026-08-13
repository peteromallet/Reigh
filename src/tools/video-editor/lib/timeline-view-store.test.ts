/**
 * createTimelineViewStore — provider-owned timeline view store tests.
 *
 * Covers the SDK read contract (stable identity, immutable frozen snapshots,
 * subscribe/dispose) and the host publish surface (partial merges, selection
 * copy-on-publish, empty reset after dispose).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyTimelineViewSnapshot,
  createTimelineViewStore,
  type TimelineViewStoreApi,
} from './timeline-view-store';
import type { TimelineViewSnapshot, TimelineViewStore } from '@/sdk/video/timeline/viewState';

describe('createTimelineViewStore', () => {
  it('publishes an empty snapshot with surfaceMounted false before any publish', () => {
    const store: TimelineViewStore = createTimelineViewStore();
    const snapshot = store.getSnapshot();
    expect(snapshot.playhead).toEqual({ time: 0, isPlaying: false });
    expect(snapshot.selection.hasSelection).toBe(false);
    expect(snapshot.selection.selectedClipIds.size).toBe(0);
    expect(snapshot.viewport).toBeNull();
    expect(snapshot.geometry).toBeNull();
    expect(snapshot.surfaceMounted).toBe(false);
  });

  it('keeps a stable snapshot reference between publishes (identity for useSyncExternalStore)', () => {
    const store = createTimelineViewStore();
    const first = store.getSnapshot();
    const second = store.getSnapshot();
    expect(second).toBe(first);
  });

  it('publishes a partial merge and freezes every member', () => {
    const store = createTimelineViewStore();
    store.publish({
      playhead: { time: 12.5, isPlaying: true },
      surfaceMounted: true,
    });
    const snapshot = store.getSnapshot();
    expect(snapshot.playhead).toEqual({ time: 12.5, isPlaying: true });
    expect(snapshot.surfaceMounted).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.playhead)).toBe(true);
  });

  it('copies the selection set on publish (no shared mutable Set with the publisher)', () => {
    const store = createTimelineViewStore();
    const original = new Set<string>(['a', 'b']);
    store.publish({
      selection: { selectedClipIds: original, hasSelection: true },
    });
    const snapshot = store.getSnapshot();
    expect(snapshot.selection.selectedClipIds).toEqual(new Set(['a', 'b']));
    expect(snapshot.selection.selectedClipIds).not.toBe(original);
    // Mutating the publisher's set must not leak into the snapshot.
    original.add('c');
    expect(snapshot.selection.selectedClipIds.has('c')).toBe(false);
    // The snapshot object itself is frozen; the set is a defensive copy
    // under the ReadonlySet contract.
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.selection)).toBe(true);
  });

  it('notifies subscribers on every publish and stops after dispose', () => {
    const store: TimelineViewStoreApi = createTimelineViewStore();
    const listener = vi.fn();
    const handle = store.subscribe(listener);

    store.publish({ surfaceMounted: true });
    store.publish({ playhead: { time: 1, isPlaying: false } });
    expect(listener).toHaveBeenCalledTimes(2);

    handle.dispose();
    store.publish({ playhead: { time: 2, isPlaying: false } });
    expect(listener).toHaveBeenCalledTimes(2);

    store.dispose();
    expect(store.getSnapshot().surfaceMounted).toBe(false);
  });

  it('conforms to the SDK read contract (getSnapshot/subscribe only)', () => {
    const api = createTimelineViewStore();
    const store: TimelineViewStore = api;
    expect(typeof store.getSnapshot).toBe('function');
    expect(typeof store.subscribe).toBe('function');
    const snapshot: TimelineViewSnapshot = store.getSnapshot();
    expect(snapshot.playhead.time).toBe(0);
  });
});

describe('createEmptyTimelineViewSnapshot', () => {
  it('returns a fresh, frozen, zeroed snapshot', () => {
    const a = createEmptyTimelineViewSnapshot();
    const b = createEmptyTimelineViewSnapshot();
    expect(a).not.toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.surfaceMounted).toBe(false);
    expect(a.geometry).toBeNull();
  });
});
