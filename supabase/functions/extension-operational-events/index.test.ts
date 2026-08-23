import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __getServeHandler, __resetServeHandler } from '../_tests/mocks/denoHttpServer.ts';

const mocks = vi.hoisted(() => ({
  bootstrapEdgeHandler: vi.fn(),
}));

vi.mock('../_shared/edgeHandler.ts', () => ({
  bootstrapEdgeHandler: (...args: unknown[]) => mocks.bootstrapEdgeHandler(...args),
  NO_SESSION_RUNTIME_OPTIONS: {},
}));

vi.mock('../_shared/http.ts', () => ({
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
}));

const validEvent = {
  event: 'host.activation',
  outcome: 'success',
  releaseRevision: 'rc1',
};

function createLogger() {
  return {
    error: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

function createSupabaseAdmin(insertError: { message: string } | null = null) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const from = vi.fn().mockReturnValue({ insert });
  return { from, insert };
}

async function loadHandler() {
  await import('./index.ts');
  return __getServeHandler();
}

describe('extension operational telemetry edge entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetServeHandler();
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin: createSupabaseAdmin(),
        logger: createLogger(),
        body: { events: [validEvent] },
        auth: { userId: 'user-1' },
      },
    });
  });

  it('requires authenticated JWT user access and inserts only validated fields', async () => {
    const supabaseAdmin = createSupabaseAdmin();
    const logger = createLogger();
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        body: { events: [validEvent] },
        auth: { userId: 'user-1' },
      },
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/extension-operational-events', { method: 'POST' }));

    expect(mocks.bootstrapEdgeHandler).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({
      auth: { required: true, options: { allowJwtUserAuth: true } },
      parseBody: 'strict',
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 1 });
    expect(supabaseAdmin.from).toHaveBeenCalledWith('extension_operational_events');
    expect(supabaseAdmin.insert).toHaveBeenCalledWith([{
      event: 'host.activation',
      outcome: 'success',
      release_revision: 'rc1',
    }]);
    expect(logger.flush).toHaveBeenCalled();
  });

  it('returns bootstrap failures without attempting persistence', async () => {
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: false,
      response: new Response('unauthorized', { status: 401 }),
    });
    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/extension-operational-events', { method: 'POST' }));
    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('unauthorized');
  });

  it('rejects content-bearing batches and oversized requests before insert', async () => {
    const supabaseAdmin = createSupabaseAdmin();
    const logger = createLogger();
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        body: { events: [{ ...validEvent, prompt: 'private content' }] },
        auth: { userId: 'user-1' },
      },
    });
    let handler = await loadHandler();
    let response = await handler(new Request('https://edge.test/extension-operational-events', { method: 'POST' }));
    expect(response.status).toBe(400);
    expect(supabaseAdmin.insert).not.toHaveBeenCalled();

    vi.resetModules();
    __resetServeHandler();
    handler = await loadHandler();
    response = await handler(new Request('https://edge.test/extension-operational-events', {
      method: 'POST',
      headers: { 'content-length': String(64 * 1024 + 1) },
    }));
    expect(response.status).toBe(429);
  });

  it('contains persistence failures and returns a bounded 503 response', async () => {
    const logger = createLogger();
    const supabaseAdmin = createSupabaseAdmin({ message: 'sensitive database details' });
    mocks.bootstrapEdgeHandler.mockResolvedValue({
      ok: true,
      value: {
        supabaseAdmin,
        logger,
        body: { events: [validEvent] },
        auth: { userId: 'user-1' },
      },
    });
    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/extension-operational-events', { method: 'POST' }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Telemetry unavailable' });
    expect(logger.error).toHaveBeenCalledWith('Operational telemetry insert failed');
  });
});
