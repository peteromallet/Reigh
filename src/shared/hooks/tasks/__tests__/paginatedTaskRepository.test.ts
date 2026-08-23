/**
 * fetchPaginatedTasks over the frozen task-list route (fake bridge router).
 * The route carries no filters, so status/type/root-task filtering and
 * paging happen in memory over one bridge read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import { fetchPaginatedTasks } from '../paginatedTaskRepository';

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

function baseFilters() {
  return {
    effectiveProjectId: 'demo-project',
    visibleTaskTypes: ['qwen_image'],
    limit: 50,
    offset: 0,
    page: 1,
  };
}

describe('fetchPaginatedTasks over the fake bridge router', () => {
  it('returns empty pages without a project scope', async () => {
    await expect(fetchPaginatedTasks({ ...baseFilters(), effectiveProjectId: null })).resolves.toEqual({
      tasks: [],
      total: 0,
      hasMore: false,
      totalPages: 0,
    });
  });

  it('lists admitted tasks with mapped statuses and derived totals', async () => {
    const taskId = await admitTask();

    const page = await fetchPaginatedTasks(baseFilters());
    expect(page.tasks.map((task) => task.id)).toContain(taskId);
    expect(page.tasks[0].status).toBe('Queued');
    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(page.totalPages).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it('filters by mapped app statuses in memory', async () => {
    const queuedId = await admitTask();
    await admitTask();
    const summary = router.state.tasks.get(queuedId);
    if (!summary) throw new Error('fixture task missing');
    summary.status = 'running';

    const page = await fetchPaginatedTasks({
      ...baseFilters(),
      status: ['In Progress'],
    });
    expect(page.tasks.map((task) => task.id)).toEqual([queuedId]);
  });

  it('serves page 2 from the prefetched window when sorting applies', async () => {
    for (let index = 0; index < 3; index += 1) {
      await admitTask();
    }

    const pageTwo = await fetchPaginatedTasks({
      ...baseFilters(),
      limit: 2,
      offset: 2,
      page: 2,
      status: ['Queued', 'In Progress'],
    });
    expect(pageTwo.tasks).toHaveLength(1);
    expect(pageTwo.total).toBe(3);
  });
});
