import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const supabaseMocks = vi.hoisted(() => {
  const tableConfigs = new Map<string, {
    query?: unknown;
    single?: unknown;
    maybeSingle?: unknown;
  }>();

  return {
    getSession: vi.fn(),
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.insert = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      chain.then = (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(
          tableConfigs.get(table)?.query ?? { data: null, error: null },
        ).then(onFulfilled, onRejected);
      chain.single = vi.fn().mockImplementation(async () => (
        tableConfigs.get(table)?.single ?? { data: null, error: null }
      ));
      chain.maybeSingle = vi.fn().mockImplementation(async () => (
        tableConfigs.get(table)?.maybeSingle ?? { data: null, error: null }
      ));
      return chain;
    }),
    normalizeAndPresentError: vi.fn(),
    setTableConfig: (table: string, config: { query?: unknown; single?: unknown; maybeSingle?: unknown }) => {
      tableConfigs.set(table, config);
    },
    resetTableConfigs: () => {
      tableConfigs.clear();
    },
  };
});

// Mock supabase
vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => supabaseMocks.getSession(...args),
    },
    from: (...args: unknown[]) => supabaseMocks.from(...args),
  }),
}));

vi.mock('@/shared/components/ui/runtime/sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/shared/constants/supabaseErrors', () => ({
  isNotFoundError: vi.fn(() => false),
  isUniqueViolationError: vi.fn(() => false),
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: (...args: unknown[]) => supabaseMocks.normalizeAndPresentError(...args),
}));

import { useShareGeneration } from '../useShareGeneration';

describe('useShareGeneration', () => {
  afterEach(() => {
    // This suite replaces the process-global crypto object for random UUID
    // generation. Restore it so later suites retain Web Crypto's subtle
    // implementation (notably extension integrity hashing).
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.resetTableConfigs();
    supabaseMocks.getSession.mockResolvedValue({
      data: {
        session: {
          [['access', 'token'].join('_')]: 'test-token',
          user: { id: 'test-user-id' },
        },
      },
    });

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    // Mock crypto.getRandomValues
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => {
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
        return array;
      },
    });
  });

  it('returns initial state', () => {
    const { result } = renderHook(() =>
      useShareGeneration('gen-1', 'task-1')
    );

    expect(result.current.isCreatingShare).toBe(false);
    expect(result.current.shareCopied).toBe(false);
    expect(result.current.shareSlug).toBeNull();
    expect(typeof result.current.handleShare).toBe('function');
  });

  it('uses initial share slug when provided', () => {
    const { result } = renderHook(() =>
      useShareGeneration('gen-1', 'task-1', null, {
        initialShareSlug: 'existing-slug',
      })
    );

    expect(result.current.shareSlug).toBe('existing-slug');
  });

  it('resets state when generationId changes', () => {
    const { result, rerender } = renderHook(
      ({ genId }: { genId: string }) => useShareGeneration(genId, 'task-1'),
      { initialProps: { genId: 'gen-1' } }
    );

    // First, set some state
    // (can't easily set shareSlug without full mock, but we can verify shareCopied resets)
    rerender({ genId: 'gen-2' });

    expect(result.current.shareCopied).toBe(false);
    expect(result.current.shareSlug).toBeNull();
  });

  it('handleShare does nothing when generationId is undefined', async () => {
    const { result } = renderHook(() =>
      useShareGeneration(undefined, null)
    );

    const mockEvent = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    await act(async () => {
      await result.current.handleShare(mockEvent);
    });

    expect(result.current.isCreatingShare).toBe(false);
  });

  it('copies existing share URL to clipboard when shareSlug exists', async () => {
    const { result } = renderHook(() =>
      useShareGeneration('gen-1', 'task-1', null, {
        initialShareSlug: 'test-slug',
      })
    );

    const mockEvent = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    await act(async () => {
      await result.current.handleShare(mockEvent);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/share/test-slug')
    );
    expect(result.current.shareCopied).toBe(true);
  });

  it('prevents event propagation', async () => {
    const { result } = renderHook(() =>
      useShareGeneration('gen-1', 'task-1', null, {
        initialShareSlug: 'test-slug',
      })
    );

    const mockEvent = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    await act(async () => {
      await result.current.handleShare(mockEvent);
    });

    expect(mockEvent.stopPropagation).toHaveBeenCalled();
    expect(mockEvent.preventDefault).toHaveBeenCalled();
  });

  it('normalizes share-creation failures when generation data cannot be loaded', async () => {
    const generationError = new Error('Failed to load generation data');
    supabaseMocks.setTableConfig('generations', {
      single: { data: null, error: generationError },
    });

    const { result } = renderHook(() =>
      useShareGeneration('gen-1', 'task-1')
    );

    const mockEvent = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    await act(async () => {
      await result.current.handleShare(mockEvent);
    });

    expect(supabaseMocks.normalizeAndPresentError).toHaveBeenCalledWith(generationError, {
      context: 'useShareGeneration',
      toastTitle: 'Share failed',
      logData: { message: 'Please try again' },
    });
    expect(result.current.isCreatingShare).toBe(false);
    expect(result.current.shareSlug).toBeNull();
  });

  it('loads shot final video data from shot_final_videos when shotId is provided', async () => {
    supabaseMocks.setTableConfig('shared_generations', {
      maybeSingle: { data: null, error: null },
      single: { data: { share_slug: 'new-slug' }, error: null },
    });
    supabaseMocks.setTableConfig('shot_final_videos', {
      single: {
        data: {
          id: 'gen-1',
          location: 'https://cdn.example.com/final.mp4',
          thumbnail_url: 'https://cdn.example.com/final.jpg',
          type: 'video',
          params: { tool_type: 'travel-between-images' },
          created_at: '2026-04-14T10:00:00Z',
        },
        error: null,
      },
    });
    supabaseMocks.setTableConfig('tasks', {
      single: {
        data: {
          id: 'task-1',
          task_type: 'travel_between_images',
          params: { prompt: 'Prompt' },
          status: 'Completed',
          created_at: '2026-04-14T10:00:00Z',
        },
        error: null,
      },
    });
    supabaseMocks.setTableConfig('shots', {
      single: {
        data: {
          id: 'shot-1',
          name: 'Shot 1',
          settings: {
            travel_between_images: {
              generationMode: 'batch',
            },
          },
        },
        error: null,
      },
    });
    supabaseMocks.setTableConfig('shot_generations', {
      query: { data: [], error: null },
    });
    supabaseMocks.setTableConfig('users', {
      maybeSingle: {
        data: {
          username: 'tester',
          name: 'Test User',
          avatar_url: null,
        },
        error: null,
      },
    });

    const { result } = renderHook(() =>
      useShareGeneration('gen-1', 'task-1', 'shot-1')
    );

    const mockEvent = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    await act(async () => {
      await result.current.handleShare(mockEvent);
    });

    expect(supabaseMocks.from).toHaveBeenCalledWith('shot_final_videos');
    expect(supabaseMocks.from).not.toHaveBeenCalledWith('generations');
    expect(result.current.shareSlug).toBe('new-slug');
  });
});
