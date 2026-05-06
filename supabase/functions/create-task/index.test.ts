import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { __getServeHandler, __resetServeHandler } from '../_tests/mocks/denoHttpServer.ts';
import * as CreateTaskEntrypoint from './index.ts';

const mocks = vi.hoisted(() => ({
  bootstrapEdgeHandler: vi.fn(),
  enforceRateLimit: vi.fn(),
  parseCreateTaskBody: vi.fn(),
  buildTaskInsertObject: vi.fn(),
  getErrorMessage: vi.fn((error: unknown) => (error instanceof Error ? error.message : String(error))),
  getTaskFamilyResolver: vi.fn(),
}));

vi.mock('../_shared/edgeHandler.ts', () => ({
  bootstrapEdgeHandler: (...args: unknown[]) => mocks.bootstrapEdgeHandler(...args),
  NO_SESSION_RUNTIME_OPTIONS: {},
}));

vi.mock('../_shared/rateLimit.ts', () => ({
  enforceRateLimit: (...args: unknown[]) => mocks.enforceRateLimit(...args),
  RATE_LIMITS: {
    taskCreation: { maxRequests: 20, windowSeconds: 60 },
  },
}));

vi.mock('./request.ts', () => ({
  parseCreateTaskBody: (...args: unknown[]) => mocks.parseCreateTaskBody(...args),
  buildTaskInsertObject: (...args: unknown[]) => mocks.buildTaskInsertObject(...args),
  getErrorMessage: (...args: unknown[]) => mocks.getErrorMessage(...args),
}));

vi.mock('./resolvers/registry.ts', () => ({
  getTaskFamilyResolver: (...args: unknown[]) => mocks.getTaskFamilyResolver(...args),
}));

function createLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
    setDefaultTaskId: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

