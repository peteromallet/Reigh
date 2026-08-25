import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { queryKeys } from '@/shared/lib/queryKeys';

// Mock supabase
const mockIsDeferredCloudDataAuthority = vi.hoisted(() => vi.fn(() => true));
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockResolveGenerationProjectScope = vi.fn();
const mockResolveVariantProjectScope = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock('@/app/runtime/dataAuthority.ts', () => ({
  isDeferredCloudDataAuthority: mockIsDeferredCloudDataAuthority,
}));

vi.mock('@/shared/lib/tasks/generationTaskRepository', () => ({
  resolveGenerationProjectScope: (...args: unknown[]) => mockResolveGenerationProjectScope(...args),
  resolveVariantProjectScope: (...args: unknown[]) => mockResolveVariantProjectScope(...args),
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: vi.fn(),
  normalizeAndPresentAndRethrow: (error: unknown) => {
    if (error instanceof Error) {
      throw error;
    }
    const message = (
      error
      && typeof error === 'object'
      && 'message' in error
      && typeof (error as { message?: unknown }).message === 'string'
    )
      ? (error as { message: string }).message
      : String(error);
    throw new Error(message);
  },
}));

import {
  useDeleteGeneration,
  useDeleteVariant,
  useUpdateGenerationLocation,
  useCreateGeneration,
  useToggleGenerationStar,
} from '@/domains/generation/hooks/useGenerationMutations';

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

describe('useDeleteGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
    mockResolveGenerationProjectScope.mockResolvedValue({
      generationId: 'gen-123',
      projectId: 'project-1',
      status: 'ok',
    });
  });

  it('deletes from generations table', async () => {
    const deleteSelect = vi.fn().mockResolvedValue({ data: [{ id: 'gen-123' }], error: null });
    const deleteProjectEq = vi.fn().mockReturnValue({ select: deleteSelect });
    const deleteIdEq = vi.fn().mockReturnValue({ eq: deleteProjectEq });
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: deleteIdEq,
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteGeneration(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'gen-123', projectId: 'project-1' });
    });

    expect(mockFrom).toHaveBeenCalledWith('generations');
  });

  it('throws on error', async () => {
    const deleteSelect = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Not found' },
    });
    const deleteProjectEq = vi.fn().mockReturnValue({ select: deleteSelect });
    const deleteIdEq = vi.fn().mockReturnValue({ eq: deleteProjectEq });
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: deleteIdEq,
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteGeneration(), { wrapper });

    await expect(result.current.mutateAsync({ id: 'gen-123', projectId: 'project-1' })).rejects.toThrow('Not found');
  });

  it('rejects in Astrid authority before repository or client calls', async () => {
    mockIsDeferredCloudDataAuthority.mockReturnValue(false);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteGeneration(), { wrapper });

    await expect(result.current.mutateAsync({ id: 'gen-123', projectId: 'project-1' }))
      .rejects.toMatchObject({ code: 'capability_unavailable' });

    expect(mockResolveGenerationProjectScope).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('useDeleteVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
    mockResolveVariantProjectScope.mockResolvedValue({
      variantId: 'variant-123',
      generationId: 'gen-123',
      projectId: 'project-1',
      status: 'ok',
    });
  });

  it('deletes from generation_variants table', async () => {
    const deleteSelect = vi.fn().mockResolvedValue({ data: [{ id: 'variant-123' }], error: null });
    const deleteVariantTypeNeq = vi.fn().mockReturnValue({ select: deleteSelect });
    const deleteGenerationEq = vi.fn().mockReturnValue({ neq: deleteVariantTypeNeq });
    const deleteIdEq = vi.fn().mockReturnValue({ eq: deleteGenerationEq });
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: deleteIdEq,
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteVariant(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'variant-123', projectId: 'project-1' });
    });

    expect(mockFrom).toHaveBeenCalledWith('generation_variants');
    expect(deleteVariantTypeNeq).toHaveBeenCalledWith('variant_type', 'original');
  });

  it('rejects in Astrid authority before repository or client calls', async () => {
    mockIsDeferredCloudDataAuthority.mockReturnValue(false);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteVariant(), { wrapper });

    await expect(result.current.mutateAsync({ id: 'variant-123', projectId: 'project-1' }))
      .rejects.toMatchObject({ code: 'capability_unavailable' });

    expect(mockResolveVariantProjectScope).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('useUpdateGenerationLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveGenerationProjectScope.mockResolvedValue({
      generationId: 'gen-123',
      projectId: 'project-1',
      status: 'ok',
    });
  });

  it('updates generation with location', async () => {
    const updateSelect = vi.fn().mockResolvedValue({ data: [{ id: 'gen-123' }], error: null });
    const updateProjectEq = vi.fn().mockReturnValue({ select: updateSelect });
    const updateIdEq = vi.fn().mockReturnValue({ eq: updateProjectEq });
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: updateIdEq,
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateGenerationLocation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'gen-123',
        projectId: 'project-1',
        location: 'https://example.com/new.png',
      });
    });

    expect(mockFrom).toHaveBeenCalledWith('generations');
  });

  it('includes thumbnailUrl when provided', async () => {
    const updateSelect = vi.fn().mockResolvedValue({ data: [{ id: 'gen-123' }], error: null });
    const updateProjectEq = vi.fn().mockReturnValue({ select: updateSelect });
    const updateIdEq = vi.fn().mockReturnValue({ eq: updateProjectEq });
    const mockUpdate = vi.fn().mockReturnValue({ eq: updateIdEq });
    mockFrom.mockReturnValue({ update: mockUpdate });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateGenerationLocation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'gen-123',
        projectId: 'project-1',
        location: 'https://example.com/new.png',
        thumbnailUrl: 'https://example.com/new-thumb.png',
      });
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      location: 'https://example.com/new.png',
      thumbnail_url: 'https://example.com/new-thumb.png',
    });
  });
});

