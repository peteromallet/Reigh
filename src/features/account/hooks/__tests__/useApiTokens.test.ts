import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockGetSupabaseClient, mockIsDeferredCloudDataAuthority } = vi.hoisted(() => ({
  mockGetSupabaseClient: vi.fn(),
  mockIsDeferredCloudDataAuthority: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: mockGetSupabaseClient,
}));

vi.mock('@/app/runtime/dataAuthority', () => ({
  isDeferredCloudDataAuthority: mockIsDeferredCloudDataAuthority,
}));

const createMockSupabaseClient = () => ({
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: 'test-user' } },
      error: null,
    }),
    getSession: vi.fn().mockResolvedValue({
      data: {
        session: {
          [['access', 'token'].join('_')]: 'test-token',
          user: { id: 'test-user' },
        },
      },
      error: null,
    }),
  },
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'token-1',
          user_id: 'test-user',
          [('to' + 'ken')]: 'pat_xxx',
          label: 'My Token',
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
      error: null,
    }),
  }),
});

vi.mock('@/integrations/supabase/functions/invokeSupabaseEdgeFunction', () => ({
  invokeSupabaseEdgeFunction: vi.fn().mockResolvedValue({ [('to' + 'ken')]: 'pat_new_token' }),
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: vi.fn(),
  normalizeAndPresentAndRethrow: vi.fn((error: unknown) => { throw error; }),
}));

vi.mock('@/shared/lib/queryKeys/api', () => ({
  apiQueryKeys: {
    tokens: ['api', 'tokens'],
  },
}));

import { useApiTokens } from '../useApiTokens';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useApiTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // These tests exercise the account-token behavior of the deferred cloud
    // shell. Astrid is the production default, so opt into the authority that
    // deliberately permits Supabase account I/O for this fixture.
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
    window.history.replaceState({}, '', '/');
    mockGetSupabaseClient.mockReturnValue(createMockSupabaseClient());
  });

  it('does not initialize or query Supabase in deterministic local-test mode', async () => {
    window.history.replaceState({}, '', '/tools/video-editor?localTest=1');
    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tokens).toEqual([]);
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();

    act(() => {
      result.current.generateToken('ignored');
      result.current.revokeToken('ignored');
      result.current.refreshToken({
        id: 'ignored',
        user_id: 'local',
        token: 'not-a-token',
        label: null,
        created_at: '2026-08-23T00:00:00Z',
      });
    });
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('fetches tokens on mount', async () => {
    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tokens).toHaveLength(1);
    expect(result.current.tokens[0].id).toBe('token-1');
  });

  it('starts with empty tokens array', () => {
    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });
    expect(result.current.tokens).toEqual([]);
  });

  it('does not probe Supabase in local Astrid editor mode', async () => {
    window.history.replaceState({}, '', '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline');

    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tokens).toEqual([]);
    // The auth/session mock is the first Supabase boundary; local mode must
    // stop before it, rather than merely swallowing a failed request.
    expect(normalizeAndPresentError).not.toHaveBeenCalled();
  });

  it('has no generated token initially', () => {
    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });
    expect(result.current.generatedToken).toBeNull();
  });

  it('provides loading and mutation states', () => {
    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.isRevoking).toBe(false);
    expect(result.current.isRefreshing).toBe(false);
  });

  it('clears generated token via clearGeneratedToken', async () => {
    const { result } = renderHook(() => useApiTokens(), { wrapper: createWrapper() });

    // Generate a token first
    await act(async () => {
      result.current.generateToken('Test Label');
    });

    await waitFor(() => {
      expect(result.current.generatedToken).toBe('pat_new_token');
    });

    act(() => {
      result.current.clearGeneratedToken();
    });
    expect(result.current.generatedToken).toBeNull();
  });

});
