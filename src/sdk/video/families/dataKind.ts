/**
 * DataKind family module (entry 21 of 22; reserved 'agent' is 22nd).
 *
 * Houses the data-kind family contracts for duration-neutral typed-data
 * lanes: the `DataKindContribution` manifest interface, the closed V1
 * shape/domain vocabularies, lane renderer / item inspector prop types,
 * and the `ctx.dataKinds` registration-service surface.
 *
 * This module contains only data-only types and read-only surfaces; no
 * registry, provider, resolver, or DOM behaviour lives here.
 *
 * [CONVERGE-WITH-M1] The closed vocabularies in this module (`DataShape`,
 * `DataCoordinateDomain`, `KNOWN_DATA_SHAPES`, `KNOWN_DATA_DOMAINS`) are
 * provisional until the typed-timeline-data epic's M1 freeze locks the
 * envelope field names. The public manifest schema deliberately keeps
 * `shape`/`domain` as open strings — the host validates them against the
 * sets below — so an M1 rename changes only this module and the host
 * validation in `src/sdk/manifest.ts`, never the public manifest contract.
 *
 * @publicContract
 */

import type { ContributionId } from '../../ids';
import type { DisposeHandle } from '../../dispose';

// ---------------------------------------------------------------------------
// Closed V1 vocabularies ([CONVERGE-WITH-M1])
// ---------------------------------------------------------------------------

/**
 * Shape of a data kind's items. Closed V1 set ([CONVERGE-WITH-M1]).
 *
 * Open string on the public manifest schema; the host validates declared
 * values against {@link KNOWN_DATA_SHAPES}.
 */
export type DataShape = 'point' | 'interval' | 'series';

/**
 * Coordinate domain of a data kind's extents. Closed V1 set
 * ([CONVERGE-WITH-M1]).
 *
 * Open string on the public manifest schema; the host validates declared
 * values against {@link KNOWN_DATA_DOMAINS}.
 */
export type DataCoordinateDomain =
  | 'timeline_seconds'
  | 'source_seconds'
  | 'frames'
  | 'samples'
  | 'ticks'
  | 'ordinal'
  | 'char_offset'
  | 'token_offset';

/** Runtime-inspectable form of {@link DataShape} for host-side validation. */
export const KNOWN_DATA_SHAPES: readonly DataShape[] = [
  'point',
  'interval',
  'series',
] as const;

/** Runtime-inspectable form of {@link DataCoordinateDomain} for host-side validation. */
export const KNOWN_DATA_DOMAINS: readonly DataCoordinateDomain[] = [
  'timeline_seconds',
  'source_seconds',
  'frames',
  'samples',
  'ticks',
  'ordinal',
  'char_offset',
  'token_offset',
] as const;

// ---------------------------------------------------------------------------
// dataKind contribution (manifest)
// ---------------------------------------------------------------------------

/**
 * A data-kind contribution declared in an extension manifest.
 *
 * Declares the stable identity and vocabulary of a typed-data lane kind.
 * The lane renderer itself is NOT declared here — it binds at activation
 * via `ctx.dataKinds.register(kindId, laneRenderer, inspector?)` (single
 * bind model, clipType analog).
 */
export interface DataKindContribution {
  /** Unique within the extension. */
  id: ContributionId;
  kind: 'dataKind';
  /**
   * Stable kind identifier. The registration gate key for
   * `ctx.dataKinds.register(kindId, ...)`; undeclared kindIds no-op with a
   * `dataKinds/undeclared-kind` diagnostic.
   */
  kindId: string;
  /** Qualified schema reference for the kind's payload (e.g. "reigh.transcript_segment/v1"). */
  schemaRef: string;
  /**
   * Shape name. Open string on the public manifest schema; the host
   * validates against {@link KNOWN_DATA_SHAPES} when present.
   */
  shape?: string;
  /**
   * Coordinate-domain name. Open string on the public manifest schema; the
   * host validates against {@link KNOWN_DATA_DOMAINS} when present.
   */
  domain?: string;
  /** Human-readable label for diagnostics / UI. */
  label?: string;
  /** Lower values sort first. Default 0. */
  order?: number;
}

// ---------------------------------------------------------------------------
// Renderer / inspector prop types ([CONVERGE-WITH-M1])
// ---------------------------------------------------------------------------

/**
 * A single frozen data item projected onto the timeline for lane rendering.
 *
 * The host maps source coordinates into timeline space (`timelineStart`/
 * `timelineEnd`); renderers never reimplement trim/speed algebra.
 *
 * [CONVERGE-WITH-M1] Provisional projection of the epic's frozen envelope
 * item; converges on `FrozenDataItem` + `DataLaneItemView` at M1.
 */
export interface DataLaneRenderItem {
  /** Occurrence id (not the source item id). */
  readonly id: string;
  /** Durable host-authored source identity, independent of occurrence ids. */
  readonly sourceItemId?: string;
  /** Timeline-space start, seconds. Host-mapped. */
  readonly timelineStart: number;
  /** Timeline-space end, seconds. Host-mapped. */
  readonly timelineEnd: number;
  /** Owning media clip id when the item is mapped onto a clip. */
  readonly clipId?: string;
  /** Host-authored source artifact identity; renderers must not mutate it. */
  readonly sourceArtifactRef?: Readonly<{
    readonly assetId?: string;
    readonly artifactHash?: string;
  }>;
  /** Adapter provenance carried by the frozen source envelope. */
  readonly provenance?: Readonly<{
    readonly adapterId: string;
    readonly adapterVersion: string;
    readonly recordedAt?: string;
  }>;
  /** Opaque frozen payload (uninterpreted by the host). */
  readonly payload: unknown;
}