function createTasksInsertChain(taskId = 'task-1') {
  const single = vi.fn().mockResolvedValue({ data: { id: taskId }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  return { insert, select, single };
}

function createTasksIdempotentLookupChain(task: { id: string; status: string; project_id: string }) {
  const single = vi.fn().mockResolvedValue({ data: task, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, single };
}

function createProjectsLookupChain(project: { user_id?: string; aspect_ratio?: string }) {
  const single = vi.fn().mockResolvedValue({ data: project, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, single };
}

function createMaybeSingleChain(response: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(response),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function createRouteLookupChains(options?: {
  selector?: Record<string, unknown> | null;
  selectorError?: Record<string, unknown> | null;
  capability?: Record<string, unknown> | null;
  capabilityError?: Record<string, unknown> | null;
}) {
  const routeKey = "image_upscale";
  const selector = options?.selector === undefined ? null : options.selector;
  const capability = options?.capability === undefined
    ? {
        backend: "wgp",
        route_key: routeKey,
        supports_route: true,
        supports_missing_selector: true,
        capability_version: 1,
        enabled: true,
        expires_at: null,
        min_worker_version: null,
      }
    : options.capability;

  return {
    selectors: createMaybeSingleChain({
      data: selector,
      error: options?.selectorError ?? null,
    }),
    capabilities: createMaybeSingleChain({
      data: capability,
      error: options?.capabilityError ?? null,
    }),
  };
}

async function loadHandler() {
  await import('./index.ts');
  return __getServeHandler();
}

describe('create-task edge entrypoint', () => {
  it('imports entrypoint module directly', () => {
    expect(CreateTaskEntrypoint).toBeDefined();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetServeHandler();

    mocks.enforceRateLimit.mockResolvedValue(null);
    mocks.parseCreateTaskBody.mockReturnValue({
      ok: true,
      value: {
        project_id: 'project-1',
        family: 'image_upscale',
        input: { image_url: 'https://example.com/source.png' },
      },
    });
    mocks.buildTaskInsertObject.mockReturnValue({ id: 'task-client-1' });
    mocks.getTaskFamilyResolver.mockReturnValue(
      vi.fn().mockResolvedValue({
        tasks: [
          {
            project_id: 'project-1',
            task_type: 'image_upscale',
            params: { image_url: 'https://example.com/source.png' },
            status: 'Queued',
          },
        ],
      }),
    );

    const taskInsert = createTasksInsertChain('task-created-1');
    const routeLookups = createRouteLookupChains();
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger: createLogger(),
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
        },
      },
    });
  });

  it('handles CORS preflight', async () => {
    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'OPTIONS' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.bootstrapEdgeHandler).not.toHaveBeenCalled();
  });

  it('returns bootstrap failure response untouched', async () => {
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: false,
      response: new Response('blocked', { status: 401 }),
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('blocked');
  });

  it('returns 400 when request body parse fails', async () => {
    const logger = createLogger();
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: { from: vi.fn() },
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {},
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'invalid_request_body',
      message: 'family field is required',
    });
    expect(logger.flush).toHaveBeenCalled();
  });

  it('requires project_id for service-role requests', async () => {
    const logger = createLogger();
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: { from: vi.fn() },
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'image_upscale',
          input: { image_url: 'https://example.com/source.png' },
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'invalid_request_body',
      message: 'project_id required',
    });
    expect(logger.flush).toHaveBeenCalled();
  });

  it('creates task successfully for service-role requests', async () => {
    const logger = createLogger();
    const taskInsert = createTasksInsertChain('task-created-1');
    const routeLookups = createRouteLookupChains();
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      task_id: 'task-created-1',
      status: 'Task queued',
    });
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(logger.setDefaultTaskId).toHaveBeenCalledWith('task-created-1');
    expect(logger.flush).toHaveBeenCalled();
    expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      selector_namespace: 'production',
      route_key: 'image_upscale',
      selected_backend: 'wgp',
      selector_version: null,
      route_selection_snapshot: expect.objectContaining({
        decision_reason: 'missing_selector_wgp_capability_supported',
        selected_backend: 'wgp',
        selector_version: null,
      }),
    }));
  });

  it('stores present selector route snapshots when live selector and capability support the backend', async () => {
    const logger = createLogger();
    const taskInsert = createTasksInsertChain('task-created-present');
    mocks.getTaskFamilyResolver.mockReturnValue(
      vi.fn().mockResolvedValue({
        tasks: [
          {
            project_id: 'project-1',
            task_type: 'run_model',
            route_key: 'image_upscale',
            params: { image_url: 'https://example.com/source.png' },
            status: 'Queued',
          },
        ],
      }),
    );
    const routeLookups = createRouteLookupChains({
      selector: {
        route_key: 'image_upscale',
        selected_backend: 'vibecomfy',
        selector_version: 9,
        enabled: true,
        expires_at: null,
        min_worker_version: null,
      },
      capability: {
        backend: 'vibecomfy',
        route_key: 'image_upscale',
        supports_route: true,
        supports_missing_selector: false,
        capability_version: 4,
        enabled: true,
        expires_at: null,
        min_worker_version: null,
      },
    });
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
          selector_namespace: 'staging',
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(routeLookups.selectors.eq).toHaveBeenCalledWith('selector_namespace', 'staging');
    expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      selector_namespace: 'staging',
      route_key: 'image_upscale',
      selected_backend: 'vibecomfy',
      selector_version: 9,
      route_selection_snapshot: expect.objectContaining({
        decision_reason: 'selector_supported',
        selector_snapshot: expect.objectContaining({ selected_backend: 'vibecomfy', selector_version: 9 }),
        capability_snapshot: expect.objectContaining({ backend: 'vibecomfy', capability_version: 4 }),
      }),
    }));
  });

  it('materializes promoted Section 3A routes through selector-backed VibeComfy snapshots', async () => {
    const logger = createLogger();
    const taskInsert = createTasksInsertChain('task-section3a-promoted');
    const section3aRouteKey = 'travel_segment__model-ltx2_distilled__guidance-none__continuity-first_last__profile-default';
    mocks.getTaskFamilyResolver.mockReturnValue(
      vi.fn().mockResolvedValue({
        tasks: [
          {
            project_id: 'project-1',
            task_type: 'travel_segment',
            params: {
              model_name: 'ltx2_22B_distilled_1_1',
              guidance_kind: 'none',
              guidance_mode: 'none',
              continuity_case: 'first_last',
              profile: 'default',
            },
            status: 'Queued',
          },
        ],
      }),
    );
    const routeLookups = createRouteLookupChains({
      selector: {
        route_key: section3aRouteKey,
        selected_backend: 'vibecomfy',
        selector_version: 9,
        enabled: true,
        expires_at: null,
        min_worker_version: null,
      },
      capability: {
        backend: 'vibecomfy',
        route_key: section3aRouteKey,
        supports_route: true,
        supports_missing_selector: false,
        capability_version: 9,
        enabled: true,
        expires_at: null,
        min_worker_version: null,
      },
    });
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'travel_segment',
          project_id: 'project-1',
          input: {},
          selector_namespace: 'production',
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(routeLookups.selectors.eq).toHaveBeenCalledWith('selector_namespace', 'production');
    expect(routeLookups.selectors.eq).toHaveBeenCalledWith('route_key', section3aRouteKey);
    expect(routeLookups.capabilities.eq).toHaveBeenCalledWith('backend', 'vibecomfy');
    expect(routeLookups.capabilities.eq).toHaveBeenCalledWith('route_key', section3aRouteKey);
    expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      selector_namespace: 'production',
      route_key: section3aRouteKey,
      selected_backend: 'vibecomfy',
      selector_version: 9,
      route_selection_snapshot: expect.objectContaining({
        selector_namespace: 'production',
        route_key: section3aRouteKey,
        selected_backend: 'vibecomfy',
        selector_version: 9,
        decision_reason: 'selector_supported',
        selector_snapshot: expect.objectContaining({
          selector_namespace: 'production',
          route_key: section3aRouteKey,
          selected_backend: 'vibecomfy',
          selector_version: 9,
        }),
        capability_snapshot: expect.objectContaining({
          backend: 'vibecomfy',
          route_key: section3aRouteKey,
          capability_version: 9,
          supports_route: true,
        }),
      }),
    }));
  });

  it('keeps blocked Section 3A rows on explicit WGP missing-selector fallback', async () => {
    const logger = createLogger();
    const taskInsert = createTasksInsertChain('task-section3a-blocked');
    const blockedRouteKey = 'travel_segment__model-ltx2_distilled__guidance-ltx_control_depth__continuity-first_last__profile-default';
    mocks.getTaskFamilyResolver.mockReturnValue(
      vi.fn().mockResolvedValue({
        tasks: [
          {
            project_id: 'project-1',
            task_type: 'travel_segment',
            params: {
              model_name: 'ltx2_22B_distilled_1_1',
              guidance_kind: 'ltx_control',
              guidance_mode: 'depth',
              continuity_case: 'first_last',
              profile: 'default',
            },
            status: 'Queued',
          },
        ],
      }),
    );
    const routeLookups = createRouteLookupChains({
      selector: null,
      capability: {
        backend: 'wgp',
        route_key: blockedRouteKey,
        supports_route: true,
        supports_missing_selector: true,
        capability_version: 9,
        enabled: true,
        expires_at: null,
        min_worker_version: null,
      },
    });
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'travel_segment',
          project_id: 'project-1',
          input: {},
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(routeLookups.selectors.eq).toHaveBeenCalledWith('route_key', blockedRouteKey);
    expect(routeLookups.capabilities.eq).toHaveBeenCalledWith('backend', 'wgp');
    expect(routeLookups.capabilities.eq).toHaveBeenCalledWith('route_key', blockedRouteKey);
    expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      selector_namespace: 'production',
      route_key: blockedRouteKey,
      selected_backend: 'wgp',
      selector_version: null,
      route_selection_snapshot: expect.objectContaining({
        route_key: blockedRouteKey,
        selected_backend: 'wgp',
        selector_version: null,
        decision_reason: 'missing_selector_wgp_capability_supported',
        selector_snapshot: null,
        capability_snapshot: expect.objectContaining({
          backend: 'wgp',
          route_key: blockedRouteKey,
          capability_version: 9,
          supports_missing_selector: true,
        }),
      }),
    }));
  });

  it('honors service-role pinned child route snapshots without live selector lookup', async () => {
    const logger = createLogger();
    const taskInsert = createTasksInsertChain('task-child-pinned');
    const routeLookups = createRouteLookupChains({
      selectorError: { message: 'should not be queried for pinned snapshots' },
      capabilityError: { message: 'should not be queried for pinned snapshots' },
    });
    mocks.getTaskFamilyResolver.mockReturnValue(
      vi.fn().mockResolvedValue({
        tasks: [
          {
            project_id: 'project-1',
            task_type: 'join_clips_segment',
            params: { segment_index: 0 },
            status: 'Queued',
            selector_namespace: 'production',
            route_key: 'join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default',
            selected_backend: 'wgp',
            selector_version: 12,
            route_selection_snapshot: {
              selector_namespace: 'production',
              route_key: 'join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default',
              selected_backend: 'wgp',
              selector_version: 12,
              parent_route_key: 'join_clips_orchestrator',
            },
          },
        ],
      }),
    );
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'join_clips_segment',
          project_id: 'project-1',
          input: {},
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(routeLookups.selectors.maybeSingle).not.toHaveBeenCalled();
    expect(routeLookups.capabilities.maybeSingle).not.toHaveBeenCalled();
    expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      route_key: 'join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default',
      selected_backend: 'wgp',
      selector_version: 12,
      route_selection_snapshot: expect.objectContaining({
        parent_route_key: 'join_clips_orchestrator',
        selected_backend: 'wgp',
      }),
    }));
  });

  it('fails closed when selector is missing and WGP capability does not allow missing selectors', async () => {
    const logger = createLogger();
    const taskInsert = createTasksInsertChain('task-unsupported');
    const routeLookups = createRouteLookupChains({
      selector: null,
      capability: {
        backend: 'wgp',
        route_key: 'image_upscale',
        supports_route: true,
        supports_missing_selector: false,
        capability_version: 1,
        enabled: true,
        expires_at: null,
        min_worker_version: null,
      },
    });
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'validation_error',
      recoverable: false,
    });
    expect(taskInsert.insert).not.toHaveBeenCalled();
  });

  it('fails closed when missing selector has no WGP capability row', async () => {
    const logger = createLogger();
    const taskInsert = createTasksInsertChain('task-missing-capability');
    const routeLookups = createRouteLookupChains({
      selector: null,
      capability: null,
    });
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'validation_error',
      recoverable: false,
    });
    expect(taskInsert.insert).not.toHaveBeenCalled();
  });

  it('fails closed when selector is disabled or expired before insert', async () => {
    const logger = createLogger();
    const taskInsert = createTasksInsertChain('task-disabled');
    const routeLookups = createRouteLookupChains({
      selector: {
        route_key: 'image_upscale',
        selected_backend: 'wgp',
        selector_version: 3,
        enabled: false,
        expires_at: null,
      },
    });
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
        },
      },
    });

    const handler = await loadHandler();
    const disabledResponse = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(disabledResponse.status).toBe(400);
    expect(taskInsert.insert).not.toHaveBeenCalled();

    routeLookups.selectors.maybeSingle.mockResolvedValue({
      data: {
        route_key: 'image_upscale',
        selected_backend: 'wgp',
        selector_version: 3,
        enabled: true,
        expires_at: '2000-01-01T00:00:00.000Z',
      },
      error: null,
    });

    const expiredResponse = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));
    expect(expiredResponse.status).toBe(400);
    expect(taskInsert.insert).not.toHaveBeenCalled();
  });

  it('fails closed on malformed selector backend values', async () => {
    const logger = createLogger();
    const routeLookups = createRouteLookupChains({
      selector: {
        route_key: 'image_upscale',
        selected_backend: 'comfy',
        selector_version: 3,
        enabled: true,
        expires_at: null,
      },
    });
    const taskInsert = createTasksInsertChain('task-malformed');
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(500);
    expect(taskInsert.insert).not.toHaveBeenCalled();
  });

  it('fails closed when selector lookup is unreachable', async () => {
    const logger = createLogger();
    const routeLookups = createRouteLookupChains({
      selectorError: { message: 'connection refused' },
    });
    const taskInsert = createTasksInsertChain('task-lookup-failure');
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') return { insert: taskInsert.insert };
        if (table === 'projects') return { select: createProjectsLookupChain({ aspect_ratio: '16:9' }).select };
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: null },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(500);
    expect(taskInsert.insert).not.toHaveBeenCalled();
  });

  it('keeps create-time selector lookup uncached', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'supabase/functions/create-task/index.ts'), 'utf8');

    expect(source).toContain('.from("route_backend_selectors")');
    expect(source).toContain('.from("route_backend_capabilities")');
    expect(source).not.toContain('ROUTE_SELECTOR_CACHE_TTL_MS');
    expect(source).not.toMatch(/selectorCache|routeSelectorCache|cachedSelector/i);
  });

  it('returns the existing task when idempotent recovery stays within the authorized project', async () => {
    const logger = createLogger();
    const duplicateError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint on idempotency_key',
    };
    const insertSingle = vi.fn().mockResolvedValue({ data: null, error: duplicateError });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });
    const projects = createProjectsLookupChain({ user_id: 'user-1', aspect_ratio: '16:9' });
    const existingTask = createTasksIdempotentLookupChain({
      id: 'task-existing-1',
      status: 'Queued',
      project_id: 'project-1',
    });
    const routeLookups = createRouteLookupChains();
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'projects') return { select: projects.select };
        if (table === 'tasks') {
          return {
            insert,
            select: existingTask.select,
          };
        }
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: false, userId: 'user-1', isJwtAuth: true },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
          idempotency_key: 'idem-1',
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      task_id: 'task-existing-1',
      status: 'Task queued',
      deduplicated: true,
    });
    expect(projects.eq).toHaveBeenCalledWith('id', 'project-1');
    expect(existingTask.eq).toHaveBeenCalledWith('idempotency_key', 'idem-1');
  });

  it('rejects idempotent recovery when the existing task belongs to another project', async () => {
    const logger = createLogger();
    const duplicateError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint on idempotency_key',
    };
    const insertSingle = vi.fn().mockResolvedValue({ data: null, error: duplicateError });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });
    const projects = createProjectsLookupChain({ user_id: 'user-1', aspect_ratio: '16:9' });
    const existingTask = createTasksIdempotentLookupChain({
      id: 'task-existing-1',
      status: 'Queued',
      project_id: 'project-other',
    });
    const routeLookups = createRouteLookupChains();
    const supabaseAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'projects') return { select: projects.select };
        if (table === 'tasks') {
          return {
            insert,
            select: existingTask.select,
          };
        }
        if (table === 'route_backend_selectors') return routeLookups.selectors;
        if (table === 'route_backend_capabilities') return routeLookups.capabilities;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: false, userId: 'user-1', isJwtAuth: true },
        body: {
          family: 'image_upscale',
          project_id: 'project-1',
          input: { image_url: 'https://example.com/source.png' },
          idempotency_key: 'idem-1',
        },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/create-task', { method: 'POST' }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'project_forbidden',
      message: 'Forbidden: duplicate task belongs to a different project',
      recoverable: false,
    });
    expect(logger.setDefaultTaskId).not.toHaveBeenCalled();
    expect(logger.flush).toHaveBeenCalled();
  });
});
