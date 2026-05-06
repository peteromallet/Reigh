import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __getServeHandler, __resetServeHandler } from '../_tests/mocks/denoHttpServer.ts';
import * as GenerateUploadUrlEntrypoint from './index.ts';

const mocks = vi.hoisted(() => ({
  withEdgeRequest: vi.fn(),
  resolveTaskStorageActor: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
  loggerSetDefaultTaskId: vi.fn(),
}));

vi.mock('../_shared/edgeHandler.ts', () => ({
  withEdgeRequest: (...args: unknown[]) => mocks.withEdgeRequest(...args),
}));

vi.mock('../_shared/http.ts', () => ({
  jsonResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}));

vi.mock('../_shared/taskActorPolicy.ts', () => ({
  resolveTaskStorageActor: (...args: unknown[]) => mocks.resolveTaskStorageActor(...args),
}));

function createContext(body: Record<string, unknown>) {
  return {
    supabaseAdmin: {
      storage: {
        from: vi.fn().mockReturnValue({
          createSignedUploadUrl: mocks.createSignedUploadUrl,
        }),
      },
    },
    logger: {
      info: mocks.loggerInfo,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
      debug: mocks.loggerDebug,
      setDefaultTaskId: mocks.loggerSetDefaultTaskId,
    },
    body,
    auth: { userId: 'user-1', isServiceRole: false },
  };
}

async function loadHandler() {
  await import('./index.ts');
  return __getServeHandler();
}

describe('generate-upload-url edge entrypoint', () => {
  it('imports entrypoint module directly', () => {
    expect(GenerateUploadUrlEntrypoint).toBeDefined();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetServeHandler();

    mocks.resolveTaskStorageActor.mockResolvedValue({
      ok: true,
      value: {
        taskUserId: 'task-user-1',
      },
    });

    mocks.createSignedUploadUrl
      .mockResolvedValueOnce({ data: { signedUrl: 'https://upload.test/primary', token: 'token-primary' }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://upload.test/thumb', token: 'token-thumb' }, error: null });

    mocks.withEdgeRequest.mockImplementation(
      async (_req: Request, _opts: unknown, handler: (ctx: unknown) => Promise<Response>) => {
        return handler(
          createContext({
            task_id: 'task-1',
            filename: 'video.mp4',
            content_type: 'video/mp4',
            artifact_class: 'intermediate',
            generate_thumbnail_url: true,
          }),
        );
      },
    );
  });

  it('returns 400 when required fields are missing', async () => {
    mocks.withEdgeRequest.mockImplementation(
      async (_req: Request, _opts: unknown, handler: (ctx: unknown) => Promise<Response>) => {
        return handler(createContext({ task_id: 'task-1', filename: '', content_type: '' }));
      },
    );

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/generate-upload-url', { method: 'POST' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'task_id, filename, and content_type required' });
  });

  it('returns actor-resolution error for unauthorized actor', async () => {
    mocks.resolveTaskStorageActor.mockResolvedValue({
      ok: false,
      error: 'Forbidden',
      statusCode: 403,
    });

    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/generate-upload-url', { method: 'POST' }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('returns signed upload URL payload with optional thumbnail URL', async () => {
    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.test/generate-upload-url', { method: 'POST' }));

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload).toEqual(
      expect.objectContaining({
        upload_url: 'https://upload.test/primary',
        token: 'token-primary',
        artifact_class: 'intermediate',
        thumbnail_upload_url: 'https://upload.test/thumb',
        thumbnail_token: 'token-thumb',
      }),
    );
    expect(payload.storage_path).toBe('task-user-1/tasks/task-1/intermediates/video.mp4');
    expect(payload.thumbnail_storage_path).toContain('/task-1/thumbnails/');
    expect(payload.artifact_metadata).toEqual(
      expect.objectContaining({
        artifact_class: 'intermediate',
        task_id: 'task-1',
        content_type: 'video/mp4',
        debug_retention: 'discard',
        redaction: 'redacted',
      }),
    );
    expect(payload.thumbnail_artifact_metadata).toEqual(
      expect.objectContaining({
        artifact_class: 'thumbnail',
        task_id: 'task-1',
        content_type: 'image/jpeg',
      }),
    );
    expect(mocks.loggerSetDefaultTaskId).toHaveBeenCalledWith('task-1');
  });
});
