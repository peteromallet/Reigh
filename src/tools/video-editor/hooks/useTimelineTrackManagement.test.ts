import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildTimelineData } from '@/tools/video-editor/lib/timeline-data';
import { serializeForDisk } from '@/tools/video-editor/lib/serialize';
import {
  useTimelineTrackManagement,
  moveTrackWithinKind,
  reorderTracksByDirection,
} from '@/tools/video-editor/hooks/useTimelineTrackManagement';
import type {
  ResolvedTimelineConfig,
  TrackDefinition,
  TrackKind,
} from '@/tools/video-editor/types';
import { createTimelineEditability } from '@/tools/video-editor/lib/timeline-editability.ts';

const makePinnedGroup = (args: {
  shotId: string;
  trackId: string;
  clipIds: string[];
  mode: 'images' | 'video';
}) => ({ ...args });

function makeTrack(id: string, kind: TrackKind): TrackDefinition {
  return {
    id,
    kind,
    label: id,
  };
}

function getTrackOrder(tracks: TrackDefinition[]): string[] {
  return tracks.map((track) => track.id);
}

function makeResolvedConfig(tracks: TrackDefinition[]): ResolvedTimelineConfig {
  return {
    output: {
      resolution: '1280x720',
      fps: 30,
      file: 'out.mp4',
    },
    tracks,
    clips: tracks.map((track, index) => ({
      id: `clip-${track.id}`,
      at: index,
      track: track.id,
      clipType: 'hold',
      hold: 1,
    })),
    registry: {},
  };
}

describe('reorderTracksByDirection', () => {
  it('handles mixed-kind boundaries without crossing kinds', () => {
    const tracks = [
      makeTrack('V1', 'visual'),
      makeTrack('V2', 'visual'),
      makeTrack('A1', 'audio'),
      makeTrack('A2', 'audio'),
    ];

    expect(getTrackOrder(reorderTracksByDirection(tracks, 'V2', 1))).toEqual(['V1', 'V2', 'A1', 'A2']);
    expect(getTrackOrder(reorderTracksByDirection(tracks, 'A1', -1))).toEqual(['V1', 'V2', 'A1', 'A2']);
    expect(getTrackOrder(reorderTracksByDirection(tracks, 'A1', 1))).toEqual(['V1', 'V2', 'A2', 'A1']);
    expect(getTrackOrder(reorderTracksByDirection(tracks, 'V1', 1))).toEqual(['V2', 'V1', 'A1', 'A2']);
  });

  it('no-ops when each kind has only one track', () => {
    const tracks = [
      makeTrack('V1', 'visual'),
      makeTrack('A1', 'audio'),
    ];

    expect(getTrackOrder(reorderTracksByDirection(tracks, 'V1', -1))).toEqual(['V1', 'A1']);
    expect(getTrackOrder(reorderTracksByDirection(tracks, 'V1', 1))).toEqual(['V1', 'A1']);
    expect(getTrackOrder(reorderTracksByDirection(tracks, 'A1', -1))).toEqual(['V1', 'A1']);
    expect(getTrackOrder(reorderTracksByDirection(tracks, 'A1', 1))).toEqual(['V1', 'A1']);
  });

  it('reorders normally when all tracks share the same kind', () => {
    const tracks = [
      makeTrack('V1', 'visual'),
      makeTrack('V2', 'visual'),
      makeTrack('V3', 'visual'),
    ];

    expect(getTrackOrder(reorderTracksByDirection(tracks, 'V1', 1))).toEqual(['V2', 'V1', 'V3']);
    expect(getTrackOrder(reorderTracksByDirection(tracks, 'V2', 1))).toEqual(['V1', 'V3', 'V2']);
    expect(getTrackOrder(reorderTracksByDirection(tracks, 'V3', -1))).toEqual(['V1', 'V3', 'V2']);
  });
});

