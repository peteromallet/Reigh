/**
 * timeline-overlay-stores — provider-local stable viewport and playhead
 * stores, plus a frame-time channel for imperative DOM transforms.
 *
 * The overlay host creates one instance of each store per provider (never
 * per render) and hands them to extension renderers via
 * `TimelineOverlayRenderProps`. All three keep a stable identity for the
 * host surface's lifetime:
 *
 * - **Viewport store** — rAF-coalesced writes. Any number of `update()`
 *   calls within one animation frame publish exactly one final snapshot to
 *   subscribers. It is `useSyncExternalStore`-safe: `getSnapshot()` only
 *   changes identity when a notification is emitted, and a flush whose
 *   merged values equal the last published snapshot publishes nothing.
 * - **Playhead store** — React-visible snapshots publish at the timeline's
 *   existing ≤250 ms cadence (the same leading-edge throttle
 *   `useTimelineSync` applies to host state). `publishNow()` bypasses the
 *   cadence for explicit seeks/scrubs, mirroring `onCursorDrag`.
 * - **Frame-time channel** — imperative-only fan-out. Every `publish()`
 *   synchronously delivers the update to every subscriber; there is no
 *   snapshot, no coalescing, and no React involvement, so per-frame DOM
 *   transforms (e.g. the marker ruler strip's `translateX(-scrollLeft)`)
 *   never trigger React renders or snapshot churn.
 *
 * The stores are deliberately plain: no React, no DOM queries, no host
 * wiring. The host (TimelineCanvas / TimelineExtensionOverlayHost) drives
 * them and owns their lifecycle.
 */

import type { DisposeHandle } from '@/sdk/dispose';
import type {
  TimelinePlayheadSnapshot,
  TimelinePlayheadStore,
  TimelineViewportSnapshot,
  TimelineViewportStore,
} from '@/sdk/video/families/timelineOverlays';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Listener = () => void;

/** An idempotent DisposeHandle wrapping one unsubscribe. */
function createDisposeHandle(unsubscribe: () => void): DisposeHandle {
  let disposed = false;
  return {
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribe();
    },
  };
}

// ---------------------------------------------------------------------------
// Viewport store (rAF-coalesced React snapshots)
// ---------------------------------------------------------------------------

/** Options for {@link createTimelineViewportStore}. */
export interface CreateTimelineViewportStoreOptions {
  /** Initial snapshot; defaults to a zeroed viewport. */
  readonly initial?: TimelineViewportSnapshot;
  /**
   * Frame scheduler for coalesced flushes; defaults to
   * `window.requestAnimationFrame` with a coarse-timer fallback.
   */
  readonly scheduleFrame?: (callback: () => void) => number;
  /** Cancels a scheduled frame; defaults to `window.cancelAnimationFrame`. */
  readonly cancelFrame?: (handle: number) => void;
}

/**
 * The concrete viewport store returned by
 * {@link createTimelineViewportStore}: the SDK contract plus the host's
 * write (`update`) and lifecycle (`dispose`) surface.
 */
export interface TimelineViewportStoreApi extends TimelineViewportStore {
  /**
   * Merge a partial viewport update. Multiple updates within one animation
   * frame are coalesced into a single published snapshot; the write itself
   * never notifies synchronously.
   */
  update(next: Partial<TimelineViewportSnapshot>): void;
  /** Cancel any pending frame and release all listeners. Idempotent. */
  dispose(): void;
}

const EMPTY_VIEWPORT: TimelineViewportSnapshot = Object.freeze({
  scrollLeft: 0,
  scrollTop: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  totalWidth: 0,
  totalHeight: 0,
});

function defaultScheduleFrame(callback: () => void): number {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  // SSR / non-browser fallback: a coarse timer keeps writes coalesced.
  // Node's global setTimeout returns a Timeout object while the frame-handle
  // contract is `number`; the handle is only ever passed back to
  // clearTimeout/cancelAnimationFrame, so the conversion is safe.
  return setTimeout(callback, 16) as unknown as number;
}

function defaultCancelFrame(handle: number): void {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
}

function viewportSnapshotsEqual(
  left: TimelineViewportSnapshot,
  right: TimelineViewportSnapshot,
): boolean {
  return (
    left.scrollLeft === right.scrollLeft &&
    left.scrollTop === right.scrollTop &&
    left.viewportWidth === right.viewportWidth &&
    left.viewportHeight === right.viewportHeight &&
    left.totalWidth === right.totalWidth &&
    left.totalHeight === right.totalHeight
  );
}

