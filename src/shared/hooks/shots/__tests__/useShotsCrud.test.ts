import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock supabase
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockIsDeferredCloudDataAuthority = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock('@/app/runtime/dataAuthority.ts', () => ({
  isDeferredCloudDataAuthority: mockIsDeferredCloudDataAuthority,
}));

vi.mock('@/shared/hooks/invalidation/useGenerationInvalidation', () => ({
  enqueueGenerationsInvalidation: vi.fn(),
}));

vi.mock('@/shared/constants/supabaseErrors', () => ({
  isNotFoundError: (err: { code?: string }) => err?.code === 'PGRST116',
}));

import { useDeleteShot, useCreateShot, useDuplicateShot, useReorderShots } from '../useShotsCrud';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe('useDeleteShot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
  });

  it('deletes a shot from the database', async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: mockEq,
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteShot(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ shotId: 'shot-1', projectId: 'project-1' });
    });

    expect(mockFrom).toHaveBeenCalledWith('shots');
  });

  it('throws on error', async () => {
    const mockEq = vi.fn().mockResolvedValue({
      error: { message: 'Not found', code: '42' },
    });
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: mockEq,
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteShot(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ shotId: 'shot-1', projectId: 'project-1' });
      })
    ).rejects.toThrow();
  });

  it('rejects in Astrid before Supabase or optimistic cache effects', async () => {
    mockIsDeferredCloudDataAuthority.mockReturnValue(false);
    const { wrapper, queryClient } = createWrapper();
    const key = ['shots', 'project-1'];
    const previous = [{ id: 'shot-1', name: 'Shot 1' }];
    queryClient.setQueryData(key, previous);
    const { result } = renderHook(() => useDeleteShot(), { wrapper });

    await expect(result.current.mutateAsync({ shotId: 'shot-1', projectId: 'project-1' }))
      .rejects.toMatchObject({ code: 'capability_unavailable' });

    expect(mockFrom).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(key)).toEqual(previous);
  });
});

describe('useCreateShot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
  });

  it('creates a shot with auto-calculated position', async () => {
    // Mock last shot fetch
    mockFrom.mockImplementation((table: string) => {
      if (table === 'shots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { position: 3 },
                    error: null,
                  }),
                }),
              }),
            }),
            // For the final fetch of the created shot
            single: vi.fn,
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    mockRpc.mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { shot_id: 'new-shot-1', success: true },
        error: null,
      }),
    });

    // Mock the follow-up fetch for the created shot
    const shotData = {
      id: 'new-shot-1',
      name: 'New Shot',
      position: 4,
      project_id: 'project-1',
    };

    let fetchCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'shots') {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // First call: fetch last position
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { position: 3 },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        // Second call: fetch created shot
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: shotData,
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateShot(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        name: 'New Shot',
        projectId: 'project-1',
      });
    });

    expect(mockRpc).toHaveBeenCalledWith('insert_shot_at_position', expect.any(Object));
  });
});

describe('useDuplicateShot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
  });

  it('calls duplicate_shot RPC', async () => {
    const shotData = {
      id: 'new-shot-dup',
      name: 'Shot (copy)',
      position: 2,
    };

    mockRpc.mockResolvedValue({ data: 'new-shot-dup', error: null });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: shotData,
            error: null,
          }),
        }),
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDuplicateShot(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        shotId: 'shot-1',
        projectId: 'project-1',
      });
    });

    expect(mockRpc).toHaveBeenCalledWith('duplicate_shot', {
      original_shot_id: 'shot-1',
      project_id: 'project-1',
    });
  });
});

describe('useReorderShots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
  });

  it('updates positions for all shots', async () => {
    const mockEq = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: mockEq,
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReorderShots(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'project-1',
        shotOrders: [
          { shotId: 'shot-a', position: 0 },
          { shotId: 'shot-b', position: 1 },
          { shotId: 'shot-c', position: 2 },
        ],
      });
    });

    // Should update positions for all three shots
    expect(mockFrom).toHaveBeenCalledWith('shots');
  });

  it('throws when some updates fail', async () => {
    let callCount = 0;
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 2) {
              return Promise.resolve({ error: { message: 'Update failed' } });
            }
            return Promise.resolve({ error: null });
          }),
        }),
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReorderShots(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          projectId: 'project-1',
          shotOrders: [
            { shotId: 'shot-a', position: 0 },
            { shotId: 'shot-b', position: 1 },
          ],
        });
      })
    ).rejects.toThrow('Failed to update some shot positions');
  });
});
