// @vitest-environment jsdom
//
// T9 regression tests for soft-tag grouped drag. The legacy useClipDrag.test.tsx
// imports deleted projection helpers and is scheduled for T15 cleanup; this file
// stands on its own and targets only the pure helpers in multi-drag-utils +
// pinned-group-projection that back the new grouped-drag commit path.

import { describe, expect, it } from 'vitest';
import {
  applyMultiDragMoves,
  buildAugmentedData,
  planMultiDragMoves,
} from '../lib/multi-drag-utils';
import { orderClipIdsByAt } from '../lib/pinned-group-projection';
import type { PinnedShotGroup, TrackDefinition } from '../types';
import type { ClipMeta, TimelineData } from '../lib/timeline-data';
import type { TimelineRow } from '../types/timeline-canvas';

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

function makeData(opts: {
  tracks: TrackDefinition[];
  rows: TimelineRow[];
  meta: Record<string, ClipMeta>;
  pinnedShotGroups?: PinnedShotGroup[];
}): TimelineData {
  const clips = opts.rows.flatMap((row) => row.actions.map((action) => {
    const clipMeta = opts.meta[action.id] ?? { track: row.id };
    return {
      id: action.id,
      at: action.start,
      track: row.id,
      clipType: clipMeta.clipType ?? 'hold' as const,
      hold: action.end - action.start,
    };
  }));
  return {
    config: {
      output,
      tracks: opts.tracks,
      clips,
      pinnedShotGroups: opts.pinnedShotGroups,
    },
    configVersion: 1,
    registry: { assets: {} },
    resolvedConfig: { output, tracks: opts.tracks, clips, registry: {} },
    rows: opts.rows,
    meta: opts.meta,
    effects: {},
    assetMap: {},
    output,
    tracks: opts.tracks,
    clipOrder: Object.fromEntries(opts.rows.map((r) => [r.id, r.actions.map((a) => a.id)])),
    signature: 'sig',
    stableSignature: 'stable',
  };
}

/**
 * Reproduce the rebuildGroupAfterDrag helper that useClipDrag uses at commit
 * time. Kept inline for this test file so we can exercise the post-drag
 * override construction without spinning up the full hook.
 */
function rebuildGroupAfterDrag(
  currentGroups: PinnedShotGroup[] | undefined,
  draggedGroupKey: { shotId: string; trackId: string },
  newTrackId: string,
  nextRows: TimelineRow[],
): PinnedShotGroup[] | undefined {
  if (!currentGroups || currentGroups.length === 0) return undefined;
  return currentGroups.map((group) => {
    if (group.shotId !== draggedGroupKey.shotId || group.trackId !== draggedGroupKey.trackId) {
      return group;
    }
    const orderedClipIds = orderClipIdsByAt(group.clipIds, { rows: nextRows });
    return { ...group, trackId: newTrackId, clipIds: orderedClipIds };
  });
}

function buildGroupedData(extraFreeClips: Array<{ id: string; row: string; start: number; end: number }> = []) {
  const tracks = [makeTrack('V1'), makeTrack('V2')];
  const rows: TimelineRow[] = [
    {
      id: 'V1',
      actions: [
        makeAction('g-a', 0, 1),
        makeAction('g-b', 1, 2),
        makeAction('g-c', 2, 3),
      ],
    },
    {
      id: 'V2',
      actions: extraFreeClips
        .filter((c) => c.row === 'V2')
        .map((c) => makeAction(c.id, c.start, c.end)),
    },
  ];
  const meta: Record<string, ClipMeta> = {
    'g-a': { track: 'V1', clipType: 'hold', hold: 1 },
    'g-b': { track: 'V1', clipType: 'hold', hold: 1 },
    'g-c': { track: 'V1', clipType: 'hold', hold: 1 },
  };
  for (const c of extraFreeClips) {
    meta[c.id] = { track: c.row, clipType: 'hold', hold: c.end - c.start };
  }
  const group: PinnedShotGroup = {
    shotId: 'shot-1',
    trackId: 'V1',
    clipIds: ['g-a', 'g-b', 'g-c'],
    mode: 'images',
  };
  return { data: makeData({ tracks, rows, meta, pinnedShotGroups: [group] }), group };
}

