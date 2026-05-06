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

    if (fn === 'route_backend_claim_decision') {
      return Promise.resolve({
        data: {
          eligible: true,
          selector_namespace: args.p_selector_namespace,
          route_key: args.p_route_key,
          selected_backend: args.p_worker_backend,
          selector_version: 1,
          decision_reason: 'eligible',
        },
        error: null,
      });
    }

    throw new Error(`Unexpected rpc: ${fn}`);
  });

  return { rpc, from };
}

function createRouteAwareServiceRoleSupabase() {
  const queuedLimit = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'queued-vibecomfy',
        task_type: 'z_image_turbo',
        route_key: 'z_image_turbo',
        selected_backend: 'vibecomfy',
        selector_namespace: 'production',
        selector_version: 7,
        route_selection_snapshot: {
          selector_namespace: 'production',
          route_key: 'z_image_turbo',
          selected_backend: 'vibecomfy',
          selector_version: 7,
        },
        created_at: '2026-03-01T00:00:00.000Z',
        dependant_on: null,
        projects: {
          user_id: 'user-route-1',
          users: { credits: 10, settings: {} },
        },
      },
    ],
    error: null,
  });
  const queuedOrder = vi.fn().mockReturnValue({ limit: queuedLimit });
  const queuedEq = vi.fn().mockReturnValue({ order: queuedOrder });

  const activeLimit = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'active-vibecomfy',
        task_type: 'z_image_turbo',
        worker_id: 'worker-vibe',
        claimed_backend: 'vibecomfy',
        claimed_selector_namespace: 'production',
        claimed_route_key: 'z_image_turbo',
        claimed_selector_version: 7,
        claimed_capability_version: 4,
        claim_decision_reason: 'eligible',
        updated_at: '2026-03-01T00:05:00.000Z',
        projects: {
          user_id: 'user-route-1',
          users: { credits: 10, settings: {} },
        },
      },
      {
        id: 'active-wgp-after-rollback',
        task_type: 'z_image_turbo',
        worker_id: 'worker-wgp',
        claimed_backend: 'wgp',
        claimed_selector_namespace: 'production',
        claimed_route_key: 'z_image_turbo',
        claimed_selector_version: 6,
        claimed_capability_version: 3,
        claim_decision_reason: 'eligible',
        updated_at: '2026-03-01T00:06:00.000Z',
        projects: {
          user_id: 'user-route-2',
          users: { credits: 10, settings: {} },
        },
      },
    ],
    error: null,
  });
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
      return Promise.resolve({ data: args.p_include_active === false ? 1 : 2, error: null });
    }

    if (fn === 'count_queued_tasks_breakdown_service_role') {
      return Promise.resolve({
        data: [{ claimable_now: 1, blocked_by_capacity: 0, blocked_by_deps: 0, blocked_by_settings: 0, total_queued: 1 }],
        error: null,
      });
    }

    if (fn === 'per_user_capacity_stats_service_role') {
      return Promise.resolve({
        data: [{
          user_id: 'user-route-1',
          credits: 10,
          queued_tasks: 1,
          in_progress_tasks: 0,
          allows_cloud: true,
          at_limit: false,
        }],
        error: null,
      });
    }

    if (fn === 'route_backend_claim_decision') {
      expect(args).toEqual({
        p_selector_namespace: 'production',
        p_route_key: 'z_image_turbo',
        p_worker_backend: 'vibecomfy',
      });
      return Promise.resolve({
        data: {
          eligible: true,
          selector_namespace: 'production',
          route_key: 'z_image_turbo',
          selected_backend: 'vibecomfy',
          selector_version: 8,
          decision_reason: 'eligible',
        },
        error: null,
      });
    }

    throw new Error(`Unexpected rpc: ${fn}`);
  });

  return { rpc, from };
}

