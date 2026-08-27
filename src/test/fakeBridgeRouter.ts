/**
 * Canonical fetch-level fake of the frozen doc-27 §4.1 bridge — the ONE
 * vitest-side stand-in for `astrid serve` (no MSW).
 *
 * - Every handler validates request/response shapes against the extended
 *   schemas in `bridgeContract.ts`, so a fixture drift fails loudly here
 *   instead of silently in a browser.
 * - All seed data comes from `src/test/bridgeFixtures.mjs`, the same module
 *   `tests/e2e/timeline/astrid-bridge-stub.mjs` consumes. There is no second
 *   fixture list anywhere.
 *
 * Error posture mirrors the real server: `{error, detail}` envelope, the
 * five public categories (`invalid_body/not_found/conflict/
 * capability_unavailable/payload_too_large`), frozen timeline codes on the
 * CAS routes, and receipt semantics on admission (replay → 200 with the
 * stored task; key reuse with different bytes → 409 idempotency_mismatch).
 */

import {
  bridgeCancelRequestSchema,
  bridgeGenerationDetailPayloadSchema,
  bridgeGenerationListSchema,
  bridgeTaskAdmissionRequestSchema,
  bridgeTaskAdmissionResponseSchema,
  bridgeTaskDetailPayloadSchema,
  bridgeTaskListSchema,
  bridgeTimelinePayloadSchema,
  BRIDGE_VERSION_CONFLICT_CODE,
} from '@/tools/video-editor/data/bridgeContract.ts';
import {
  AVAILABLE_FAMILIES,
  createJourneyState,
  fixtureUlid,
  makeAttemptWireShape,
  makeAdmittedTaskReadModel,
  taskSummaryFromReadModel,
} from './bridgeFixtures.mjs';

export type FakeBridgeState = ReturnType<typeof createJourneyState> & {
  /** task_id → full admission read model (`id`-keyed wire shape). */
  admittedByTaskId: Map<string, Record<string, unknown>>;
  /** IdempotencyKey → task_id, for replay responses. */
  receiptTasks: Map<string, string>;
  /** task_id → committed output rows surfaced on the detail read. */
  taskOutputs: Map<string, Array<{ ordinal: number; role: string; media_id: string; is_primary?: boolean }>>;
};

export type FakeBridgeRouter = {
  /** Drop-in fetch target: `(request) => response`. */
  handle(request: Request): Promise<Response>;
  /** Mutate directly to drive poll/cancel scenarios. */
  state: FakeBridgeState;
  /** Executor hook: mark a task succeeded and commit one output row (R9 media). */
  completeTask(taskId: string, output: { role: string; media_id: string; is_primary?: boolean }): void;
};

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorEnvelope(status: number, code: string, detail: string, extra: Record<string, unknown> = {}): Response {
  return json(status, { error: code, detail, ...extra });
}

