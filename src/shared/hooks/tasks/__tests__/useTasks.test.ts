import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { setProjectSelectionSnapshot, resetProjectSelectionStoreForTests } from '@/shared/contexts/projectSelectionStore';
import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';

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

vi.mock('@/shared/state/realtimeStore', () => ({
  getRealtimeTaskSnapshot: vi.fn(),
  useRealtimeTask: vi.fn(() => null),
  upsertRealtimeTaskSnapshot: vi.fn((task: unknown) => task),
}));

import { useGetTask, usePaginatedTasks } from '../useTasks';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

async function admitTask(): Promise<string> {
  const response = await router.handle(new Request(`${FAKE_ORIGIN}/api/astrid/projects/fallback-project/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `k-${Math.random()}` },
    body: JSON.stringify({ family: 'image_generation', input: {} }),
  }));
  expect(response.status).toBe(201);
  const body = await response.json();
  return body.task.id as string;
}

describe('useGetTask', () => {
  beforeEach(() => {
    resetProjectSelectionStoreForTests();
  });

  it('is disabled when taskId is empty', () => {
    const { result } = renderHook(() => useGetTask('', 'project-1'), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
  });

  it('falls back to the selected project scope and reads the task over the bridge', async () => {
    setProjectSelectionSnapshot({ selectedProjectId: 'fallback-project' });
    const taskId = await admitTask();

    const { result } = renderHook(() => useGetTask(taskId, null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toMatchObject({
        id: taskId,
        projectId: expect.any(String),
      });
    });
  });
});

describe('usePaginatedTasks', () => {
  beforeEach(() => {
    resetProjectSelectionStoreForTests();
  });

  it('is disabled when no projectId', () => {
    const { result } = renderHook(
      () =>
        usePaginatedTasks({
          projectId: null,
          status: ['Complete'],
          limit: 20,
          offset: 0,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isFetching).toBe(false);
  });

  it('starts fetching when projectId is provided', async () => {
    await admitTask();
    const { result } = renderHook(
      () =>
        usePaginatedTasks({
          projectId: 'fallback-project',
          limit: 20,
          offset: 0,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.total).toBeGreaterThanOrEqual(1);
  });
});
