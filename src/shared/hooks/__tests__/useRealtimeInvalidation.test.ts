import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock realtime event processor
const mockOnEvent = vi.fn().mockReturnValue(() => {});

vi.mock('@/shared/realtime/RealtimeEventProcessor', () => ({
  realtimeEventProcessor: {
    onEvent: (...args: unknown[]) => mockOnEvent(...args),
  },
}));

vi.mock('@/shared/realtime/DataFreshnessManager', () => ({
  dataFreshnessManager: {
    onRealtimeEvent: vi.fn(),
  },
}));

vi.mock('@/shared/hooks/invalidation', () => ({
  enqueueGenerationsInvalidation: vi.fn(),
  invalidateAllShotGenerations: vi.fn(),
}));

vi.mock('@/shared/lib/queryKeys', () => ({
  queryKeys: {
    tasks: {
      paginatedAll: ['tasks', 'paginated'],
      statusCountsAll: ['tasks', 'statusCounts'],
      all: ['tasks'],
      single: (id: string) => ['tasks', id],
    },
    segments: {
      parentsAll: ['segments-parents'],
      childrenAll: ['segments-children'],
      liveTimelineAll: ['segments-timeline'],
    },
    generations: {
      all: ['generations'],
      derivedGenerationsAll: ['derived-generations'],
      derivedAll: ['derived'],
      detailAll: ['generation-detail'],
      detail: (id: string) => ['generation-detail', id],
      variants: (id: string) => ['generation-variants', id],
      variantBadges: ['variant-badges'],
    },
    unified: {
      all: ['unified-generations'],
    },
    finalVideos: {
      all: ['final-videos'],
    },
    shots: {
      all: ['shots'],
    },
  },
}));

vi.mock('@/shared/lib/preloading', () => ({
  preloadingService: {
    onGenerationsDeleted: vi.fn(),
  },
}));

import { useRealtimeInvalidation } from '../useRealtimeInvalidation';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useRealtimeInvalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes to realtime events on mount', () => {
    renderHook(() => useRealtimeInvalidation(), { wrapper: createWrapper() });

    expect(mockOnEvent).toHaveBeenCalledTimes(1);
    expect(mockOnEvent).toHaveBeenCalledWith(expect.any(Function));
  });

  it('unsubscribes on unmount', () => {
    const unsubscribeFn = vi.fn();
    mockOnEvent.mockReturnValue(unsubscribeFn);

    const { unmount } = renderHook(() => useRealtimeInvalidation(), {
      wrapper: createWrapper(),
    });

    unmount();

    expect(unsubscribeFn).toHaveBeenCalled();
  });

  it('provides a callback that handles different event types', () => {
    renderHook(() => useRealtimeInvalidation(), { wrapper: createWrapper() });

    const eventHandler = mockOnEvent.mock.calls[0][0];
    expect(typeof eventHandler).toBe('function');

    // Test that different event types don't throw
    expect(() => {
      eventHandler({ type: 'tasks-updated', tasks: [] });
    }).not.toThrow();

    expect(() => {
      eventHandler({ type: 'tasks-created', tasks: [] });
    }).not.toThrow();

    expect(() => {
      eventHandler({
        type: 'generations-inserted',
        generations: [],
      });
    }).not.toThrow();

    expect(() => {
      eventHandler({
        type: 'generations-updated',
        generations: [],
      });
    }).not.toThrow();

    expect(() => {
      eventHandler({
        type: 'generations-deleted',
        generations: [],
      });
    }).not.toThrow();

    expect(() => {
      eventHandler({
        type: 'variants-changed',
        affectedGenerationIds: [],
      });
    }).not.toThrow();

    expect(() => {
      eventHandler({
        type: 'variants-deleted',
        affectedGenerationIds: [],
      });
    }).not.toThrow();
  });
});
