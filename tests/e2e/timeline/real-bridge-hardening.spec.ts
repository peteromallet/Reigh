import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.skip(process.env.REAL_BRIDGE !== '1', 'real-bridge scenarios require REAL_BRIDGE=1');

const bridgePortValue = process.env.ASTRID_HARDENING_BRIDGE_PORT;
if (!bridgePortValue) throw new Error('ASTRID_BRIDGE_PORT is required');
const bridgePort = Number(bridgePortValue);
if (!Number.isInteger(bridgePort) || bridgePort < 1 || bridgePort > 65_535) {
  throw new Error(`Invalid ASTRID_BRIDGE_PORT: ${bridgePortValue}`);
}
const BRIDGE_ORIGIN = `http://127.0.0.1:${bridgePort}`;
const RUNAWAY_RUN_ID = '01j5realbridgepage000000000000';

function bridgeHeaders(): Record<string, string> {
  const configuredToken = process.env.ASTRID_HARDENING_BRIDGE_TOKEN?.trim();
  if (!configuredToken) throw new Error('ASTRID_BRIDGE_TOKEN is required');
  const tokenFile = process.env.ASTRID_HARDENING_REQUEST_TOKEN_FILE?.trim()
    || '/tmp/astrid-real-bridge-hardening.token';
  if (tokenFile && readFileSync(tokenFile, 'utf8').trim() !== configuredToken) {
    throw new Error(`Configured Astrid bridge token does not match ${tokenFile}`);
  }
  return {
    Authorization: `Bearer ${configuredToken}`,
    'X-Astrid-Bridge-Version': 'v1',
  };
}

async function defaultTimelineId(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const response = await request.get(`${BRIDGE_ORIGIN}/projects/demo-project/timelines`, {
    headers: bridgeHeaders(),
  });
  const rows = (await response.json()).timelines as Array<{ timeline_id: string; is_default?: boolean }>;
  const chosen = rows.find((row) => row.is_default) ?? rows[0];
  if (!chosen) throw new Error('real bridge registered no demo timeline');
  return chosen.timeline_id;
}

