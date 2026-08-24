import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAllTaskTypesConfig, useTaskType } from '../useTaskType';
import { setTaskTypeConfigCache } from '@/shared/lib/taskTypeCache';

vi.mock('@/shared/lib/taskTypeCache', async () => {
  const actual = await vi.importActual<typeof taskTypeCacheModule>('@/shared/lib/taskTypeCache');
  return {
    ...actual,
    setTaskTypeConfigCache: vi.fn(),
  };
});

import type * as taskTypeCacheModule from '@/shared/lib/taskTypeCache';

const mockedSetCache = vi.mocked(setTaskTypeConfigCache);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useTaskType (local registry source)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a known task type from the local registry', async () => {
    const { result } = renderHook(() => useTaskType('qwen_image'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      name: 'qwen_image',
      display_name: 'Qwen Image',
      category: 'generation',
      is_visible: true,
      content_type: 'image',
    });
  });

  it('returns null for unknown task types', async () => {
    const { result } = renderHook(() => useTaskType('not_a_real_type'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('useAllTaskTypesConfig warms the cache with every registry entry', async () => {
    const { result } = renderHook(() => useAllTaskTypesConfig(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const config = result.current.data!;
    expect(Object.keys(config)).toContain('qwen_image');
    expect(Object.keys(config)).toContain('travel_orchestrator');
    // Cache warming is part of the contract consumers rely on.
    expect(mockedSetCache).toHaveBeenCalledWith(expect.objectContaining({
      qwen_image: expect.objectContaining({ name: 'qwen_image' }),
    }));
  });
});