/**
 * Props passed to a registered data-lane renderer.
 *
 * Renderers receive pre-mapped timeline coordinates and the kind's declared
 * vocabulary; they paint lane rows only — never analysis, never duration.
 */
export interface DataLaneRendererProps {
  /** Registered kind identifier. */
  readonly kindId: string;
  /** Qualified schema reference from the contribution. */
  readonly schemaRef: string;
  /** Shape from the contribution (host-validated at registration). */
  readonly shape: DataShape;
  /** Coordinate domain from the contribution (host-validated at registration). */
  readonly domain: DataCoordinateDomain;
  /**
   * Frozen items mapped onto the timeline for this lane. For large lanes the
   * host supplies a bounded window rather than the complete collection; use
   * {@link DataLaneRendererProps.itemWindow} for absolute positions and the
   * total count.
   */
  readonly items: readonly DataLaneRenderItem[];
  /**
   * Lazily materialize the complete lane for explicit whole-lane commands
   * (export, caption creation, etc.). Renderers must not call this while
   * painting; visual DOM must remain bounded to {@link items}.
   */
  readonly getAllItems?: () => readonly DataLaneRenderItem[];
  /**
   * Host-owned item window. `startIndex` is inclusive and `endIndex` is
   * exclusive. Optional for compatibility with isolated/older render hosts;
   * when absent, `items` is the complete collection.
   */
  readonly itemWindow?: Readonly<{
    readonly startIndex: number;
    readonly endIndex: number;
    readonly totalItemCount: number;
  }>;
  /** Item owning the renderer's roving tab stop. */
  readonly activeItemId?: string;
  /**
   * Item the host asks the renderer to focus after keyboard navigation moved
   * the item window. Renderers should ignore this when they do not paint an
   * interactive control for the item.
   */
  readonly focusItemId?: string;
  /**
   * Pixel offset of timeline zero within the renderer's box; host lane rows
   * are timeline-zero-origin, so the host passes 0 and renderers never add a
   * gutter correction themselves.
   */
  readonly startLeft: number;
  /** Shared px-per-second scale — same value the ruler and tracks use. */
  readonly pixelsPerSecond: number;
  /**
   * Optional item-selection callback wired by the host to its interaction
   * model: invoking it dispatches a `dataItem` target for `itemId`. A
   * renderer forwarding a pointer press must stop propagation first (as the
   * host's own extent bars do) so the row's empty-chrome `dataLane` handler
   * cannot overwrite the target. Absent in isolated renders (tests) where
   * rows stay display-only.
   */
  readonly onSelectItem?: (itemId: string) => void;
  /**
   * Host-owned navigation across the complete lane, including items outside
   * the current window. Calling this updates the window, selection, and focus
   * without requiring a renderer to retain the full item collection.
   */
  readonly onNavigateItem?: (
    itemId: string,
    direction: 'previous' | 'next' | 'first' | 'last',
  ) => void;
}

/**
 * A bounded, host-rendered action associated with an entire data lane.
 *
 * Extensions provide intent and behavior; the host owns placement, responsive
 * layout, keyboard interaction, pending/error state, and event containment.
 */
export interface DataLaneActionDescriptor {
  /** Stable within the registered data kind. */
  readonly id: string;
  /** Short visible label rendered by the host. */
  readonly label: string;
  /** Accessible name when the visible label is not sufficiently descriptive. */
  readonly ariaLabel?: string;
  /** Optional bounded explanatory tooltip. */
  readonly title?: string;
  /** Invoke against the complete host-frozen lane, never only its DOM window. */
  readonly invoke: (items: readonly DataLaneRenderItem[]) => void | Promise<void>;
}

/**
 * Props passed to a registered data-item inspector.
 *
 * Inspectors render in the properties panel when a lane item is selected;
 * unknown schemaRefs fall back to the host's opaque inspector instead.
 */
export interface DataItemInspectorProps {
  /** Registered kind identifier. */
  readonly kindId: string;
  /** Qualified schema reference from the contribution. */
  readonly schemaRef: string;
  /** Shape from the contribution (host-validated at registration). */
  readonly shape: DataShape;
  /** Coordinate domain from the contribution (host-validated at registration). */
  readonly domain: DataCoordinateDomain;
  /** The selected frozen item. */
  readonly item: DataLaneRenderItem;
}

// ---------------------------------------------------------------------------
// ctx.dataKinds registration service (single bind model)
// ---------------------------------------------------------------------------

/** Options for imperative data-kind registration via `ctx.dataKinds.register()`. */
export interface DataKindRegistrationOptions {
  /** Override label for the lane gutter / UI. */
  label?: string;
  /** Override sort order for lane stacking. Lower values sort first. */
  order?: number;
  /** Optional whole-lane actions rendered in the host's responsive action menu. */
  actions?: readonly DataLaneActionDescriptor[];
}

/**
 * Data-kind registration service available as `ctx.dataKinds` during
 * `activate()`.
 *
 * Single bind model (clipType analog): the renderer lives on the host
 * registry record, not on a manifest field. The `kindId` must match the
 * `kindId` of a `DataKindContribution` declared by this extension in its
 * manifest; undeclared kindIds emit `dataKinds/undeclared-kind` and return
 * a no-op handle.
 */
export interface DataKindRegistrationService {
  /**
   * Register a lane renderer and optional item inspector for a data kind.
   *
   * Returns a DisposeHandle that unregisters the kind when dispose() is
   * called (safe to call multiple times; idempotent).
   */
  register(
    kindId: string,
    laneRenderer: (props: DataLaneRendererProps) => unknown,
    inspector?: (props: DataItemInspectorProps) => unknown,
    options?: DataKindRegistrationOptions,
  ): DisposeHandle;
}
