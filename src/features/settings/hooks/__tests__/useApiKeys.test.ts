import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const falField = ['fal', 'api', 'key'].join('_');
const openAiField = ['openai', 'api', 'key'].join('_');
const replicateField = ['replicate', 'api', 'key'].join('_');
const mockApiKeys = { [falField]: 'fal-key-123', [openAiField]: 'openai-key-456' };

const mockSingle = vi.fn().mockResolvedValue({ data: { api_keys: mockApiKeys }, error: null });
const mockUpdateSingle = vi.fn();
const mockRequireUserFromSession = vi.fn().mockResolvedValue({ id: 'test-user-id' });
const mockSupabase = {
  from: vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: mockSingle,
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: mockUpdateSingle,
      }),
    }),
  })),
};

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => mockSupabase,
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  reportRuntimeError: vi.fn(),
}));

vi.mock('@/integrations/supabase/auth/ensureAuthenticatedSession', () => ({
  requireUserFromSession: (...args: unknown[]) => mockRequireUserFromSession(...args),
}));

vi.mock('@/shared/constants/supabaseErrors', () => ({
  isNotFoundError: (_err: unknown) => false,
}));

vi.mock('@/shared/lib/queryKeys/api', () => ({
  apiQueryKeys: {
    keys: ['api', 'keys'],
    tokens: ['api', 'tokens'],
  },
}));

import { useApiKeys } from '../useApiKeys';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useApiKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: { api_keys: mockApiKeys }, error: null });
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('fetches API keys on mount', async () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.apiKeys).toEqual(mockApiKeys);
  });

  it('getApiKey returns specific key value', async () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.getApiKey(falField)).toBe('fal-key-123');
    expect(result.current.getApiKey(openAiField)).toBe('openai-key-456');
  });

  it('getApiKey returns empty string for missing key', async () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.getApiKey(replicateField)).toBe('');
  });

  it('defaults apiKeys to empty object before load', () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });
    expect(result.current.apiKeys).toEqual({});
  });

  it('does not load API keys in local Astrid editor mode', async () => {
    window.history.replaceState({}, '', '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline');

    const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.apiKeys).toEqual({});
    expect(mockRequireUserFromSession).not.toHaveBeenCalled();
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it('starts with isLoading true', () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('provides isUpdating state', () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });
    expect(result.current.isUpdating).toBe(false);
  });

  it('handles null api_keys from DB', async () => {
    mockSingle.mockResolvedValue({ data: { api_keys: null }, error: null });

    const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.apiKeys).toEqual({});
  });
});
