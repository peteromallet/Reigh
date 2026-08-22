import { describe, expect, it } from 'vitest';
import type { TimelineData, TranscriptSegment } from '@/tools/video-editor/lib/timeline-data.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import { TRANSCRIPT_SCHEMA_REF } from './adaptTranscript.ts';
import { assembleDataLanes, mergeDataLanes } from './assembleDataLanes.ts';
import type { DataKindSnapshotRecord } from './assembleDataLanes.ts';
import type { DataLaneView } from './envelope.ts';

const SEGMENT: TranscriptSegment = { start: 2, end: 4, text: 'shared' };

const mediaEntry = (file: string, type: string) => ({ file, src: file, type });

/** Video clip at t=10 trimming source seconds [2, ∞) at speed 1. */
const CLIP_C1 = {
  id: 'c1',
  at: 10,
  track: 'v1',
  asset: 'a',
  from: 2,
  speed: 1,
  assetEntry: mediaEntry('a.mp4', 'video/mp4'),
};

/** Same asset reused: clip at t=0, untrimmed, speed 2. */
const CLIP_C2 = {
  id: 'c2',
  at: 0,
  track: 'v1',
  asset: 'a',
  from: 0,
  speed: 2,
  assetEntry: mediaEntry('a.mp4', 'video/mp4'),
};

const transcriptKind = (overrides: Partial<DataKindSnapshotRecord> = {}): DataKindSnapshotRecord => ({
  kindId: 'transcript',
  schemaRef: TRANSCRIPT_SCHEMA_REF,
  shape: 'interval',
  domain: 'source_seconds',
  label: 'Transcript',
  laneRenderer: (props) => props,
  inspector: (props) => props,
  ...overrides,
});

const clips = (list: Array<Record<string, unknown>>) =>
  list as unknown as ResolvedTimelineConfig['clips'];

// Type-level gate: the data plane is synchronous — no Promise may appear.
type ReturnsPromise<T> = Promise<unknown> extends T ? true : false;

