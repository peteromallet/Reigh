import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __getServeHandler, __resetServeHandler } from '../_tests/mocks/denoHttpServer.ts';
import * as UpdateTaskStatusEntrypoint from './index.ts';

const mocks = vi.hoisted(() => ({
  bootstrapEdgeHandler: vi.fn(),
  ensureTaskActor: vi.fn(),
  authorizeTaskActor: vi.fn(),
  handleCascadingTaskFailure: vi.fn(),
  handleOrchestratorCancellationBilling: vi.fn(),
  buildTaskUpdatePayload: vi.fn(),
  parseAndValidateRequest: vi.fn(),
  validateStatusTransition: vi.fn(),
  fetchCurrentTaskStatus: vi.fn(),
  updateTaskByRole: vi.fn(),
  toErrorMessage: vi.fn((error: unknown) => (error instanceof Error ? error.message : String(error))),
}));

vi.mock('../_shared/edgeHandler.ts', () => ({
  bootstrapEdgeHandler: (...args: unknown[]) => mocks.bootstrapEdgeHandler(...args),
  NO_SESSION_RUNTIME_OPTIONS: {},
}));

vi.mock('../_shared/requestGuards.ts', () => ({
  ensureTaskActor: (...args: unknown[]) => mocks.ensureTaskActor(...args),
}));

vi.mock('../_shared/taskActorPolicy.ts', () => ({
  authorizeTaskActor: (...args: unknown[]) => mocks.authorizeTaskActor(...args),
}));

vi.mock('./cascade.ts', () => ({
  handleCascadingTaskFailure: (...args: unknown[]) => mocks.handleCascadingTaskFailure(...args),
}));

vi.mock('./cancellationBilling.ts', () => ({
  handleOrchestratorCancellationBilling: (...args: unknown[]) =>
    mocks.handleOrchestratorCancellationBilling(...args),
}));

vi.mock('./payload.ts', () => ({
  buildTaskUpdatePayload: (...args: unknown[]) => mocks.buildTaskUpdatePayload(...args),
}));

vi.mock('./request.ts', () => ({
  parseAndValidateRequest: (...args: unknown[]) => mocks.parseAndValidateRequest(...args),
}));

vi.mock('./statusValidation.ts', () => ({
  validateStatusTransition: (...args: unknown[]) => mocks.validateStatusTransition(...args),
}));

vi.mock('./taskUpdates.ts', () => ({
  fetchCurrentTaskStatus: (...args: unknown[]) => mocks.fetchCurrentTaskStatus(...args),
  updateTaskByRole: (...args: unknown[]) => mocks.updateTaskByRole(...args),
}));

vi.mock('../_shared/errorMessage.ts', () => ({
  toErrorMessage: (...args: unknown[]) => mocks.toErrorMessage(...args),
}));

