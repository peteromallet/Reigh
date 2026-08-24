// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimelineShotGroupView } from '@/tools/video-editor/lib/timeline-domain';
import type { TimelineAction, TimelineRow } from '@/tools/video-editor/types/timeline-canvas';
import { getShotColor, useShotGroups } from './useShotGroups';

function buildAction(id: string, start: number, end: number): TimelineAction {
  return { id, start, end, effectId: `effect-${id}` };
}

function buildGroup(
  overrides: Partial<TimelineShotGroupView> = {},
): TimelineShotGroupView {
  const placedMembers = (overrides.placedMembers ?? [{
    generationId: 'gen-1',
    clipId: 'clip-1',
    assetKey: 'asset-1',
    variantId: 'variant-1',
    mediaRef: 'media-1',
    at: 0,
    duration: 2,
    pooled: false,
    stale: false,
  }]) as TimelineShotGroupView['placedMembers'];
  const pooledMembers = (overrides.pooledMembers ?? []) as TimelineShotGroupView['pooledMembers'];
  return {
    id: 'shot-1:V1',
    shotId: 'shot-1',
    name: 'Shot 1',
    trackId: 'V1',
    mode: 'images',
    placedMembers,
    pooledMembers,
    members: [...placedMembers, ...pooledMembers],
    finalVideo: null,
    derivedFrom: null,
    ...overrides,
  };
}

describe('useShotGroups', () => {
  it('returns deterministic colors and different colors for distinct sample shot ids', () => {
    expect(getShotColor('shot-a')).toBe(getShotColor('shot-a'));
    expect(new Set(['shot-a', 'shot-b', 'shot-c'].map((shotId) => getShotColor(shotId))).size).toBe(3);
  });

  it('returns empty array when pinnedShotGroups is undefined', () => {
    const rows: TimelineRow[] = [{ id: 'V1', actions: [buildAction('clip-1', 0, 1)] }];
    const { result } = renderHook(() => useShotGroups(rows, []));
    expect(result.current).toEqual([]);
  });

  it('returns pinned groups', () => {
    const rows: TimelineRow[] = [{ id: 'V1', actions: [buildAction('clip-1', 0, 2)] }];
    const { result } = renderHook(() => useShotGroups(
      rows,
      [buildGroup({ mode: 'video' })],
    ));

    expect(result.current).toEqual([{
      shotId: 'shot-1',
      shotName: 'Shot 1',
      rowId: 'V1',
      rowIndex: 0,
      start: 0,
      clipIds: ['clip-1'],
      children: [{ clipId: 'clip-1', offset: 0, duration: 2 }],
      color: getShotColor('shot-1'),
      mode: 'video',
      poolGenerationIds: [],
      variantIdsByGenerationId: { 'gen-1': 'variant-1' },
    }]);
  });

  it('resolves stale track ids against the live rows', () => {
    const rows: TimelineRow[] = [{ id: 'V1', actions: [buildAction('clip-1', 0, 2)] }];
    const { result } = renderHook(() => useShotGroups(
      rows,
      [buildGroup({ trackId: 'V2' })],
    ));
    expect(result.current).toEqual([{
      shotId: 'shot-1',
      shotName: 'Shot 1',
      rowId: 'V1',
      rowIndex: 0,
      start: 0,
      clipIds: ['clip-1'],
      children: [{ clipId: 'clip-1', offset: 0, duration: 2 }],
      color: getShotColor('shot-1'),
      mode: 'images',
      poolGenerationIds: [],
      variantIdsByGenerationId: { 'gen-1': 'variant-1' },
    }]);
  });

  it('derives group start and children from the live row actions instead of legacy projection fields', () => {
    const rows: TimelineRow[] = [{
      id: 'V1',
      actions: [
        buildAction('clip-2', 1, 2),
        buildAction('clip-1', 3, 5),
      ],
    }];
    const { result } = renderHook(() => useShotGroups(
      rows,
      [buildGroup({
        placedMembers: [
          { generationId: 'gen-1', clipId: 'clip-1', assetKey: 'a1', variantId: 'v1', mediaRef: 'm1', at: 3, duration: 2, pooled: false, stale: false },
          { generationId: 'gen-2', clipId: 'clip-2', assetKey: 'a2', variantId: 'v2', mediaRef: 'm2', at: 1, duration: 1, pooled: false, stale: false },
        ],
      })],
    ));

    expect(result.current).toEqual([{
      shotId: 'shot-1',
      shotName: 'Shot 1',
      rowId: 'V1',
      rowIndex: 0,
      start: 1,
      clipIds: ['clip-2', 'clip-1'],
      children: [
        { clipId: 'clip-2', offset: 0, duration: 1 },
        { clipId: 'clip-1', offset: 2, duration: 2 },
      ],
      color: getShotColor('shot-1'),
      mode: 'images',
      poolGenerationIds: [],
      variantIdsByGenerationId: { 'gen-1': 'v1', 'gen-2': 'v2' },
    }]);
  });

  it('filters out pinned groups whose live row actions are missing', () => {
    const rows: TimelineRow[] = [{ id: 'V1', actions: [] }];
    const { result } = renderHook(() => useShotGroups(
      rows,
      [buildGroup({
        placedMembers: [{ generationId: 'gen-1', clipId: 'clip-missing', assetKey: 'a1', variantId: 'v1', mediaRef: 'm1', at: 0, duration: 1, pooled: false, stale: false }],
      })],
    ));

    expect(result.current).toEqual([]);
  });

  it('keeps pool-only groups in the document view without relational shot rows', () => {
    const rows: TimelineRow[] = [{ id: 'V1', actions: [] }];
    const pooled = {
      generationId: 'gen-pool',
      clipId: null,
      assetKey: 'gen:gen-pool',
      variantId: 'variant-pool',
      mediaRef: 'media-pool',
      at: null,
      duration: null,
      pooled: true,
      stale: false,
    } as const;
    const group = buildGroup({ placedMembers: [], pooledMembers: [pooled], members: [pooled] });
    const { result } = renderHook(() => useShotGroups(rows, [group]));

    expect(result.current[0]).toMatchObject({
      shotId: 'shot-1',
      shotName: 'Shot 1',
      clipIds: [],
      poolGenerationIds: ['gen-pool'],
      variantIdsByGenerationId: { 'gen-pool': 'variant-pool' },
    });
  });
});