describe('useCreateGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates generation and variant', async () => {
    const mockSingle = vi.fn()
      .mockResolvedValueOnce({
        data: { id: 'gen-new', location: 'https://example.com/image.png' },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSingle,
        }),
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateGeneration(), { wrapper });

    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync({
        imageUrl: 'https://example.com/image.png',
        fileName: 'test.png',
        fileType: 'image',
        fileSize: 1024,
        projectId: 'project-1',
        prompt: 'test prompt',
      });
    });

    expect(data).toHaveProperty('id', 'gen-new');
    // Should have been called for both generations and generation_variants
    expect(mockFrom).toHaveBeenCalledWith('generations');
    expect(mockFrom).toHaveBeenCalledWith('generation_variants');
  });
});

describe('useToggleGenerationStar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
    mockResolveGenerationProjectScope.mockResolvedValue({
      generationId: 'gen-123',
      projectId: 'project-1',
      status: 'ok',
    });
  });

  it('stars a generation', async () => {
    const mockSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'gen-123', starred: true }],
      error: null,
    });
    const updateProjectEq = vi.fn().mockReturnValue({ select: mockSelect });
    const updateIdEq = vi.fn().mockReturnValue({ eq: updateProjectEq });
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: updateIdEq,
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useToggleGenerationStar(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'gen-123', starred: true, projectId: 'project-1' });
    });

    expect(mockFrom).toHaveBeenCalledWith('generations');
  });

  it('dispatches custom event on success with shotId', async () => {
    const mockSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'gen-123', starred: true }],
      error: null,
    });
    const updateProjectEq = vi.fn().mockReturnValue({ select: mockSelect });
    const updateIdEq = vi.fn().mockReturnValue({ eq: updateProjectEq });
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: updateIdEq,
      }),
    });

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useToggleGenerationStar(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'gen-123',
        starred: true,
        projectId: 'project-1',
        shotId: 'shot-456',
      });
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'generation-star-updated',
        detail: {
          generationId: 'gen-123',
          shotId: 'shot-456',
          starred: true,
        },
      })
    );

    dispatchSpy.mockRestore();
  });

  it('throws when no rows updated (RLS policy issue)', async () => {
    const mockSelect = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    });
    const updateProjectEq = vi.fn().mockReturnValue({ select: mockSelect });
    const updateIdEq = vi.fn().mockReturnValue({ eq: updateProjectEq });
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: updateIdEq,
      }),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useToggleGenerationStar(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: 'gen-123', starred: true, projectId: 'project-1' });
      })
    ).rejects.toThrow('No rows updated');
  });

  it('rejects in Astrid authority without optimistic cache drift or repository calls', async () => {
    mockIsDeferredCloudDataAuthority.mockReturnValue(false);
    const { wrapper, queryClient } = createWrapper();
    const key = queryKeys.unified.byProject('project-1', 1, 50, null, false);
    const previous = {
      items: [{ id: 'gen-123', starred: false }],
    };
    queryClient.setQueryData(key, previous);

    const { result } = renderHook(() => useToggleGenerationStar(), { wrapper });

    await expect(result.current.mutateAsync({
      id: 'gen-123',
      starred: true,
      projectId: 'project-1',
    })).rejects.toMatchObject({ code: 'capability_unavailable' });

    expect(queryClient.getQueryData(key)).toEqual(previous);
    expect(mockResolveGenerationProjectScope).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
