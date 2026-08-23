/**
 * Task cancellation over the frozen cancel route (fake bridge router):
 * queued cancels commit directly, running cancels require the attempt
 * fence, terminal tasks replay as no-op, and orchestrator subtasks are
 * cancelled in batch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import {
  cancelBridgeTask,
  useCancelAllPendingTasks,
  useCancelTask,
} from '../useTaskCancellation';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const FAKE_ORIGIN = 'http://bridge.fake';

let router: FakeBridgeRouter;

beforeEach(() => {
  router = createFakeBridgeRouter();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), FAKE_ORIGIN);
    return await router.handle(new Request(`${FAKE_ORIGIN}${url.pathname}${url.search}`, init));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function admitTask(): Promise<string> {
  const response = await router.handle(new Request(`${FAKE_ORIGIN}/api/astrid/projects/demo-project/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `k-${Math.random()}` },
    body: JSON.stringify({ family: 'image_generation', input: {} }),
  }));
  expect(response.status).toBe(201);
  const body = await response.json();
  return body.task.id as string;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('cancelBridgeTask over the fake bridge router', () => {
  it('cancels a queued task and replays the cancelled state on repeat', async () => {
    const taskId = await admitTask();

    await cancelBridgeTask('demo-project', taskId);
    await cancelBridgeTask('demo-project', taskId);

    expect(router.state.tasks.get(taskId)?.status).toBe('cancelled');
  });

  it('fences a running-task cancel with the live attempt read', async () => {
    const taskId = await admitTask();
    const summary = router.state.tasks.get(taskId);
    if (!summary) throw new Error('fixture task missing');
    summary.status = 'running';

    // Unfenced cancel answers 409; the helper recovers the fence itself.
    await cancelBridgeTask('demo-project', taskId);

    expect(summary.status).toBe('cancelled');
  });
});

describe('useCancelTask hook', () => {
  it('cancels a task through the bridge and invalidates task queries', async () => {
    const taskId = await admitTask();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCancelTask('demo-project'), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate(taskId);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(router.state.tasks.get(taskId)?.status).toBe('cancelled');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskQueryKeys.paginatedAll });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskQueryKeys.statusCountsAll });
  });

  it('treats already-terminal tasks as a no-op success', async () => {
    const taskId = await admitTask();
    await cancelBridgeTask('demo-project', taskId);
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useCancelTask('demo-project'), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate(taskId);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(router.state.tasks.get(taskId)?.status).toBe('cancelled');
  });
});

describe('useCancelAllPendingTasks hook', () => {
  it('cancels all pending tasks of the project in one batch', async () => {
    const first = await admitTask();
    const second = await admitTask();
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useCancelAllPendingTasks(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('demo-project');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.cancelledCount).toBe(2);
    expect(router.state.tasks.get(first)?.status).toBe('cancelled');
    expect(router.state.tasks.get(second)?.status).toBe('cancelled');
  });

  it('surfaces bridge failures through the mutation error handler', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useCancelAllPendingTasks(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('demo-project');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(consoleError).toHaveBeenCalled();
  });
});
