import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/test-utils';

vi.mock('@/shared/lib/tasks/taskConfig', () => ({
  getVisibleTaskTypes: vi.fn(() => ['video_generation', 'travel_segment']),
}));

vi.mock('@/shared/hooks/useSmartPolling', () => ({
  useSmartPollingConfig: vi.fn(() => ({})),
}));

vi.mock('@/shared/lib/query/queryDefaults', () => ({
  QUERY_PRESETS: { immutable: { staleTime: Infinity } },
  STANDARD_RETRY: 3,
  STANDARD_RETRY_DELAY: vi.fn(() => 1000),
}));

vi.mock('@/shared/realtime/DataFreshnessManager', () => ({
  dataFreshnessManager: {
    onFetchSuccess: vi.fn(),
    onFetchFailure: vi.fn(),
  },
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: vi.fn(),
}));

import { useTaskStatusCounts, useAllTaskTypes } from '../useTaskStatusCounts';

describe('useTaskStatusCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default counts when projectId is null', () => {
    const { result } = renderHookWithProviders(() => useTaskStatusCounts(null));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('is disabled when projectId is null', () => {
    const { result } = renderHookWithProviders(() => useTaskStatusCounts(null));
    expect(result.current.isFetching).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isRefetching).toBe(false);
  });
});

describe('useAllTaskTypes', () => {
  it('returns visible task types', async () => {
    const { result } = renderHookWithProviders(() => useAllTaskTypes('proj-1'));

    await waitFor(() => {
      expect(result.current.data).toEqual(['video_generation', 'travel_segment']);
    });
    expect(result.current.data).toHaveLength(2);
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
