import { describe, expect, it } from 'vitest';
import {
  categorizeSelection,
  findEnclosingPinnedGroup,
  findGroupForTrack,
  orderClipIdsByAt,
  resolveGroupTrackId,
} from '@/tools/video-editor/lib/pinned-group-projection';
import { setPinnedShotGroups } from '@/tools/video-editor/lib/config-utils';
import type { PinnedShotGroup, TimelineConfig } from '@/tools/video-editor/types';
import type { TimelineRow } from '@/tools/video-editor/types/timeline-canvas';

const buildConfig = (): TimelineConfig => setPinnedShotGroups({
  output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
  tracks: [
    { id: 'V1', kind: 'visual', label: 'V1' },
    { id: 'V2', kind: 'visual', label: 'V2' },
  ],
  clips: [
    { id: 'clip-a', at: 0, track: 'V1', clipType: 'hold', hold: 1 },
    { id: 'clip-b', at: 1, track: 'V1', clipType: 'hold', hold: 2 },
    { id: 'clip-c', at: 3, track: 'V1', clipType: 'hold', hold: 1 },
    { id: 'free-1', at: 0, track: 'V2', clipType: 'hold', hold: 5 },
  ],
}, [
  {
    shotId: 'shot-1',
    trackId: 'V1',
    clipIds: ['clip-a', 'clip-b', 'clip-c'],
    mode: 'images',
  },
]);

const buildRows = (rows: Array<{ id: string; clipIds: string[] }>): TimelineRow[] => (
  rows.map((row) => ({
    id: row.id,
    actions: row.clipIds.map((clipId, index) => ({
      id: clipId,
      start: index,
      end: index + 1,
      effectId: `effect-${clipId}`,
    })),
  }))
);

const buildPinnedGroup = (overrides: Partial<PinnedShotGroup> = {}): PinnedShotGroup => ({
  shotId: 'shot-1',
  trackId: 'V1',
  clipIds: ['clip-a', 'clip-b', 'clip-c'],
  mode: 'images',
  ...overrides,
});

describe('findEnclosingPinnedGroup', () => {
  it('returns the group containing a clip', () => {
    const config = buildConfig();
    const result = findEnclosingPinnedGroup(config, 'clip-b');
    expect(result).not.toBeNull();
    expect(result?.group.shotId).toBe('shot-1');
    expect(result?.groupKey).toEqual({ shotId: 'shot-1', trackId: 'V1' });
    expect(result?.index).toBe(0);
  });

  it('returns null when no group contains the clip', () => {
    expect(findEnclosingPinnedGroup(buildConfig(), 'free-1')).toBeNull();
    expect(findEnclosingPinnedGroup(buildConfig(), 'missing')).toBeNull();
  });

  it('handles configs without pinnedShotGroups', () => {
    const config: TimelineConfig = {
      output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
      tracks: [],
      clips: [],
    };
    expect(findEnclosingPinnedGroup(config, 'anything')).toBeNull();
  });
});

describe('categorizeSelection', () => {
  it('separates free clips from enclosing groups', () => {
    const result = categorizeSelection(['clip-a', 'free-1'], buildConfig());
    expect(result.freeClipIds).toEqual(['free-1']);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupKey).toEqual({ shotId: 'shot-1', trackId: 'V1' });
    // Entire group membership, not just the clicked clip.
    expect(result.groups[0].clipIds).toEqual(['clip-a', 'clip-b', 'clip-c']);
  });

  it('deduplicates groups when multiple members are selected', () => {
    const result = categorizeSelection(['clip-a', 'clip-b'], buildConfig());
    expect(result.freeClipIds).toEqual([]);
    expect(result.groups).toHaveLength(1);
  });

  it('handles an all-free selection', () => {
    const result = categorizeSelection(['free-1'], buildConfig());
    expect(result.freeClipIds).toEqual(['free-1']);
    expect(result.groups).toEqual([]);
  });
});

describe('orderClipIdsByAt', () => {
  it('orders ids by live `at` from clips[]', () => {
    const config = buildConfig();
    const reordered = orderClipIdsByAt(['clip-c', 'clip-a', 'clip-b'], { clips: config.clips });
    expect(reordered).toEqual(['clip-a', 'clip-b', 'clip-c']);
  });

  it('orders ids by live `at` from rows', () => {
    const rows: TimelineRow[] = [
      {
        id: 'V1',
        actions: [
          { id: 'clip-a', start: 5, end: 6, effectId: 'effect-clip-a' },
          { id: 'clip-b', start: 0, end: 1, effectId: 'effect-clip-b' },
          { id: 'clip-c', start: 2, end: 3, effectId: 'effect-clip-c' },
        ],
      },
    ];
    const reordered = orderClipIdsByAt(['clip-a', 'clip-b', 'clip-c'], { rows });
    expect(reordered).toEqual(['clip-b', 'clip-c', 'clip-a']);
  });

  it('falls back to original order for unknown ids', () => {
    const reordered = orderClipIdsByAt(['clip-a', 'missing', 'clip-b'], { clips: buildConfig().clips });
    expect(reordered).toEqual(['clip-a', 'clip-b', 'missing']);
  });

  it('uses stable original order when two clips share the same `at`', () => {
    const clips: TimelineConfig['clips'] = [
      { id: 'x', at: 1, track: 'V1', clipType: 'hold', hold: 1 },
      { id: 'y', at: 1, track: 'V1', clipType: 'hold', hold: 1 },
    ];
    expect(orderClipIdsByAt(['x', 'y'], { clips })).toEqual(['x', 'y']);
    expect(orderClipIdsByAt(['y', 'x'], { clips })).toEqual(['y', 'x']);
  });
});

