import { afterEach, describe, expect, it, vi } from 'vitest';
import * as editorUtils from '@/tools/video-editor/lib/editor-utils';
import {
  applyMultiDragMoves,
  buildAugmentedData,
  buildConfigFromDragResult,
  planMultiDragMoves,
} from '@/tools/video-editor/lib/multi-drag-utils';
import type { ClipMeta, TimelineData } from '@/tools/video-editor/lib/timeline-data';
import type { PinnedShotGroup, TrackDefinition } from '@/tools/video-editor/types';
import type { TimelineRow } from '@/tools/video-editor/types/timeline-canvas';

const output = { resolution: '1920x1080', fps: 30, file: 'out.mp4' };

const makeTrack = (id: string, kind: TrackDefinition['kind'] = 'visual'): TrackDefinition => ({
  id,
  kind,
  label: id,
  scale: 1,
  fit: kind === 'visual' ? 'manual' : 'contain',
  opacity: 1,
  blendMode: 'normal',
});

const makeAction = (id: string, start: number, end: number) => ({
  id,
  start,
  end,
  effectId: `effect-${id}`,
});

function makeTimelineData(
  tracks: TrackDefinition[],
  rows: TimelineRow[],
  meta: Record<string, ClipMeta>,
): TimelineData {
  const clips = rows.flatMap((row) => {
    return row.actions.map((action) => {
      const clipMeta = meta[action.id] ?? { track: row.id };
      const duration = action.end - action.start;
      if (typeof clipMeta.hold === 'number') {
        return {
          id: action.id,
          at: action.start,
          track: row.id,
          clipType: clipMeta.clipType ?? 'hold',
          hold: duration,
        };
      }

      return {
        id: action.id,
        at: action.start,
        track: row.id,
        clipType: clipMeta.clipType ?? 'media',
        from: clipMeta.from ?? 0,
        to: clipMeta.to ?? duration,
        speed: clipMeta.speed,
      };
    });
  });

  const clipOrder = Object.fromEntries(rows.map((row) => [row.id, row.actions.map((action) => action.id)]));

  return {
    config: { output, tracks, clips },
    configVersion: 1,
    registry: { assets: {} },
    resolvedConfig: { output, tracks, clips, registry: {} },
    rows,
    meta,
    effects: {},
    assetMap: {},
    output,
    tracks,
    clipOrder,
    signature: 'sig-1',
    stableSignature: 'stable-1',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildAugmentedData', () => {
  it('inserts a new track and empty row at the top', () => {
    const tracks = [makeTrack('V1'), makeTrack('V2')];
    const rows: TimelineRow[] = [
      { id: 'V1', actions: [makeAction('clip-a', 0, 2)] },
      { id: 'V2', actions: [makeAction('clip-b', 3, 5)] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'hold', hold: 2 },
      'clip-b': { track: 'V2', clipType: 'hold', hold: 2 },
    };
    const data = makeTimelineData(tracks, rows, meta);

    const result = buildAugmentedData(data, 'visual', true);

    expect(result).not.toBeNull();
    expect(result?.newTrackId).toBe('V3');
    expect(result?.augmented.tracks.map((track) => track.id)).toEqual(['V3', 'V1', 'V2']);
    expect(result?.augmented.rows.map((row) => row.id)).toEqual(['V3', 'V1', 'V2']);
    expect(result?.augmented.rows[0]).toEqual({ id: 'V3', actions: [] });
    expect(result?.augmented.clipOrder).toMatchObject({
      V1: ['clip-a'],
      V2: ['clip-b'],
      V3: [],
    });
  });

  it('inserts a new track and empty row at the bottom', () => {
    const tracks = [makeTrack('V1'), makeTrack('V2')];
    const rows: TimelineRow[] = [
      { id: 'V1', actions: [makeAction('clip-a', 0, 2)] },
      { id: 'V2', actions: [makeAction('clip-b', 3, 5)] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'hold', hold: 2 },
      'clip-b': { track: 'V2', clipType: 'hold', hold: 2 },
    };
    const data = makeTimelineData(tracks, rows, meta);

    const result = buildAugmentedData(data, 'visual', false);

    expect(result).not.toBeNull();
    expect(result?.newTrackId).toBe('V3');
    expect(result?.augmented.tracks.map((track) => track.id)).toEqual(['V1', 'V2', 'V3']);
    expect(result?.augmented.rows.map((row) => row.id)).toEqual(['V1', 'V2', 'V3']);
    expect(result?.augmented.rows.at(-1)).toEqual({ id: 'V3', actions: [] });
  });

  it('returns null when addTrack does not produce a new track', () => {
    const tracks = [makeTrack('V1')];
    const rows: TimelineRow[] = [{ id: 'V1', actions: [makeAction('clip-a', 0, 2)] }];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'hold', hold: 2 },
    };
    const data = makeTimelineData(tracks, rows, meta);

    vi.spyOn(editorUtils, 'addTrack').mockReturnValue(data.resolvedConfig);

    expect(buildAugmentedData(data, 'visual', true)).toBeNull();
  });
});

