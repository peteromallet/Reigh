import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// createTask keeps a legacy materialization scan that reaches into the
// generation repository; the bridge journey itself never needs it here.
vi.mock('@/integrations/supabase/repositories/generationRepository', () => ({
  fetchGenerationRecordById: async () => null,
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentAndRethrow: (error: unknown) => {
    throw error;
  },
}));

import { createTask } from './createTask';
import { beginLocalWorkerSession } from './localWorkerSession';
import type { LocalWorkerSession, MaterializedInputRecord } from './localWorkerSession';
import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';

const FAKE_ORIGIN = 'http://bridge.fake';

let router: FakeBridgeRouter;
let fetchMock: Mock;

beforeEach(() => {
  router = createFakeBridgeRouter();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), FAKE_ORIGIN);
    return await router.handle(new Request(`${FAKE_ORIGIN}${url.pathname}${url.search}`, init));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastAdmitCall(): { url: string; init: RequestInit } {
  const admissionCalls = fetchMock.mock.calls.filter(([input, init]) => {
    const url = new URL(input instanceof Request ? input.url : String(input), FAKE_ORIGIN);
    return url.pathname.endsWith('/tasks') && (init as RequestInit | undefined)?.method === 'POST';
  });
  expect(admissionCalls.length).toBeGreaterThan(0);
  const [input, init] = admissionCalls[admissionCalls.length - 1] as [RequestInfo | URL, RequestInit];
  const url = new URL(input instanceof Request ? input.url : String(input), FAKE_ORIGIN);
  return { url: url.pathname, init };
}

function lastAdmitBody(): Record<string, unknown> {
  const { init } = lastAdmitCall();
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function fakeSessionWithRecords(records: MaterializedInputRecord[]): LocalWorkerSession {
  return {
    probe: () => Promise.resolve(false),
    register: () => undefined,
    records: () => records,
    cached: () => null,
  };
}

describe('createTask R1 admission over the fake bridge router', () => {
  it('admits with a per-call Idempotency-Key header and maps the response', async () => {
    const result = await createTask({
      family: 'image_generation',
      project_id: 'demo-project',
      input: { prompt: 'hi' },
    });

    const { url, init } = lastAdmitCall();
    // Frozen R1 route + required receipt header.
    expect(url).toBe('/api/astrid/projects/demo-project/tasks');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toEqual(expect.any(String));
    expect(headers['Idempotency-Key'].length).toBeGreaterThan(0);

    expect(result.task_id).toBeTruthy();
    expect(result.status).toBe('Queued');
  });

  it('keeps one idempotency key across the transport retry of the same admission', async () => {
    let calls = 0;
    const idempotencyKeys: string[] = [];
    const flakyFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers['Idempotency-Key']) {
        idempotencyKeys.push(headers['Idempotency-Key']);
      }
      calls += 1;
      if (calls === 1) {
        throw new Error('connection reset');
      }
      const url = new URL(input instanceof Request ? input.url : String(input), FAKE_ORIGIN);
      return await router.handle(new Request(`${FAKE_ORIGIN}${url.pathname}${url.search}`, init));
    });
    vi.stubGlobal('fetch', flakyFetch);

    await createTask({
      family: 'image_generation',
      project_id: 'demo-project',
      input: { prompt: 'retry' },
    });

    // Both attempts carried the SAME receipt key; only one task committed.
    expect(idempotencyKeys.length).toBe(2);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    expect(router.state.admissions).toBe(1);
  });

  it('omits materialized_inputs when no session is provided', async () => {
    await createTask({
      family: 'image_generation',
      project_id: 'demo-project',
      input: { prompt: 'hi' },
    });

    const body = lastAdmitBody();
    expect(body).not.toHaveProperty('materialized_inputs');
    expect(body).toMatchObject({
      family: 'image_generation',
      input: { prompt: 'hi' },
    });
  });

  it('omits materialized_inputs when session has no records', async () => {
    await createTask(
      { family: 'image_generation', project_id: 'demo-project', input: { prompt: 'hi' } },
      { localWorkerSession: beginLocalWorkerSession() },
    );

    expect(lastAdmitBody()).not.toHaveProperty('materialized_inputs');
  });

  it('includes materialized_inputs when session has ≥1 record', async () => {
    const records: MaterializedInputRecord[] = [
      { generation_id: 'gen-a', kind: 'remote', target: 'user/uploads/a.png' },
      { generation_id: 'gen-b', kind: 'file', target: '/tmp/.reigh-local-files/gen-b.png' },
    ];

    await createTask(
      { family: 'image_generation', project_id: 'demo-project', input: { x: 1 } },
      { localWorkerSession: fakeSessionWithRecords(records) },
    );

    expect(lastAdmitBody().materialized_inputs).toEqual(records);
  });
});
