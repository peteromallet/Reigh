/**
 * Timeline overlay family module.
 *
 * Houses the canonical SDK-owned `timelineOverlay` family contracts:
 * the required-render manifest contribution, unresolved/resolved descriptors,
 * memoized geometry inputs, stable viewport/playhead store contracts, the
 * selection and boolean pointer-claim API, ruler-only marker contracts, and
 * the host-owned `markerLayer` primitive.
 *
 * This module contains only data-only types and read-only surfaces; no
 * registry, provider, resolver, DOM, React, or host behaviour lives here.
 *
 * V1 is ruler-only: the marker primitive accepts `placement: 'ruler'` only.
 * There is deliberately no `trackId`, no `when` clause, and no
 * `setGestureOwner` on the public contract.
 *
 * @publicContract
 */

import type { ContributionId } from '../../ids';
import type { DisposeHandle } from '../../dispose';
import type { ExtensionRenderer } from '../../ui';

// ---------------------------------------------------------------------------
// Manifest contribution (required render)
// ---------------------------------------------------------------------------

/**
 * A `timelineOverlay` contribution declared in an extension manifest.
 *
 * The `render` field is a required render-id reference: the owning extension
 * must bind a renderer for it imperatively via `ctx.ui.registerRenderer()`
 * during activation. There is no `when` clause on this contribution.
 */
export interface TimelineOverlayManifestContribution {
  /** Unique within the extension. */
  id: ContributionId;
  kind: 'timelineOverlay';
  /** Required render-id reference resolved via ctx.ui.registerRenderer(). */
  render: string;
  /** Lower values sort first. Default 0. */
  order?: number;
  /** Human-readable label for diagnostics / UI. */
  label?: string;
}

// ---------------------------------------------------------------------------
// Descriptors (unresolved and resolved)
// ---------------------------------------------------------------------------

/**
 * Unresolved timeline overlay descriptor as projected from a manifest
 * contribution. Carries the render-id reference; the renderer itself is
 * resolved only after the owning extension registers it via `ctx.ui`.
 */
export interface TimelineOverlayDescriptor {
  /** Owning extension ID. */
  readonly extensionId: string;
  /** Contribution ID, unique within the extension. */
  readonly id: ContributionId;
  /** Render-id reference bound by the owning extension via ctx.ui. */
  readonly renderId: string;
  /** Lower values sort first. Default 0. */
  readonly order?: number;
}

/**
 * Resolved timeline overlay descriptor: the descriptor plus the renderer
 * registered by the owning extension. Host surfaces render only resolved
 * descriptors; overlays whose renderer was never registered are omitted.
 */
export interface ResolvedTimelineOverlayDescriptor {
  /** Owning extension ID. */
  readonly extensionId: string;
  /** Contribution ID, unique within the extension. */
  readonly id: ContributionId;
  /** Render-id reference bound by the owning extension via ctx.ui. */
  readonly renderId: string;
  /** Lower values sort first. Default 0. */
  readonly order?: number;
  /** Renderer registered by the owning extension for `renderId`. */
  readonly render: ExtensionRenderer<TimelineOverlayRenderProps>;
}

// ---------------------------------------------------------------------------
// Geometry (memoized inputs)
// ---------------------------------------------------------------------------

/**
 * Inputs to {@link createTimelineOverlayGeometry}. The host memoizes these
 * (e.g. via React `useMemo`) so the derived geometry object keeps a stable
 * identity across renders unless an input actually changed.
 */
export interface TimelineOverlayGeometryInput {
  /** Zoom scale: seconds of timeline visible across `scaleWidth`. */
  readonly scale: number;
  /** Width of the scale region (px). */
  readonly scaleWidth: number;
  /** Left offset where timeline content begins (px). */
  readonly startLeft: number;
  /** Visible extent start (seconds). */
  readonly extentStart: number;
  /** Visible extent end (seconds). */
  readonly extentEnd: number;
}

/**
 * Memoized timeline geometry passed to overlay renderers.
 *
 * A pure derivation of {@link TimelineOverlayGeometryInput}: identical inputs
 * always produce identical members, so hosts can memoize the input and reuse
 * the geometry object without per-frame allocation.
 */