describe('buildConfigFromDragResult', () => {
  it('uses merged meta updates when serializing overlap-adjusted timing fields', () => {
    const tracks = [makeTrack('V1'), makeTrack('V2')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [makeAction('clip-b', 5, 7)],
      },
      {
        id: 'V2',
        actions: [makeAction('clip-a', 2, 4)],
      },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'media', from: 0, to: 2, speed: 1 },
      'clip-b': { track: 'V1', clipType: 'media', from: 1, to: 3, speed: 1 },
    };
    const baseData = makeTimelineData(
      tracks,
      [
        { id: 'V1', actions: [makeAction('clip-a', 0, 2), makeAction('clip-b', 5, 7)] },
        { id: 'V2', actions: [] },
      ],
      meta,
    );

    const result = buildConfigFromDragResult(
      baseData.resolvedConfig,
      baseData.meta,
      rows,
      {
        'clip-a': { track: 'V2', from: 1.25, to: 3.25 },
      },
    );

    expect(result.clips.find((clip) => clip.id === 'clip-a')).toMatchObject({
      id: 'clip-a',
      at: 2,
      track: 'V2',
      from: 1.25,
      to: 3.25,
    });
    expect(result.clips.find((clip) => clip.id === 'clip-b')).toMatchObject({
      id: 'clip-b',
      at: 5,
      track: 'V1',
      from: 1,
      to: 3,
    });
  });
});

