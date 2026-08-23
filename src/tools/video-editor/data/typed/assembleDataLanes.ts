// [CONVERGE-WITH-M1] Pure, synchronous lane assembly. Every input is
// injected: the registered-kind snapshot, resolved clips, and SOURCE data
// items — host-fetched transcript segments adapt into source items (the
// producer path) and join any persisted bundle items passed via
// `sourceItemsBySchemaRef` (V2's sole kind-agnostic ingest seam). No IO,
// no async — the data plane never fetches.
//
// Mapping: one source-item pool feeds a single remap pass. A source item
// attaches wherever an authored clip (`clip.asset` === the item's
// `sourceArtifactRef.assetId`) maps it, through the exact inverse of
// `getSourceTime` (lib/timeline-data.ts:
// `source = clip.from + (time − clip.at) · speed`), so
// `timeline = clip.at + (source − clip.from) / clip.speed`. Occurrence ids
// (`${sourceItemId}@${clipId}`) are view-only derivatives; views are never
// persisted and renderers never reimplement trim/speed algebra.
//
// Evidence is not an edit: items appear unclamped by the trim window; lanes
// never feed duration, rows, or export scanning.

import { getClipAssetMediaType } from '@/tools/video-editor/clip-types/runtime.ts';
import type { TimelineData, TranscriptSegment } from '@/tools/video-editor/lib/timeline-data.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import { adaptTranscript } from './adaptTranscript.ts';
import {
  DEFAULT_DATA_LANE_HEIGHT,
  freezeDataItem,
  type DataCoordinateDomain,
  type DataItemInspectorRef,
  type DataLaneItemView,
  type DataLaneRendererRef,
  type DataLaneView,
  type DataShape,
  type FrozenDataItem,
  type SourceFrozenDataItem,
} from './envelope.ts';

/**
 * Structural subset of a host `DataKindRegistry` record (Batch 3) that lane
 * assembly consumes. Full registry records are structurally assignable —
 * extra fields are ignored.
 */
export interface DataKindSnapshotRecord {
  readonly kindId: string;
  readonly schemaRef: string;
  readonly shape: DataShape;
  readonly domain: DataCoordinateDomain;
  readonly label?: string;
  readonly order?: number;
  readonly laneRenderer?: DataLaneRendererRef;
  readonly inspector?: DataItemInspectorRef;
}

export interface AssembleDataLanesInput {
  /** Registered-kind snapshot (gated/declared upstream). */
  kinds: readonly DataKindSnapshotRecord[];
  /** Resolved clips; `assetEntry` attached by buildTimelineCommandData. */
  clips: ResolvedTimelineConfig['clips'];
  /** Injected per-asset segments; the host fetched them (no IO here). */
  segmentsByAsset: Readonly<Record<string, readonly TranscriptSegment[] | null | undefined>>;
  /**
   * V2's sole kind-agnostic ingest seam — persisted SOURCE items
   * (`SourceFrozenDataItem`: native source domain, `id` already the durable
   * content-stable sourceItemId, no occurrence/view chrome) keyed by
   * qualified schemaRef. They join transcript-derived source items in one
   * pool before the per-clip remap; extents are read in the artifact's
   * source coordinates and mapped through the clip algebra like any other
   * source item. Unknown schemaRefs stay opaque.
   */
  sourceItemsBySchemaRef?: Readonly<Record<string, readonly SourceFrozenDataItem[]>>;
}
/** Inverse of `getSourceTime`: source seconds → timeline seconds. */
const timelineTimeForSourceTime = (
  clip: { readonly at: number; readonly from?: number; readonly speed?: number },
  sourceTime: number,
): number => clip.at + (sourceTime - (clip.from ?? 0)) / (clip.speed ?? 1);

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/**
 * Strip occurrence chrome from an adapter item → persisted-plane shape
 * ([CONVERGE-WITH-M1] `SourceFrozenDataItem`). Items without provenance get
 * an empty `assetId`, which can never match a clip and therefore never maps.
 */
const toSourceItem = (item: FrozenDataItem): SourceFrozenDataItem => ({
  id: item.sourceItemId ?? item.id,
  shape: item.shape,
  domain: item.domain,
  extent: item.extent,
  schemaRef: item.schemaRef,
  payload: item.payload,
  sourceArtifactRef: { assetId: item.sourceArtifactRef?.assetId ?? '' },
  provenance: item.provenance,
});


/**
 * Assemble data lanes from one SOURCE-item pool. Host-fetched transcript
 * segments adapt per sound-bearing asset (`video` | `audio` via
 * getClipAssetMediaType) into source items and join any persisted items
 * injected via `sourceItemsBySchemaRef`; every source item then remaps onto
 * each clip whose `asset` matches its `sourceArtifactRef.assetId`. Assets no
 * clip references contribute nothing. Items whose schemaRef matches no
 * registered kind land in an opaque lane.
 */
