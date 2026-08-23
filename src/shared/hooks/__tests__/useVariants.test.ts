import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
// Mock supabase
const mockFrom = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock('@/shared/contexts/AuthContext', () => ({
  useAuthSafe: () => ({
    userId: 'user-1',
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('@/shared/hooks/invalidation/useGenerationInvalidation', () => ({
  enqueueVariantInvalidation: vi.fn().mockResolvedValue(undefined),
}));

import { useVariants } from '@/shared/hooks/variants/useVariants';
import type { GenerationVariant } from '@/shared/hooks/variants/useVariants';

const createVariant = (
  overrides: Partial<GenerationVariant> = {}
): GenerationVariant => ({
  id: `variant-${Math.random().toString(36).slice(2)}`,
  generation_id: 'gen-1',
  location: 'https://example.com/image.png',
  thumbnail_url: 'https://example.com/thumb.png',
  params: null,
  is_primary: false,
  starred: false,
  variant_type: 'original',
  name: null,
  created_at: '2025-01-01T00:00:00Z',
  viewed_at: null,
  ...overrides,
});

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

describe('useVariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetching', () => {
    it('does not fetch when generationId is null', () => {
      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: null }),
        { wrapper }
      );

      expect(result.current.variants).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });

    it('does not fetch when enabled is false', () => {
      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: 'gen-1', enabled: false }),
        { wrapper }
      );

      expect(result.current.variants).toEqual([]);
    });

    it('fetches variants when generationId is provided', async () => {
      const variants = [
        createVariant({ id: 'v-1', is_primary: true }),
        createVariant({ id: 'v-2' }),
      ];

      const mockOrder = vi.fn().mockResolvedValue({ data: variants, error: null });
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: mockOrder,
          }),
        }),
      });

      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: 'gen-1' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.variants).toHaveLength(2);
      });

      expect(result.current.primaryVariant?.id).toBe('v-1');
    });
  });

  describe('derived state', () => {
    it('finds primaryVariant from variants list', async () => {
      const primary = createVariant({ id: 'v-1', is_primary: true });
      const secondary = createVariant({ id: 'v-2', is_primary: false });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [primary, secondary], error: null }),
          }),
        }),
      });

      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: 'gen-1' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.primaryVariant).not.toBeNull();
      });

      expect(result.current.primaryVariant?.id).toBe('v-1');
    });

    it('returns null primaryVariant when none is_primary', async () => {
      const variants = [
        createVariant({ id: 'v-1', is_primary: false }),
        createVariant({ id: 'v-2', is_primary: false }),
      ];

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: variants, error: null }),
          }),
        }),
      });

      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: 'gen-1' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.variants).toHaveLength(2);
      });

      expect(result.current.primaryVariant).toBeNull();
    });

    it('activeVariant defaults to primary', async () => {
      const primary = createVariant({ id: 'v-1', is_primary: true });
      const secondary = createVariant({ id: 'v-2', is_primary: false });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [primary, secondary], error: null }),
          }),
        }),
      });

      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: 'gen-1' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.activeVariant).not.toBeNull();
      });

      expect(result.current.activeVariant?.id).toBe('v-1');
    });

    it('activeVariant falls back to first when no primary', async () => {
      const variants = [
        createVariant({ id: 'v-1', is_primary: false }),
        createVariant({ id: 'v-2', is_primary: false }),
      ];

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: variants, error: null }),
          }),
        }),
      });

      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: 'gen-1' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.activeVariant).not.toBeNull();
      });

      expect(result.current.activeVariant?.id).toBe('v-1');
    });
  });

  describe('setActiveVariantId', () => {
    it('changes active variant', async () => {
      const primary = createVariant({ id: 'v-1', is_primary: true });
      const secondary = createVariant({ id: 'v-2', is_primary: false });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [primary, secondary], error: null }),
          }),
        }),
      });

      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: 'gen-1' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.variants).toHaveLength(2);
      });

      act(() => {
        result.current.setActiveVariantId('v-2');
      });

      expect(result.current.activeVariant?.id).toBe('v-2');
    });

    it('falls back to primary when set to non-existent id', async () => {
      const primary = createVariant({ id: 'v-1', is_primary: true });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [primary], error: null }),
          }),
        }),
      });

      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: 'gen-1' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.variants).toHaveLength(1);
      });

      act(() => {
        result.current.setActiveVariantId('nonexistent');
      });

      // Should fall back to primary
      expect(result.current.activeVariant?.id).toBe('v-1');
    });

    it('can be set to null', async () => {
      const primary = createVariant({ id: 'v-1', is_primary: true });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [primary], error: null }),
          }),
        }),
      });

      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useVariants({ generationId: 'gen-1' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.variants).toHaveLength(1);
      });

      act(() => {
        result.current.setActiveVariantId(null);
      });

      // Should fall back to primary
      expect(result.current.activeVariant?.id).toBe('v-1');
    });
  });
});
