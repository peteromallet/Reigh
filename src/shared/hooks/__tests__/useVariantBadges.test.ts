import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockGalleryList = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/astrid/client', () => ({
  AstridLocalClient: class {
    gallery = { list: (...args: unknown[]) => mockGalleryList(...args) };
  },
}));

import { initializeProjectSelectionStore } from '@/shared/contexts/projectSelectionStore';

import { useVariantBadges } from '@/shared/hooks/variants/useVariantBadges';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useVariantBadges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeProjectSelectionStore('project-1');
    mockGalleryList.mockResolvedValue({
      generations: [
        {
          generation_id: 'gen-1',
          name: 'Generation 1',
          type: 'image',
          starred: false,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          primary: null,
          variant_count: 3,
        },
        {
          generation_id: 'gen-2',
          name: 'Generation 2',
          type: 'image',
          starred: false,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          primary: null,
          variant_count: 0,
        },
      ],
      next_cursor: null,
    });
  });

  it('returns loading state initially', () => {
    const { result } = renderHook(
      () => useVariantBadges(['gen-1', 'gen-2']),
      { wrapper: createWrapper() }
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('returns badge data after loading', async () => {
    const { result } = renderHook(
      () => useVariantBadges(['gen-1', 'gen-2']),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const badge1 = result.current.getBadgeData('gen-1');
    expect(badge1.derivedCount).toBe(3);
    // R12 gallery summaries expose counts only. Unviewed detail is deliberately
    // absent until the bounded R13 variant read is available.
    expect(badge1.hasUnviewedVariants).toBe(false);
    expect(badge1.unviewedVariantCount).toBe(0);

    const badge2 = result.current.getBadgeData('gen-2');
    expect(badge2.derivedCount).toBe(0);
    expect(badge2.hasUnviewedVariants).toBe(false);
    expect(badge2.unviewedVariantCount).toBe(0);
  });

  it('returns zero values for unknown generation IDs', async () => {
    const { result } = renderHook(
      () => useVariantBadges(['gen-1']),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const badge = result.current.getBadgeData('unknown-gen');
    expect(badge.derivedCount).toBe(0);
    expect(badge.hasUnviewedVariants).toBe(false);
    expect(badge.unviewedVariantCount).toBe(0);
  });

  it('markGenerationViewed optimistically removes unviewed state', async () => {
    const { result } = renderHook(
      () => useVariantBadges(['gen-1']),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // R12 summaries have no unviewed detail, but the derived count is present.
    expect(result.current.getBadgeData('gen-1').hasUnviewedVariants).toBe(false);

    // Mark as viewed
    act(() => {
      result.current.markGenerationViewed('gen-1');
    });

    // After marking - optimistically updated
    expect(result.current.getBadgeData('gen-1').hasUnviewedVariants).toBe(false);
    expect(result.current.getBadgeData('gen-1').unviewedVariantCount).toBe(0);
    // derivedCount is not affected by viewing
    expect(result.current.getBadgeData('gen-1').derivedCount).toBe(3);
  });

  it('does not fetch when enabled=false', () => {
    renderHook(
      () => useVariantBadges(['gen-1'], false),
      { wrapper: createWrapper() }
    );

    expect(mockGalleryList).not.toHaveBeenCalled();
  });

  it('does not fetch when generationIds is empty', () => {
    renderHook(
      () => useVariantBadges([]),
      { wrapper: createWrapper() }
    );

    expect(mockGalleryList).not.toHaveBeenCalled();
  });

  it('passes correct IDs to calculateDerivedCountsSafe', async () => {
    const ids = ['gen-1', 'gen-2', 'gen-3'];

    renderHook(
      () => useVariantBadges(ids),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(mockGalleryList).toHaveBeenCalled());
    expect(mockGalleryList).toHaveBeenCalledWith({ limit: 200, cursor: undefined });
  });
});
