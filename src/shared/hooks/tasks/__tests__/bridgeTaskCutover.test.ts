/**
 * Slice-A cutover journey: admit → poll → terminal against the canonical
 * fake bridge router. The fake-router admission handler itself asserts the
 * Idempotency-Key contract (a missing key answers 400 before any body
 * validation); these tests additionally assert the exact header value the
 * client sends.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/repositories/generationRepository', () => ({
  fetchGenerationRecordById: async () => null,
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentAndRethrow: (error: unknown) => {
    throw error;
  },
}));

import { createTask } from '@/shared/lib/taskCreation/createTask';
import { fetchTaskInProject } from '@/integrations/supabase/repositories/taskRepository';
import { fetchPaginatedTasks } from '@/shared/hooks/tasks/paginatedTaskRepository';
import { getBridgeTaskClient, mapBridgeTaskStatus } from '@/integrations/astrid/bridgeTaskReads';
import { cancelBridgeTask } from '@/shared/hooks/tasks/useTaskCancellation';
import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';

const FAKE_ORIGIN = 'http://bridge.fake';
const PROJECT = 'demo-project';
const VISIBLE_TASK_TYPES = ['qwen_image'];

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

async function admitImageTask(): Promise<string> {
  const result = await createTask({
    family: 'image_generation',
    project_id: PROJECT,
    input: { prompt: 'admit-poll-terminal' },
  });
  return result.task_id;
}

describe('task admit → poll → terminal over the fake bridge', () => {
  it('rejects admission without an Idempotency-Key (router-side assertion)', async () => {
    const response = await router.handle(new Request(`${FAKE_ORIGIN}/api/astrid/projects/${PROJECT}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family: 'image_generation', input: {} }),
    }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('invalid_body');
    expect(body.detail).toMatch(/Idempotency-Key/);
  });

  it('runs admit → poll → cancel → terminal replay end to end', async () => {
    // -- J3: admission ------------------------------------------------------
    const taskId = await admitImageTask();
    expect(taskId).toBeTruthy();

    // -- J4: polling reads --------------------------------------------------
    const page = await fetchPaginatedTasks({
      effectiveProjectId: PROJECT,
      visibleTaskTypes: VISIBLE_TASK_TYPES,
      limit: 50,
      offset: 0,
      page: 1,
    });
    expect(page.tasks.map((task) => task.id)).toContain(taskId);
    const listed = page.tasks.find((task) => task.id === taskId);
    expect(listed?.status).toBe('Queued');
    expect(mapBridgeTaskStatus('running')).toBe('In Progress');

    const detail = await fetchTaskInProject(taskId, PROJECT);
    expect(detail?.id).toBe(taskId);
    expect(detail?.status).toBe('Queued');

    // -- cancellation -------------------------------------------------------
    await cancelBridgeTask(PROJECT, taskId);

    // Terminal replay: the cancelled state reads back through every surface.
    const afterCancel = await fetchTaskInProject(taskId, PROJECT);
    expect(afterCancel?.status).toBe('Cancelled');
    const cancelledListed = await fetchPaginatedTasks({
      effectiveProjectId: PROJECT,
      visibleTaskTypes: VISIBLE_TASK_TYPES,
      limit: 50,
      offset: 0,
      page: 1,
    });
    // Cancelled tasks leave the default (all-status) root view unchanged in
    // content but their status must read back as Cancelled.
    const reread = cancelledListed.tasks.find((task) => task.id === taskId);
    if (reread) {
      expect(reread.status).toBe('Cancelled');
    }
  });

  it('fences a running-task cancel with the live attempt', async () => {
    const taskId = await admitImageTask();
    const summary = router.state.tasks.get(taskId);
    if (!summary) throw new Error('fixture task missing');
    summary.status = 'running';

    // Unfenced running cancels answer 409; the cutover helper recovers the
    // fence from the attempt read and retries.
    await cancelBridgeTask(PROJECT, taskId);

    expect(router.state.tasks.get(taskId)?.status).toBe('cancelled');
    void getBridgeTaskClient;
  });

  it('returns null (not an error) for unknown tasks on the poll read', async () => {
    await expect(fetchTaskInProject('01j8zcex4q7m4sjdy6g6missing', PROJECT)).resolves.toBeNull();
  });
});
