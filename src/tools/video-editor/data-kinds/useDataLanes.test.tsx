// @vitest-environment jsdom
// dataKind V1 (Batch 6): useDataLanes — the host lane pipeline hook.
// Stub loaders prove the assembly/merge contract; the null loader proves the
// additive fail-open posture (base identity, empty lanes).
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TimelineData, TranscriptSegment } from '@/tools/video-editor/lib/timeline-data.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import { TRANSCRIPT_SCHEMA_REF } from '@/tools/video-editor/data/typed/adaptTranscript.ts';
import type { DataKindSnapshotRecord } from '@/tools/video-editor/data/typed/assembleDataLanes.ts';
import { useDataLanes, type LoadDataSegments } from './useDataLanes.ts';

const SEGMENT: TranscriptSegment = { start: 2, end: 4, text: 'hello' };

const mediaEntry = (file: string, type: string) => ({ file, src: file, type });

/** Video clip at t=10 trimming source seconds [2, ∞) at speed 1. */
const VIDEO_CLIP = {
  id: 'c1',
  at: 10,
  track: 'v1',
  asset: 'a',
  from: 2,
  speed: 1,
  assetEntry: mediaEntry('a.mp4', 'video/mp4'),
};

const CONFIG_SENTINEL = { clips: [], tracks: [] };

const buildBase = (clips: unknown[]): TimelineData =>
  ({
    config: CONFIG_SENTINEL,
    resolvedConfig: { clips } as unknown as ResolvedTimelineConfig,
    dataLanes: [],
  }) as unknown as TimelineData;

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

describe('useDataLanes', () => {
  it('merges stub-loaded segments into a patched TimelineData carrying the expected DataLaneView[]', async () => {
    const loadSegments: LoadDataSegments = vi.fn(async () => [SEGMENT]);
    const base = buildBase([VIDEO_CLIP]);

    const kind = transcriptKind();
    const { result } = renderHook(() =>
      useDataLanes({ base, kinds: [kind], loadSegments }),
    );

    await waitFor(() => expect(result.current?.dataLanes).toHaveLength(1));

    const patched = result.current;
    expect(patched).not.toBe(base);
    expect(patched?.dataLanes).not.toBe(base.dataLanes); // fresh array per mergeDataLanes contract

    const [lane] = patched!.dataLanes;
    expect(lane.laneId).toBe('transcript');
    expect(lane.kindId).toBe('transcript');
    expect(lane.label).toBe('Transcript');
    expect(lane.schemaRef).toBe(TRANSCRIPT_SCHEMA_REF);
    expect(lane.opaque).toBe(false);
    expect(lane.laneRenderer).toBe(kind.laneRenderer);
    expect(lane.inspector).toBe(kind.inspector);
    const [view] = lane.items;
    expect(view.item.id).toBe('a:c1:0');
    expect(view.item.sourceItemId).toBe('a:src:74b32fcb340a'); // content-derived FNV-1a/64 slice
    expect(view.item.payload).toEqual({ text: 'hello' });
    expect(view.timelineStart).toBe(10); // clip.at + (2 − 2)/1
    expect(view.timelineEnd).toBe(12);
    expect(view.clipId).toBe('c1');

    // Every other TimelineData field is preserved by reference.
    expect(patched?.config).toBe(base.config);
    // One fetch per asset per mount.
    expect(loadSegments).toHaveBeenCalledTimes(1);
    expect(loadSegments).toHaveBeenCalledWith('a');
  });

  it('returns base identity with empty lanes when the loader is null', () => {
    const base = buildBase([VIDEO_CLIP]);

    const { result } = renderHook(() =>
      useDataLanes({ base, kinds: [transcriptKind()], loadSegments: null }),
    );

    expect(result.current).toBe(base);
    expect(result.current?.dataLanes).toEqual([]);
  });

  it('returns base identity when no runtime provides a default loader', () => {
    const base = buildBase([VIDEO_CLIP]);

    // No VideoEditorRuntimeProvider above the hook → no default loader.
    const { result } = renderHook(() => useDataLanes({ base }));

    expect(result.current).toBe(base);
    expect(result.current?.dataLanes).toEqual([]);
  });

  it('never fetches for non-sound-bearing media and stays at base identity', () => {
    const loadSegments = vi.fn<LoadDataSegments>();
    const imageClip = { ...VIDEO_CLIP, id: 'c2', assetEntry: mediaEntry('a.png', 'image/png') };
    const base = buildBase([imageClip]);

    const { result } = renderHook(() =>
      useDataLanes({ base, kinds: [transcriptKind()], loadSegments }),
    );

    expect(loadSegments).not.toHaveBeenCalled();
    expect(result.current).toBe(base);
  });

  it('last-write-wins: re-merges on base change from cached segments without refetching', async () => {
    const loadSegments: LoadDataSegments = vi.fn(async () => [SEGMENT]);
    const base = buildBase([VIDEO_CLIP]);

    const view = renderHook(({ base: currentBase }) =>
      useDataLanes({ base: currentBase, kinds: [transcriptKind()], loadSegments }), {
      initialProps: { base },
    });

    await waitFor(() => expect(view.result.current?.dataLanes).toHaveLength(1));
    expect(loadSegments).toHaveBeenCalledTimes(1);

    // New base object (same assets): re-merge only — no second fetch.
    const base2 = buildBase([VIDEO_CLIP]);
    view.rerender({ base: base2 });
    expect(view.result.current).not.toBe(base2);
    expect(view.result.current?.config).toBe(base2.config);
    expect(view.result.current?.dataLanes).toHaveLength(1);
    expect(loadSegments).toHaveBeenCalledTimes(1);
  });

  it('last-write-wins: kinds snapshot changes re-merge without refetching', async () => {
    const loadSegments: LoadDataSegments = vi.fn(async () => [SEGMENT]);
    const base = buildBase([VIDEO_CLIP]);

    const view = renderHook(({ kinds }) =>
      useDataLanes({ base, kinds, loadSegments }), {
      initialProps: { kinds: [transcriptKind()] as readonly DataKindSnapshotRecord[] },
    });

    await waitFor(() => expect(view.result.current?.dataLanes).toHaveLength(1));
    expect(view.result.current?.dataLanes[0]?.opaque).toBe(false);

    // Kinds gone (unregister analog): the same segments re-assemble opaque.
    view.rerender({ kinds: [] });
    await waitFor(() => expect(view.result.current?.dataLanes[0]?.opaque).toBe(true));
    expect(view.result.current?.dataLanes[0]?.laneId).toBe(`opaque:${TRANSCRIPT_SCHEMA_REF}`);
    expect(loadSegments).toHaveBeenCalledTimes(1);
  });

  it('survives a rejected loader: no segments, base identity, no throw', async () => {
    const loadSegments: LoadDataSegments = vi.fn(async () => {
      throw new Error('boom');
    });
    const base = buildBase([VIDEO_CLIP]);

    const { result } = renderHook(() =>
      useDataLanes({ base, kinds: [transcriptKind()], loadSegments }),
    );

    await waitFor(() => expect(loadSegments).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(base));
    expect(result.current?.dataLanes).toEqual([]);
  });
});
