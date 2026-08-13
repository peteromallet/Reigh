/**
 * createTimelineViewStore — host factory for the provider-owned
 * TimelineViewStore primitive.
 *
 * The runtime assembly owns ONE store per provider mount and injects it as
 * `ctx.creative.timelineView`. The canvas publishes layout/playback state
 * into it regardless of whether the overlay host is enabled; extensions
 * observe it through the read-only SDK contract.
 *
 * The write surface (`publish`) is host-only: it never appears on the SDK
 * `TimelineViewStore` type, so extensions cannot mutate timeline view state.
 */

import type {
  TimelineViewSnapshot,
  TimelineViewStore,
} from '@/sdk/video/timeline/viewState';
import type { DisposeHandle } from '@/sdk/dispose';

/** Zeroed snapshot used before the surface publishes its first layout. */
export function createEmptyTimelineViewSnapshot(): TimelineViewSnapshot {
  return Object.freeze({
    playhead: Object.freeze({ time: 0, isPlaying: false }),
    selection: Object.freeze({
      selectedClipIds: Object.freeze(new Set<string>()),
      hasSelection: false,
    }),
    viewport: null,
    geometry: null,
    surfaceMounted: false,
  });
}

/** Host write surface for the provider-owned timeline view store. */
export interface TimelineViewStoreApi extends TimelineViewStore {
  /** Merge a partial snapshot into the store and notify subscribers. */
  publish(next: Partial<TimelineViewSnapshot>): void;
  /** Release all subscribers and drop the snapshot. */
  dispose(): void;
}

/**
 * Create one provider-owned timeline view store.
 *
 * Snapshots are immutable and reference-stable between publishes; every
 * publish replaces the snapshot with a fresh frozen object so identity
 * comparison works for `useSyncExternalStore`-style consumers.
 */
export function createTimelineViewStore(): TimelineViewStoreApi {
  let snapshot: TimelineViewSnapshot = createEmptyTimelineViewSnapshot();
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,

    subscribe(listener: () => void): DisposeHandle {
      listeners.add(listener);
      return {
        dispose(): void {
          listeners.delete(listener);
        },
      };
    },

    publish(next: Partial<TimelineViewSnapshot>): void {
      const merged = { ...snapshot, ...next };
      snapshot = Object.freeze({
        playhead: Object.freeze({ ...merged.playhead }),
        // Selection is a defensive COPY of the publisher's set, published
        // under the repo-wide ReadonlySet contract (JS Sets cannot be
        // runtime-frozen; the copy prevents aliasing mutations from leaking
        // in after publish, and consumers must treat it as read-only).
        selection: merged.selection === null || merged.selection === undefined
          ? createEmptyTimelineViewSnapshot().selection
          : Object.freeze({
              ...merged.selection,
              selectedClipIds: new Set(merged.selection.selectedClipIds) as ReadonlySet<string>,
            }),
        viewport: merged.viewport ? Object.freeze({ ...merged.viewport }) : null,
        geometry: merged.geometry ?? null,
        surfaceMounted: merged.surfaceMounted,
      });
      for (const listener of listeners) {
        listener();
      }
    },

    dispose(): void {
      listeners.clear();
      snapshot = createEmptyTimelineViewSnapshot();
    },
  };
}