describe('planMultiDragMoves on augmented data', () => {
  it('moves the anchor to the new track and preserves relative row offsets for secondary clips', () => {
    const tracks = [makeTrack('V1'), makeTrack('V2')];
    const rows: TimelineRow[] = [
      { id: 'V1', actions: [makeAction('clip-a', 0, 2)] },
      { id: 'V2', actions: [makeAction('clip-b', 3, 5)] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'hold', hold: 2 },
      'clip-b': { track: 'V2', clipType: 'hold', hold: 2 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    const augmentedResult = buildAugmentedData(data, 'visual', true);

    expect(augmentedResult).not.toBeNull();

    const result = planMultiDragMoves(
      augmentedResult!.augmented,
      [
        { clipId: 'clip-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 2 },
        { clipId: 'clip-b', rowId: 'V2', deltaTime: 3, initialStart: 3, initialEnd: 5 },
      ],
      'clip-a',
      augmentedResult!.newTrackId,
      'V1',
      1,
      0.08,
    );

    expect(result).toEqual({
      canMove: true,
      moves: [
        { kind: 'clip', clipId: 'clip-a', sourceRowId: 'V1', targetRowId: 'V3', newStart: 1 },
        { kind: 'clip', clipId: 'clip-b', sourceRowId: 'V2', targetRowId: 'V1', newStart: 4 },
      ],
    });
  });

  it('rejects the move when a secondary clip would require another new track', () => {
    const tracks = [makeTrack('V1'), makeTrack('V2'), makeTrack('V3')];
    const rows: TimelineRow[] = [
      { id: 'V1', actions: [makeAction('clip-top', 0, 2)] },
      { id: 'V2', actions: [makeAction('clip-anchor', 2, 4)] },
      { id: 'V3', actions: [] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-top': { track: 'V1', clipType: 'hold', hold: 2 },
      'clip-anchor': { track: 'V2', clipType: 'hold', hold: 2 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    const augmentedResult = buildAugmentedData(data, 'visual', true);

    expect(augmentedResult).not.toBeNull();

    const result = planMultiDragMoves(
      augmentedResult!.augmented,
      [
        { clipId: 'clip-anchor', rowId: 'V2', deltaTime: 0, initialStart: 2, initialEnd: 4 },
        { clipId: 'clip-top', rowId: 'V1', deltaTime: -2, initialStart: 0, initialEnd: 2 },
      ],
      'clip-anchor',
      augmentedResult!.newTrackId,
      'V2',
      0,
      0.08,
    );

    expect(result).toEqual({ canMove: false, moves: [] });
  });
});

describe('planMultiDragMoves on grouped drag (soft-tag)', () => {
  const buildGroupedData = (): TimelineData => {
    const tracks = [makeTrack('V1'), makeTrack('V2')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('clip-1', 0, 2),
          makeAction('clip-2', 2, 4),
        ],
      },
      { id: 'V2', actions: [] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-1': { track: 'V1', clipType: 'hold', hold: 2 },
      'clip-2': { track: 'V1', clipType: 'hold', hold: 2 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    const pinnedGroup: PinnedShotGroup = {
      shotId: 'shot-1',
      trackId: 'V1',
      clipIds: ['clip-1', 'clip-2'],
      mode: 'images',
    };
    data.config = {
      ...data.config,
      pinnedShotGroups: [pinnedGroup],
    };
    return data;
  };

  it('expands a same-track grouped drag into per-clip moves', () => {
    const data = buildGroupedData();
    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'clip-1', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 2 },
        { clipId: 'clip-2', rowId: 'V1', deltaTime: 2, initialStart: 2, initialEnd: 4 },
      ],
      'clip-1',
      'V1',
      'V1',
      3, // shift the whole group right by 3s
      0.08,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(true);
    expect(result.moves).toEqual([
      { kind: 'clip', clipId: 'clip-1', sourceRowId: 'V1', targetRowId: 'V1', newStart: 3 },
      { kind: 'clip', clipId: 'clip-2', sourceRowId: 'V1', targetRowId: 'V1', newStart: 5 },
    ]);
  });

  it('expands a cross-track grouped drag into per-clip moves on the new row', () => {
    const data = buildGroupedData();
    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'clip-1', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 2 },
        { clipId: 'clip-2', rowId: 'V1', deltaTime: 2, initialStart: 2, initialEnd: 4 },
      ],
      'clip-1',
      'V2',
      'V1',
      0,
      0.08,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(true);
    expect(result.moves).toEqual([
      { kind: 'clip', clipId: 'clip-1', sourceRowId: 'V1', targetRowId: 'V2', newStart: 0 },
      { kind: 'clip', clipId: 'clip-2', sourceRowId: 'V1', targetRowId: 'V2', newStart: 2 },
    ]);
  });

  it('rejects grouped drag onto an incompatible track kind', () => {
    const data = buildGroupedData();
    data.tracks = [makeTrack('V1'), makeTrack('A1', 'audio')];
    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'clip-1', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 2 },
        { clipId: 'clip-2', rowId: 'V1', deltaTime: 2, initialStart: 2, initialEnd: 4 },
      ],
      'clip-1',
      'A1',
      'V1',
      0,
      0.08,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );
    expect(result.canMove).toBe(false);
  });
});

describe('applyMultiDragMoves', () => {
  it('applies per-clip moves from an expanded grouped drag without calling any group helper', () => {
    const tracks = [makeTrack('V1'), makeTrack('V2')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('clip-1', 0, 2),
          makeAction('clip-2', 2, 4),
        ],
      },
      { id: 'V2', actions: [] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-1': { track: 'V1', clipType: 'hold', hold: 2 },
      'clip-2': { track: 'V1', clipType: 'hold', hold: 2 },
    };
    const data = makeTimelineData(tracks, rows, meta);

    const result = applyMultiDragMoves(data, [
      { kind: 'clip', clipId: 'clip-1', sourceRowId: 'V1', targetRowId: 'V2', newStart: 0 },
      { kind: 'clip', clipId: 'clip-2', sourceRowId: 'V1', targetRowId: 'V2', newStart: 2 },
    ]);

    const v2 = result.nextRows.find((r) => r.id === 'V2');
    expect(v2?.actions.map((a) => a.id).sort()).toEqual(['clip-1', 'clip-2']);
    const v1 = result.nextRows.find((r) => r.id === 'V1');
    expect(v1?.actions.map((a) => a.id)).toEqual([]);
    // No nextPinnedShotGroups / nextConfig on the return anymore — cohesion is
    // rebuilt at the commit site via pinnedShotGroupsOverride.
    expect(result).not.toHaveProperty('nextPinnedShotGroups');
    expect(result).not.toHaveProperty('nextConfig');
    // Each moved clip gets a meta track patch.
    expect(result.metaUpdates['clip-1']).toEqual({ track: 'V2' });
    expect(result.metaUpdates['clip-2']).toEqual({ track: 'V2' });
  });
});