export interface TimelineOverlayGeometry {
  /** Zoom scale: seconds of timeline visible across `scaleWidth`. */
  readonly scale: number;
  /** Width of the scale region (px). */
  readonly scaleWidth: number;
  /** Left offset where timeline content begins (px). */
  readonly startLeft: number;
  /** Visible extent start (seconds). */
  readonly extentStart: number;
  /** Visible extent end (seconds). */
  readonly extentEnd: number;
  /** Pixels per second of timeline (`scaleWidth / scale`). */
  readonly pixelsPerSecond: number;
  /** Convert a time (seconds) to a content x position (px). */
  timeToPixel(time: number): number;
  /** Convert a content x position (px) to a time (seconds). */
  pixelToTime(pixel: number): number;
}

/**
 * Build a frozen {@link TimelineOverlayGeometry} from memoized inputs.
 *
 * Pure and deterministic: the same input object always yields the same
 * geometry members. Freezing prevents accidental mutation by renderers.
 */
export function createTimelineOverlayGeometry(
  input: TimelineOverlayGeometryInput,
): TimelineOverlayGeometry {
  const { scale, scaleWidth, startLeft, extentStart, extentEnd } = input;
  const pixelsPerSecond = scaleWidth / scale;

  return Object.freeze({
    scale,
    scaleWidth,
    startLeft,
    extentStart,
    extentEnd,
    pixelsPerSecond,
    timeToPixel(time: number): number {
      return startLeft + time * pixelsPerSecond;
    },
    pixelToTime(pixel: number): number {
      return (pixel - startLeft) / pixelsPerSecond;
    },
  });
}

// ---------------------------------------------------------------------------
// Stable viewport / playhead store contracts
// ---------------------------------------------------------------------------

/** Immutable viewport snapshot published by {@link TimelineViewportStore}. */
export interface TimelineViewportSnapshot {
  /** Current horizontal scroll offset (px). */
  readonly scrollLeft: number;
  /** Current vertical scroll offset (px). */
  readonly scrollTop: number;
  /** Width of the visible viewport (px). */
  readonly viewportWidth: number;
  /** Height of the visible viewport (px). */
  readonly viewportHeight: number;
  /** Total scrollable width (px). */
  readonly totalWidth: number;
  /** Total scrollable height (px). */
  readonly totalHeight: number;
}

/** Immutable playhead snapshot published by {@link TimelinePlayheadStore}. */
export interface TimelinePlayheadSnapshot {
  /** Current playhead time (seconds). */
  readonly time: number;
  /** Whether playback is active. */
  readonly isPlaying: boolean;
}

/**
 * Stable viewport store contract.
 *
 * The store keeps a stable identity for the lifetime of the host surface and
 * publishes immutable snapshots. Consumers subscribe for change notification;
 * React consumers can wrap `subscribe`/`getSnapshot` for `useSyncExternalStore`.
 */
export interface TimelineViewportStore {
  /** Latest viewport snapshot (stable reference between updates). */
  readonly getSnapshot: () => TimelineViewportSnapshot;
  /**
   * Subscribe to viewport updates. Returns a DisposeHandle that unsubscribes
   * (safe to call multiple times; idempotent).
   */
  readonly subscribe: (listener: () => void) => DisposeHandle;
}

/**
 * Stable playhead store contract.
 *
 * The store keeps a stable identity for the lifetime of the host surface and
 * publishes immutable snapshots. Playhead snapshots are published at the
 * host's playback cadence; consumers should not read preview DOM attributes.
 */