/** Strip an optional `/api/astrid` prefix. */
function normalizePath(url: URL): string[] {
  let path = url.pathname;
  if (path.startsWith('/api/astrid')) {
    path = path.slice('/api/astrid'.length);
  }
  return path.split('/').filter((segment) => segment.length > 0);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (request.method !== 'POST') return {};
  const text = await request.text();
  if (text.length > 1024 * 1024) return null;
  try {
    const parsed: unknown = text.length === 0 ? {} : JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createFakeBridgeRouter(): FakeBridgeRouter {
  const state = createJourneyState() as FakeBridgeState;
  state.admittedByTaskId = new Map();
  state.receiptTasks = new Map();
  state.taskOutputs = new Map();

  function completeTask(taskId: string, output: { role: string; media_id: string; is_primary?: boolean }): void {
    const summary = state.tasks.get(taskId);
    if (summary === undefined) throw new Error(`task ${taskId} was not admitted`);
    summary.status = 'succeeded';
    const readModel = state.admittedByTaskId.get(taskId);
    if (readModel !== undefined && typeof readModel === 'object') {
      readModel.status = 'succeeded';
    }
    state.taskOutputs.set(taskId, [{
      ordinal: 1,
      role: output.role,
      media_id: output.media_id,
      ...(output.is_primary ? { is_primary: true } : {}),
    }]);
  }

  function timelinePayload() {
    return {
      ...state.timelineSummary,
      config: state.config,
      config_version: state.configVersion,
      registry: state.registry,
    };
  }

  // -- R1 admission ---------------------------------------------------------

  async function admitTask(request: Request, body: Record<string, unknown>): Promise<Response> {
    const rawKey = request.headers.get('Idempotency-Key');
    if (rawKey === null || rawKey.trim().length === 0 || rawKey.length > 200) {
      return errorEnvelope(400, 'invalid_body', 'the Idempotency-Key header is required for this route');
    }
    const parsed = bridgeTaskAdmissionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorEnvelope(400, 'invalid_body', 'admission body violates the wire contract');
    }
    if (!AVAILABLE_FAMILIES.includes(parsed.data.family)) {
      return errorEnvelope(422, 'capability_unavailable', `${parsed.data.family}: no available local binding`);
    }

    const serializedBody = JSON.stringify(body);
    const replayedBody = state.receipts.get(rawKey);
    if (replayedBody !== undefined) {
      if (replayedBody !== serializedBody) {
        return errorEnvelope(409, 'idempotency_mismatch', 'key already committed under different bytes');
      }
      const taskId = state.receiptTasks.get(rawKey) ?? '';
      return json(200, { task: state.admittedByTaskId.get(taskId) });
    }

    state.admissions += 1;
    const readModel = makeAdmittedTaskReadModel({
      taskId: fixtureUlid(String(state.admissions).padStart(6, '0')),
      family: parsed.data.family,
    });
    state.tasks.set(readModel.id, taskSummaryFromReadModel(readModel));
    state.admittedByTaskId.set(readModel.id, readModel);
    state.receipts.set(rawKey, serializedBody);
    state.receiptTasks.set(rawKey, readModel.id);

    const payload = { task: readModel };
    // Round-trip through the schema: a fixture that stops matching the frozen
    // admission contract must fail here, in CI, not in a browser.
    bridgeTaskAdmissionResponseSchema.parse(payload);
    return json(201, payload);
  }

  // -- R2 cancellation ------------------------------------------------------

  function cancelTask(taskId: string, body: Record<string, unknown>): Response {
    const summary = state.tasks.get(taskId);
    if (summary === undefined) {
      return errorEnvelope(404, 'not_found', `task ${taskId} was not found`);
    }
    const fence = bridgeCancelRequestSchema.safeParse(body);
    if (!fence.success) {
      return errorEnvelope(400, 'invalid_body', 'cancel body violates the wire contract');
    }
    if (summary.status === 'running') {
      const hasFence = Boolean(fence.data.attempt_id && fence.data.lease_id && fence.data.status_version);
      if (!hasFence) {
        return errorEnvelope(409, 'conflict', 'cancelling a running task requires the live attempt fence', {
          attempt: makeAttemptWireShape({ status: 'running' }),
        });
      }
    }
    if (['succeeded', 'failed', 'cancelled'].includes(summary.status)) {
      // Terminal replay: current state, no mutation.
      return json(200, { task: summary });
    }
    summary.status = 'cancelled';
    const readModel = state.admittedByTaskId.get(taskId);
    if (readModel !== undefined && typeof readModel === 'object') {
      readModel.status = 'cancelled';
      readModel.finished_at = '2026-08-22T12:01:00Z';
    }
    return json(200, { task: readModel, attempt: null });
  }

  // -- R9 managed-media bytes ----------------------------------------------

  function serveMedia(request: Request, mediaId: string): Response {
    const media = state.media.get(mediaId);
    if (media === undefined) {
      return errorEnvelope(404, 'media_not_found', `media ${mediaId} was not found`);
    }
    const etag = `"${media.bytes.byteLength.toString(16)}-seed"`;
    if (request.headers.get('If-None-Match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') ?? '');
    if (range && (range[1] !== '' || range[2] !== '')) {
      const size = media.bytes.byteLength;
      const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
      const end = range[1] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
      if (start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
        });
      }
      return new Response(Uint8Array.from(media.bytes.subarray(start, end + 1)), {
        status: 206,
        headers: {
          'Content-Type': media.mime,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          ETag: etag,
          'Cache-Control': 'private, no-cache',
        },
      });
    }
    return new Response(Uint8Array.from(media.bytes), {
      status: 200,
      headers: {
        'Content-Type': media.mime,
        'Accept-Ranges': 'bytes',
        ETag: etag,
        'Cache-Control': 'private, no-cache',
      },
    });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = normalizePath(url);

    if (parts[0] === 'health' && request.method === 'GET') return json(200, { ok: true });
    if (parts[0] === 'projects' && parts.length === 1) return json(200, { projects: [state.project] });

    // Timeline discovery / load / CAS save (frozen contract, unchanged).
    if (parts[0] === 'projects' && parts[2] === 'timelines' && parts.length === 3) {
      return json(200, { timelines: [state.timelineSummary] });
    }
    if (parts[0] === 'projects' && parts[2] === 'timelines' && parts.length === 4 && request.method === 'GET') {
      const payload = timelinePayload();
      bridgeTimelinePayloadSchema.parse(payload);
      return json(200, payload);
    }
    if (
      parts[0] === 'projects'
      && parts[2] === 'timelines'
      && parts[4] === 'save'
      && parts.length === 5
      && request.method === 'POST'
    ) {
      const body = await readJsonObject(request);
      if (body === null) return errorEnvelope(400, 'invalid_body', 'request body must be valid JSON');
      const expectedVersion = body.expected_version;
      if (
        expectedVersion !== undefined
        && (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion))
      ) {
        return errorEnvelope(400, 'invalid_expected_version', 'expected_version must be an integer');
      }
      if (typeof expectedVersion === 'number' && expectedVersion !== state.configVersion) {
        return errorEnvelope(409, BRIDGE_VERSION_CONFLICT_CODE, 'stale expected head', {
          config_version: state.configVersion,
        });
      }
      if (body.config !== undefined) state.config = body.config as FakeBridgeState['config'];
      if (body.registry !== undefined) state.registry = body.registry as FakeBridgeState['registry'];
      state.configVersion += 1;
      return json(200, timelinePayload());
    }

    // R1 admission.
    if (parts[0] === 'projects' && parts[2] === 'tasks' && parts.length === 3 && request.method === 'POST') {
      const body = await readJsonObject(request);
      if (body === null) {
        return errorEnvelope(413, 'payload_too_large', 'admission body over limit', {
          limit_bytes: 1024 * 1024,
        });
      }
      return await admitTask(request, body);
    }

    // Task reads.
    if (parts[0] === 'projects' && parts[2] === 'tasks' && parts.length === 3 && request.method === 'GET') {
      const payload = { tasks: [...state.tasks.values()], next_offset: null };
      bridgeTaskListSchema.parse(payload);
      return json(200, payload);
    }
    if (parts[0] === 'projects' && parts[2] === 'tasks' && parts.length === 4 && request.method === 'GET') {
      const summary = state.tasks.get(parts[3]);
      if (summary === undefined) return errorEnvelope(404, 'not_found', `task ${parts[3]} was not found`);
      const detail = {
        task: {
          ...summary,
          attempts: summary.status === 'running'
            ? [{
                ...makeAttemptWireShape({}),
                diagnostics: { progress: {}, error: {} },
              }]
            : [],
          outputs: state.taskOutputs.get(parts[3]) ?? [],
        },
      };
      bridgeTaskDetailPayloadSchema.parse(detail);
      return json(200, detail);
    }

    // R2 cancellation.
    if (
      parts[0] === 'projects'
      && parts[2] === 'tasks'
      && parts[4] === 'cancel'
      && parts.length === 5
      && request.method === 'POST'
    ) {
      const body = await readJsonObject(request);
      if (body === null) return errorEnvelope(400, 'invalid_body', 'request body must be valid JSON');
      return cancelTask(parts[3], body);
    }

    // Gallery reads (R12 subset that exists in v1).
    if (parts[0] === 'projects' && parts[2] === 'generations' && parts.length === 3 && request.method === 'GET') {
      let rows = state.galleryPageRows;
      const starred = url.searchParams.get('starred');
      if (starred !== null) {
        if (!['true', 'false'].includes(starred)) {
          return errorEnvelope(400, 'invalid_body', 'starred must be true or false');
        }
        rows = starred === 'true' ? rows.filter((row) => row.starred) : rows.filter((row) => !row.starred);
      }
      const payload = { generations: rows, next_cursor: null };
      bridgeGenerationListSchema.parse(payload);
      return json(200, payload);
    }
    if (parts[0] === 'projects' && parts[2] === 'generations' && parts.length === 4 && request.method === 'GET') {
      const detail = state.galleryDetails.find((generation) => generation.generation_id === parts[3]);
      if (detail === undefined) {
        return errorEnvelope(404, 'generation_not_found', `generation ${parts[3]} was not found`);
      }
      const payload = { generation: detail };
      bridgeGenerationDetailPayloadSchema.parse(payload);
      return json(200, payload);
    }

    // Managed-media bytes (R9).
    if (
      parts[0] === 'projects'
      && parts[2] === 'media'
      && parts[4] === 'content'
      && parts.length === 5
      && (request.method === 'GET' || request.method === 'HEAD')
    ) {
      return serveMedia(request, parts[3]);
    }

    return errorEnvelope(404, 'not_found', `No fake route for ${url.pathname}`);
  }

  return { handle, state, completeTask };
}