/**
 * Create a provider-local viewport store.
 *
 * Writes are rAF-coalesced: the first `update()` in a frame schedules one
 * flush; later writes in the same frame only update the pending merge. The
 * flush publishes a single frozen snapshot (notifying subscribers once) and
 * skips notification entirely when the merged values equal the last
 * published snapshot, keeping `getSnapshot()` identity stable for
 * `useSyncExternalStore` consumers.
 */
export function createTimelineViewportStore(
  options: CreateTimelineViewportStoreOptions = {},
): TimelineViewportStoreApi {
  const scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame;

  let published: TimelineViewportSnapshot =
    options.initial === undefined ? EMPTY_VIEWPORT : Object.freeze({ ...options.initial });
  let pending: TimelineViewportSnapshot | null = null;
  let frameHandle: number | null = null;
  let disposed = false;
  const listeners = new Set<Listener>();

  function notify(): void {
    // Iterate over a copy so listeners may subscribe/unsubscribe during dispatch.
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function flushFrame(): void {
    frameHandle = null;
    const snapshot = pending;
    pending = null;
    if (snapshot === null || viewportSnapshotsEqual(published, snapshot)) {
      return;
    }
    published = Object.freeze({ ...snapshot });
    notify();
  }

  return {
    getSnapshot: () => published,
    subscribe(listener: Listener): DisposeHandle {
      listeners.add(listener);
      return createDisposeHandle(() => {
        listeners.delete(listener);
      });
    },
    update(next: Partial<TimelineViewportSnapshot>): void {
      if (disposed) {
        return;
      }
      const merged = { ...(pending ?? published), ...next };
      pending = merged;
      // A merge equal to the published snapshot has nothing to publish. An
      // already-scheduled frame will no-op when it flushes; otherwise no
      // frame needs to be scheduled at all.
      if (viewportSnapshotsEqual(published, merged)) {
        return;
      }
      if (frameHandle === null) {
        frameHandle = scheduleFrame(flushFrame);
      }
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
      pending = null;
      listeners.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Playhead store (≤250 ms React publish cadence)
// ---------------------------------------------------------------------------

/** Options for {@link createTimelinePlayheadStore}. */
export interface CreateTimelinePlayheadStoreOptions {
  /**
   * Minimum interval between React-visible publishes in ms; defaults to
   * 250 (the timeline's existing playback cadence).
   */
  readonly cadenceMs?: number;
  /** Monotonic clock in ms; defaults to `performance.now()`. */
  readonly now?: () => number;
}

/**
 * The concrete playhead store returned by
 * {@link createTimelinePlayheadStore}: the SDK contract plus the host's
 * write (`set`), seek (`publishNow`), and lifecycle (`dispose`) surface.
 */
export interface TimelinePlayheadStoreApi extends TimelinePlayheadStore {
  /**
   * Record the current playhead position and playback state. Publishes a
   * React-visible snapshot immediately for the first write and then at most
   * once per cadence window (leading edge), matching the host's existing
   * ≤250 ms playback cadence.
   */
  set(time: number, isPlaying: boolean): void;
  /**
   * Publish the latest position immediately regardless of cadence — for
   * explicit seeks/scrubs (mirrors `onCursorDrag` in `useTimelineSync`).
   */
  publishNow(): void;
  /** Release all listeners. Idempotent. */
  dispose(): void;
}

const DEFAULT_PLAYHEAD_CADENCE_MS = 250;

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Create a provider-local playhead store.
 *
 * `set()` records the latest position on every call but only *publishes* a
 * React-visible snapshot when the cadence window has elapsed since the last
 * publish (the first write always publishes immediately, so a freshly
 * mounted host sees the current position without latency). `publishNow()`
 * bypasses the cadence for explicit seeks/scrubs. The published snapshot is
 * immutable and keeps a stable identity between publishes, so
 * `useSyncExternalStore` consumers never re-render on throttled writes.
 */
export function createTimelinePlayheadStore(
  options: CreateTimelinePlayheadStoreOptions = {},
): TimelinePlayheadStoreApi {
  const cadenceMs = options.cadenceMs ?? DEFAULT_PLAYHEAD_CADENCE_MS;
  const now = options.now ?? defaultNow;

  const initial: TimelinePlayheadSnapshot = Object.freeze({ time: 0, isPlaying: false });
  let latest: TimelinePlayheadSnapshot = initial;
  let published: TimelinePlayheadSnapshot = initial;
  let lastPublishAt = Number.NEGATIVE_INFINITY;
  let disposed = false;
  const listeners = new Set<Listener>();

  function notify(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function publish(snapshot: TimelinePlayheadSnapshot): void {
    published = Object.freeze({ ...snapshot });
    lastPublishAt = now();
    notify();
  }

  return {
    getSnapshot: () => published,
    subscribe(listener: Listener): DisposeHandle {
      listeners.add(listener);
      return createDisposeHandle(() => {
        listeners.delete(listener);
      });
    },
    set(time: number, isPlaying: boolean): void {
      if (disposed) {
        return;
      }
      latest = { time, isPlaying };
      // Leading-edge throttle, identical to useTimelineSync's cadence check.
      if (now() - lastPublishAt > cadenceMs) {
        publish(latest);
      }
    },
    publishNow(): void {
      if (disposed) {
        return;
      }
      publish(latest);
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      listeners.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Frame-time channel (imperative, every-update delivery)
// ---------------------------------------------------------------------------

/**
 * One frame-time delivery: a high-resolution timestamp plus the scroll
 * offsets an imperative DOM transform needs. The host publishes this per
 * frame; subscribers apply it directly to DOM (e.g. the marker ruler
 * strip's `translateX(-scrollLeft)`) without any React involvement.
 */
export interface TimelineFrameTimeUpdate {
  /** High-resolution timestamp of the frame (ms). */
  readonly timestamp: number;
  /** Horizontal scroll offset (px). */
  readonly scrollLeft: number;
  /** Vertical scroll offset (px). */
  readonly scrollTop: number;
}

/**
 * An imperative-only fan-out channel for per-frame DOM transforms.
 *
 * Unlike the viewport/playhead stores this channel has no snapshot and no
 * React surface: every `publish()` synchronously delivers the supplied
 * update to every subscriber (including duplicate values), and publishing
 * never touches the viewport store's snapshot or notifications.
 */
export interface TimelineFrameTimeChannel {
  /**
   * Subscribe to frame-time updates. The listener receives every supplied
   * update synchronously, in publish order. Returns a DisposeHandle that
   * unsubscribes (safe to call multiple times; idempotent).
   */
  subscribe(listener: (update: TimelineFrameTimeUpdate) => void): DisposeHandle;
  /** Deliver an update to every current subscriber, synchronously. */
  publish(update: TimelineFrameTimeUpdate): void;
}

/** Create a provider-local frame-time channel. */
export function createTimelineFrameTimeChannel(): TimelineFrameTimeChannel {
  const listeners = new Set<(update: TimelineFrameTimeUpdate) => void>();
  return {
    subscribe(listener: (update: TimelineFrameTimeUpdate) => void): DisposeHandle {
      listeners.add(listener);
      return createDisposeHandle(() => {
        listeners.delete(listener);
      });
    },
    publish(update: TimelineFrameTimeUpdate): void {
      // Iterate over a copy so listeners may subscribe/unsubscribe during dispatch.
      for (const listener of [...listeners]) {
        listener(update);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Bundle factory (provider-local lifecycle)
// ---------------------------------------------------------------------------

/** Options for {@link createTimelineOverlayStores}. */
export interface TimelineOverlayStoresOptions {
  /** Viewport store options. */
  readonly viewport?: CreateTimelineViewportStoreOptions;
  /** Playhead store options. */
  readonly playhead?: CreateTimelinePlayheadStoreOptions;
}

/** The three provider-local surfaces handed to the overlay host. */
export interface TimelineOverlayStores {
  /** rAF-coalesced viewport snapshots for React consumers. */
  readonly viewport: TimelineViewportStoreApi;
  /** Cadence-throttled playhead snapshots for React consumers. */
  readonly playhead: TimelinePlayheadStoreApi;
  /** Imperative per-frame updates for host-owned DOM transforms. */
  readonly frameTime: TimelineFrameTimeChannel;
}

/**
 * Create one viewport store, one playhead store, and one frame-time channel
 * as a single provider-local bundle. Call once per provider (e.g. in a
 * ref/useMemo) so all three keep a stable identity for the host surface's
 * lifetime; dispose the viewport/playhead stores when the provider unmounts.
 */
export function createTimelineOverlayStores(
  options: TimelineOverlayStoresOptions = {},
): TimelineOverlayStores {
  return {
    viewport: createTimelineViewportStore(options.viewport),
    playhead: createTimelinePlayheadStore(options.playhead),
    frameTime: createTimelineFrameTimeChannel(),
  };
}