describe('runtime editability at commit', () => {
  it('rechecks a lock after the drag plan was produced', () => {
    const tracks = [makeTrack('V1', 'visual'), makeTrack('V2', 'visual')];
    const dataRef = { current: {
      rows: [
        { id: 'V1', actions: [{ id: 'clip-1', start: 0, end: 10, effectId: 'effect-clip-1' }] },
        { id: 'V2', actions: [] },
      ],
      tracks,
      meta: { 'clip-1': { track: 'V1', clipType: 'hold', hold: 10 } },
      clipOrder: { V1: ['clip-1'], V2: [] },
      config: { output: { resolution: '1280x720', fps: 30, file: 'out.mp4' }, tracks, clips: [{ id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 10 }] },
      resolvedConfig: makeResolvedConfig(tracks),
    } } as any;
    const applyEdit = vi.fn();
    const { result } = renderHook(() => useTimelineTrackManagement({
      dataRef,
      resolvedConfig: dataRef.current.resolvedConfig,
      selectedClipId: null,
      setSelectedTrackId: vi.fn(),
      applyEdit,
      editability: createTimelineEditability({ lockedClipIds: ['clip-1'] }),
    }));

    act(() => result.current.applyResolvedClipMove('clip-1', 'V2', 'V2', 20, false, 'txn-stale-lock'));
    expect(applyEdit).not.toHaveBeenCalled();
  });
});

describe('moveTrackWithinKind', () => {
  it('moves a track to a new position within its kind group', () => {
    const tracks = [
      makeTrack('V1', 'visual'),
      makeTrack('V2', 'visual'),
      makeTrack('V3', 'visual'),
      makeTrack('A1', 'audio'),
      makeTrack('A2', 'audio'),
    ];

    expect(getTrackOrder(moveTrackWithinKind(tracks, 'V1', 'V3'))).toEqual(['V2', 'V3', 'V1', 'A1', 'A2']);
  });

  it('allows drag moves between different kinds', () => {
    const tracks = [
      makeTrack('V1', 'visual'),
      makeTrack('V2', 'visual'),
      makeTrack('A1', 'audio'),
      makeTrack('A2', 'audio'),
    ];

    expect(getTrackOrder(moveTrackWithinKind(tracks, 'V2', 'A1'))).toEqual(['V1', 'A1', 'V2', 'A2']);
  });

  it('preserves within-kind order across serialize and buildTimelineData round-trips', async () => {
    const reorderedTracks = moveTrackWithinKind([
      makeTrack('V1', 'visual'),
      makeTrack('V2', 'visual'),
      makeTrack('A1', 'audio'),
      makeTrack('A2', 'audio'),
    ], 'V1', 'V2');

    const serialized = serializeForDisk(makeResolvedConfig(reorderedTracks));
    const rebuilt = await buildTimelineData(serialized, { assets: {} });

    expect(getTrackOrder(rebuilt.tracks)).toEqual(['V2', 'V1', 'A1', 'A2']);
  });
});