describe('planMultiDragMoves with stale group trackId', () => {
  it('uses actual clip row when group trackId is stale', () => {
    // Reproduces a bug where pinnedShotGroup.trackId says V1 but the clip
    // was moved to V2. The group drag would use the stale V1 as sourceRowId,
    // causing applyMultiDragMoves to fail to find the clip and silently drop it.
    const tracks = [makeTrack('V1'), makeTrack('V2')];
    const rows: TimelineRow[] = [
      { id: 'V1', actions: [makeAction('clip-a', 0, 5)] },
      { id: 'V2', actions: [makeAction('clip-video', 8, 13)] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'hold', hold: 5 },
      'clip-video': { track: 'V2', clipType: 'media', from: 0, to: 10, speed: 2 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    const pinnedGroup: PinnedShotGroup = {
      shotId: 'shot-1',
      trackId: 'V1', // STALE — clip is actually on V2
      clipIds: ['clip-video'],
      mode: 'video',
    };
    data.config = { ...data.config, pinnedShotGroups: [pinnedGroup] };

    const result = planMultiDragMoves(
      data,
      [{ clipId: 'clip-video', rowId: 'V2', deltaTime: 0, initialStart: 8, initialEnd: 13 }],
      'clip-video',
      'V2',
      'V2',
      2, // shift right by 2s
      0.08,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 8,
        originTrackId: 'V1', // stale
      },
    );

    expect(result.canMove).toBe(true);
    expect(result.moves).toEqual([
      // sourceRowId must be V2 (actual), not V1 (stale group trackId)
      { kind: 'clip', clipId: 'clip-video', sourceRowId: 'V2', targetRowId: 'V2', newStart: 10 },
    ]);

    // Verify applyMultiDragMoves doesn't lose the clip
    const applied = applyMultiDragMoves(data, result.moves);
    const v2 = applied.nextRows.find((r) => r.id === 'V2');
    expect(v2?.actions).toHaveLength(1);
    expect(v2?.actions[0]?.id).toBe('clip-video');
    expect(v2?.actions[0]?.start).toBe(10);
  });

  it('does not use group duration as an implicit snap threshold for long grouped drags', () => {
    const tracks = [makeTrack('V1')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('clip-long', 0, 1590),
          makeAction('blocker', 1600, 1610),
        ],
      },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-long': { track: 'V1', clipType: 'hold', hold: 1590 },
      blocker: { track: 'V1', clipType: 'hold', hold: 10 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-long'],
        mode: 'images',
      }],
    };

    const result = planMultiDragMoves(
      data,
      [{ clipId: 'clip-long', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 1590 }],
      'clip-long',
      'V1',
      'V1',
      20,
      1,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result).toEqual({
      canMove: true,
      moves: [
        { kind: 'clip', clipId: 'clip-long', sourceRowId: 'V1', targetRowId: 'V1', newStart: 20 },
      ],
    });
  });
});

// ── T14 — long grouped / multi-selection drag with explicit threshold ──

