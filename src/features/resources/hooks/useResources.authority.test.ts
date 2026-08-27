import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resourceQueryKeys } from '@/shared/lib/queryKeys/resources';
import { usePublicLoras } from './useResources';

const { isDeferredCloudDataAuthorityMock, fromMock } = vi.hoisted(() => ({
  isDeferredCloudDataAuthorityMock: vi.fn(() => false),
  fromMock: vi.fn(),
}));

vi.mock('@/app/runtime/dataAuthority', () => ({
  isDeferredCloudDataAuthority: isDeferredCloudDataAuthorityMock,
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: vi.fn(() => ({ from: fromMock })),
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('usePublicLoras authority boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDeferredCloudDataAuthorityMock.mockReturnValue(false);
    window.history.replaceState({}, '', '/');
    fromMock.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            range: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      })),
    });
  });

  it('stays disabled under Astrid authority, including with a cached error', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, gcTime: 0 } } });
    const cachedError = new Error('cached public lora failure');
    const query = queryClient.getQueryCache().build(queryClient, {
      queryKey: resourceQueryKeys.publicByType('lora'),
    });
    query.setState({
      error: cachedError,
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
      fetchFailureCount: 1,
      fetchFailureReason: cachedError,
      fetchStatus: 'idle',
      status: 'error',
    });

    const { result } = renderHook(() => usePublicLoras(), { wrapper: createWrapper(queryClient) });

    expect(result.current.data).toEqual([]);
    expect(result.current.isFetching).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('keeps public lora fetching available under explicit deferred authority', async () => {
    isDeferredCloudDataAuthorityMock.mockReturnValue(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, gcTime: 0 } } });

    const { result } = renderHook(() => usePublicLoras(), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fromMock).toHaveBeenCalledWith('resources');
    expect(result.current.data).toEqual([]);
  });
});
