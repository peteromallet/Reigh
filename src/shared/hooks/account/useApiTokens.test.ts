import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useApiTokens } from './useApiTokens';

const { isDeferredCloudDataAuthorityMock, requireUserFromSessionMock } = vi.hoisted(() => ({
  isDeferredCloudDataAuthorityMock: vi.fn(() => false),
  requireUserFromSessionMock: vi.fn(),
}));

const fromMock = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      order: vi.fn(),
    })),
  })),
}));

vi.mock('@/app/runtime/dataAuthority', () => ({
  isDeferredCloudDataAuthority: isDeferredCloudDataAuthorityMock,
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: vi.fn(() => ({ from: fromMock })),
}));

vi.mock('@/integrations/supabase/auth/ensureAuthenticatedSession', () => ({
  requireUserFromSession: requireUserFromSessionMock,
  requireSession: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useApiTokens authority boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDeferredCloudDataAuthorityMock.mockReturnValue(false);
    requireUserFromSessionMock.mockResolvedValue({ id: 'user-1' });
    fromMock.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    });
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('does not fetch account tokens under default Astrid authority', () => {
    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });

    expect(result.current.tokens).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(requireUserFromSessionMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('does not fetch account tokens in local editor mode', () => {
    window.history.replaceState(
      {},
      '',
      '/tools/video-editor?localProject=desert-plant-growth&localTimeline=01KYPVKMW5STB4W6FE05ED8242',
    );

    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });

    expect(result.current.tokens).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(requireUserFromSessionMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('fetches account tokens only when deferred cloud authority is explicit', async () => {
    isDeferredCloudDataAuthorityMock.mockReturnValue(true);
    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(requireUserFromSessionMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(result.current.tokens).toEqual([]);
  });
});
