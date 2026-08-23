import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { extractTaskIds, useTaskPlaceholder } from '../useTaskPlaceholder';
import type * as projectSelectionStoreModule from '@/shared/contexts/projectSelectionStore';
import { createFakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import { FIXTURE_PROJECT } from '@/test/bridgeFixtures.mjs';
import { AstridLocalClient } from '@/integrations/astrid/client';

// ---------------------------------------------------------------------------
// extractTaskIds – pure utility, no mocks needed
// ---------------------------------------------------------------------------

describe('extractTaskIds', () => {
  it('returns [] for null/undefined/void', () => {
    expect(extractTaskIds(null)).toEqual([]);
    expect(extractTaskIds(undefined)).toEqual([]);
  });

  it('wraps a single string', () => {
    expect(extractTaskIds('abc-123')).toEqual(['abc-123']);
  });

  it('extracts { task_id } from a single object', () => {
    expect(extractTaskIds({ task_id: 'task-1' })).toEqual(['task-1']);
  });

  it('extracts { task_ids } from a batch object', () => {
    expect(extractTaskIds({ task_ids: ['task-1', ' task-2 '] })).toEqual(['task-1', 'task-2']);
  });

  it('extracts task_ids from an array of objects', () => {
    const batch = [
      { task_id: 'a' },
      { task_id: 'b' },
      { task_id: 'c' },
    ];
    expect(extractTaskIds(batch)).toEqual(['a', 'b', 'c']);
  });

  it('filters out array items without task_id', () => {
    const mixed = [
      { task_id: 'ok' },
      { task_ids: ['batch-1', 'batch-2'] },
      { other: 'no' },
      null,
      { task_id: 'also-ok' },
    ];
    expect(extractTaskIds(mixed)).toEqual(['ok', 'batch-1', 'batch-2', 'also-ok']);
  });

  it('extracts IDs from a plain string array', () => {
    expect(extractTaskIds(['id-1', 'id-2', 'id-3'])).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('handles mixed string and object arrays', () => {
    const mixed = ['id-1', { task_id: 'id-2' }, null, 'id-3'];
    expect(extractTaskIds(mixed)).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('returns [] for unrecognized shapes', () => {
    expect(extractTaskIds(42)).toEqual([]);
    expect(extractTaskIds({ id: 'not-task-id' })).toEqual([]);
    expect(extractTaskIds(true)).toEqual([]);
  });

  it('returns [] for empty array', () => {
    expect(extractTaskIds([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// useTaskPlaceholder – integration test with mocked context
// ---------------------------------------------------------------------------

const mockAddIncomingTask = vi.fn(() => 'incoming-1');
const mockRemoveIncomingTask = vi.fn();
const mockResolveTaskIds = vi.fn();
const mockWasCancelled = vi.fn(() => false);
const mockAcknowledgeCancellation = vi.fn();
const mockRefetchQueries = vi.fn(() => Promise.resolve());

vi.mock('@/shared/contexts/IncomingTasksContext', () => ({
  useIncomingTasks: () => ({
    addIncomingTask: mockAddIncomingTask,
    removeIncomingTask: mockRemoveIncomingTask,
    resolveTaskIds: mockResolveTaskIds,
    wasCancelled: mockWasCancelled,
    acknowledgeCancellation: mockAcknowledgeCancellation,
    cancelIncoming: vi.fn(),
    cancelAllIncoming: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    refetchQueries: mockRefetchQueries,
  }),
}));

const FAKE_ORIGIN = 'http://bridge.fake';
const SLUG = FIXTURE_PROJECT.slug;
const mockedFallback = vi.fn((): string | null => SLUG);

vi.mock('@/shared/contexts/projectSelectionStore', async () => {
  const actual = await vi.importActual<typeof projectSelectionStoreModule>(
    '@/shared/contexts/projectSelectionStore',
  );
  return { ...actual, getProjectSelectionFallbackId: () => mockedFallback() };
});

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: vi.fn(),
}));


describe('useTaskPlaceholder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFallback.mockReturnValue(SLUG);
  });

  function stubBridge() {
    const router = createFakeBridgeRouter();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return await router.handle(new Request(new URL(raw, FAKE_ORIGIN).href, init));
    }));
    return router;
  }

  it('runs full lifecycle on success', async () => {
    const { result } = renderHook(() => useTaskPlaceholder());

    await act(async () => {
      await result.current({
        taskType: 'image-upscale',
        label: 'Upscale 2x',
        context: 'test',
        toastTitle: 'Failed',
        create: async () => ({ task_id: 'real-task-1' }),
      });
    });

    // 1. addIncomingTask called
    expect(mockAddIncomingTask).toHaveBeenCalledWith({
      taskType: 'image-upscale',
      label: 'Upscale 2x',
      expectedCount: undefined,
    });

    // 2. resolveTaskIds called with extracted ID
    expect(mockResolveTaskIds).toHaveBeenCalledWith('incoming-1', ['real-task-1']);

    // 3. refetch called in finally
    expect(mockRefetchQueries).toHaveBeenCalledTimes(2);

    // 4. removeIncomingTask called in finally
    expect(mockRemoveIncomingTask).toHaveBeenCalledWith('incoming-1');
  });

  it('still cleans up on error', async () => {
    const { result } = renderHook(() => useTaskPlaceholder());

    await act(async () => {
      await result.current({
        taskType: 'image-upscale',
        label: 'Upscale 2x',
        context: 'test',
        toastTitle: 'Failed',
        create: async () => {
          throw new Error('boom');
        },
      });
    });

    // resolveTaskIds should NOT be called
    expect(mockResolveTaskIds).not.toHaveBeenCalled();

    // cleanup still happens
    expect(mockRefetchQueries).toHaveBeenCalledTimes(2);
    expect(mockRemoveIncomingTask).toHaveBeenCalledWith('incoming-1');
  });

  it('calls onSuccess with extracted task IDs', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useTaskPlaceholder());

    await act(async () => {
      await result.current({
        taskType: 'test',
        label: 'test',
        context: 'test',
        toastTitle: 'Failed',
        create: async () => [{ task_id: 'a' }, { task_id: 'b' }],
        onSuccess,
      });
    });

    expect(onSuccess).toHaveBeenCalledWith(['a', 'b']);
    expect(mockResolveTaskIds).toHaveBeenCalledWith('incoming-1', ['a', 'b']);
  });

  it('skips resolveTaskIds when create returns void', async () => {
    const { result } = renderHook(() => useTaskPlaceholder());

    await act(async () => {
      await result.current({
        taskType: 'test',
        label: 'test',
        context: 'test',
        toastTitle: 'Failed',
        create: async () => undefined,
      });
    });

    expect(mockResolveTaskIds).not.toHaveBeenCalled();
    expect(mockRemoveIncomingTask).toHaveBeenCalledWith('incoming-1');
  });

  it('passes expectedCount through to addIncomingTask', async () => {
    const { result } = renderHook(() => useTaskPlaceholder());

    await act(async () => {
      await result.current({
        taskType: 'image_generation',
        label: 'Generate 4 images',
        expectedCount: 4,
        context: 'test',
        toastTitle: 'Failed',
        create: async () => null,
      });
    });

    expect(mockAddIncomingTask).toHaveBeenCalledWith({
      taskType: 'image_generation',
      label: 'Generate 4 images',
      expectedCount: 4,
    });
  });

  it('cancels newly created tasks through the bridge cancel route when the placeholder was cancelled mid-flight', async () => {
    stubBridge();
    // Admit a real task so the cancel route has something to fence.
    const client = new AstridLocalClient({ projectSlug: SLUG, baseUrl: FAKE_ORIGIN + '/api/astrid' });
    const admitted = await client.tasks.admit({ family: 'image_generation', input: {} }, 'reigh.admit:placeholder-cancel');

    mockWasCancelled.mockReturnValue(true);
    const { result } = renderHook(() => useTaskPlaceholder());

    await act(async () => {
      await result.current({
        taskType: 'image_generation',
        label: 'Generate 1 image',
        context: 'test',
        toastTitle: 'Failed',
        create: async () => ({ task_id: admitted.task.id }),
      });
    });

    // The bridge now holds the task in a terminal cancelled state.
    const polled = await client.tasks.get(admitted.task.id);
    expect(polled.status).toBe('cancelled');
    expect(mockResolveTaskIds).not.toHaveBeenCalled();
    expect(mockAcknowledgeCancellation).toHaveBeenCalledWith('incoming-1');
  });

  it('skips mid-flight cancellation without a project scope but still cleans up', async () => {
    mockedFallback.mockReturnValue(null);
    const { result } = renderHook(() => useTaskPlaceholder());

    await act(async () => {
      await result.current({
        taskType: 'image_generation',
        label: 'Generate 1 image',
        context: 'test',
        toastTitle: 'Failed',
        create: async () => ({ task_id: 'task-1' }),
      });
    });

    expect(mockRemoveIncomingTask).toHaveBeenCalledWith('incoming-1');
  });
});
