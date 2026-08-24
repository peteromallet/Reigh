import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AstridLocalClient } from '@/integrations/astrid/client.ts';
import {
  BridgeContractError,
  BRIDGE_ERROR_CATEGORIES,
} from '@/tools/video-editor/data/bridgeContract.ts';
import { BridgeRouteError, BridgeTransportFailure } from '@/integrations/astrid/transport.ts';
import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';

const FAKE_ORIGIN = 'http://bridge.fake';

describe('AstridLocalClient', () => {
  let router: FakeBridgeRouter;

  beforeEach(() => {
    router = createFakeBridgeRouter();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return await router.handle(new Request(`${FAKE_ORIGIN}${url.pathname}${url.search}`, init));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeClient(): AstridLocalClient {
    return new AstridLocalClient({ projectSlug: 'demo-project', baseUrl: FAKE_ORIGIN });
  }

  function admissionRequest() {
    return { family: 'image_generation', input: { prompt: 'a lighthouse' } };
  }

  it('discovers projects through the one shared transport', async () => {
    const client = makeClient();
    await expect(client.projects.list()).resolves.toEqual([
      expect.objectContaining({ slug: 'demo-project' }),
    ]);
  });

  // -- Admission ------------------------------------------------------------

  it('admits a task with the required Idempotency-Key header', async () => {
    const client = makeClient();

    const response = await client.tasks.admit(admissionRequest(), 'reigh.admit:test-1');

    expect(response.task.id).toBeTruthy();
    expect(response.task.status).toBe('queued');
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('reigh.admit:test-1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('replays the stored task on idempotent re-admission', async () => {
    const client = makeClient();
    const first = await client.tasks.admit(admissionRequest(), 'reigh.admit:same');

    const replay = await client.tasks.admit(admissionRequest(), 'reigh.admit:same');
    expect(replay.task.id).toBe(first.task.id);
  });

  it('rejects key reuse with different bytes as a conflict', async () => {
    const client = makeClient();
    await client.tasks.admit(admissionRequest(), 'reigh.admit:same');

    const error = await client.tasks
      .admit({ ...admissionRequest(), input: { prompt: 'changed' } }, 'reigh.admit:same')
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(BridgeRouteError);
    expect((error as BridgeRouteError).status).toBe(409);
    expect((error as BridgeRouteError).code).toBe('idempotency_mismatch');
  });

  it('maps an unavailable family to capability_unavailable', async () => {
    const client = makeClient();

    await expect(
      client.tasks.admit({ family: 'image_generation_dead', input: {} }, 'reigh.admit:x'),
    ).rejects.toMatchObject({
      status: 422,
      code: 'capability_unavailable',
    });
  });

  // -- Poll / cancel journey -------------------------------------------------

  it('lists and reads admitted tasks through the polling shapes', async () => {
    const client = makeClient();
    const { task } = await client.tasks.admit(admissionRequest(), 'reigh.admit:list');

    const list = await client.tasks.list();
    expect(list.tasks.map((entry) => entry.task_id)).toContain(task.id);
    expect(list.next_offset).toBeNull();

    const detail = await client.tasks.get(task.id);
    expect(detail.task_id).toBe(task.id);
    expect(detail.attempts).toEqual([]);
  });

  it('cancels a queued task without a fence and replays terminal state', async () => {
    const client = makeClient();
    const { task } = await client.tasks.admit(admissionRequest(), 'reigh.admit:cancel');

    const cancelled = await client.tasks.cancel(task.id);
    expect(cancelled.task.status).toBe('cancelled');

    const replay = await client.tasks.cancel(task.id);
    expect(replay.task.status).toBe('cancelled');
  });

  it('refuses an unfenced cancel of a running task with the bounded attempt extra', async () => {
    const client = makeClient();
    const { task } = await client.tasks.admit(admissionRequest(), 'reigh.admit:running');
    const summary = router.state.tasks.get(task.id);
    if (!summary) throw new Error('fixture missing');
    summary.status = 'running';

    const error = await client.tasks.cancel(task.id).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BridgeRouteError);
    const routeError = error as BridgeRouteError;
    expect(routeError.status).toBe(409);
    expect(routeError.category).toBe('conflict');
    expect(routeError.envelope?.attempt?.status).toBe('running');
  });

  // -- Gallery ---------------------------------------------------------------

  it('reads gallery pages and generation detail from the seeded fixtures', async () => {
    const client = makeClient();

    const page = await client.gallery.list();
    expect(page.generations).toHaveLength(router.state.galleryPageRows.length);

    const starred = await client.gallery.list({ starred: true });
    expect(starred.generations.every((generation) => generation.starred)).toBe(true);

    const detail = await client.gallery.get(page.generations[0].generation_id);
    expect(detail.variants.some((variant) => variant.is_primary)).toBe(true);

    await expect(client.gallery.get('01j8zcex4q7m4sjdy6g6missing')).rejects.toMatchObject({
      status: 404,
      category: 'not_found',
    });
  });

  // -- Media content ---------------------------------------------------------

  it('builds same-origin media content URLs serving Range/ETag bytes', async () => {
    const client = makeClient();
    const [media] = [...router.state.media.keys()];
    const url = client.media.contentUrl(media);

    const full = await fetch(url);
    expect(full.status).toBe(200);
    expect(full.headers.get('Accept-Ranges')).toBe('bytes');

    const partial = await fetch(`${url}`, { headers: { Range: 'bytes=0-9' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('Content-Range')).toMatch(/^bytes 0-9\//);

    const conditional = await fetch(url, { headers: { 'If-None-Match': full.headers.get('ETag') ?? '' } });
    expect(conditional.status).toBe(304);
  });

  // -- Failure posture -------------------------------------------------------

  it('surfaces the reachable doc-27 §4.6 categories as typed route errors', async () => {
    const client = makeClient();

    // invalid_body: missing Idempotency-Key
    await expect(fetch(
      `${FAKE_ORIGIN}/projects/demo-project/tasks`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(admissionRequest()) },
    ).then(async (response) => {
      if (response.ok) throw new Error('expected failure');
      return response.json();
    })).resolves.toMatchObject({ error: 'invalid_body' });

    // not_found
    await expect(client.tasks.get('01j8zcex4q7m4sjdy6g6missing')).rejects.toMatchObject({
      category: 'not_found',
    });

    // conflict via unfenced running-cancel
    const { task } = await client.tasks.admit(admissionRequest(), 'reigh.admit:cat-conflict');
    const summary = router.state.tasks.get(task.id);
    if (summary) summary.status = 'running';
    await expect(client.tasks.cancel(task.id)).rejects.toMatchObject({ category: 'conflict' });

    // capability_unavailable
    await expect(client.tasks.admit({ family: 'dead_family', input: {} }, 'k')).rejects.toMatchObject({
      category: 'capability_unavailable',
    });

    expect(BRIDGE_ERROR_CATEGORIES).toContain('payload_too_large');
  });

  it('throws contract violations on malformed payloads, never coercion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"generations": "not-an-array"}', { status: 200 })));
    const client = new AstridLocalClient({ projectSlug: 'demo-project', baseUrl: FAKE_ORIGIN });
    await expect(client.gallery.list()).rejects.toBeInstanceOf(BridgeContractError);
  });

  it('wraps network failures in BridgeTransportFailure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    const client = new AstridLocalClient({ projectSlug: 'demo-project', baseUrl: FAKE_ORIGIN });
    await expect(client.gallery.list()).rejects.toBeInstanceOf(BridgeTransportFailure);
  });
});