describe('assembleDataLanes', () => {
  it('maps one source segment on two clips to two views sharing sourceItemId', () => {
    const lanes = assembleDataLanes({
      kinds: [transcriptKind()],
      clips: clips([CLIP_C1, CLIP_C2]),
      segmentsByAsset: { a: [SEGMENT] },
    });
    expect(lanes).toHaveLength(1);
    const [lane] = lanes;
    expect(lane.laneId).toBe('transcript');
    expect(lane.kindId).toBe('transcript');
    expect(lane.label).toBe('Transcript');
    expect(lane.schemaRef).toBe(TRANSCRIPT_SCHEMA_REF);
    expect(lane.opaque).toBe(false);
    expect(lane.hidden).toBe(false);

    // Sorted by timelineStart: c2 maps [2,4]s at speed 2 → [1,2]; c1 → [10,12].
    expect(lane.items.map((view) => view.item.id)).toEqual(['a:c2:0', 'a:c1:0']);
    const [onC2, onC1] = lane.items;
    expect(onC2.item.sourceItemId).toBe('a:src:0');
    expect(onC1.item.sourceItemId).toBe('a:src:0');
    expect(onC2.timelineStart).toBe(1);
    expect(onC2.timelineEnd).toBe(2);
    expect(onC2.clipId).toBe('c2');
    expect(onC1.timelineStart).toBe(10);
    expect(onC1.timelineEnd).toBe(12);
    expect(onC1.clipId).toBe('c1');
  });

  it('carries renderer refs only for registered kinds', () => {
    const registeredKind = transcriptKind();
    const renderer = registeredKind.laneRenderer;
    const inspector = registeredKind.inspector;
    const registered = assembleDataLanes({
      kinds: [registeredKind],
      clips: clips([CLIP_C2]),
      segmentsByAsset: { a: [SEGMENT] },
    });
    expect(registered[0].laneRenderer).toBe(renderer);
    expect(registered[0].inspector).toBe(inspector);

    // Kind registered under a different schemaRef → transcript stays opaque.
    const mismatched = assembleDataLanes({
      kinds: [transcriptKind({ kindId: 'other', schemaRef: 'other.schema/v1' })],
      clips: clips([CLIP_C2]),
      segmentsByAsset: { a: [SEGMENT] },
    });
    expect(mismatched[0].opaque).toBe(true);
    expect(mismatched[0].laneRenderer).toBeUndefined();
    expect(mismatched[0].inspector).toBeUndefined();
  });

  it('lists unknown-schemaRef items in an opaque lane without renderer refs', () => {
    const lanes = assembleDataLanes({
      kinds: [],
      clips: clips([CLIP_C2]),
      segmentsByAsset: { a: [SEGMENT] },
    });
    expect(lanes).toHaveLength(1);
    const [lane] = lanes;
    expect(lane.opaque).toBe(true);
    expect(lane.kindId).toBe('');
    expect(lane.laneId).toBe(`opaque:${TRANSCRIPT_SCHEMA_REF}`);
    expect(lane.label).toBe(TRANSCRIPT_SCHEMA_REF);
    expect(lane.schemaRef).toBe(TRANSCRIPT_SCHEMA_REF);
    expect(lane.laneRenderer).toBeUndefined();
    expect(lane.inspector).toBeUndefined();
    expect(lane.items).toHaveLength(1);
  });

  it('stamps domain on lanes at assembly time from the kind record / item domain', () => {
    const registered = assembleDataLanes({
      kinds: [transcriptKind({ domain: 'source_seconds' })],
      clips: clips([CLIP_C2]),
      segmentsByAsset: { a: [SEGMENT] },
    });
    expect(registered[0].domain).toBe('source_seconds');
    const opaque = assembleDataLanes({
      kinds: [],
      clips: clips([CLIP_C2]),
      segmentsByAsset: { a: [SEGMENT] },
    });
    // Opaque lanes keep their items' declared domain (adaptTranscript stamps
    // 'source_seconds'; assembleDataLanes' explicit `?? 'timeline_seconds'`
    // fallback covers a future adapter that omits it).
    expect(opaque[0].domain).toBe('source_seconds');
  });

  it('filters to sound-bearing media and clips with assets', () => {
    const lanes = assembleDataLanes({
      kinds: [transcriptKind()],
      clips: clips([
        { id: 'img', at: 0, track: 'v1', asset: 'pic', assetEntry: mediaEntry('p.png', 'image/png') },
        CLIP_C2,
        { id: 'aud', at: 0, track: 'a1', asset: 'm', assetEntry: mediaEntry('m.mp3', 'audio/mpeg') },
        { id: 'noasset', at: 0, track: 'v1' },
      ]),
      segmentsByAsset: {
        a: [{ start: 0, end: 2, text: 'video words' }],
        m: [{ start: 0, end: 1, text: 'audio words' }],
        pic: [{ start: 0, end: 9, text: 'never shown' }],
      },
    });
    // Tie at timelineStart 0 broken by item id: 'a:c2:0' < 'm:aud:0'.
    expect(lanes[0].items.map((view) => view.clipId)).toEqual(['c2', 'aud']);
    expect(lanes[0].items.map((view) => view.item.id)).toEqual(['a:c2:0', 'm:aud:0']);
  });

  it('returns [] when nothing maps', () => {
    expect(assembleDataLanes({ kinds: [], clips: [], segmentsByAsset: {} })).toEqual([]);
    // Assets no clip references contribute nothing.
    expect(assembleDataLanes({
      kinds: [transcriptKind()],
      clips: [],
      segmentsByAsset: { a: [SEGMENT] },
    })).toEqual([]);
    // Clips whose assets have no injected segments contribute nothing.
    expect(assembleDataLanes({
      kinds: [transcriptKind()],
      clips: clips([CLIP_C1]),
      segmentsByAsset: {},
    })).toEqual([]);
    expect(assembleDataLanes({
      kinds: [transcriptKind()],
      clips: clips([CLIP_C1]),
      segmentsByAsset: { a: null },
    })).toEqual([]);
  });

  it('freezes lanes and their view arrays', () => {
    const lanes = assembleDataLanes({
      kinds: [transcriptKind()],
      clips: clips([CLIP_C2]),
      segmentsByAsset: { a: [SEGMENT] },
    });
    expect(Object.isFrozen(lanes)).toBe(true);
    expect(Object.isFrozen(lanes[0])).toBe(true);
    expect(Object.isFrozen(lanes[0].items)).toBe(true);
  });

  it('is synchronous at the type level (no Promise in signature)', () => {
    const lanes = assembleDataLanes({
      kinds: [transcriptKind()],
      clips: clips([CLIP_C2]),
      segmentsByAsset: { a: [SEGMENT] },
    });
    const returnsPromise: ReturnsPromise<typeof lanes> = false;
    expect(returnsPromise).toBe(false);
  });
});

