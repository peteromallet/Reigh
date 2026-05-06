import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { __getServeHandler, __resetServeHandler } from '../_tests/mocks/denoHttpServer.ts';
import * as ClaimNextTaskEntrypoint from './index.ts';

const mocks = vi.hoisted(() => ({
  withEdgeRequest: vi.fn(),
  rpc: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
  loggerSetDefaultTaskId: vi.fn(),
}));

vi.mock('../_shared/edgeHandler.ts', () => ({
  withEdgeRequest: (...args: unknown[]) => mocks.withEdgeRequest(...args),
}));

function createContext(body: Record<string, unknown>, auth: { userId?: string | null; isServiceRole?: boolean }) {
  return {
    supabaseAdmin: {
      rpc: mocks.rpc,
    },
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
      debug: mocks.loggerDebug,
      setDefaultTaskId: mocks.loggerSetDefaultTaskId,
    },
    body,
    auth,
  };
}

async function loadHandler() {
  await import('./index.ts');
  return __getServeHandler();
}

describe('claim-next-task edge entrypoint', () => {
  it('imports entrypoint module directly', () => {
    expect(ClaimNextTaskEntrypoint).toBeDefined();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetServeHandler();

    mocks.withEdgeRequest.mockImplementation(
      async (_req: Request, _opts: unknown, handler: (ctx: unknown) => Promise<Response>) => {
        return handler(createContext({}, { userId: 'user-1', isServiceRole: false }));
      },
    );
  });

  it('returns 401 when auth is missing', async () => {
    mocks.withEdgeRequest.mockImplementation(
      async (_req: Request, _opts: unknown, handler: (ctx: unknown) => Promise<Response>) => {
        return handler(createContext({}, { userId: null, isServiceRole: false }));
      },
    );

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/claim-next-task', { method: 'POST' }));

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toContain('Authentication failed');
  });

  it('returns 204 when PAT user has no eligible tasks', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/claim-next-task', { method: 'POST' }));

    expect(response.status).toBe(204);
    expect(mocks.rpc).toHaveBeenCalledWith('claim_next_task_user_pat', {
      p_user_id: 'user-1',
      p_include_active: false,
    });
  });

  it('returns claimed task for PAT user', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          task_id: 'task-42',
          params: { prompt: 'hello' },
          task_type: 'image_generation',
          project_id: 'project-7',
        },
      ],
      error: null,
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/claim-next-task', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      task_id: 'task-42',
      params: { prompt: 'hello' },
      task_type: 'image_generation',
      project_id: 'project-7',
    });
    expect(mocks.loggerSetDefaultTaskId).toHaveBeenCalledWith('task-42');
  });

  it('uses service-role RPC path when service role auth is present', async () => {
    mocks.withEdgeRequest.mockImplementation(
      async (_req: Request, _opts: unknown, handler: (ctx: unknown) => Promise<Response>) => {
        return handler(createContext({
          run_type: 'api',
          same_model_only: true,
          worker_backend: 'vibecomfy',
          selector_namespace: 'production',
        }, { userId: null, isServiceRole: true }));
      },
    );

    mocks.rpc.mockResolvedValue({
      data: [
        {
          task_id: 'task-service',
          params: {},
          task_type: 'video_generation',
          project_id: 'project-service',
          selector_namespace: 'production',
          route_key: 'z_image_turbo',
          task_selector_namespace: 'production',
          task_route_key: 'z_image_turbo',
          task_selected_backend: 'wgp',
          task_selector_version: 7,
          task_route_selection_snapshot: { selected_backend: 'wgp', selector_version: 7 },
          selected_backend: 'vibecomfy',
          selector_version: 12,
          route_selection_snapshot: { selected_backend: 'vibecomfy', selector_version: 12 },
          claimed_backend: 'vibecomfy',
          claimed_selector_namespace: 'production',
          claimed_route_key: 'z_image_turbo',
          claimed_selector_version: 12,
          claimed_capability_version: 2,
          claim_decision_reason: 'eligible',
          claim_decision_snapshot: { decision_reason: 'eligible' },
        },
      ],
      error: null,
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/claim-next-task', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('claim_next_task_service_role', {
      p_worker_id: expect.any(String),
      p_include_active: false,
      p_run_type: 'api',
      p_same_model_only: true,
      p_max_task_wait_minutes: 5,
      p_worker_backend: 'vibecomfy',
      p_selector_namespace: 'production',
    });
    await expect(response.json()).resolves.toEqual({
      task_id: 'task-service',
      params: {},
      task_type: 'video_generation',
      project_id: 'project-service',
      route_key: 'z_image_turbo',
      selector_namespace: 'production',
      selected_backend: 'vibecomfy',
      selector_version: 12,
      route_selection_snapshot: { selected_backend: 'vibecomfy', selector_version: 12 },
      task_selector_namespace: 'production',
      task_route_key: 'z_image_turbo',
      task_selected_backend: 'wgp',
      task_selector_version: 7,
      task_route_selection_snapshot: { selected_backend: 'wgp', selector_version: 7 },
      claimed_backend: 'vibecomfy',
      claimed_selector_namespace: 'production',
      claimed_route_key: 'z_image_turbo',
      claimed_selector_version: 12,
      claimed_capability_version: 2,
      claim_decision_reason: 'eligible',
      claim_decision_snapshot: { decision_reason: 'eligible' },
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Task claimed successfully',
      expect.objectContaining({
        route_key: 'z_image_turbo',
        selected_backend: 'vibecomfy',
        claimed_backend: 'vibecomfy',
        selector_version: 12,
        task_selected_backend: 'wgp',
        task_selector_version: 7,
        claim_decision_reason: 'eligible',
      }),
    );
  });

  it('passes through max_task_wait_minutes for service-role claims', async () => {
    mocks.withEdgeRequest.mockImplementation(
      async (_req: Request, _opts: unknown, handler: (ctx: unknown) => Promise<Response>) => {
        return handler(createContext({
          run_type: 'gpu',
          same_model_only: true,
          max_task_wait_minutes: 3,
        }, { userId: null, isServiceRole: true }));
      },
    );

    mocks.rpc.mockResolvedValue({
      data: [
        {
          task_id: 'task-service-2',
          params: {},
          task_type: 'video_generation',
          project_id: 'project-service-2',
        },
      ],
      error: null,
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/claim-next-task', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('claim_next_task_service_role', {
      p_worker_id: expect.any(String),
      p_include_active: false,
      p_run_type: 'gpu',
      p_same_model_only: true,
      p_max_task_wait_minutes: 3,
      p_worker_backend: 'wgp',
      p_selector_namespace: 'production',
    });
    await expect(response.json()).resolves.toEqual({
      task_id: 'task-service-2',
      params: {},
      task_type: 'video_generation',
      project_id: 'project-service-2',
    });
  });

  it('rejects malformed service-role backend values before claim RPC', async () => {
    mocks.withEdgeRequest.mockImplementation(
      async (_req: Request, _opts: unknown, handler: (ctx: unknown) => Promise<Response>) => {
        return handler(createContext({ worker_backend: 'comfy' }, { userId: null, isServiceRole: true }));
      },
    );

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/claim-next-task', { method: 'POST' }));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("worker_backend must be 'wgp' or 'vibecomfy'");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed selector namespaces before claim RPC', async () => {
    mocks.withEdgeRequest.mockImplementation(
      async (_req: Request, _opts: unknown, handler: (ctx: unknown) => Promise<Response>) => {
        return handler(createContext({ selector_namespace: 'Production!' }, { userId: null, isServiceRole: true }));
      },
    );

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/claim-next-task', { method: 'POST' }));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('selector_namespace must start');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps selector control-plane SQL service-role-only and fail-closed for missing VibeComfy selectors', () => {
    const selectorSql = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20260506110000_add_route_backend_selector_control_plane.sql'),
      'utf8',
    );
    const claimSql = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20260506113000_update_claim_next_task_route_selector.sql'),
      'utf8',
    );

    expect(selectorSql).toContain('REVOKE ALL ON TABLE public.route_backend_selectors FROM anon, authenticated');
    expect(selectorSql).toContain('REVOKE ALL ON TABLE public.route_backend_capabilities FROM anon, authenticated');
    expect(selectorSql).toContain("supports_missing_selector = false OR backend = 'wgp'");
    expect(selectorSql).toContain('missing_capability');
    expect(selectorSql).toContain('missing_selector_vibecomfy_no_claim');
    expect(claimSql).toContain('route_backend_claim_decision');
    expect(claimSql).toContain('p_worker_backend');
    expect(claimSql).toContain('claim_decision_snapshot');
    expect(claimSql).toContain('rd.selected_backend AS decision_selected_backend');
    expect(claimSql).toContain('rt.decision_selected_backend');
    expect(claimSql).toContain('task_selected_backend TEXT');
  });
});
