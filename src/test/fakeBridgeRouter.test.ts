import { afterEach, describe, expect, it } from 'vitest';

import { bridgeErrorEnvelopeSchema } from '@/tools/video-editor/data/bridgeContract.ts';
import { classifyRouteError } from '@/integrations/astrid/transport.ts';
import { createFakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import {
  createGalleryFixtures,
  createTimelineFixtures,
  taskSummaryFromReadModel,
  makeAdmittedTaskReadModel,
} from '@/test/bridgeFixtures.mjs';

const BASE = 'http://bridge.fake';

function get(path: string): Promise<Response> {
  return createFakeBridgeRouter().handle(new Request(`${BASE}${path}`));
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return await createFakeBridgeRouter().handle(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe('fakeBridgeRouter wire conformance', () => {
  afterEach(() => {});

  it('serves the frozen timeline routes with schema-valid payloads', async () => {
    const list = await get('/api/astrid/projects/demo-project/timelines');
    expect(list.status).toBe(200);
    const payload = await (await get('/api/astrid/projects/demo-project/timelines/demo-timeline')).json();
    // The router itself parses against bridgeTimelinePayloadSchema; a drift
    // throws before this assertion. Shape spot-check for the reader:
    expect(payload.config_version).toBe(1);
    expect(Object.keys(payload.registry.assets)).toContain('demo-hero');
  });

  it('keeps the CAS save contract including the frozen conflict code', async () => {
    const stale = await post(
      '/api/astrid/projects/demo-project/timelines/demo-timeline/save',
      { config: {}, registry: { assets: {} }, expected_version: 99 },
    );
    expect(stale.status).toBe(409);
    const envelope = bridgeErrorEnvelopeSchema.parse(await stale.json());
    expect(envelope.error).toBe('timeline_version_conflict');
    expect(envelope.config_version).toBe(1);

    const fresh = await post(
      '/api/astrid/projects/demo-project/timelines/demo-timeline/save',
      { config: {}, registry: { assets: {} }, expected_version: 1 },
    );
    expect(fresh.status).toBe(200);
  });

  it('replays doc-18 fixture shapes end to end through admission and polling', async () => {
    const router = createFakeBridgeRouter();
    const admit = await router.handle(new Request(`${BASE}/api/astrid/projects/demo-project/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k1' },
      body: JSON.stringify({ family: 'image_generation', input: { prompt: 'x' } }),
    }));
    expect(admit.status).toBe(201);
    const admitted = (await admit.json()).task;
    // Kernel read model keys its identity as `id` (as implemented on phase-b).
    expect(admitted.id).toBeTruthy();
    expect(admitted.spec.family).toBe('image_generation');

    // Polling summary keys identity as `task_id` — the doc-18 §5 read shape.
    const list = await (await router.handle(new Request(`${BASE}/api/astrid/projects/demo-project/tasks`))).json();
    expect(list.tasks[0].task_id).toBe(admitted.id);
    expect(list.tasks[0].status).toBe('queued');

    const detail = await (
      await router.handle(new Request(`${BASE}/api/astrid/projects/demo-project/tasks/${admitted.id}`))
    ).json();
    expect(detail.task.attempts).toEqual([]);
    expect(detail.task.outputs).toEqual([]);

    // Cancel transitions and replays.
    const cancelled = await router.handle(new Request(
      `${BASE}/api/astrid/projects/demo-project/tasks/${admitted.id}/cancel`,
      { method: 'POST', body: '{}' },
    ));
    expect((await cancelled.json()).task.status).toBe('cancelled');
  });

  it('answers gallery reads from the shared fixture module only', async () => {
    const fixtures = createGalleryFixtures();
    const page = await (await get('/api/astrid/projects/demo-project/generations?limit=50')).json();
    expect(page.generations).toHaveLength(fixtures.pageRows.length);
    // Recency-first order (created_at DESC).
    const created = page.generations.map((row: { created_at: string }) => row.created_at);
    expect([...created].sort().reverse()).toEqual(created);

    const detail = await (
      await get(`/api/astrid/projects/demo-project/generations/${fixtures.details[0].generation_id}`)
    ).json();
    expect(detail.generation.variants[0].is_primary).toBe(true);
    expect(detail.generation.items).toEqual([]);

    const missing = await get('/api/astrid/projects/demo-project/generations/unknown');
    expect(missing.status).toBe(404);
    expect(bridgeErrorEnvelopeSchema.parse(await missing.json()).error).toBe('generation_not_found');
  });


  it('serves media bytes with Range/ETag semantics from fixture data', async () => {
    const fixtures = createGalleryFixtures();
    const mediaId = fixtures.media[0].media_id;

    const full = await get(`/api/astrid/projects/demo-project/media/${mediaId}/content`);
    expect(full.status).toBe(200);
    expect(full.headers.get('Content-Type')).toBe(fixtures.media[0].mime);
    expect(full.headers.get('Accept-Ranges')).toBe('bytes');

    const ranged = await createFakeBridgeRouter().handle(new Request(
      `${BASE}/api/astrid/projects/demo-project/media/${mediaId}/content`,
      { headers: { Range: 'bytes=0-9' } },
    ));
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('Content-Range')).toMatch(/^bytes 0-9\//);

    const missing = await get('/api/astrid/projects/demo-project/media/unknown/content');
    expect(missing.status).toBe(404);
  });

  it('maps oversized admission bodies to payload_too_large with limit_bytes', async () => {
    const huge = JSON.stringify({
      family: 'image_generation',
      input: { prompt: 'x'.repeat(1024 * 1024 + 2) },
    });
    const response = await createFakeBridgeRouter().handle(new Request(
      `${BASE}/api/astrid/projects/demo-project/tasks`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k' }, body: huge },
    ));
    expect(response.status).toBe(413);
    const envelope = bridgeErrorEnvelopeSchema.parse(await response.json());
    expect(envelope.error).toBe('payload_too_large');
    expect(envelope.limit_bytes).toBe(1024 * 1024);
  });

  it('classifies every public category deterministically', () => {
    expect(classifyRouteError(400, 'invalid_body')).toBe('invalid_body');
    expect(classifyRouteError(404, undefined)).toBe('not_found');
    expect(classifyRouteError(409, 'idempotency_mismatch')).toBe('conflict');
    expect(classifyRouteError(422, 'capability_unavailable')).toBe('capability_unavailable');
    expect(classifyRouteError(413, 'payload_too_large')).toBe('payload_too_large');
    expect(classifyRouteError(500, 'internal')).toBe('unknown');
  });

  it('keeps fixture helpers consistent with the journey state', () => {
    const readModel = makeAdmittedTaskReadModel({ taskId: '01j8zcex4q7m4sjdy6g6000001' });
    const summary = taskSummaryFromReadModel(readModel);
    expect(summary.task_id).toBe(readModel.id);
    expect(summary.status).toBe(readModel.status);

    const timeline = createTimelineFixtures();
    expect(timeline.timelineSummary.timeline_id).toBe('demo-timeline');
  });
});
