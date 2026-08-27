import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { renderHookWithProviders } from '@/test/test-utils';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';

const mockIs = vi.fn();
const mockEq = vi.fn(() => ({
  is: mockIs,
}));
const mockUpdate = vi.fn(() => ({
  eq: mockEq,
}));
const mockFrom = vi.fn(() => ({
  update: mockUpdate,
}));
const mockLocalMarkViewed = vi.fn().mockResolvedValue({
  generation_id: 'gen-local',
  variant_id: 'variant-local',
  viewed_at: '2026-08-27T00:00:00.000Z',
  marked_count: 1,
});

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

vi.mock('@/integrations/astrid/client', () => ({
  AstridLocalClient: class {
    gallery = { markViewed: mockLocalMarkViewed };
  },
}));

import { useMarkVariantViewed } from '@/shared/hooks/variants/useMarkVariantViewed';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

describe('useMarkVariantViewed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIs.mockResolvedValue({ error: null });
    window.history.replaceState({}, '', '/');
  });

  it('returns markViewed and markAllViewed functions', () => {
    const { result } = renderHookWithProviders(() => useMarkVariantViewed());

    expect(typeof result.current.markViewed).toBe('function');
    expect(typeof result.current.markAllViewed).toBe('function');
    expect(result.current.isMarking).toBe(false);
    expect(result.current.isMarkingAll).toBe(false);
  });

  it('marks a single variant as viewed and updates variant cache optimistically', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(generationQueryKeys.variants('gen-1'), [
      { id: 'v-1', generation_id: 'gen-1', viewed_at: null },
      { id: 'v-2', generation_id: 'gen-1', viewed_at: null },
    ]);
    queryClient.setQueryData(['variant-badges', 'gen-1'], {
      derivedCounts: {},
      hasUnviewedVariants: { 'gen-1': true },
      unviewedVariantCounts: { 'gen-1': 2 },
    });

    const { result } = renderHookWithProviders(() => useMarkVariantViewed(), { queryClient });

    act(() => {
      result.current.markViewed({ variantId: 'v-1', generationId: 'gen-1' });
    });

    await waitFor(() => {
      const variants = queryClient.getQueryData(generationQueryKeys.variants('gen-1')) as Array<{ id: string; viewed_at: string | null }>;
      expect(variants[0].viewed_at).not.toBeNull();
      expect(variants[1].viewed_at).toBeNull();
    });

    const badges = queryClient.getQueryData(['variant-badges', 'gen-1']) as {
      unviewedVariantCounts: Record<string, number>;
    };
    expect(badges.unviewedVariantCounts['gen-1']).toBe(1);

    expect(mockFrom).toHaveBeenCalledWith('generation_variants');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ viewed_at: expect.any(String) }));
    expect(mockEq).toHaveBeenCalledWith('id', 'v-1');
    expect(mockIs).toHaveBeenCalledWith('viewed_at', null);
  });

  it('does not double-decrement badges when markViewed is called twice for the same variant', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(generationQueryKeys.variants('gen-1'), [
      { id: 'v-1', generation_id: 'gen-1', viewed_at: null },
    ]);
    queryClient.setQueryData(['variant-badges', 'gen-1'], {
      derivedCounts: {},
      hasUnviewedVariants: { 'gen-1': true },
      unviewedVariantCounts: { 'gen-1': 3 },
    });

    const { result } = renderHookWithProviders(() => useMarkVariantViewed(), { queryClient });

    act(() => {
      result.current.markViewed({ variantId: 'v-1', generationId: 'gen-1' });
      result.current.markViewed({ variantId: 'v-1', generationId: 'gen-1' });
    });

    await waitFor(() => {
      const badges = queryClient.getQueryData(['variant-badges', 'gen-1']) as {
        unviewedVariantCounts: Record<string, number>;
      };
      expect(badges.unviewedVariantCounts['gen-1']).toBe(2);
    });
  });

  it('marks all variants for a generation as viewed and zeroes the badge count', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(generationQueryKeys.variants('gen-1'), [
      { id: 'v-1', generation_id: 'gen-1', viewed_at: null },
      { id: 'v-2', generation_id: 'gen-1', viewed_at: null },
      { id: 'other-gen', generation_id: 'gen-2', viewed_at: null },
    ]);
    queryClient.setQueryData(['variant-badges', 'gen-1'], {
      derivedCounts: {},
      hasUnviewedVariants: { 'gen-1': true },
      unviewedVariantCounts: { 'gen-1': 2 },
    });

    const { result } = renderHookWithProviders(() => useMarkVariantViewed(), { queryClient });

    act(() => {
      result.current.markAllViewed('gen-1');
    });

    await waitFor(() => {
      const variants = queryClient.getQueryData(generationQueryKeys.variants('gen-1')) as Array<{
        id: string;
        generation_id: string;
        viewed_at: string | null;
      }>;
      expect(variants.find((v) => v.id === 'v-1')?.viewed_at).not.toBeNull();
      expect(variants.find((v) => v.id === 'v-2')?.viewed_at).not.toBeNull();
      expect(variants.find((v) => v.id === 'other-gen')?.viewed_at).toBeNull();
    });

    const badges = queryClient.getQueryData(['variant-badges', 'gen-1']) as {
      hasUnviewedVariants: Record<string, boolean>;
      unviewedVariantCounts: Record<string, number>;
    };
    expect(badges.hasUnviewedVariants['gen-1']).toBe(false);
    expect(badges.unviewedVariantCounts['gen-1']).toBe(0);
    expect(mockEq).toHaveBeenCalledWith('generation_id', 'gen-1');
    expect(mockIs).toHaveBeenCalledWith('viewed_at', null);
  });

  it('uses the authenticated local bridge and never calls Supabase in local mode', async () => {
    window.history.replaceState(
      {},
      '',
      '/tools/video-editor?localProject=local-project&localTimeline=local-timeline',
    );
    const queryClient = createQueryClient();
    const { result } = renderHookWithProviders(() => useMarkVariantViewed(), { queryClient });

    act(() => {
      result.current.markViewed({ variantId: 'variant-local', generationId: 'gen-local' });
      result.current.markAllViewed('gen-local');
    });

    await waitFor(() => expect(mockLocalMarkViewed).toHaveBeenCalledTimes(2));
    expect(mockLocalMarkViewed).toHaveBeenCalledWith('gen-local', 'variant-local');
    expect(mockLocalMarkViewed.mock.calls.some((args) => args.length === 1 && args[0] === 'gen-local')).toBe(true);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
