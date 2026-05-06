import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __getServeHandler, __resetServeHandler } from '../_tests/mocks/denoHttpServer.ts';
import * as TaskCountsEntrypoint from './index.ts';

const mocks = vi.hoisted(() => ({
  bootstrapEdgeHandler: vi.fn(),
  toErrorMessage: vi.fn((error: unknown) => (error instanceof Error ? error.message : String(error))),
}));

vi.mock('../_shared/edgeHandler.ts', () => ({
  bootstrapEdgeHandler: (...args: unknown[]) => mocks.bootstrapEdgeHandler(...args),
  NO_SESSION_RUNTIME_OPTIONS: {},
}));

vi.mock('../_shared/errorMessage.ts', () => ({
  toErrorMessage: (...args: unknown[]) => mocks.toErrorMessage(...args),
}));

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

function createServiceRoleSupabase() {
  const queuedLimit = vi.fn().mockResolvedValue({ data: [], error: null });
  const queuedOrder = vi.fn().mockReturnValue({ limit: queuedLimit });
  const queuedEq = vi.fn().mockReturnValue({ order: queuedOrder });

  const activeLimit = vi.fn().mockResolvedValue({ data: [], error: null });
  const activeOrder = vi.fn().mockReturnValue({ limit: activeLimit });
  const activeNot = vi.fn().mockReturnValue({ order: activeOrder });
  const activeEq = vi.fn().mockReturnValue({ not: activeNot });

  let tasksSelectCount = 0;
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'tasks') {
      return {
        select: vi.fn().mockImplementation(() => {
          tasksSelectCount += 1;
          if (tasksSelectCount === 1) {
            return { eq: queuedEq };
          }
          return { eq: activeEq };
        }),
      };
    }

    return { select: vi.fn() };
  });

  const rpc = vi.fn().mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (fn === 'count_eligible_tasks_service_role') {
      if (args.p_include_active === false) {
        return Promise.resolve({ data: 3, error: null });
      }
      return Promise.resolve({ data: 5, error: null });
    }

    if (fn === 'count_queued_tasks_breakdown_service_role') {
      return Promise.resolve({
        data: [
          {
            claimable_now: 3,
            blocked_by_capacity: 2,
            blocked_by_deps: 1,
            blocked_by_settings: 1,
            total_queued: 7,
          },
        ],
        error: null,
      });
    }

    if (fn === 'per_user_capacity_stats_service_role') {
      return Promise.resolve({ data: [], error: null });
    }

    throw new Error(`Unexpected rpc: ${fn}`);
  });

  return { rpc, from };
}

function createUserSupabase() {
  const queuedLimit = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'queued-eligible',
        task_type: 'image_generation',
        params: {
          route_contract: {
            selector_namespace: 'production',
            route_key: 'image_generation',
            selected_backend: 'wgp',
            selector_version: null,
            selected_profile: 'default',
            selected_template_id: null,
            route_run_id: null,
            worker_contract_version: 1,
            route_selection_snapshot: {
              selector_namespace: 'production',
              route_key: 'image_generation',
              selected_backend: 'wgp',
              selector_version: null,
              support_state: 'vibecomfy_unsupported',
              template_id: null,
              selected_profile: 'default',
              route_run_id: null,
              worker_contract_version: 1,
            },
          },
        },
        created_at: '2026-03-01T00:00:00.000Z',
        project_id: 'project-1',
        dependant_on: ['dep-complete'],
      },
      {
        id: 'queued-blocked',
        task_type: 'image_generation',
        params: {},
        created_at: '2026-03-01T00:01:00.000Z',
        project_id: 'project-1',
        dependant_on: ['dep-pending'],
      },
      {
        id: 'queued-orchestrator',
        task_type: 'image_orchestrator',
        params: {},
        created_at: '2026-03-01T00:02:00.000Z',
        project_id: 'project-1',
        dependant_on: null,
      },
    ],
    error: null,
  });
  const queuedOrder = vi.fn().mockReturnValue({ limit: queuedLimit });
  const queuedIn = vi.fn().mockReturnValue({ order: queuedOrder });
  const queuedEq = vi.fn().mockReturnValue({ in: queuedIn });

  const activeLimit = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'active-1',
        task_type: 'image_generation',
        params: {},
        worker_id: 'worker-1',
        updated_at: '2026-03-01T00:03:00.000Z',
        project_id: 'project-1',
      },
    ],
    error: null,
  });
  const activeOrder = vi.fn().mockReturnValue({ limit: activeLimit });
  const activeNot = vi.fn().mockReturnValue({ order: activeOrder });
  const activeIn = vi.fn().mockReturnValue({ not: activeNot });
  const activeEq = vi.fn().mockReturnValue({ in: activeIn });

  const dependencyIn = vi.fn().mockResolvedValue({
    data: [
      { id: 'dep-complete', status: 'Complete' },
      { id: 'dep-pending', status: 'Queued' },
    ],
    error: null,
  });

  const projectsEq = vi.fn().mockResolvedValue({
    data: [{ id: 'project-1' }],
    error: null,
  });

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'projects') {
      return {
        select: vi.fn().mockReturnValue({ eq: projectsEq }),
      };
    }

    if (table === 'tasks') {
      return {
        select: vi.fn().mockImplementation((columns: string) => {
          if (columns === 'id, status') {
            return { in: dependencyIn };
          }
          if (columns.includes('dependant_on')) {
            return { eq: queuedEq };
          }
          if (columns.includes('worker_id')) {
            return { eq: activeEq };
          }
          throw new Error(`Unexpected tasks select: ${columns}`);
        }),
      };
    }

    return { select: vi.fn() };
  });

  const rpc = vi.fn().mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (fn === 'count_eligible_tasks_user_pat') {
      if (args.p_include_active === false) {
        return Promise.resolve({ data: 1, error: null });
      }
      return Promise.resolve({ data: 3, error: null });
    }

    if (fn === 'analyze_task_availability_user_pat') {
      return Promise.resolve({
        data: {
          eligible_count: 2,
          user_info: {
            credits: 5,
            settings: {},
          },
        },
        error: null,
      });
    }

    throw new Error(`Unexpected rpc: ${fn}`);
  });

  return { rpc, from };
}