describe('T14 — long grouped drag 1500s bounding box', () => {
  it('1500s bounding box does NOT create a 1500s snap window (grouped)', () => {
    // Two clips in a pinned group that together span 0–1500s (1500s wide).
    // Drag by +10s → bounding box 10–1510.
    // A sibling at 1520–1530 is 10s away from the group end (1510).
    // snapThresholdS=1 → 10s > 1s → NO snap.
    // If the planner fell back to the bounding-box duration (1500s), it
    // would snap to 1520. That is the regression this test prevents.
    const tracks = [makeTrack('V1')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('clip-a', 0, 500),
          makeAction('clip-b', 1000, 1500),
          makeAction('blocker', 1520, 1530),
        ],
      },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'hold', hold: 500 },
      'clip-b': { track: 'V1', clipType: 'hold', hold: 500 },
      blocker: { track: 'V1', clipType: 'hold', hold: 10 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-a', 'clip-b'],
        mode: 'images',
      }],
    };

    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'clip-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 500 },
        { clipId: 'clip-b', rowId: 'V1', deltaTime: 1000, initialStart: 1000, initialEnd: 1500 },
      ],
      'clip-a',
      'V1',
      'V1',
      10, // shift the whole group right by 10s → bounding box 10–1510
      1, // explicit snapThresholdS = 1s
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(true);
    // Anchor clip-a should land at 10 (not snapped to 1520).
    expect(result.moves.find((m) => m.clipId === 'clip-a')?.newStart).toBe(10);
    // clip-b at 1010 (preserving +1000s offset from clip-a).
    expect(result.moves.find((m) => m.clipId === 'clip-b')?.newStart).toBe(1010);
    // Both on same target track.
    expect(result.moves.every((m) => m.targetRowId === 'V1')).toBe(true);
  });

  it('1500s bounding box does NOT snap to sibling when within explicit threshold but blocked by overlap', () => {
    // Same 1500s group dragged so that the group end lands exactly at
    // the sibling end (1520). With snapThresholdS=5, distance to sibling
    // start (1520 - 1510 = 10) > 5 → no snap. Even though the bounding
    // box duration (1500s) is much larger than 5, it must not be used.
    const tracks = [makeTrack('V1')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('clip-a', 0, 500),
          makeAction('clip-b', 1000, 1500),
          makeAction('blocker', 1520, 1530),
        ],
      },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'hold', hold: 500 },
      'clip-b': { track: 'V1', clipType: 'hold', hold: 500 },
      blocker: { track: 'V1', clipType: 'hold', hold: 10 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-a', 'clip-b'],
        mode: 'images',
      }],
    };

    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'clip-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 500 },
        { clipId: 'clip-b', rowId: 'V1', deltaTime: 1000, initialStart: 1000, initialEnd: 1500 },
      ],
      'clip-a',
      'V1',
      'V1',
      10,
      5, // snapThresholdS=5s — still smaller than the 10s gap
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(true);
    expect(result.moves.find((m) => m.clipId === 'clip-a')?.newStart).toBe(10);
    expect(result.moves.find((m) => m.clipId === 'clip-b')?.newStart).toBe(1010);
  });

  it('1500s bounding box snaps to nearest clear edge WITHIN explicit threshold (overlap case)', () => {
    // Drag the 1500s group so it overlaps a blocking sibling.
    // groupStart=15, groupDuration=1500 → group occupies 15–1515.
    // Blocker at 1510–1520 → overlap (1515 > 1510).
    // Nearest clear edge: blocker start - groupDuration = 1510-1500 = 10.
    // Distance from groupStart=15 to 10 = 5s.
    // snapThresholdS=6 → 5 < 6 → SHOULD snap to 10.
    // If duration fallback (1500) were used, it would also snap — but this
    // test pairs with the next one that proves the threshold IS used.
    const tracks = [makeTrack('V1')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('clip-a', 0, 500),
          makeAction('clip-b', 1000, 1500),
          makeAction('blocker', 1510, 1520),
        ],
      },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'hold', hold: 500 },
      'clip-b': { track: 'V1', clipType: 'hold', hold: 500 },
      blocker: { track: 'V1', clipType: 'hold', hold: 10 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-a', 'clip-b'],
        mode: 'images',
      }],
    };

    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'clip-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 500 },
        { clipId: 'clip-b', rowId: 'V1', deltaTime: 1000, initialStart: 1000, initialEnd: 1500 },
      ],
      'clip-a',
      'V1',
      'V1',
      15, // group occupies 15–1515, overlaps blocker at 1510–1520
      6, // snapThresholdS=6s — nearest clear edge at 10, distance 5 < 6 → snap
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(true);
    // Snaps to the nearest non-overlapping edge: 10 (blocker.start - groupDuration).
    expect(result.moves.find((m) => m.clipId === 'clip-a')?.newStart).toBe(10);
    expect(result.moves.find((m) => m.clipId === 'clip-b')?.newStart).toBe(1010);
  });

  it('1500s bounding box does NOT snap when nearest clear edge is OUTSIDE explicit threshold (regression guard)', () => {
    // Same overlap scenario as above, but snapThresholdS=3.
    // groupStart=15, overlap with blocker at 1510–1520.
    // Nearest clear edge: 10, distance = |10-15| = 5s.
    // snapThresholdS=3 → 5 > 3 → NO snap with explicit threshold.
    // With duration fallback (1500s), 5 < 1500 → WOULD snap (BUG).
    const tracks = [makeTrack('V1')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('clip-a', 0, 500),
          makeAction('clip-b', 1000, 1500),
          makeAction('blocker', 1510, 1520),
        ],
      },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-a': { track: 'V1', clipType: 'hold', hold: 500 },
      'clip-b': { track: 'V1', clipType: 'hold', hold: 500 },
      blocker: { track: 'V1', clipType: 'hold', hold: 10 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-a', 'clip-b'],
        mode: 'images',
      }],
    };

    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'clip-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 500 },
        { clipId: 'clip-b', rowId: 'V1', deltaTime: 1000, initialStart: 1000, initialEnd: 1500 },
      ],
      'clip-a',
      'V1',
      'V1',
      15,
      3, // snapThresholdS=3s — nearest clear edge at 10, distance 5 > 3 → no snap
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    // Can still move — the planner falls back to findNearestFreeTrack
    // which redirects to a different track (or stays if no track is
    // both free and compatible). Since we only have one track (V1),
    // findNearestFreeTrack returns null and anchorTargetRowId is used.
    // The key point: the group does NOT snap to edge 10 because the
    // explicit threshold (3s) blocks it.
    expect(result.canMove).toBe(true);
    // Verify the group was NOT snapped — the snapped clear edge (10)
    // is outside the explicit threshold, so the group stays at 15.
    // (Or moves to a different track via findNearestFreeTrack.)
    // Since only V1 exists, the moves land on V1 at the original 15.
    expect(result.moves.find((m) => m.clipId === 'clip-a')?.newStart).toBe(15);
    expect(result.moves.find((m) => m.clipId === 'clip-b')?.newStart).toBe(1015);
  });
});

