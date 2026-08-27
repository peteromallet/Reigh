import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrefetchToolSettings } from '../usePrefetchToolSettings';
import { settingsQueryKeys } from '@/shared/lib/queryKeys/settings';

const {
  isDeferredCloudDataAuthorityMock,
  fetchToolSettingsSupabaseMock,
  normalizeAndPresentErrorMock,
} = vi.hoisted(() => ({
  isDeferredCloudDataAuthorityMock: vi.fn(() => false),
  fetchToolSettingsSupabaseMock: vi.fn().mockResolvedValue({ settings: {}, hasShotSettings: false }),
  normalizeAndPresentErrorMock: vi.fn(),
}));

vi.mock('@/app/runtime/dataAuthority', () => ({
  isDeferredCloudDataAuthority: isDeferredCloudDataAuthorityMock,
}));

vi.mock('@/shared/settings', () => ({
  fetchToolSettingsSupabase: fetchToolSettingsSupabaseMock,
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: vi.fn(),
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: normalizeAndPresentErrorMock,
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('usePrefetchToolSettings authority boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDeferredCloudDataAuthorityMock.mockReturnValue(false);
    window.history.replaceState({}, '', '/');
  });

  it('does not prefetch or re-present cached errors under Astrid authority', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, gcTime: 0 } } });
    const queryKey = settingsQueryKeys.tool('image-generation', 'project-1', undefined);
    const cachedError = new Error('cached settings failure');
    const query = queryClient.getQueryCache().build(queryClient, { queryKey });
    query.setState({
      error: cachedError,
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
      fetchFailureCount: 1,
      fetchFailureReason: cachedError,
      fetchStatus: 'idle',
      status: 'error',
    });
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery');

    renderHook(() => usePrefetchToolSettings('project-1'), { wrapper: createWrapper(queryClient) });
    await act(async () => { await Promise.resolve(); });

    expect(prefetchSpy).not.toHaveBeenCalled();
    expect(fetchToolSettingsSupabaseMock).not.toHaveBeenCalled();
    expect(normalizeAndPresentErrorMock).not.toHaveBeenCalled();
  });

  it('prefetches the legacy settings set only under explicit deferred authority', async () => {
    isDeferredCloudDataAuthorityMock.mockReturnValue(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, gcTime: 0 } } });
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined);

    renderHook(() => usePrefetchToolSettings('project-1'), { wrapper: createWrapper(queryClient) });
    await act(async () => { await Promise.resolve(); });

    expect(prefetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchToolSettingsSupabaseMock).not.toHaveBeenCalled();
  });
});