describe('useTimelineTrackManagement', () => {
  it('reroutes moveClipToRow through a group move when the clip belongs to a pinned group', () => {
    const tracks = [
      makeTrack('V1', 'visual'),
      makeTrack('V2', 'visual'),
    ];
    const dataRef = {
      current: {
        rows: [
          { id: 'V1', actions: [{ id: 'clip-1', start: 0, end: 2, effectId: 'effect-clip-1' }] },
          { id: 'V2', actions: [] },
        ],
        tracks,
        meta: {
          'clip-1': { track: 'V1', clipType: 'hold', hold: 2 },
        },
        clipOrder: { V1: ['clip-1'], V2: [] },
        config: {
          output: {
            resolution: '1280x720',
            fps: 30,
            file: 'out.mp4',
          },
          tracks,
          clips: [{ id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 2 }],
          pinnedShotGroups: [makePinnedGroup({ shotId: 'shot-1', trackId: 'V1', clipIds: ['clip-1'], mode: 'images' })],
        },
        resolvedConfig: makeResolvedConfig(tracks),
      },
    } as any;
    const applyEdit = vi.fn();

    const { result } = renderHook(() => useTimelineTrackManagement({
      dataRef,
      resolvedConfig: dataRef.current.resolvedConfig,
      selectedClipId: null,
      setSelectedTrackId: vi.fn(),
      applyEdit,
    }));

    act(() => {
      result.current.moveClipToRow('clip-1', 'V2', 3, 'txn-1');
    });

    expect(applyEdit).toHaveBeenCalledTimes(1);
    const [mutation, options] = applyEdit.mock.calls[0];
    expect(mutation).toEqual({
      type: 'rows',
      rows: [
        { id: 'V1', actions: [] },
        { id: 'V2', actions: [{ id: 'clip-1', start: 3, end: 5, effectId: 'effect-clip-1' }] },
      ],
      metaUpdates: { 'clip-1': { track: 'V2' } },
      clipOrderOverride: { V1: [], V2: ['clip-1'] },
      pinnedShotGroupsOverride: [makePinnedGroup({
        shotId: 'shot-1',
        trackId: 'V2',
        clipIds: ['clip-1'],
        mode: 'images',
      })],
    });
    expect(options).toEqual({ transactionId: 'txn-1' });
  });

  it('reroutes createTrackAndMoveClip through a group move when the clip belongs to a pinned group', () => {
    const tracks = [
      makeTrack('V1', 'visual'),
      makeTrack('V2', 'visual'),
    ];
    const applyEdit = vi.fn();
    const dataRef = {
      current: {
        rows: [
          { id: 'V1', actions: [{ id: 'clip-1', start: 0, end: 2, effectId: 'effect-clip-1' }] },
          { id: 'V2', actions: [] },
        ],
        tracks,
        meta: {
          'clip-1': { track: 'V1', clipType: 'hold', hold: 2 },
        },
        clipOrder: { V1: ['clip-1'], V2: [] },
        config: {
          output: {
            resolution: '1280x720',
            fps: 30,
            file: 'out.mp4',
          },
          tracks,
          clips: [{ id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 2 }],
          pinnedShotGroups: [makePinnedGroup({ shotId: 'shot-1', trackId: 'V1', clipIds: ['clip-1'], mode: 'images' })],
        },
        resolvedConfig: {
          output: {
            resolution: '1280x720',
            fps: 30,
            file: 'out.mp4',
          },
          tracks,
          clips: [{ id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 2 }],
          registry: {},
        },
      },
    } as any;

    const { result } = renderHook(() => useTimelineTrackManagement({
      dataRef,
      resolvedConfig: dataRef.current.resolvedConfig,
      selectedClipId: 'clip-1',
      setSelectedTrackId: vi.fn(),
      applyEdit,
    }));

    act(() => {
      result.current.createTrackAndMoveClip('clip-1', 'visual', 4);
    });

    expect(applyEdit).toHaveBeenCalledTimes(1);
    const [mutation, options] = applyEdit.mock.calls[0];
    expect(mutation.type).toBe('config');
    expect(mutation.resolvedConfig.tracks.map((track: TrackDefinition) => track.id)).toEqual(['V1', 'V2', 'V3']);
    expect(mutation.resolvedConfig.clips).toEqual([
      { id: 'clip-1', at: 4, track: 'V3', clipType: 'hold', hold: 2 },
    ]);
    expect(mutation.pinnedShotGroupsOverride).toEqual([makePinnedGroup({
      shotId: 'shot-1',
      trackId: 'V3',
      clipIds: ['clip-1'],
      mode: 'images',
    })]);
    expect(options).toEqual({ selectedClipId: 'clip-1', selectedTrackId: 'V3' });
  });

  it('reroutes grouped ArrowUp and ArrowDown moves through one atomic rows edit', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('txn-group');
    const tracks = [
      makeTrack('V1', 'visual'),
      makeTrack('V2', 'visual'),
    ];
    const setSelectedTrackId = vi.fn();
    const applyEdit = vi.fn();
    const dataRef = {
      current: {
        rows: [
          {
            id: 'V1',
            actions: [
              { id: 'clip-1', start: 0, end: 2, effectId: 'effect-clip-1' },
              { id: 'clip-2', start: 2, end: 4, effectId: 'effect-clip-2' },
            ],
          },
          { id: 'V2', actions: [] },
        ],
        tracks,
        meta: {
          'clip-1': { track: 'V1', clipType: 'hold', hold: 2 },
          'clip-2': { track: 'V1', clipType: 'hold', hold: 2 },
        },
        clipOrder: { V1: ['clip-1', 'clip-2'], V2: [] },
        config: {
          output: {
            resolution: '1280x720',
            fps: 30,
            file: 'out.mp4',
          },
          tracks,
          clips: [
            { id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 2 },
            { id: 'clip-2', at: 2, track: 'V1', clipType: 'hold', hold: 2 },
          ],
          pinnedShotGroups: [makePinnedGroup({
            shotId: 'shot-1',
            trackId: 'V1',
            clipIds: ['clip-1', 'clip-2'],
            mode: 'images',
          })],
        },
        resolvedConfig: makeResolvedConfig(tracks),
      },
    } as any;

    const { result } = renderHook(() => useTimelineTrackManagement({
      dataRef,
      resolvedConfig: dataRef.current.resolvedConfig,
      selectedClipId: 'clip-1',
      setSelectedTrackId,
      applyEdit,
    }));

    act(() => {
      result.current.moveSelectedClipsToTrack('down', new Set(['clip-1']));
    });

    expect(applyEdit).toHaveBeenCalledTimes(1);
    expect(applyEdit).toHaveBeenCalledWith({
      type: 'rows',
      rows: [
        { id: 'V1', actions: [] },
        {
          id: 'V2',
          actions: [
            { id: 'clip-1', start: 0, end: 2, effectId: 'effect-clip-1' },
            { id: 'clip-2', start: 2, end: 4, effectId: 'effect-clip-2' },
          ],
        },
      ],
      metaUpdates: {
        'clip-1': { track: 'V2' },
        'clip-2': { track: 'V2' },
      },
      clipOrderOverride: { V1: [], V2: ['clip-1', 'clip-2'] },
      pinnedShotGroupsOverride: [makePinnedGroup({
        shotId: 'shot-1',
        trackId: 'V2',
        clipIds: ['clip-1', 'clip-2'],
        mode: 'images',
      })],
    }, { transactionId: 'txn-group' });
    expect(setSelectedTrackId).toHaveBeenCalledWith('V2');
  });

  it('reroutes grouped upward moves through one atomic rows edit', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('txn-group-up');
    const tracks = [
      makeTrack('V1', 'visual'),
      makeTrack('V2', 'visual'),
    ];
    const setSelectedTrackId = vi.fn();
    const applyEdit = vi.fn();
    const dataRef = {
      current: {
        rows: [
          { id: 'V1', actions: [] },
          {
            id: 'V2',
            actions: [
              { id: 'clip-1', start: 0, end: 2, effectId: 'effect-clip-1' },
              { id: 'clip-2', start: 2, end: 4, effectId: 'effect-clip-2' },
            ],
          },
        ],
        tracks,
        meta: {
          'clip-1': { track: 'V2', clipType: 'hold', hold: 2 },
          'clip-2': { track: 'V2', clipType: 'hold', hold: 2 },
        },
        clipOrder: { V1: [], V2: ['clip-1', 'clip-2'] },
        config: {
          output: {
            resolution: '1280x720',
            fps: 30,
            file: 'out.mp4',
          },
          tracks,
          clips: [
            { id: 'clip-1', at: 0, track: 'V2', clipType: 'hold', hold: 2 },
            { id: 'clip-2', at: 2, track: 'V2', clipType: 'hold', hold: 2 },
          ],
          pinnedShotGroups: [makePinnedGroup({
            shotId: 'shot-1',
            trackId: 'V2',
            clipIds: ['clip-1', 'clip-2'],
            mode: 'images',
          })],
        },
        resolvedConfig: makeResolvedConfig(tracks),
      },
    } as any;

    const { result } = renderHook(() => useTimelineTrackManagement({
      dataRef,
      resolvedConfig: dataRef.current.resolvedConfig,
      selectedClipId: 'clip-1',
      setSelectedTrackId,
      applyEdit,
    }));

    act(() => {
      result.current.moveSelectedClipsToTrack('up', new Set(['clip-1']));
    });

    expect(applyEdit).toHaveBeenCalledTimes(1);
    expect(applyEdit).toHaveBeenCalledWith({
      type: 'rows',
      rows: [
        {
          id: 'V1',
          actions: [
            { id: 'clip-1', start: 0, end: 2, effectId: 'effect-clip-1' },
            { id: 'clip-2', start: 2, end: 4, effectId: 'effect-clip-2' },
          ],
        },
        { id: 'V2', actions: [] },
      ],
      metaUpdates: {
        'clip-1': { track: 'V1' },
        'clip-2': { track: 'V1' },
      },
      clipOrderOverride: { V1: ['clip-1', 'clip-2'], V2: [] },
      pinnedShotGroupsOverride: [makePinnedGroup({
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-1', 'clip-2'],
        mode: 'images',
      })],
    }, { transactionId: 'txn-group-up' });
    expect(setSelectedTrackId).toHaveBeenCalledWith('V1');
  });
});
