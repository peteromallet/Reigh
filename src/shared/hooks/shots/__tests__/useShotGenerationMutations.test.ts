import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { enqueueGenerationsInvalidation } from '@/shared/hooks/invalidation';
import { queryKeys } from '@/shared/lib/queryKeys';

const mockPlaceGeneration = vi.fn();
const mockUnplaceGeneration = vi.fn();
const mockBatchUpdatePlacementFrames = vi.fn();

vi.mock('@/shared/lib/placement/placementService', () => ({
  placeGeneration: (...args: unknown[]) => mockPlaceGeneration(...args),
  unplaceGeneration: (...args: unknown[]) => mockUnplaceGeneration(...args),
  batchUpdatePlacementFrames: (...args: unknown[]) => mockBatchUpdatePlacementFrames(...args),
}));

vi.mock('@/shared/contexts/projectSelectionStore', () => ({
  getProjectSelectionFallbackId: vi.fn(() => 'fallback-project'),
}));

vi.mock('@/shared/components/ui/runtime/sonner', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('@/shared/hooks/invalidation', () => ({
  enqueueGenerationsInvalidation: vi.fn(),
}));

vi.mock('./cacheUtils', () => ({
  cancelShotsQueries: vi.fn(),
  findShotsCache: vi.fn(),
  updateAllShotsCaches: vi.fn(),
  rollbackShotsCaches: vi.fn(),
  rollbackShotGenerationsCache: vi.fn(),
  cancelShotGenerationsQuery: vi.fn(),
}));

import {
  useAddImageToShot,
  useRemoveImageFromShot,
  useUpdateShotImageOrder,
} from '../useShotGenerationMutations';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

// The deterministic entry id the document read model surfaces for a pair.
const entryId = (shotId: string, generationId: string) => `sg-${shotId}-${generationId}`;

describe('useAddImageToShot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds an image pooled (null timeline_frame) via document placement', async () => {
    mockPlaceGeneration.mockResolvedValue({
      entryId: entryId('shot-1', 'gen-1'),
      shotId: 'shot-1',
      generationId: 'gen-1',
      timelineFrame: null,
      assetKey: 'gen:gen-1',
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAddImageToShot(), { wrapper });

    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync({
        shot_id: 'shot-1',
        generation_id: 'gen-1',
        project_id: 'project-1',
        timelineFrame: null,
      });
    });

    expect(mockPlaceGeneration).toHaveBeenCalledWith({
      projectSlug: 'project-1',
      shotId: 'shot-1',
      generationId: 'gen-1',
      timelineFrame: null,
    });
    expect(data).toHaveProperty('id', entryId('shot-1', 'gen-1'));
  });

  it('auto-positions when timelineFrame is undefined', async () => {
    mockPlaceGeneration.mockResolvedValue({
      entryId: entryId('shot-1', 'gen-1'),
      shotId: 'shot-1',
      generationId: 'gen-1',
      timelineFrame: 150,
      assetKey: 'gen:gen-1',
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAddImageToShot(), { wrapper });

    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync({
        shot_id: 'shot-1',
        generation_id: 'gen-1',
        project_id: 'project-1',
        // timelineFrame not provided = undefined = auto-position
      });
    });

    expect(mockPlaceGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ timelineFrame: undefined }),
    );
    expect(data).toHaveProperty('timeline_frame', 150);
  });

  it('passes an explicit frame through untouched', async () => {
    mockPlaceGeneration.mockResolvedValue({
      entryId: entryId('shot-1', 'gen-1'),
      shotId: 'shot-1',
      generationId: 'gen-1',
      timelineFrame: 100,
      assetKey: 'gen:gen-1',
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAddImageToShot(), { wrapper });

    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync({
        shot_id: 'shot-1',
        generation_id: 'gen-1',
        project_id: 'project-1',
        timelineFrame: 100,
      });
    });

    expect(mockPlaceGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ timelineFrame: 100 }),
    );
    expect(data).toHaveProperty('timeline_frame', 100);
  });

  it('invalidates shot, segment, and unified data after a successful add', async () => {
    mockPlaceGeneration.mockResolvedValue({
      entryId: entryId('shot-1', 'gen-1'),
      shotId: 'shot-1',
      generationId: 'gen-1',
      timelineFrame: 150,
      assetKey: 'gen:gen-1',
    });

    const { queryClient, wrapper } = createWrapper();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAddImageToShot(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        shot_id: 'shot-1',
        generation_id: 'gen-1',
        project_id: 'project-1',
      });
    });

    expect(enqueueGenerationsInvalidation).toHaveBeenCalledWith(queryClient, 'shot-1', {
      reason: 'add-image-to-shot',
      scope: 'all',
      includeShots: true,
      projectId: 'project-1',
      includeProjectUnified: true,
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.segments.liveTimeline('shot-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.segments.parents('shot-1', 'project-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.generations.meta('shot-1'),
    });
  });
});