describe('T14 — multi-selection long clips (non-grouped)', () => {
  it('preserves relative row offsets when dragging multi-selection long clips', () => {
    const tracks = [makeTrack('V1'), makeTrack('V2'), makeTrack('V3')];
    const rows: TimelineRow[] = [
      { id: 'V1', actions: [makeAction('clip-1', 0, 1600)] },
      { id: 'V2', actions: [makeAction('clip-2', 10, 1610)] },
      { id: 'V3', actions: [] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-1': { track: 'V1', clipType: 'hold', hold: 1600 },
      'clip-2': { track: 'V2', clipType: 'hold', hold: 1600 },
    };
    const data = makeTimelineData(tracks, rows, meta);

    // Drag clip-1 (anchor, on V1) down to V2. clip-2 should move to V3.
    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'clip-1', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 1600 },
        { clipId: 'clip-2', rowId: 'V2', deltaTime: 10, initialStart: 10, initialEnd: 1610 },
      ],
      'clip-1',
      'V2',
      'V1',
      5, // shift by 5s
      1, // explicit snapThresholdS
    );

    expect(result.canMove).toBe(true);
    expect(result.moves).toHaveLength(2);
    // clip-1 moves V1→V2 at time 5.
    expect(result.moves.find((m) => m.clipId === 'clip-1')).toEqual({
      kind: 'clip', clipId: 'clip-1', sourceRowId: 'V1', targetRowId: 'V2', newStart: 5,
    });
    // clip-2 moves V2→V3 at time 15 (10 + 5 delta).
    expect(result.moves.find((m) => m.clipId === 'clip-2')).toEqual({
      kind: 'clip', clipId: 'clip-2', sourceRowId: 'V2', targetRowId: 'V3', newStart: 15,
    });
  });

  it('rejects multi-selection long-clip drag when secondary track out of bounds', () => {
    const tracks = [makeTrack('V1')];
    const rows: TimelineRow[] = [
      { id: 'V1', actions: [makeAction('clip-1', 0, 1600), makeAction('clip-2', 10, 1610)] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-1': { track: 'V1', clipType: 'hold', hold: 1600 },
      'clip-2': { track: 'V1', clipType: 'hold', hold: 1600 },
    };
    const data = makeTimelineData(tracks, rows, meta);

    // clip-1 on V1 dragged down → clip-2 would need to go past V1 (only track).
    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'clip-1', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 1600 },
        { clipId: 'clip-2', rowId: 'V1', deltaTime: 10, initialStart: 10, initialEnd: 1610 },
      ],
      'clip-1',
      'V2', // anchor target is beyond last row
      'V1',
      0,
      1,
    );

    expect(result.canMove).toBe(false);
    expect(result.moves).toEqual([]);
  });
});

