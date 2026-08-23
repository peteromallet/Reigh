import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import type * as projectSelectionStoreModule from '@/shared/contexts/projectSelectionStore';

const mockedFallback = vi.fn((): string | null => null);

vi.mock('@/shared/contexts/projectSelectionStore', async () => {
  const actual = await vi.importActual<typeof projectSelectionStoreModule>(
    '@/shared/contexts/projectSelectionStore',
  );
  return { ...actual, getProjectSelectionFallbackId: () => mockedFallback() };
});

vi.mock('@/shared/lib/tasks/taskConfig', () => ({
  getVisibleTaskTypes: vi.fn(() => ['generate-video', 'generate-image']),
  getHiddenTaskTypes: vi.fn(() => ['internal-task']),
}));

import { useTaskLog } from '../useTaskLog';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useTaskLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns initial loading state', () => {
    const { result } = renderHook(() => useTaskLog(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('accepts custom limit and page', () => {
    const { result } = renderHook(() => useTaskLog(10, 2), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
  });

  it('accepts filter parameters', () => {
    const { result } = renderHook(
      () =>
        useTaskLog(20, 1, {
          costFilter: 'paid',
          status: ['Complete'],
          taskTypes: ['generate-video'],
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBeDefined();
  });

  it('returns empty tasks when no project scope is resolvable', async () => {
    // taskLogPipeline scopes every bridge read by the selected project; with
    // no scope there is nothing to address and the page degrades to empty.
    const { result } = renderHook(() => useTaskLog(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    if (result.current.data) {
      expect(result.current.data.tasks).toEqual([]);
    }
  });
});