describe('useRemoveImageFromShot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unplaces the entry as pooled (keepAsPooled)', async () => {
    mockUnplaceGeneration.mockResolvedValue(undefined);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRemoveImageFromShot(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        shotId: 'shot-1',
        shotGenerationId: entryId('shot-1', 'gen-1'),
        projectId: 'project-1',
      });
    });

    expect(mockUnplaceGeneration).toHaveBeenCalledWith({
      projectSlug: 'project-1',
      shotId: 'shot-1',
      entryId: entryId('shot-1', 'gen-1'),
      generationId: 'gen-1',
      keepAsPooled: true,
    });
  });

  it('resolves a bare generation id to its deterministic entry id', async () => {
    mockUnplaceGeneration.mockResolvedValue(undefined);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRemoveImageFromShot(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        shotId: 'shot-1',
        shotGenerationId: 'gen-7',
        projectId: 'project-1',
      });
    });

    expect(mockUnplaceGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: entryId('shot-1', 'gen-7'),
        generationId: 'gen-7',
      }),
    );
  });

  it('throws on missing required params', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRemoveImageFromShot(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          shotId: '',
          shotGenerationId: entryId('shot-1', 'gen-1'),
          projectId: 'project-1',
        });
      })
    ).rejects.toThrow('Missing required parameters');
  });

  it('persists frame shifts in ONE placement CAS cycle', async () => {
    mockUnplaceGeneration.mockResolvedValue(undefined);
    mockBatchUpdatePlacementFrames.mockResolvedValue([]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRemoveImageFromShot(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        shotId: 'shot-1',
        shotGenerationId: entryId('shot-1', 'gen-1'),
        projectId: 'project-1',
        shiftItems: [
          { id: entryId('shot-1', 'gen-2'), newFrame: 0 },
          { id: entryId('shot-1', 'gen-3'), newFrame: 50 },
        ],
      });
    });

    expect(mockBatchUpdatePlacementFrames).toHaveBeenCalledWith({
      projectSlug: 'project-1',
      shotId: 'shot-1',
      updates: [
        { entryId: entryId('shot-1', 'gen-2'), timelineFrame: 0 },
        { entryId: entryId('shot-1', 'gen-3'), timelineFrame: 50 },
      ],
    });
  });
});

describe('useUpdateShotImageOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates timeline frames for reordered items via one CAS cycle', async () => {
    mockBatchUpdatePlacementFrames.mockResolvedValue([]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateShotImageOrder(), { wrapper });

    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync({
        updates: [
          { shot_id: 'shot-1', generation_id: 'gen-1', timeline_frame: 0 },
          { shot_id: 'shot-1', generation_id: 'gen-2', timeline_frame: 50 },
        ],
        projectId: 'project-1',
        shotId: 'shot-1',
      });
    });

    expect(mockBatchUpdatePlacementFrames).toHaveBeenCalledWith({
      projectSlug: 'project-1',
      shotId: 'shot-1',
      updates: [
        { entryId: entryId('shot-1', 'gen-1'), timelineFrame: 0 },
        { entryId: entryId('shot-1', 'gen-2'), timelineFrame: 50 },
      ],
    });
    expect(data).toHaveProperty('projectId', 'project-1');
  });
});