export interface TimelinePlayheadStore {
  /** Latest playhead snapshot (stable reference between updates). */
  readonly getSnapshot: () => TimelinePlayheadSnapshot;
  /**
   * Subscribe to playhead updates. Returns a DisposeHandle that unsubscribes
   * (safe to call multiple times; idempotent).
   */
  readonly subscribe: (listener: () => void) => DisposeHandle;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Timeline selection snapshot passed to overlay renderers. */
export interface TimelineOverlaySelection {
  /** Currently selected clip IDs (empty when nothing is selected). */
  readonly selectedClipIds: ReadonlySet<string>;
  /** Whether any timeline content is currently selected. */
  readonly hasSelection: boolean;
}

// ---------------------------------------------------------------------------
// Overlay render props (boolean pointer-claim API)
// ---------------------------------------------------------------------------

/**
 * Props passed to every `timelineOverlay` renderer.
 *
 * The pointer-claim API is boolean and overlay-scoped: `claimPointer()`
 * returns `false` when another owner (a drag system or a foreign overlay)
 * currently holds the claim, and `releasePointer()` is a no-op unless this
 * overlay still owns the claim. There is deliberately no public
 * `setGestureOwner` on this contract.
 */
export interface TimelineOverlayRenderProps {
  /** Memoized timeline geometry (time↔px mapping, scale, visible extent). */
  readonly geometry: TimelineOverlayGeometry;
  /** Stable viewport store (scroll offsets, viewport size, content size). */
  readonly viewport: TimelineViewportStore;
  /** Stable playhead store (current time, playback state). */
  readonly playhead: TimelinePlayheadStore;
  /** Current timeline selection snapshot. */
  readonly selection: TimelineOverlaySelection;
  /** Whether this overlay currently owns the pointer claim. */
  readonly pointerClaimed: boolean;
  /**
   * Claim pointer events for this overlay. Returns `true` on success and
   * `false` when another owner or overlay claimant holds the claim.
   */
  readonly claimPointer: () => boolean;
  /**
   * Release the pointer claim. No-op unless this overlay still owns the
   * claim.
   */
  readonly releasePointer: () => void;
  /** Host-owned drawing primitives (e.g. `markerLayer`). */
  readonly primitives: TimelineOverlayPrimitives;
}

// ---------------------------------------------------------------------------
// Ruler-only marker contracts
// ---------------------------------------------------------------------------

/**
 * A point marker rendered on the timeline ruler.
 *
 * V1 is ruler-only: there is deliberately no `trackId` and no canvas
 * placement on this primitive.
 */
export interface TimelinePointMarker<T = unknown> {
  /** Marker ID, unique within the layer. */
  id: string;
  /** Marker time in seconds. */
  time: number;
  /** Optional label rendered next to the marker. */
  label?: string;
  /** Optional marker color (any CSS color value). */
  color?: string;
  /** When true, the marker is not interactive. */
  disabled?: boolean;
  /** Arbitrary extension-owned data carried through the layer. */
  data?: T;
}

/** A marker movement reported by the marker layer. */
export interface TimelineMarkerChange {
  /** The marker ID that moved. */
  id: string;
  /** New marker time in seconds. */
  time: number;
  /** `'preview'` during a drag; `'commit'` when the drag ends. */
  phase: 'preview' | 'commit';
}

/**
 * Options for {@link TimelineOverlayPrimitives.markerLayer}.
 *
 * Markers are controlled: the extension owns the array and receives
 * `onChange` callbacks with preview/commit phases, persisting on commit only.
 */
export interface TimelineMarkerLayerOptions<T = unknown> {
  /** Controlled marker list (time-sorted). */
  markers: readonly TimelinePointMarker<T>[];
  /**
   * Placement. V1 supports only `'ruler'`; defaults to `'ruler'` when
   * omitted. No canvas/track placement exists in V1.
   */
  placement?: 'ruler';
  /** Whether markers are interactive (drag, click, keyboard). */
  interactive: boolean;
  /** Snap marker commits to the frame grid. */
  snap: boolean;
  /** Currently selected marker IDs. */
  selectedIds?: ReadonlySet<string>;
  /** Invoked when a marker is activated (pointer or keyboard). */
  onActivate?: (marker: TimelinePointMarker<T>) => void;
  /** Invoked on marker movement with preview/commit phases. */
  onChange?: (change: TimelineMarkerChange) => void;
  /** Custom per-marker renderer. */
  renderMarker?: (marker: TimelinePointMarker<T>) => unknown;
}

// ---------------------------------------------------------------------------
// Primitives (markerLayer)
// ---------------------------------------------------------------------------

/**
 * Host-owned drawing primitives available to overlay renderers via
 * `props.primitives`.
 */
export interface TimelineOverlayPrimitives {
  /**
   * Render a ruler-only marker layer (V1).
   *
   * The returned value is a host-owned element the renderer embeds in its
   * output; the host owns geometry, culling, gestures, and lifecycle.
   */
  markerLayer<T = unknown>(options: TimelineMarkerLayerOptions<T>): unknown;
}