describe('T9 — soft-tag grouped drag', () => {
  it('same-track no-collision: plans per-clip moves and rebuilds the soft-tag override unchanged', () => {
    const { data } = buildGroupedData();
    const timeDelta = 5;

    const { canMove, moves } = planMultiDragMoves(
      data,
      [
        { clipId: 'g-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 1 },
        { clipId: 'g-b', rowId: 'V1', deltaTime: 1, initialStart: 1, initialEnd: 2 },
        { clipId: 'g-c', rowId: 'V1', deltaTime: 2, initialStart: 2, initialEnd: 3 },
      ],
      'g-a',
      'V1',
      'V1',
      timeDelta,
      0.08,
      { groupKey: { shotId: 'shot-1', trackId: 'V1' }, originStart: 0, originTrackId: 'V1' },
    );

    expect(canMove).toBe(true);
    expect(moves).toHaveLength(3);
    // Every member translates by +5s.
    expect(moves.find((m) => m.clipId === 'g-a')?.newStart).toBe(5);
    expect(moves.find((m) => m.clipId === 'g-b')?.newStart).toBe(6);
    expect(moves.find((m) => m.clipId === 'g-c')?.newStart).toBe(7);

    const { nextRows, metaUpdates } = applyMultiDragMoves(data, moves);

    // All members landed on V1 at their translated positions.
    const v1 = nextRows.find((r) => r.id === 'V1')!;
    const ids = v1.actions.map((a) => a.id).sort();
    expect(ids).toEqual(['g-a', 'g-b', 'g-c']);

    // Same-track → no track patch.
    expect(metaUpdates['g-a']?.track).toBeUndefined();

    // Soft-tag override: trackId unchanged, clipIds in live `at` order.
    const override = rebuildGroupAfterDrag(
      data.config.pinnedShotGroups,
      { shotId: 'shot-1', trackId: 'V1' },
      'V1',
      nextRows,
    );
    expect(override).toEqual([
      {
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['g-a', 'g-b', 'g-c'],
        mode: 'images',
      },
    ]);
  });

  it('same-track colliding with a free clip: planner snaps to the nearest open edge on V1', () => {
    const { data } = buildGroupedData([
      // A free clip sitting where the dragged group would land on V1.
      { id: 'free', row: 'V1', start: 8, end: 10 },
    ]);
    // Add the free clip to V1 row.
    const v1Row = data.rows.find((r) => r.id === 'V1')!;
    v1Row.actions.push(makeAction('free', 8, 10));
    data.meta['free'] = { track: 'V1', clipType: 'hold', hold: 2 };
    data.config.clips.push({ id: 'free', at: 8, track: 'V1', clipType: 'hold', hold: 2 });

    const { canMove, moves } = planMultiDragMoves(
      data,
      [
        { clipId: 'g-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 1 },
        { clipId: 'g-b', rowId: 'V1', deltaTime: 1, initialStart: 1, initialEnd: 2 },
        { clipId: 'g-c', rowId: 'V1', deltaTime: 2, initialStart: 2, initialEnd: 3 },
      ],
      'g-a',
      'V1',
      'V1',
      7, // pushes the group to 7..10, overlapping free clip at 8..10
      3,
      { groupKey: { shotId: 'shot-1', trackId: 'V1' }, originStart: 0, originTrackId: 'V1' },
    );

    expect(canMove).toBe(true);
    expect(moves.every((m) => m.targetRowId === 'V1')).toBe(true);
    expect(moves.map((m) => m.newStart)).toEqual([5, 6, 7]);
    const { nextRows } = applyMultiDragMoves(data, moves);

    const v1 = nextRows.find((r) => r.id === 'V1')!;
    const groupActions = v1.actions
      .filter((a) => ['g-a', 'g-b', 'g-c'].includes(a.id))
      .sort((x, y) => x.start - y.start);
    expect(groupActions.map((a) => a.id)).toEqual(['g-a', 'g-b', 'g-c']);
    expect(groupActions.map((a) => a.start)).toEqual([5, 6, 7]);

    // The rebuilt override keeps the group on the original track.
    const override = rebuildGroupAfterDrag(
      data.config.pinnedShotGroups,
      { shotId: 'shot-1', trackId: 'V1' },
      'V1',
      nextRows,
    );
    expect(override?.[0].clipIds).toEqual(['g-a', 'g-b', 'g-c']);
    expect(override?.[0].trackId).toBe('V1');
  });

  it('cross-track existing-row grouped drag: override trackId updates, clipIds preserved in at order', () => {
    const { data } = buildGroupedData();

    const { canMove, moves } = planMultiDragMoves(
      data,
      [
        { clipId: 'g-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 1 },
        { clipId: 'g-b', rowId: 'V1', deltaTime: 1, initialStart: 1, initialEnd: 2 },
        { clipId: 'g-c', rowId: 'V1', deltaTime: 2, initialStart: 2, initialEnd: 3 },
      ],
      'g-a',
      'V2',
      'V1',
      0,
      0.08,
      { groupKey: { shotId: 'shot-1', trackId: 'V1' }, originStart: 0, originTrackId: 'V1' },
    );

    expect(canMove).toBe(true);
    const { nextRows, metaUpdates } = applyMultiDragMoves(data, moves);

    // All members migrated to V2.
    const v2 = nextRows.find((r) => r.id === 'V2')!;
    expect(v2.actions.map((a) => a.id).sort()).toEqual(['g-a', 'g-b', 'g-c']);
    const v1 = nextRows.find((r) => r.id === 'V1')!;
    expect(v1.actions).toEqual([]);

    // Track patches on every member.
    expect(metaUpdates['g-a']).toEqual({ track: 'V2' });
    expect(metaUpdates['g-b']).toEqual({ track: 'V2' });
    expect(metaUpdates['g-c']).toEqual({ track: 'V2' });

    // Override: trackId updated to V2.
    const override = rebuildGroupAfterDrag(
      data.config.pinnedShotGroups,
      { shotId: 'shot-1', trackId: 'V1' },
      'V2',
      nextRows,
    );
    expect(override).toEqual([
      {
        shotId: 'shot-1',
        trackId: 'V2',
        clipIds: ['g-a', 'g-b', 'g-c'],
        mode: 'images',
      },
    ]);
  });

  it('cross-track NEW-track grouped drag: augmented data produces the new track and override picks it up', () => {
    const { data } = buildGroupedData();

    const augmentedData = buildAugmentedData(data, 'visual', true);
    expect(augmentedData).not.toBeNull();
    const { augmented, newTrackId } = augmentedData!;

    const { canMove, moves } = planMultiDragMoves(
      augmented,
      [
        { clipId: 'g-a', rowId: 'V1', deltaTime: 0, initialStart: 0, initialEnd: 1 },
        { clipId: 'g-b', rowId: 'V1', deltaTime: 1, initialStart: 1, initialEnd: 2 },
        { clipId: 'g-c', rowId: 'V1', deltaTime: 2, initialStart: 2, initialEnd: 3 },
      ],
      'g-a',
      newTrackId,
      'V1',
      0,
      0.08,
      { groupKey: { shotId: 'shot-1', trackId: 'V1' }, originStart: 0, originTrackId: 'V1' },
    );

    expect(canMove).toBe(true);
    const { nextRows, metaUpdates } = applyMultiDragMoves(augmented, moves);

    // All members now on the new track.
    const newTrack = nextRows.find((r) => r.id === newTrackId)!;
    expect(newTrack.actions.map((a) => a.id).sort()).toEqual(['g-a', 'g-b', 'g-c']);
    expect(metaUpdates['g-a']).toEqual({ track: newTrackId });

    // Override: trackId updated to the new track.
    const override = rebuildGroupAfterDrag(
      data.config.pinnedShotGroups,
      { shotId: 'shot-1', trackId: 'V1' },
      newTrackId,
      nextRows,
    );
    expect(override?.[0].trackId).toBe(newTrackId);
    expect(override?.[0].clipIds).toEqual(['g-a', 'g-b', 'g-c']);
  });

  it('rebuildGroupAfterDrag preserves non-dragged groups', () => {
    const groupA: PinnedShotGroup = {
      shotId: 'shot-1',
      trackId: 'V1',
      clipIds: ['g-a', 'g-b'],
      mode: 'images',
    };
    const groupB: PinnedShotGroup = {
      shotId: 'shot-2',
      trackId: 'V2',
      clipIds: ['g-c', 'g-d'],
      mode: 'video',
    };
    const rows: TimelineRow[] = [
      { id: 'V1', actions: [makeAction('g-a', 5, 6), makeAction('g-b', 6, 7)] },
      { id: 'V2', actions: [makeAction('g-c', 0, 1), makeAction('g-d', 1, 2)] },
    ];
    const result = rebuildGroupAfterDrag(
      [groupA, groupB],
      { shotId: 'shot-1', trackId: 'V1' },
      'V1',
      rows,
    );
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({
      shotId: 'shot-1',
      trackId: 'V1',
      clipIds: ['g-a', 'g-b'],
      mode: 'images',
    });
    // Non-dragged group passed through unchanged (identity preserved).
    expect(result![1]).toBe(groupB);
  });
});
