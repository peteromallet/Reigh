import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { createDefaultTimelineConfig } from '@tbd/schema';
import { describe, expect, it } from 'vitest';
import { createAssetResolverFromDataProvider } from '../data/ports.js';
import { createDataProviderMock, createTestTimelineData } from '../testing.js';
import {
  TimelineStoreProvider,
  createTimelineStore,
  useEditorStore,
  useTimelineEditorData,
  useTimelineEditorDataSafe,
  useTimelineEditorOps,
  useTimelinePlaybackContext,
  useTimelineStoreLifecycle,
} from './timelineStore.js';

function createWrapper() {
  const provider = createDataProviderMock();
  const store = createTimelineStore({
    timelineId: 'timeline-1',
    ports: { dataProvider: provider },
    hostContext: {},
    assetResolver: createAssetResolverFromDataProvider(provider),
  });

  return {
    store,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <TimelineStoreProvider store={store}>{children}</TimelineStoreProvider>
    ),
  };
}

async function createPopulatedTimelineData() {
  const config = createDefaultTimelineConfig();
  config.tracks = [{ id: 'track-1', kind: 'visual', label: 'V1' }];
  config.clips = [
    { id: 'clip-1', at: 0, track: 'track-1', clipType: 'hold', hold: 2, asset: 'asset-1' },
    { id: 'clip-2', at: 2, track: 'track-1', clipType: 'hold', hold: 2, asset: 'asset-2' },
  ];
  return createTestTimelineData({ config });
}

describe('timelineStore', () => {
  it('exposes the four slices and keeps the legacy selector view in sync', async () => {
    const { store, wrapper } = createWrapper();
    const timelineData = await createPopulatedTimelineData();

    store.getState().setMounted(true);
    store.getState().setData(timelineData);
    store.getState().setLoading(true);
    store.getState().setCurrentTime(12.5);
    store.getState().setSelectedClipIds(['clip-1']);

    const { result } = renderHook(() => ({
      data: useTimelineEditorData(),
      ops: useTimelineEditorOps(),
      playback: useTimelinePlaybackContext(),
      legacy: useEditorStore((state) => ({
        data: state.data,
        loading: state.loading,
        currentTime: state.currentTime,
        selectedClipIds: state.selectedClipIds,
      })),
    }), { wrapper });

    expect(result.current.data.data).toBe(timelineData);
    expect(result.current.data.resolvedConfig).toBe(timelineData.resolvedConfig);
    expect(typeof result.current.ops.selectClip).toBe('function');
    expect(result.current.playback.currentTime).toBe(12.5);
    expect(result.current.legacy.data).toBe(timelineData);
    expect(result.current.legacy.loading).toBe(true);
    expect(result.current.legacy.currentTime).toBe(12.5);
    expect(result.current.legacy.selectedClipIds).toEqual(['clip-1']);
  });

  it('returns null from safe hooks outside the mounted provider boundary', () => {
    const outside = renderHook(() => useTimelineEditorDataSafe());
    expect(outside.result.current).toBeNull();

    const { wrapper } = createWrapper();
    const insideButUnmounted = renderHook(() => useTimelineEditorDataSafe(), { wrapper });
    expect(insideButUnmounted.result.current).toBeNull();
  });

  it('restores safe selectors once the provider is marked mounted', () => {
    const { store, wrapper } = createWrapper();
    store.getState().setMounted(true);

    const { result } = renderHook(() => ({
      data: useTimelineEditorDataSafe(),
      lifecycle: useTimelineStoreLifecycle(),
    }), { wrapper });

    expect(result.current.data).not.toBeNull();
    expect(result.current.lifecycle.mounted).toBe(true);
    expect(typeof result.current.lifecycle.syncSlices).toBe('function');
  });

  it('keeps selection state synchronized across data and ops slices', async () => {
    const { store, wrapper } = createWrapper();
    const timelineData = await createPopulatedTimelineData();
    store.getState().setMounted(true);
    store.getState().setData(timelineData);

    const { result } = renderHook(() => ({
      data: useTimelineEditorData(),
      ops: useTimelineEditorOps(),
    }), { wrapper });

    act(() => {
      result.current.ops.selectClip('clip-2');
    });

    expect(result.current.data.selectedClipId).toBe('clip-2');
    expect(result.current.data.selectedClipIds.has('clip-2')).toBe(true);
    expect(result.current.data.selectedClipIdsRef.current.has('clip-2')).toBe(true);
    expect(result.current.data.selectedTrackId).toBe('track-1');
    expect(result.current.data.primaryClipId).toBe('clip-2');
    expect(result.current.data.selectedClip?.id).toBe('clip-2');
    expect(result.current.data.selectedClipHasPredecessor).toBe(true);
  });
});
