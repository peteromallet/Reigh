import { afterEach, describe, expect, it, vi } from 'vitest';
import * as editorUtils from '@/tools/video-editor/lib/editor-utils';
import { setPinnedShotGroups } from '@/tools/video-editor/lib/config-utils';
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
    data.config = setPinnedShotGroups(data.config, [pinnedGroup]);
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
    data.config = setPinnedShotGroups(data.config, [pinnedGroup]);

    const result = planMultiDragMoves(
      data,
      [{ clipId: 'clip-video', rowId: 'V2', deltaTime: 0, initialStart: 8, initialEnd: 13 }],
      'clip-video',
      'V2',
      'V2',
      2, // shift right by 2s
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
});

// Suppress unused-import warning for vi in the top-level helpers.
void vi;