describe('assembleDataLanes — kind-agnostic ingest (G2)', () => {
  it('merges caller-mapped items for a second kind via extraItemsBySchemaRef', () => {
    const beatsKind: DataKindSnapshotRecord = {
      kindId: 'beats',
      schemaRef: 'example.beats/v1',
      shape: 'point',
      domain: 'timeline_seconds',
      label: 'Beats',
    };
    const lanes = assembleDataLanes({
      kinds: [transcriptKind(), beatsKind],
      clips: clips([CLIP_C1]),
      segmentsByAsset: { a: [SEGMENT] },
      extraItemsBySchemaRef: {
        'example.beats/v1': [
          {
            item: {
              id: 'beat-1',
              shape: 'point',
              domain: 'timeline_seconds',
              extent: { start: 3 },
              schemaRef: 'example.beats/v1',
              payload: { velocity: 1 },
              provenance: { adapterId: 'test.beats', adapterVersion: '1' },
            },
            timelineStart: 3,
            timelineEnd: 3,
          },
        ],
        'unknown.opaque/v1': [
          {
            item: {
              id: 'opaque-1',
              shape: 'series',
              domain: 'samples',
              extent: { start: 0, end: 10 },
              schemaRef: 'unknown.opaque/v1',
              payload: null,
              provenance: { adapterId: 'test.unknown', adapterVersion: '1' },
            },
            timelineStart: 0,
            timelineEnd: 10,
          },
        ],
      },
    });

    // Sorted by (order ?? MAX) then kindId: beats < transcript; opaque last.
    expect(lanes.map((lane) => lane.schemaRef)).toEqual([
      'example.beats/v1',
      TRANSCRIPT_SCHEMA_REF,
      'unknown.opaque/v1',
    ]);
    const beats = lanes[0];
    expect(beats.kindId).toBe('beats');
    expect(beats.opaque).toBe(false);
    expect(beats.items).toHaveLength(1);
    expect(beats.items[0].item.id).toBe('beat-1');
    const opaqueLane = lanes[2];
    expect(opaqueLane.opaque).toBe(true);
    expect(opaqueLane.items[0].item.schemaRef).toBe('unknown.opaque/v1');
  });
});

describe('mergeDataLanes', () => {
  const rowsRef = [{ id: 'r1' }] as TimelineData['rows'];
  const metaRef = { c1: { track: 'v1' } } as TimelineData['meta'];
  const base = {
    configVersion: 3,
    signature: 'sig-a',
    stableSignature: 'stable-a',
    rows: rowsRef,
    meta: metaRef,
  } as unknown as TimelineData;

  const lane: DataLaneView = Object.freeze({
    laneId: 'transcript',
    kindId: 'transcript',
    label: 'Transcript',
    schemaRef: TRANSCRIPT_SCHEMA_REF,
    shape: 'interval',
    items: [],
    hidden: false,
    height: 24,
    opaque: false,
  });

  it('replaces dataLanes with a fresh copy of the given views', () => {
    const merged = mergeDataLanes(base, [lane]);
    expect(merged.dataLanes).toEqual([lane]);
    expect(merged.dataLanes).not.toBe([lane]);
  });

  it('preserves every other TimelineData field by reference', () => {
    const merged = mergeDataLanes(base, [lane]);
    expect(merged.rows).toBe(rowsRef);
    expect(merged.meta).toBe(metaRef);
    expect(merged.configVersion).toBe(3);
    expect(merged.signature).toBe('sig-a');
    expect(merged.stableSignature).toBe('stable-a');
  });

  it('does not mutate the base', () => {
    mergeDataLanes(base, [lane]);
    expect(base).not.toHaveProperty('dataLanes');
    expect(Object.isFrozen(base)).toBe(false);
  });

  it('is synchronous at the type level (no Promise in signature)', () => {
    const merged = mergeDataLanes(base, [lane]);
    const returnsPromise: ReturnsPromise<typeof merged> = false;
    expect(returnsPromise).toBe(false);
  });
});
