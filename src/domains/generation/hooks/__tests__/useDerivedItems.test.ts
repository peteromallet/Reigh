import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDerivedItems } from '../useDerivedItems';
import { initializeProjectSelectionStore } from '@/shared/contexts/projectSelectionStore';

const fetchGenerationDetailByIdMock = vi.fn();

vi.mock('@/integrations/supabase/repositories/generationRepository', () => ({
  fetchGenerationDetailById: (...args: unknown[]) => fetchGenerationDetailByIdMock(...args),
}));

vi.mock('@/shared/hooks/useSmartPolling', () => ({
  useSmartPollingConfig: () => ({ refetchInterval: false }),
}));

function createDerivedItemsWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('domains/generation/useDerivedItems', () => {
  beforeEach(() => {
    fetchGenerationDetailByIdMock.mockReset();
    initializeProjectSelectionStore('project-1');
  });

  it('does not fetch when source id is null', () => {
    const { result } = renderHook(() => useDerivedItems(null), {
      wrapper: createDerivedItemsWrapper(),
    });
    expect(result.current.data).toBeUndefined();
    expect(fetchGenerationDetailByIdMock).not.toHaveBeenCalled();
  });

  it('fetches derived items when source id is provided', async () => {
    fetchGenerationDetailByIdMock.mockResolvedValue({
      generation_id: 'gen-1',
      project_id: 'project-1',
      type: 'image',
      starred: false,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      variants: [{
        id: 'derived-1',
        generation_id: 'gen-1',
        media_id: 'media-1',
        variant_type: 'inpaint',
        name: null,
        is_primary: false,
        starred: false,
        viewed_at: null,
        created_at: '2025-01-01T00:00:00Z',
        params: {},
      }],
    });

    const { result } = renderHook(() => useDerivedItems('gen-1'), {
      wrapper: createDerivedItemsWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchGenerationDetailByIdMock).toHaveBeenCalledWith('gen-1');
    expect(result.current.data).toHaveLength(1);
  });
});