describe('resolveGroupTrackId', () => {
  it('returns the stored track when all group clips still live there', () => {
    const group = buildPinnedGroup();
    const rows = buildRows([
      { id: 'V1', clipIds: ['clip-a', 'clip-b', 'clip-c'] },
      { id: 'V2', clipIds: ['free-1'] },
    ]);

    expect(resolveGroupTrackId(group, rows)).toBe('V1');
  });

  it('returns the row where the group clips moved when the stored track is stale', () => {
    const group = buildPinnedGroup();
    const rows = buildRows([
      { id: 'V1', clipIds: ['free-1'] },
      { id: 'V2', clipIds: ['clip-a', 'clip-b', 'clip-c'] },
    ]);

    expect(resolveGroupTrackId(group, rows)).toBe('V2');
  });

  it('falls back to the stored track for orphaned groups with no live clips', () => {
    const group = buildPinnedGroup();
    const rows = buildRows([
      { id: 'V1', clipIds: ['free-1'] },
      { id: 'V2', clipIds: ['free-2'] },
    ]);

    expect(resolveGroupTrackId(group, rows)).toBe('V1');
  });

  it('returns the row with the most matching clips when a group is split across tracks', () => {
    const group = buildPinnedGroup({
      clipIds: ['clip-a', 'clip-b', 'clip-c', 'clip-d', 'clip-e'],
    });
    const rows = buildRows([
      { id: 'V1', clipIds: ['clip-a', 'clip-b'] },
      { id: 'V2', clipIds: ['clip-c', 'clip-d', 'clip-e'] },
    ]);

    expect(resolveGroupTrackId(group, rows)).toBe('V2');
  });
});

describe('findGroupForTrack', () => {
  it('returns an exact stored-key match when one exists', () => {
    const groups = [
      buildPinnedGroup(),
      buildPinnedGroup({ shotId: 'shot-2', trackId: 'V2', clipIds: ['clip-z'] }),
    ];
    const rows = buildRows([
      { id: 'V1', clipIds: ['clip-a', 'clip-b', 'clip-c'] },
      { id: 'V2', clipIds: ['clip-z'] },
    ]);

    expect(findGroupForTrack(groups, 'shot-1', 'V1', rows)).toBe(groups[0]);
  });

  it('finds a stale group via resolved track lookup', () => {
    const groups = [
      buildPinnedGroup(),
    ];
    const rows = buildRows([
      { id: 'V1', clipIds: ['free-1'] },
      { id: 'V2', clipIds: ['clip-a', 'clip-b', 'clip-c'] },
    ]);

    expect(findGroupForTrack(groups, 'shot-1', 'V2', rows)).toBe(groups[0]);
  });

  it('returns undefined when no group matches the requested shot and track', () => {
    const groups = [
      buildPinnedGroup(),
    ];
    const rows = buildRows([
      { id: 'V1', clipIds: ['clip-a', 'clip-b', 'clip-c'] },
      { id: 'V2', clipIds: [] },
    ]);

    expect(findGroupForTrack(groups, 'shot-2', 'V2', rows)).toBeUndefined();
  });

  it('keeps same-shot groups separate across tracks even when one track id is stale', () => {
    const v1Group = buildPinnedGroup({ trackId: 'stale-v1', clipIds: ['clip-a', 'clip-b'] });
    const v2Group = buildPinnedGroup({ trackId: 'V2', clipIds: ['clip-c', 'clip-d'] });
    const groups = [v1Group, v2Group];
    const rows = buildRows([
      { id: 'V1', clipIds: ['clip-a', 'clip-b'] },
      { id: 'V2', clipIds: ['clip-c', 'clip-d'] },
    ]);

    expect(findGroupForTrack(groups, 'shot-1', 'V1', rows)).toBe(v1Group);
    expect(findGroupForTrack(groups, 'shot-1', 'V2', rows)).toBe(v2Group);
    expect(findGroupForTrack(groups, 'shot-1', 'stale-v1', rows)).toBe(v1Group);
  });
});