async function loadHandler() {
  await import('./index.ts');
  return __getServeHandler();
}

describe('task-counts edge entrypoint', () => {
  it('imports entrypoint module directly', () => {
    expect(TaskCountsEntrypoint).toBeDefined();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetServeHandler();

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: createServiceRoleSupabase(),
        logger: createLogger(),
        auth: { isServiceRole: true, userId: null },
        body: {},
      },
    });
  });

  it('returns bootstrap failure response untouched', async () => {
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: false,
      response: new Response('blocked', { status: 401 }),
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/task-counts', { method: 'POST' }));

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('blocked');
  });

  it('returns service-role aggregate counts payload', async () => {
    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/task-counts', { method: 'POST' }));

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.mode).toBe('count');
    expect(payload.run_type_filter_requested).toBeNull();
    expect(payload.run_type_filter).toBeNull();
    expect(payload.totals).toEqual({
      queued_only: 3,
      active_only: 2,
      queued_plus_active: 5,
      blocked_by_capacity: 2,
      blocked_by_deps: 1,
      blocked_by_settings: 1,
      potentially_claimable: 5,
    });
    expect(payload.queued_tasks).toEqual([]);
    expect(payload.active_tasks).toEqual([]);
    expect(payload.users).toEqual([]);
  });

  it('filters PAT queued_tasks to the same immediately-claimable contract as queued_only', async () => {
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: createUserSupabase(),
        logger: createLogger(),
        auth: { isServiceRole: false, userId: 'user-1' },
        body: {},
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/task-counts', { method: 'POST' }));

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.user_id).toBe('user-1');
    expect(payload.totals).toMatchObject({
      queued_only: 1,
      active_only: 2,
      queued_plus_active: 3,
      eligible_queued: 2,
    });
    expect(payload.queued_tasks).toEqual([
      expect.objectContaining({
        task_id: 'queued-eligible',
        task_type: 'image_generation',
        user_id: 'user-1',
        created_at: '2026-03-01T00:00:00.000Z',
        route_contract: expect.objectContaining({
          selected_backend: 'wgp',
          selected_profile: 'default',
          selector_namespace: 'production',
          route_key: 'image_generation',
          worker_contract_version: 1,
        }),
      }),
    ]);
    expect(payload.route_totals).toEqual([
      expect.objectContaining({
        selected_backend: 'wgp',
        selected_profile: 'default',
        selector_namespace: 'production',
        route_key: 'image_generation',
        queued_only: 1,
        active_only: 1,
        queued_plus_active: 2,
        blocked_by_capacity: 0,
        potentially_claimable: 1,
      }),
    ]);
    expect(payload.debug_summary).toEqual({
      at_capacity: false,
      capacity_used_pct: 40,
      can_claim_more: true,
    });
  });
});