function createSelectorRollbackServiceRoleSupabase() {
  const queuedLimit = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'queued-rolled-back',
        task_type: 'z_image_turbo',
        route_key: 'z_image_turbo',
        selected_backend: 'vibecomfy',
        selector_namespace: 'production',
        selector_version: 7,
        route_selection_snapshot: {
          selector_namespace: 'production',
          route_key: 'z_image_turbo',
          selected_backend: 'vibecomfy',
          selector_version: 7,
        },
        created_at: '2026-03-01T00:00:00.000Z',
        dependant_on: null,
        projects: {
          user_id: 'user-route-1',
          users: { credits: 10, settings: {} },
        },
      },
    ],
    error: null,
  });
  const queuedOrder = vi.fn().mockReturnValue({ limit: queuedLimit });
  const queuedEq = vi.fn().mockReturnValue({ order: queuedOrder });

  const activeLimit = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'active-vibecomfy-before-rollback',
        task_type: 'z_image_turbo',
        worker_id: 'worker-vibe',
        claimed_backend: 'vibecomfy',
        claimed_selector_namespace: 'production',
        claimed_route_key: 'z_image_turbo',
        claimed_selector_version: 7,
        claimed_capability_version: 4,
        claim_decision_reason: 'eligible',
        updated_at: '2026-03-01T00:05:00.000Z',
        projects: {
          user_id: 'user-route-1',
          users: { credits: 10, settings: {} },
        },
      },
    ],
    error: null,
  });
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
      return Promise.resolve({ data: args.p_include_active === false ? 0 : 1, error: null });
    }

    if (fn === 'count_queued_tasks_breakdown_service_role') {
      return Promise.resolve({
        data: [{ claimable_now: 0, blocked_by_capacity: 0, blocked_by_deps: 0, blocked_by_settings: 0, total_queued: 1 }],
        error: null,
      });
    }

    if (fn === 'per_user_capacity_stats_service_role') {
      return Promise.resolve({
        data: [{
          user_id: 'user-route-1',
          credits: 10,
          queued_tasks: 0,
          in_progress_tasks: 1,
          allows_cloud: true,
          at_limit: false,
        }],
        error: null,
      });
    }

    if (fn === 'route_backend_claim_decision') {
      expect(args).toEqual({
        p_selector_namespace: 'production',
        p_route_key: 'z_image_turbo',
        p_worker_backend: 'vibecomfy',
      });
      return Promise.resolve({
        data: {
          eligible: false,
          selector_namespace: 'production',
          route_key: 'z_image_turbo',
          selected_backend: 'wgp',
          selector_version: 8,
          decision_reason: 'selector_backend_mismatch',
        },
        error: null,
      });
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
        created_at: '2026-03-01T00:00:00.000Z',
        project_id: 'project-1',
        dependant_on: ['dep-complete'],
      },
      {
        id: 'queued-blocked',
        task_type: 'image_generation',
        created_at: '2026-03-01T00:01:00.000Z',
        project_id: 'project-1',
        dependant_on: ['dep-pending'],
      },
      {
        id: 'queued-orchestrator',
        task_type: 'image_orchestrator',
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
    expect(payload.worker_backend).toBe('wgp');
    expect(payload.selector_namespace).toBe('production');
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

  it('filters service-role queued and active details through route selector eligibility', async () => {
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: createRouteAwareServiceRoleSupabase(),
        logger: createLogger(),
        auth: { isServiceRole: true, userId: null },
        body: { worker_backend: 'vibecomfy', selector_namespace: 'production' },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/task-counts', { method: 'POST' }));

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.worker_backend).toBe('vibecomfy');
    expect(payload.selector_namespace).toBe('production');
    expect(payload.queued_tasks).toEqual([
      {
        task_id: 'queued-vibecomfy',
        task_type: 'z_image_turbo',
        route_key: 'z_image_turbo',
        selected_backend: 'vibecomfy',
        selector_namespace: 'production',
        selector_version: 8,
        claim_decision_reason: 'eligible',
        user_id: 'user-route-1',
        created_at: '2026-03-01T00:00:00.000Z',
      },
    ]);
    expect(payload.active_tasks).toEqual([
      {
        task_id: 'active-vibecomfy',
        task_type: 'z_image_turbo',
        worker_id: 'worker-vibe',
        claimed_backend: 'vibecomfy',
        claimed_selector_namespace: 'production',
        claimed_route_key: 'z_image_turbo',
        claimed_selector_version: 7,
        claimed_capability_version: 4,
        claim_decision_reason: 'eligible',
        user_id: 'user-route-1',
        started_at: '2026-03-01T00:05:00.000Z',
      },
    ]);
  });

  it('applies live selector rollback to queued details while preserving active claimed work', async () => {
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: createSelectorRollbackServiceRoleSupabase(),
        logger: createLogger(),
        auth: { isServiceRole: true, userId: null },
        body: { worker_backend: 'vibecomfy', selector_namespace: 'production' },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/task-counts', { method: 'POST' }));

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.totals).toMatchObject({
      queued_only: 0,
      active_only: 1,
      queued_plus_active: 1,
      potentially_claimable: 0,
    });
    expect(payload.queued_tasks).toEqual([]);
    expect(payload.active_tasks).toEqual([
      {
        task_id: 'active-vibecomfy-before-rollback',
        task_type: 'z_image_turbo',
        worker_id: 'worker-vibe',
        claimed_backend: 'vibecomfy',
        claimed_selector_namespace: 'production',
        claimed_route_key: 'z_image_turbo',
        claimed_selector_version: 7,
        claimed_capability_version: 4,
        claim_decision_reason: 'eligible',
        user_id: 'user-route-1',
        started_at: '2026-03-01T00:05:00.000Z',
      },
    ]);
  });

  it('rejects malformed service-role backend and selector namespace filters', async () => {
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: createServiceRoleSupabase(),
        logger: createLogger(),
        auth: { isServiceRole: true, userId: null },
        body: { worker_backend: 'comfy' },
      },
    });

    const handler = await loadHandler();
    const backendResponse = await handler(new Request('https://edge.test/task-counts', { method: 'POST' }));
    expect(backendResponse.status).toBe(400);
    await expect(backendResponse.text()).resolves.toContain("worker_backend must be 'wgp' or 'vibecomfy'");

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: createServiceRoleSupabase(),
        logger: createLogger(),
        auth: { isServiceRole: true, userId: null },
        body: { selector_namespace: '../prod' },
      },
    });

    const namespaceResponse = await handler(new Request('https://edge.test/task-counts', { method: 'POST' }));
    expect(namespaceResponse.status).toBe(400);
    await expect(namespaceResponse.text()).resolves.toContain('selector_namespace must start');
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
      {
        task_id: 'queued-eligible',
        task_type: 'image_generation',
        user_id: 'user-1',
        created_at: '2026-03-01T00:00:00.000Z',
      },
    ]);
    expect(payload.debug_summary).toEqual({
      at_capacity: false,
      capacity_used_pct: 40,
      can_claim_more: true,
    });
  });
});