async function postOversizedWithoutBody(
  pathname: string,
  headers: Record<string, string>,
  contentLength: number,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const client = httpRequest({
      hostname: '127.0.0.1', port: bridgePort, path: pathname, method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': String(contentLength),
        Expect: '100-continue',
      },
    });
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    client.once('continue', () => undefined);
    client.once('error', (error) => fail(error));
    client.once('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('error', fail);
      response.once('end', () => {
        if (settled) return;
        settled = true;
        try {
          resolve({
            status: response.statusCode ?? 0,
            payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    client.end();
  });
}

test('real release bridge enforces project scope, pagination, limits, and Origin policy', async ({ request }) => {
  const validHeaders = bridgeHeaders();
  const demoTimeline = await defaultTimelineId(request);
  const otherTimelines = await request.get(`${BRIDGE_ORIGIN}/projects/other-project/timelines`, { headers: validHeaders });
  expect(otherTimelines.status()).toBe(200);
  const otherTimeline = ((await otherTimelines.json()).timelines as Array<{ timeline_id: string }>)[0]?.timeline_id;
  if (!otherTimeline) throw new Error('real bridge registered no other-project timeline');

  const crossProjectResource = await request.get(
    `${BRIDGE_ORIGIN}/projects/demo-project/timelines/${otherTimeline}`, { headers: validHeaders },
  );
  expect(crossProjectResource.status()).toBe(404);
  expect((await crossProjectResource.json()).error).toBe('timeline_not_found');
  const unknownProject = await request.get(
    `${BRIDGE_ORIGIN}/projects/no-such-project/timelines/${demoTimeline}`, { headers: validHeaders },
  );
  expect(unknownProject.status()).toBe(404);
  expect((await unknownProject.json()).error).toBe('project_not_found');

  const firstPage = await request.get(
    `${BRIDGE_ORIGIN}/v1/projects/demo-project/runaway-transitions?run_id=${RUNAWAY_RUN_ID}&limit=2`,
    { headers: validHeaders },
  );
  expect(firstPage.status()).toBe(200);
  const firstPagePayload = await firstPage.json();
  expect(firstPagePayload.total_count).toBe(5);
  expect(firstPagePayload.transitions.map((row: { ordinal: number }) => row.ordinal)).toEqual([0, 1]);
  const firstCursor = firstPagePayload.page.next_cursor as string;
  const secondPage = await request.get(
    `${BRIDGE_ORIGIN}/v1/projects/demo-project/runaway-transitions?run_id=${RUNAWAY_RUN_ID}&limit=2&cursor=${encodeURIComponent(firstCursor)}`,
    { headers: validHeaders },
  );
  expect(secondPage.status()).toBe(200);
  const secondPagePayload = await secondPage.json();
  expect(secondPagePayload.transitions.map((row: { ordinal: number }) => row.ordinal)).toEqual([2, 3]);
  const secondCursor = secondPagePayload.page.next_cursor as string;
  const thirdPage = await request.get(
    `${BRIDGE_ORIGIN}/v1/projects/demo-project/runaway-transitions?run_id=${RUNAWAY_RUN_ID}&limit=2&cursor=${encodeURIComponent(secondCursor)}`,
    { headers: validHeaders },
  );
  expect(thirdPage.status()).toBe(200);
  const thirdPagePayload = await thirdPage.json();
  expect(thirdPagePayload.transitions.map((row: { ordinal: number }) => row.ordinal)).toEqual([4]);
  expect(thirdPagePayload.page.next_cursor).toBeNull();
  expect(secondPagePayload.snapshot).toBe(firstPagePayload.snapshot);
  expect(thirdPagePayload.snapshot).toBe(firstPagePayload.snapshot);
  const boundary = await request.get(
    `${BRIDGE_ORIGIN}/v1/projects/demo-project/runaway-transitions?run_id=${RUNAWAY_RUN_ID}&limit=1000`,
    { headers: validHeaders },
  );
  expect(boundary.status()).toBe(200);
  expect((await boundary.json()).page).toMatchObject({ limit: 1000, next_cursor: null });
  const invalidCursor = await request.get(
    `${BRIDGE_ORIGIN}/v1/projects/demo-project/runaway-transitions?run_id=${RUNAWAY_RUN_ID}&cursor=not-a-valid-cursor`,
    { headers: validHeaders },
  );
  expect(invalidCursor.status()).toBe(400);
  expect((await invalidCursor.json()).error).toBe('invalid_cursor');

  const initial = await request.get(`${BRIDGE_ORIGIN}/projects/demo-project/timelines/${demoTimeline}`, { headers: validHeaders });
  const initialPayload = await initial.json();
  const oversized = await postOversizedWithoutBody(
    `/projects/demo-project/timelines/${demoTimeline}/save`, validHeaders, 8 * 1024 * 1024 + 1,
  );
  expect(oversized.status).toBe(413);
  expect(oversized.payload.error).toBe('payload_too_large');
  const afterRejectedSave = await request.get(`${BRIDGE_ORIGIN}/projects/demo-project/timelines/${demoTimeline}`, { headers: validHeaders });
  const afterRejectedPayload = await afterRejectedSave.json();
  expect(afterRejectedPayload.config_version).toBe(initialPayload.config_version);
  expect(afterRejectedPayload.config).toEqual(initialPayload.config);
  expect(afterRejectedPayload.registry).toEqual(initialPayload.registry);

  const allowedOrigin = await request.fetch(`${BRIDGE_ORIGIN}/health`, {
    method: 'OPTIONS', headers: { ...validHeaders, Origin: 'http://localhost:3000' },
  });
  expect(allowedOrigin.status()).toBe(204);
  expect(allowedOrigin.headers()['access-control-allow-origin']).toBe('http://localhost:3000');
  const deniedOrigin = await request.fetch(`${BRIDGE_ORIGIN}/health`, {
    method: 'OPTIONS', headers: { ...validHeaders, Origin: 'https://attacker.invalid' },
  });
  expect(deniedOrigin.status()).toBe(403);
  expect(deniedOrigin.headers()['access-control-allow-origin']).toBeUndefined();
});