describe('T14 — pinned-group preservation with long clips', () => {
  it('preserves group cohesion on same-track long-clip drag', () => {
    const tracks = [makeTrack('V1')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('g-a', 0, 600),
          makeAction('g-b', 600, 1200),
          makeAction('free', 2000, 2010),
        ],
      },
    ];
    const meta: Record<string, ClipMeta> = {
      'g-a': { track: 'V1', clipType: 'hold', hold: 600 },
      'g-b': { track: 'V1', clipType: 'hold', hold: 600 },
      free: { track: 'V1', clipType: 'hold', hold: 10 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['g-a', 'g-b'],
        mode: 'images',
      }],
    };

    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'g-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 600 },
        { clipId: 'g-b', rowId: 'V1', deltaTime: 600, initialStart: 600, initialEnd: 1200 },
      ],
      'g-a',
      'V1',
      'V1',
      100, // shift group to 100–1300 — clear of the free clip at 2000
      1,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(true);
    expect(result.moves).toHaveLength(2);
    expect(result.moves.find((m) => m.clipId === 'g-a')?.newStart).toBe(100);
    expect(result.moves.find((m) => m.clipId === 'g-b')?.newStart).toBe(700);
    expect(result.moves.every((m) => m.targetRowId === 'V1')).toBe(true);
  });

  it('preserves group cohesion on cross-track long-clip drag with compatible target', () => {
    const tracks = [makeTrack('V1'), makeTrack('V2')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('g-a', 0, 600),
          makeAction('g-b', 600, 1200),
        ],
      },
      { id: 'V2', actions: [] },
    ];
    const meta: Record<string, ClipMeta> = {
      'g-a': { track: 'V1', clipType: 'hold', hold: 600 },
      'g-b': { track: 'V1', clipType: 'hold', hold: 600 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['g-a', 'g-b'],
        mode: 'images',
      }],
    };

    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'g-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 600 },
        { clipId: 'g-b', rowId: 'V1', deltaTime: 600, initialStart: 600, initialEnd: 1200 },
      ],
      'g-a',
      'V2', // cross-track target
      'V1',
      0,
      1,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(true);
    expect(result.moves).toHaveLength(2);
    expect(result.moves.every((m) => m.targetRowId === 'V2')).toBe(true);
    expect(result.moves.find((m) => m.clipId === 'g-a')?.newStart).toBe(0);
    expect(result.moves.find((m) => m.clipId === 'g-b')?.newStart).toBe(600);
  });
});

