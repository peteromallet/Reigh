import { describe, expect, it } from 'vitest';
import { findBestGroupStart, resolveOverlaps } from './resolve-overlaps';
import type { ClipMeta, TimelineRow } from '../types';

const makeAction = (id: string, start: number, end: number) => ({
  id,
  start,
  end,
  effectId: `effect-${id}`,
});

describe('resolve-overlaps utilities', () => {
  it('returns overlap adjustments and timed meta patches for single-clip overlap resolution', () => {
    const rows: TimelineRow[] = [{
      id: 'V1',
      actions: [
        makeAction('sibling', 0, 2),
        makeAction('clip-1', 1, 4),
      ],
    }];
    const meta: Record<string, ClipMeta> = {
      'clip-1': { id: 'clip-1', at: 1, track: 'V1', clipType: 'media', from: 0, to: 3, speed: 1 },
    };

    const result = resolveOverlaps(rows, 'V1', 'clip-1', meta);

    expect(result.rows[0]?.actions.find((action) => action.id === 'clip-1')).toMatchObject({
      start: 2,
      end: 5,
    });
    expect(result.metaPatches['clip-1']).toEqual({ from: 1, to: 4 });
    expect(result.adjustments).toEqual([{ clipId: 'clip-1', requestedStart: 1, actualStart: 2 }]);
  });

  it('finds the nearest valid start for a moved clip extent', () => {
    const siblings = [
      makeAction('sibling-a', 0, 2),
      makeAction('sibling-b', 8, 10),
    ];

    expect(findBestGroupStart({ start: 1, end: 5 }, siblings)).toBe(2);
    expect(findBestGroupStart({ start: -3, end: 1 }, siblings)).toBe(2);
  });
});
