// [CONVERGE-WITH-M1] Pure, synchronous lane assembly. Every input is
// injected: the registered-kind snapshot, resolved clips, and per-asset
// segments fetched by the host (Batch 6 hook). No IO, no async — the data
// plane never fetches.
//
// Mapping: source→timeline uses the exact inverse of `getSourceTime`
// (lib/timeline-data.ts: `source = clip.from + (time − clip.at) · speed`), so
// `timeline = clip.at + (source − clip.from) / clip.speed`. Renderers never
// reimplement trim/speed algebra.
//
// Evidence is not an edit: a segment appears wherever an authored clip
// (`clip.asset`) maps it, unclamped by the trim window; lanes never feed
// duration, rows, or export scanning.

import { getClipAssetMediaType } from '@/tools/video-editor/clip-types/runtime.ts';
import type { TimelineData, TranscriptSegment } from '@/tools/video-editor/lib/timeline-data.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import { adaptTranscript } from './adaptTranscript.ts';
import {
  DEFAULT_DATA_LANE_HEIGHT,
  type DataCoordinateDomain,
  type DataItemInspectorRef,
  type DataLaneItemView,
  type DataLaneRendererRef,
  type DataLaneView,
  type DataShape,
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
}

/** Inverse of `getSourceTime`: source seconds → timeline seconds. */
const timelineTimeForSourceTime = (
  clip: { readonly at: number; readonly from?: number; readonly speed?: number },
  sourceTime: number,
): number => clip.at + (sourceTime - (clip.from ?? 0)) / (clip.speed ?? 1);

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Assemble data lanes from injected transcript segments. Transcripts attach
 * to sound-bearing media only (`video` | `audio` via getClipAssetMediaType);
 * clips without an asset, and assets no clip references, contribute nothing.
 * Items whose schemaRef matches no registered kind land in an opaque lane.
 */
export function assembleDataLanes(input: AssembleDataLanesInput): readonly DataLaneView[] {
  const { kinds, clips, segmentsByAsset } = input;

  const kindBySchemaRef = new Map<string, DataKindSnapshotRecord>();
  for (const kind of kinds) {
    // First snapshot record wins on a shared schemaRef (deterministic).
    if (!kindBySchemaRef.has(kind.schemaRef)) kindBySchemaRef.set(kind.schemaRef, kind);
  }

  const viewsBySchemaRef = new Map<string, DataLaneItemView[]>();
  for (const clip of clips) {
    if (!clip.asset) continue;
    // Transcripts attach to sound-bearing media only.
    const media = getClipAssetMediaType(clip);
    if (media !== 'video' && media !== 'audio') continue;
    const segments = segmentsByAsset[clip.asset];
    if (!segments?.length) continue;

    const items = adaptTranscript(segments, { assetId: clip.asset, clipId: clip.id });
    for (const item of items) {
      const view: DataLaneItemView = {
        item,
        timelineStart: timelineTimeForSourceTime(clip, item.extent.start),
        timelineEnd: timelineTimeForSourceTime(clip, item.extent.end ?? item.extent.start),
        clipId: clip.id,
      };
      const bucket = viewsBySchemaRef.get(item.schemaRef);
      if (bucket) bucket.push(view);
      else viewsBySchemaRef.set(item.schemaRef, [view]);
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