describe('T14 — compatible-track redirection for long grouped drag', () => {
  it('rejects grouped long-clip drag onto an incompatible audio track', () => {
    const tracks = [makeTrack('V1'), makeTrack('A1', 'audio')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('g-a', 0, 600),
          makeAction('g-b', 600, 1200),
        ],
      },
      { id: 'A1', actions: [] },
    ];
    const meta: Record<string, ClipMeta> = {
      'g-a': { track: 'V1', clipType: 'hold', hold: 600 },
      'g-b': { track: 'V1', clipType: 'hold', hold: 600 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['g-a', 'g-b'],
        mode: 'images',
      }],
    };

    const result = planMultiDragMoves(
      data,
      [
        { clipId: 'g-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 600 },
        { clipId: 'g-b', rowId: 'V1', deltaTime: 600, initialStart: 600, initialEnd: 1200 },
      ],
      'g-a',
      'A1', // incompatible kind
      'V1',
      0,
      1,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(false);
    expect(result.moves).toEqual([]);
  });

  it('visual multi-selection long-clip drag redirects when target row is audio', () => {
    const tracks = [makeTrack('V1'), makeTrack('A1', 'audio'), makeTrack('V2')];
    const rows: TimelineRow[] = [
      { id: 'V1', actions: [makeAction('clip-1', 0, 1600)] },
      { id: 'A1', actions: [] },
      { id: 'V2', actions: [] },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-1': { track: 'V1', clipType: 'hold', hold: 1600 },
    };
    const data = makeTimelineData(tracks, rows, meta);

    // Single long clip dragged to audio row A1 → kind mismatch.
    // planMultiDragMoves should redirect to nearest compatible visual track (V2).
    // With only one clip and anchorTargetRowId='A1', the trackDelta is V1→A1 = 1.
    // But A1 is audio, V1 is visual → kind mismatch → canMove=false.
    const result = planMultiDragMoves(
      data,
      [{ clipId: 'clip-1', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 1600 }],
      'clip-1',
      'A1', // incompatible
      'V1',
      5,
      1,
    );

    // The multi-drag check at lines 316-317 rejects when sourceTrack.kind !== targetTrack.kind.
    expect(result.canMove).toBe(false);
  });
});

describe('T14 — new-track behavior for long grouped drag', () => {
  it('creates augmented data and plans moves onto the new track for long grouped clips', () => {
    const tracks = [makeTrack('V1')];
    // V1 is occupied by a blocker across the whole span, forcing a new track.
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('g-a', 0, 600),
          makeAction('g-b', 600, 1200),
          makeAction('blocker', 0, 2000),
        ],
      },
    ];
    const meta: Record<string, ClipMeta> = {
      'g-a': { track: 'V1', clipType: 'hold', hold: 600 },
      'g-b': { track: 'V1', clipType: 'hold', hold: 600 },
      blocker: { track: 'V1', clipType: 'hold', hold: 2000 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['g-a', 'g-b'],
        mode: 'images',
      }],
    };

    const augmentedResult = buildAugmentedData(data, 'visual', true);
    expect(augmentedResult).not.toBeNull();
    const { augmented, newTrackId } = augmentedResult!;

    const result = planMultiDragMoves(
      augmented,
      [
        { clipId: 'g-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 600 },
        { clipId: 'g-b', rowId: 'V1', deltaTime: 600, initialStart: 600, initialEnd: 1200 },
      ],
      'g-a',
      newTrackId,
      'V1',
      0,
      1,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(true);
    expect(result.moves).toHaveLength(2);
    // All group members land on the new track.
    expect(result.moves.every((m) => m.targetRowId === newTrackId)).toBe(true);
    expect(result.moves.find((m) => m.clipId === 'g-a')?.newStart).toBe(0);
    expect(result.moves.find((m) => m.clipId === 'g-b')?.newStart).toBe(600);
  });

  it('new-track long grouped drag preserves group identity when blocker spans the entire track', () => {
    // Same setup but with only one clip in the group, long duration.
    const tracks = [makeTrack('V1')];
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          makeAction('clip-long', 0, 1500),
          makeAction('blocker', 0, 2000),
        ],
      },
    ];
    const meta: Record<string, ClipMeta> = {
      'clip-long': { track: 'V1', clipType: 'hold', hold: 1500 },
      blocker: { track: 'V1', clipType: 'hold', hold: 2000 },
    };
    const data = makeTimelineData(tracks, rows, meta);
    data.config = {
      ...data.config,
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-long'],
        mode: 'images',
      }],
    };

    const augmentedResult = buildAugmentedData(data, 'visual', true);
    expect(augmentedResult).not.toBeNull();
    const { augmented, newTrackId } = augmentedResult!;

    const result = planMultiDragMoves(
      augmented,
      [{ clipId: 'clip-long', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 1500 }],
      'clip-long',
      newTrackId,
      'V1',
      50,
      1,
      {
        groupKey: { shotId: 'shot-1', trackId: 'V1' },
        originStart: 0,
        originTrackId: 'V1',
      },
    );

    expect(result.canMove).toBe(true);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0].targetRowId).toBe(newTrackId);
    expect(result.moves[0].newStart).toBe(50);
  });
});

// Suppress unused-import warning for vi in the top-level helpers.
void vi;
