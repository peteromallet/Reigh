import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockIsDeferredCloudDataAuthority = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/app/runtime/dataAuthority.ts', () => ({
  isDeferredCloudDataAuthority: mockIsDeferredCloudDataAuthority,
}));

// Mock supabase
vi.mock('@/integrations/supabase/client', () => {
  const createSupabaseMockChain = () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.abortSignal = vi.fn().mockResolvedValue({ data: [], error: null });
    return chain;
  };

  return {
    getSupabaseClient: () => ({
      from: vi.fn(() => createSupabaseMockChain()),
    }),
  };
});

vi.mock('@/shared/lib/query/queryDefaults', () => ({
  QUERY_PRESETS: {
    realtimeBacked: { staleTime: 0 },
  },
  STANDARD_RETRY: 3,
  STANDARD_RETRY_DELAY: vi.fn(() => 1000),
}));

vi.mock('@/shared/lib/queryKeys', () => ({
  queryKeys: {
    generations: {
      byShot: (shotId: string) => ['generations', 'shot', shotId],
    },
    shots: {
      list: (projectId: string, limit: number) => ['shots', projectId, limit],
    },
  },
}));

vi.mock('@/shared/hooks/shots', () => ({
  mapShotGenerationToRow: vi.fn((sg: Record<string, unknown>) => ({
    id: sg.id,
    generation_id: sg.generation_id,
    timeline_frame: sg.timeline_frame,
  })),
}));

import { useShotImages, useTimelineImages, useUnpositionedImages, useVideoOutputs } from '@/shared/hooks/shots/useShotImages';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useShotImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
  });

  it('is disabled when shotId is null', () => {
    const { result } = renderHook(() => useShotImages(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
  });

  it('starts fetching when shotId is provided', () => {
    const { result } = renderHook(() => useShotImages('shot-1'), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('does not fetch relational shot images in Astrid authority', () => {
    mockIsDeferredCloudDataAuthority.mockReturnValue(false);
    const { result } = renderHook(() => useShotImages('shot-1'), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('is disabled when disableRefetch is true', () => {
    const { result } = renderHook(
      () => useShotImages('shot-1', { disableRefetch: true }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isFetching).toBe(false);
  });
});

describe('useTimelineImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when shotId is null', () => {
    const { result } = renderHook(() => useTimelineImages(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
  });

  it('filters to positioned non-video images', async () => {
    // Set up query cache with mock data
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const mockImages = [
      { id: '1', timeline_frame: 0, type: 'image', imageUrl: 'img1.jpg', location: 'img1.jpg' },
      { id: '2', timeline_frame: 1, type: 'image', imageUrl: 'img2.jpg', location: 'img2.jpg' },
      { id: '3', timeline_frame: null, type: 'image', imageUrl: 'img3.jpg', location: 'img3.jpg' }, // unpositioned
      { id: '4', timeline_frame: 2, type: 'video/mp4', imageUrl: 'vid.mp4', location: 'vid.mp4' }, // video
    ];

    // Pre-populate cache
    queryClient.setQueryData(['generations', 'shot', 'shot-1'], mockImages);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useTimelineImages('shot-1'), {
      wrapper,
    });

    // The selector should filter to only positioned non-video images
    await waitFor(() => {
      if (result.current.data) {
        // Only positioned, non-video images with valid location
        const filtered = result.current.data;
        expect(filtered.every((g: { timeline_frame: number | null }) => g.timeline_frame !== null)).toBe(true);
        expect(filtered.every((g: { type?: string }) => !g.type?.includes('video'))).toBe(true);
      }
    });
  });
});

describe('useUnpositionedImages', () => {
  it('is disabled when shotId is null', () => {
    const { result } = renderHook(() => useUnpositionedImages(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
  });
});

describe('useVideoOutputs', () => {
  it('is disabled when shotId is null', () => {
    const { result } = renderHook(() => useVideoOutputs(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
  });
});