function createLogger() {
  return {
    setDefaultTaskId: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

function stubDenoEnv(values: Record<string, string | undefined>) {
  vi.stubGlobal('Deno', {
    env: {
      get: (key: string) => values[key],
    },
  });
}

async function loadHandler() {
  await import('./index.ts');
  return __getServeHandler();
}

describe('update-task-status edge entrypoint', () => {
  it('imports entrypoint module directly', () => {
    expect(UpdateTaskStatusEntrypoint).toBeDefined();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetServeHandler();

    stubDenoEnv({
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://example.supabase.co',
    });

    mocks.handleCascadingTaskFailure.mockResolvedValue(undefined);
    mocks.handleOrchestratorCancellationBilling.mockResolvedValue(undefined);
    mocks.buildTaskUpdatePayload.mockReturnValue({ status: 'Completed' });
    mocks.ensureTaskActor.mockReturnValue({
      ok: true,
      response: null,
    });
    mocks.authorizeTaskActor.mockResolvedValue({
      ok: true,
      value: {
        isServiceRole: true,
        callerId: 'service-role',
        taskOwnerVerified: false,
      },
    });
    mocks.parseAndValidateRequest.mockResolvedValue({
      ok: true,
      data: { task_id: 'task-1', status: 'Completed' },
    });
    mocks.validateStatusTransition.mockReturnValue(null);
    mocks.fetchCurrentTaskStatus.mockResolvedValue({
      data: { status: 'Running' },
      error: null,
    });
    mocks.updateTaskByRole.mockResolvedValue({
      data: { id: 'task-1' },
      error: null,
    });
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
        logger: createLogger(),
        auth: { isServiceRole: true, userId: 'service-role' },
      },
    });
  });

  it('returns bootstrap failure response untouched', async () => {
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: false,
      response: new Response('blocked', { status: 401 }),
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/update-task-status', { method: 'POST' }));

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await expect(response.text()).resolves.toBe('blocked');
  });

  it('returns 500 when required environment variables are missing', async () => {
    stubDenoEnv({
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_URL: 'https://example.supabase.co',
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/update-task-status', { method: 'POST' }));

    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await expect(response.text()).resolves.toBe('Server configuration error');
  });

  it('returns parse failure response untouched', async () => {
    mocks.parseAndValidateRequest.mockResolvedValue({
      ok: false,
      response: new Response('invalid payload', { status: 400 }),
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/update-task-status', { method: 'POST' }));

    expect(response.status).toBe(400);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await expect(response.text()).resolves.toBe('invalid payload');
  });

  it('returns authorization failure before reading task state', async () => {
    const logger = createLogger();
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
        logger,
        auth: { isServiceRole: false, userId: 'user-1' },
      },
    });
    mocks.authorizeTaskActor.mockResolvedValue({
      ok: false,
      error: 'Forbidden',
      statusCode: 403,
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/update-task-status', { method: 'POST' }));

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe('Forbidden');
    expect(mocks.fetchCurrentTaskStatus).not.toHaveBeenCalled();
    expect(logger.flush).toHaveBeenCalled();
  });

  it('returns transition validation response and skips update', async () => {
    const logger = createLogger();
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
        logger,
        auth: { isServiceRole: false, userId: 'user-1' },
      },
    });
    mocks.validateStatusTransition.mockReturnValue(new Response('invalid transition', { status: 409 }));

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/update-task-status', { method: 'POST' }));

    expect(response.status).toBe(409);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await expect(response.text()).resolves.toBe('invalid transition');
    expect(logger.flush).toHaveBeenCalled();
    expect(mocks.updateTaskByRole).not.toHaveBeenCalled();
  });

  it('bypasses transition validation for reset-only in-progress timestamp refreshes', async () => {
    const logger = createLogger();
    const supabaseAdmin = { from: vi.fn(), rpc: vi.fn() };
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: 'service-role' },
      },
    });
    mocks.parseAndValidateRequest.mockResolvedValue({
      ok: true,
      data: {
        task_id: 'task-1',
        status: 'In Progress',
        reset_generation_started_at: true,
      },
    });
    mocks.fetchCurrentTaskStatus.mockResolvedValue({
      data: { status: 'In Progress' },
      error: null,
    });
    mocks.buildTaskUpdatePayload.mockReturnValue({
      status: 'In Progress',
      generation_started_at: '2026-03-31T05:00:00.000Z',
    });
    mocks.updateTaskByRole.mockResolvedValue({
      data: { id: 'task-1', status: 'In Progress' },
      error: null,
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/update-task-status', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await expect(response.json()).resolves.toEqual({
      success: true,
      task_id: 'task-1',
      status: 'In Progress',
      message: "Task status updated to 'In Progress'",
    });
    expect(mocks.validateStatusTransition).not.toHaveBeenCalled();
    expect(mocks.buildTaskUpdatePayload).toHaveBeenCalledWith({
      task_id: 'task-1',
      status: 'In Progress',
      reset_generation_started_at: true,
    });
    expect(mocks.updateTaskByRole).toHaveBeenCalledWith(
      supabaseAdmin,
      'task-1',
      {
        status: 'In Progress',
        generation_started_at: '2026-03-31T05:00:00.000Z',
      },
      true,
      'service-role',
    );
  });

  it('still validates in-progress resets when other mutation fields are present', async () => {
    const logger = createLogger();
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
        logger,
        auth: { isServiceRole: true, userId: 'service-role' },
      },
    });
    mocks.parseAndValidateRequest.mockResolvedValue({
      ok: true,
      data: {
        task_id: 'task-1',
        status: 'In Progress',
        reset_generation_started_at: true,
        clear_worker: true,
      },
    });
    mocks.fetchCurrentTaskStatus.mockResolvedValue({
      data: { status: 'In Progress' },
      error: null,
    });
    mocks.validateStatusTransition.mockReturnValue(new Response('invalid transition', { status: 409 }));

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/update-task-status', { method: 'POST' }));

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toBe('invalid transition');
    expect(mocks.validateStatusTransition).toHaveBeenCalledWith(
      logger,
      'task-1',
      'In Progress',
      'In Progress',
    );
    expect(mocks.updateTaskByRole).not.toHaveBeenCalled();
  });

  it('handles cancelled status and triggers cascading + billing side effects', async () => {
    const logger = createLogger();
    const supabaseAdmin = { from: vi.fn(), rpc: vi.fn() };
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        auth: { isServiceRole: true, userId: 'service-role' },
      },
    });
    mocks.parseAndValidateRequest.mockResolvedValue({
      ok: true,
      data: { task_id: 'task-1', status: 'Cancelled' },
    });
    mocks.buildTaskUpdatePayload.mockReturnValue({ status: 'Cancelled' });
    mocks.updateTaskByRole.mockResolvedValue({
      data: { id: 'task-1', status: 'Cancelled' },
      error: null,
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/update-task-status', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      task_id: 'task-1',
      status: 'Cancelled',
      message: "Task status updated to 'Cancelled'",
    });
    expect(mocks.handleCascadingTaskFailure).toHaveBeenCalledWith(
      supabaseAdmin,
      logger,
      'task-1',
      'Cancelled',
      { id: 'task-1', status: 'Cancelled' },
    );
    expect(mocks.handleOrchestratorCancellationBilling).toHaveBeenCalledWith(
      supabaseAdmin,
      'https://example.supabase.co',
      'service-role-key',
      logger,
      'task-1',
      { id: 'task-1', status: 'Cancelled' },
    );
  });

  it('returns 500 on unexpected errors and logs critical context', async () => {
    const logger = createLogger();
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
        logger,
        auth: { isServiceRole: true, userId: 'service-role' },
      },
    });
    mocks.fetchCurrentTaskStatus.mockRejectedValue(new Error('boom'));

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/update-task-status', { method: 'POST' }));

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('Internal server error: boom');
    expect(mocks.toErrorMessage).toHaveBeenCalled();
    expect(logger.critical).toHaveBeenCalled();
    expect(logger.flush).toHaveBeenCalled();
  });
});
