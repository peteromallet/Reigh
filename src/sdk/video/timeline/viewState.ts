/**
 * TimelineViewStore — the provider-owned, renderer-independent timeline
 * observation primitive.
 *
 * Extensions building on top of the timeline UX need live access to
 * playback, selection, viewport, and geometry from ANY contribution
 * surface — commands, keybindings, context menus — not only from a mounted
 * `timelineOverlay` renderer. This module defines that read surface as a
 * stable snapshot store owned by the provider/runtime assembly and injected
 * through `CreativeContext.timelineView`.
 *
 * The store is a neutral SDK contract: no DOM, no React, no host wiring.
 * The host creates one instance per provider via the factory in
 * `src/tools/video-editor/lib/timeline-view-store.ts` and publishes into it;
 * extensions only ever call `getSnapshot()` / `subscribe()`.
 *
 * @publicContract
 */

import type { DisposeHandle } from '@/sdk/dispose';
import type {
  TimelineOverlayGeometry,
  TimelineOverlaySelection,
  TimelinePlayheadSnapshot,
  TimelineViewportSnapshot,
} from '@/sdk/video/families/timelineOverlays';

/**
 * A consistent, immutable view of the timeline's live UX state at one
 * instant. Published by the host as a stable reference between updates;
 * consumers must not mutate any member.
 *
 * `selection.selectedClipIds` follows the repo-wide `ReadonlySet` contract:
 * the host publishes a defensive copy at publish time (mutations to the
 * publisher's set cannot leak in), and consumers must treat the set as
 * read-only — JS `Set` instances cannot be runtime-frozen.
 */
export interface TimelineViewSnapshot {
  /** Current playhead position and playback state. */
  readonly playhead: TimelinePlayheadSnapshot;
  /** Current timeline selection (selected clip ids, has-selection flag). */
  readonly selection: TimelineOverlaySelection;
  /**
   * Current viewport (scroll offsets, viewport size, content size), or
   * `null` before the timeline surface has published its first layout.
   */
  readonly viewport: TimelineViewportSnapshot | null;
  /**
   * Current time↔pixel geometry, or `null` before the timeline surface has
   * published its first layout.
   */
  readonly geometry: TimelineOverlayGeometry | null;
  /**
   * True once the timeline surface is mounted and publishing layout state.
   * Extensions can use this to distinguish "timeline not ready" from a
   * legitimate playhead at 0s.
   */
  readonly surfaceMounted: boolean;
}

/**
 * Provider-owned live view of the timeline's UX state.
 *
 * Stable identity for the lifetime of the provider surface. Snapshots are
 * immutable; `getSnapshot()` returns the same reference between updates so
 * `useSyncExternalStore`-style consumers can compare by identity.
 */
export interface TimelineViewStore {
  /** Latest timeline view snapshot (stable reference between updates). */
  readonly getSnapshot: () => TimelineViewSnapshot;
  /**
   * Subscribe to snapshot updates. Returns a DisposeHandle that
   * unsubscribes (safe to call multiple times; idempotent).
   */
  readonly subscribe: (listener: () => void) => DisposeHandle;
}