export function assembleDataLanes(input: AssembleDataLanesInput): readonly DataLaneView[] {
  const { kinds, clips, segmentsByAsset, sourceItemsBySchemaRef } = input;

  const kindBySchemaRef = new Map<string, DataKindSnapshotRecord>();
  for (const kind of kinds) {
    // First snapshot record wins on a shared schemaRef (deterministic).
    if (!kindBySchemaRef.has(kind.schemaRef)) kindBySchemaRef.set(kind.schemaRef, kind);
  }

  // --- SOURCE-item pool ------------------------------------------------------
  // Content-addressed: one entry per durable sourceItemId (keep-first).
  // Identical-content transcript segments share an id by design and collapse
  // here; their occurrences stay distinct across (not within) clips below.
  const pool = new Map<string, SourceFrozenDataItem>();
  const addSourceItem = (item: SourceFrozenDataItem): void => {
    if (!pool.has(item.id)) pool.set(item.id, item);
  };

  // Producer path: adapt at ASSET level — occurrence chrome is derived per
  // referencing clip in the remap below, never baked in here.
  const soundBearingAssets: string[] = [];
  const seenAssets = new Set<string>();
  for (const clip of clips) {
    if (!clip.asset || seenAssets.has(clip.asset)) continue;
    const media = getClipAssetMediaType(clip);
    if (media !== 'video' && media !== 'audio') continue;
    seenAssets.add(clip.asset);
    soundBearingAssets.push(clip.asset);
  }
  soundBearingAssets.sort(compareStrings);
  for (const assetId of soundBearingAssets) {
    const segments = segmentsByAsset[assetId];
    if (!segments?.length) continue;
    for (const adapted of adaptTranscript(segments, { assetId })) {
      addSourceItem(toSourceItem(adapted));
    }
  }

  // Persisted plane: bundle items ride in verbatim (strict-parsed upstream
  // by timelineBundle.ts); keep-first keeps pool identity deterministic.
  if (sourceItemsBySchemaRef) {
    for (const items of Object.values(sourceItemsBySchemaRef)) {
      for (const item of items ?? []) addSourceItem(item);
    }
  }

  // --- Remap: source items → per-clip occurrences ----------------------------
  const viewsBySchemaRef = new Map<string, DataLaneItemView[]>();
  // Timeline-domain source items are already expressed in the canonical
  // timeline coordinate system. They project exactly once, without inventing
  // a carrier clip or bypassing the source-item ingest/provenance contract.
  for (const src of pool.values()) {
    if (src.domain !== 'timeline_seconds') continue;
    const item: FrozenDataItem = freezeDataItem({
      id: `${src.id}@timeline`,
      sourceItemId: src.id,
      shape: src.shape,
      domain: src.domain,
      extent: src.extent,
      schemaRef: src.schemaRef,
      payload: src.payload,
      provenance: src.provenance,
      sourceArtifactRef: src.sourceArtifactRef,
    });
    const view: DataLaneItemView = {
      item,
      timelineStart: src.extent.start,
      timelineEnd: src.extent.end ?? src.extent.start,
    };
    const bucket = viewsBySchemaRef.get(src.schemaRef);
    if (bucket) bucket.push(view);
    else viewsBySchemaRef.set(src.schemaRef, [view]);
  }
  for (const clip of clips) {
    if (!clip.asset) continue;
    for (const src of pool.values()) {
      if (src.domain === 'timeline_seconds') continue;
      if (src.sourceArtifactRef.assetId !== clip.asset) continue;
      const item: FrozenDataItem = freezeDataItem({
        id: `${src.id}@${clip.id}`,
        sourceItemId: src.id,
        shape: src.shape,
        domain: src.domain,
        extent: src.extent,
        schemaRef: src.schemaRef,
        payload: src.payload,
        provenance: src.provenance,
        sourceArtifactRef: src.sourceArtifactRef,
        entityRef: { kind: 'clip', id: clip.id },
      });
      const view: DataLaneItemView = {
        item,
        timelineStart: timelineTimeForSourceTime(clip, src.extent.start),
        timelineEnd: timelineTimeForSourceTime(clip, src.extent.end ?? src.extent.start),
        clipId: clip.id,
      };
      const bucket = viewsBySchemaRef.get(src.schemaRef);
      if (bucket) bucket.push(view);
      else viewsBySchemaRef.set(src.schemaRef, [view]);
    }
  }

  const registered: Array<{ order: number; lane: DataLaneView }> = [];
  const opaque: DataLaneView[] = [];
  for (const [schemaRef, bucket] of viewsBySchemaRef) {
    const items = Object.freeze([...bucket].sort((a, b) =>
      (a.timelineStart - b.timelineStart) || compareStrings(a.item.id, b.item.id)));
    const kind = kindBySchemaRef.get(schemaRef);
    if (kind) {
      registered.push({
        order: kind.order ?? Number.MAX_SAFE_INTEGER,
        lane: Object.freeze({
          laneId: kind.kindId,
          kindId: kind.kindId,
          label: kind.label ?? kind.kindId,
          schemaRef: kind.schemaRef,
          shape: kind.shape,
          domain: kind.domain,
          items,
          hidden: false,
          height: DEFAULT_DATA_LANE_HEIGHT,
          laneRenderer: kind.laneRenderer,
          inspector: kind.inspector,
          opaque: false,
        }),
      });
    } else {
      opaque.push(Object.freeze({
        laneId: `opaque:${schemaRef}`,
        kindId: '',
        label: schemaRef,
        schemaRef,
        shape: bucket[0].item.shape,
        // Opaque lanes keep their items' declared domain; the explicit
        // fallback covers a malformed adapter item at runtime.
        domain: bucket[0].item.domain ?? 'timeline_seconds',
        items,
        hidden: false,
        height: DEFAULT_DATA_LANE_HEIGHT,
        opaque: true,
      }));
    }
  }

  registered.sort((a, b) => (a.order - b.order) || compareStrings(a.lane.kindId, b.lane.kindId));
  opaque.sort((a, b) => compareStrings(a.laneId, b.laneId));
  return Object.freeze([...registered.map((entry) => entry.lane), ...opaque]);
}

/**
 * Pure TimelineData patch: replace `dataLanes`, preserve every other field by
 * reference. Shallow clone — the base is left untouched.
 *
 * Batch 5 made `TimelineData.dataLanes` a required field, so the former
 * readonly-intersection return is redundant (and no longer typechecks).
 */
export function mergeDataLanes(
  base: TimelineData,
  views: readonly DataLaneView[],
): TimelineData {
  return { ...base, dataLanes: [...views] };
}
