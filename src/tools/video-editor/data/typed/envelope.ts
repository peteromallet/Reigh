// [CONVERGE-WITH-M1] Provisional envelope for the Reigh data-lane plane.
// These types mirror the typed-timeline-data epic's M1 kernel envelope
// (design: Astrid/.megaplan/initiatives/typed-timeline-data-automation/
// decisions/reigh-editor-data-lanes.md §Envelope types); when the M1 kernel
// lands, these definitions converge onto it. Pure data + one freeze helper:
// no IO, no async.

/** Structural shape of a data item along its primary axis. */
export type DataShape = 'point' | 'interval' | 'series';

/**
 * Ordered coordinate domains (V1 set). Contributions declare one of these as
 * an open string; the host validates it against this set.
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

/** Half-open extent: `start` inclusive, `end` exclusive when present. */
export interface DataExtent {
  start: number;
  end?: number;
}

export interface DataProvenance {
  adapterId: string;
  adapterVersion: string;
  recordedAt?: string;
}

/** Authored relation back to a timeline entity (never a derived position). */
export interface TimelineEntityRef {
  kind: 'timeline' | 'pinned_shot' | 'clip';
  id: string;
}

/**
 * Immutable canonical data item. `id` is the occurrence id, not the source
 * id; `payload` is opaque unless the reader knows `schemaRef`.
 */
export interface FrozenDataItem {
  id: string;
  sourceItemId?: string;
  shape: DataShape;
  domain: DataCoordinateDomain;
  extent: DataExtent;
  schemaRef: string;
  payload: unknown;
  sourceArtifactRef?: { assetId?: string; artifactHash?: string };
  provenance: DataProvenance;
  entityRef?: TimelineEntityRef;
}

/**
 * A persisted source item: a `FrozenDataItem` in its native domain with all
 * view/occurrence chrome stripped — no `entityRef`, no timeline coords, no
 * renderer refs. `id` IS the durable, content-stable `sourceItemId`
 * (occurrences are re-derived at assembly), and `sourceArtifactRef.assetId`
 * is required so every persisted item names its origin artifact.
 * [CONVERGE-WITH-M1] Serialized by TimelineBundle (./timelineBundle.ts).
 */
export interface SourceFrozenDataItem {
  id: string;
  shape: DataShape;
  domain: DataCoordinateDomain;
  extent: DataExtent;
  schemaRef: string;
  payload: unknown;
  sourceArtifactRef: { assetId: string; artifactHash?: string };
  provenance: DataProvenance;
}

/**
 * Props-agnostic stand-ins for the SDK renderer types
 * (`DataLaneRendererProps` / `DataItemInspectorProps` on
 * src/sdk/video/families/dataKind.ts — outside this batch). A function whose
 * parameter is `never` accepts every concrete renderer by contravariance, so
 * registry records stay assignable until M1 owns the shared type.
 */
export type DataLaneRendererRef = (props: never) => unknown;
export type DataItemInspectorRef = (props: never) => unknown;

/** One mapped occurrence of a canonical item on the timeline. */
export interface DataLaneItemView {
  item: FrozenDataItem;
  timelineStart: number;
  timelineEnd: number;
  clipId?: string;
}

/** One lane: a registered kind's (or an unknown schema's) mapped items. */
export interface DataLaneView {
  laneId: string;
  kindId: string;
  label: string;
  schemaRef: string;
  shape: DataShape;
  domain: DataCoordinateDomain;
  items: readonly DataLaneItemView[];
  hidden: boolean;
  height: number;
  laneRenderer?: DataLaneRendererRef;
  inspector?: DataItemInspectorRef;
  opaque: boolean;
}

/** Provisional lane height (px); the canvas mount (Batch 6) owns the visual. */
export const DEFAULT_DATA_LANE_HEIGHT = 24;

/**
 * Deep-freeze an item's envelope structures. Scalar payloads pass through;
 * object payloads are frozen so evidence cannot be edited in place.
 */
export const freezeDataItem = (item: FrozenDataItem): FrozenDataItem => {
  Object.freeze(item.extent);
  Object.freeze(item.provenance);
  if (item.entityRef) Object.freeze(item.entityRef);
  if (item.sourceArtifactRef) Object.freeze(item.sourceArtifactRef);
  if (item.payload !== null && typeof item.payload === 'object') Object.freeze(item.payload);
  return Object.freeze(item);
};
