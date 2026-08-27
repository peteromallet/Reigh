import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShotFinalVideos } from './useShotFinalVideos';

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

describe('useShotFinalVideos authority boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDeferredCloudDataAuthorityMock.mockReturnValue(false);
    window.history.replaceState({}, '', '/');
    fromMock.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          not: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      })),
    });
  });

  it('does not query final videos for Astrid projects, even with a UUID', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, gcTime: 0 } } });
    const { result } = renderHook(
      () => useShotFinalVideos('00000000-0000-4000-8000-000000000001'),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.finalVideoMap.size).toBe(0);
    expect(result.current.isLoading).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('keeps final-video querying available under explicit deferred authority', async () => {
    isDeferredCloudDataAuthorityMock.mockReturnValue(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, gcTime: 0 } } });
    const { result } = renderHook(
      () => useShotFinalVideos('00000000-0000-4000-8000-000000000001'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fromMock).toHaveBeenCalledWith('shot_final_videos');
  });
});
