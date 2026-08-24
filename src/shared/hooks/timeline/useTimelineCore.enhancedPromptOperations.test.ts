import { act, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRow } from '@/domains/generation/types';
import { queryKeys } from '@/shared/lib/queryKeys';
import { useTimelineEnhancedPromptOperations } from './useTimelineCore.enhancedPromptOperations';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  normalizeAndPresentError: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: (...args: unknown[]) => mocks.from(...args),
  }),
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: (...args: unknown[]) => mocks.normalizeAndPresentError(...args),
}));

function createGeneration(overrides: Record<string, unknown>): GenerationRow {
  return {
    id: 'sg-default',
    timeline_frame: 0,
    metadata: {},
    ...overrides,
  } as unknown as GenerationRow;
}

describe('useTimelineEnhancedPromptOperations', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.update.mockReset();
    mocks.eq.mockReset();
    mocks.normalizeAndPresentError.mockReset();

    mocks.eq.mockResolvedValue({ error: null });
    mocks.update.mockImplementation(() => ({
      eq: (...args: unknown[]) => mocks.eq(...args),
    }));
    mocks.from.mockImplementation(() => ({
      update: (...args: unknown[]) => mocks.update(...args),
    }));
  });

  it('reads enhanced prompts from positioned item metadata', () => {
    const queryClient = new QueryClient();
    const invalidateGenerations = vi.fn();
    const positionedItems = [
      createGeneration({
        id: 'sg-1',
        shotImageEntryId: 'sg-1',
        metadata: { enhanced_prompt: 'cinematic portrait' },
      }),
      createGeneration({
        id: 'sg-2',
        shotImageEntryId: 'sg-2',
        metadata: null,
      }),
    ];

    const { result } = renderHook(() => useTimelineEnhancedPromptOperations(
      'shot-1',
      positionedItems,
      invalidateGenerations,
      queryClient,
    ));

    expect(result.current.getEnhancedPrompt('sg-1')).toBe('cinematic portrait');
    expect(result.current.getEnhancedPrompt('sg-2')).toBeUndefined();
    expect(result.current.getEnhancedPrompt('missing')).toBeUndefined();
  });

  it('optimistically clears a single enhanced prompt and invalidates generation metadata', async () => {
    const queryClient = new QueryClient();
    const invalidateGenerations = vi.fn();
    const positionedItems = [
      createGeneration({
        id: 'sg-1',
        shotImageEntryId: 'sg-1',
        metadata: { enhanced_prompt: 'cinematic portrait', source: 'ai' },
      }),
      createGeneration({
        id: 'sg-2',
        shotImageEntryId: 'sg-2',
        metadata: { source: 'manual' },
      }),
    ];

    queryClient.setQueryData(queryKeys.generations.byShot('shot-1'), positionedItems);

    const { result } = renderHook(() => useTimelineEnhancedPromptOperations(
      'shot-1',
      positionedItems,
      invalidateGenerations,
      queryClient,
    ));

    await act(async () => {
      await result.current.clearEnhancedPrompt('sg-1');
    });

    expect(mocks.from).toHaveBeenCalledWith('shot_generations');
    expect(mocks.update).toHaveBeenCalledWith({
      metadata: { enhanced_prompt: '', source: 'ai' },
    });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'sg-1');
    expect(invalidateGenerations).toHaveBeenCalledWith('shot-1', {
      reason: 'clear-enhanced-prompt',
      scope: 'metadata',
    });
    expect(queryClient.getQueryData(queryKeys.generations.byShot('shot-1'))).toEqual([
      expect.objectContaining({
        id: 'sg-1',
        metadata: { enhanced_prompt: '', source: 'ai' },
      }),
      expect.objectContaining({
        id: 'sg-2',
        metadata: { source: 'manual' },
      }),
    ]);
  });

  it('clears all enhanced prompts that are currently set', async () => {
    const queryClient = new QueryClient();
    const invalidateGenerations = vi.fn();
    const positionedItems = [
      createGeneration({
        id: 'sg-1',
        shotImageEntryId: 'sg-1',
        metadata: { enhanced_prompt: 'one', source: 'ai' },
      }),
      createGeneration({
        id: 'sg-2',
        shotImageEntryId: 'sg-2',
        metadata: { enhanced_prompt: '', source: 'manual' },
      }),
      createGeneration({
        id: '',
        shotImageEntryId: null,
        metadata: { enhanced_prompt: 'skipped because missing id' },
      }),
    ];

    const { result } = renderHook(() => useTimelineEnhancedPromptOperations(
      'shot-1',
      positionedItems,
      invalidateGenerations,
      queryClient,
    ));

    await act(async () => {
      await result.current.clearAllEnhancedPrompts();
    });

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      metadata: { enhanced_prompt: '', source: 'ai' },
    });
    expect(invalidateGenerations).toHaveBeenCalledWith('shot-1', {
      reason: 'clear-all-enhanced-prompts',
      scope: 'metadata',
    });
  });

  it('normalizes and rethrows clear errors after invalidating the metadata cache', async () => {
    const queryClient = new QueryClient();
    const invalidateGenerations = vi.fn();
    const normalizedError = new Error('normalized clear failure');
    const originalError = new Error('db failure');
    const positionedItems = [
      createGeneration({
        id: 'sg-1',
        shotImageEntryId: 'sg-1',
        metadata: { enhanced_prompt: 'cinematic portrait' },
      }),
    ];

    mocks.eq.mockResolvedValueOnce({ error: originalError });
    mocks.normalizeAndPresentError.mockReturnValue(normalizedError);

    const { result } = renderHook(() => useTimelineEnhancedPromptOperations(
      'shot-1',
      positionedItems,
      invalidateGenerations,
      queryClient,
    ));

    await expect(result.current.clearEnhancedPrompt('sg-1')).rejects.toBe(normalizedError);
    expect(invalidateGenerations).toHaveBeenCalledWith('shot-1', {
      reason: 'clear-enhanced-prompt-error',
      scope: 'metadata',
    });
    expect(mocks.normalizeAndPresentError).toHaveBeenCalledWith(originalError, {
      context: 'useTimelineCore.clearEnhancedPrompt',
      showToast: false,
    });
  });
});
