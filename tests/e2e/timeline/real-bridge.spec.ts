/**
 * B5 real-bridge scenarios: CAS conflict, watchdog, and recovery draft against
 * the REAL Astrid bridge (`astrid serve`), not the stub.
 *
 *   npm run test:e2e:timeline:realbridge
 *
 * The webServer boots `real-bridge-serve.mjs` on port 17334 with a temp seeded
 * project root; the Vite dev server comes from the shared webServer config.
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BASE_URL, EDITOR_SETTLE_MS } from './support';

// The final watchdog case intentionally kills the one harness-owned bridge.
// Serial mode guarantees it cannot race an otherwise independent acceptance.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

// The harness registers the project through the astrid CLI, which mints the
// timeline identity — resolve it from the discovery route instead of assuming
// a fixed UUID.
async function defaultTimelineId(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const response = await request.get(`${BRIDGE_ORIGIN}/projects/demo-project/timelines`, {
    headers: bridgeHeaders(),
  });
  const body = await response.json();
  const rows = (body.timelines ?? []) as Array<{ timeline_id: string; is_default?: boolean }>;
  const chosen = rows.find((row) => row.is_default) ?? rows[0];
  if (!chosen) {
    throw new Error('real bridge registered no timelines for demo-project');
  }
  return chosen.timeline_id;
}

async function timelineUrl(request: import('@playwright/test').APIRequestContext): Promise<string> {
  return `${BRIDGE_ORIGIN}/projects/demo-project/timelines/${await defaultTimelineId(request)}`;
}

async function openEditorAt(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('reigh.lastSelectedProjectId', 'stale-project-from-earlier-session');
    } catch {
      // storage unavailable
    }
  });
  const editorUrl = `${BASE_URL}/tools/video-editor?localProject=demo-project&localTimeline=${await defaultTimelineId(page.request)}`;
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(EDITOR_SETTLE_MS);
  // The real timeline region renders clips as [data-clip-id] elements — wait
  // for one (there is no data-testid in production DOM).
  await expect(page.locator('[data-clip-id]').first()).toBeVisible({ timeout: 20_000 });
}

/** Select the first clip and drag it right — a real edit that triggers autosave. */
async function dragFirstClipRight(page: import('@playwright/test').Page) {
  const clip = page.locator('[data-clip-id]').first();
  await clip.waitFor({ timeout: 15_000 });
  const box = await clip.boundingBox();
  if (!box) {
    throw new Error('clip has no bounding box');
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 48, cy, { steps: 6 });
  await page.mouse.up();
}


const BRIDGE_ORIGIN = `http://127.0.0.1:${process.env.ASTRID_BRIDGE_PORT ?? '17334'}`;

/**
 * Release mode authenticates and negotiates every route. The Vite proxy
 * injects these server-side for browser `/api/astrid` traffic; direct
 * bridge-origin Playwright requests read the owner-only harness token file.
 */
function bridgeHeaders(): Record<string, string> {
  try {
    const token = readFileSync(process.env.ASTRID_REQUEST_TOKEN_FILE ?? '/tmp/astrid-real-bridge.token', 'utf8').trim();
    return {
      Authorization: `Bearer ${token}`,
      'X-Astrid-Bridge-Version': 'v1',
    };
  } catch {
    return {};
  }
}

/**
 * OpenAPI conformance (B3 envelope) against the real bridge: GET timeline,
 * POST save with CAS, GET assets.
 */
test('real release bridge serves timeline, task, generation, and media surfaces', async ({ request }) => {
  const url = await timelineUrl(request);
  const timelineId = url.split('/').at(-1);
  expect(timelineId).toBeTruthy();
  const timeline = await request.get(url, { headers: bridgeHeaders() });
  const payload = await timeline.json();
  expect(payload).toHaveProperty('config');
  expect(payload).toHaveProperty('registry');
  expect(typeof payload.config_version).toBe('number');

  // Save with the read version → 200 + version bump.
  const saved = await request.post(`${url}/save`, {
    headers: bridgeHeaders(),
    data: {
      config: payload.config,
      registry: payload.registry,
      expected_version: payload.config_version,
    },
  });
  expect(saved.status()).toBe(200);
  const savedPayload = await saved.json();
  // Legacy assembly → event-log migration can append more than one event,
  // so the version strictly increases rather than += 1.
  expect(savedPayload.config_version).toBeGreaterThan(payload.config_version);

  // Save with a stale version → typed 409, never a 500/connection-close.
  // The body must DIFFER from the accepted save: an identical body under the
  // same expected_version is an idempotent replay, not a conflict.
  const conflicted = await request.post(`${url}/save`, {
    headers: bridgeHeaders(),
    data: {
      config: payload.config,
      registry: { ...payload.registry, assets: { ...payload.registry.assets, 'stale-cas-probe': { file: 'probe' } } },
      expected_version: payload.config_version,
    },
  });
  expect(conflicted.status()).toBe(409);
  const conflictBody = await conflicted.json();
  expect(conflictBody.error).toBe('timeline_version_conflict');

  // Discovery routes are served again (restored after B5): list endpoints
  // return the envelope with at least the seeded project.
  const projects = await request.get(`${BRIDGE_ORIGIN}/projects`, { headers: bridgeHeaders() });
  expect(projects.status()).toBe(200);
  const projectsBody = await projects.json();
  expect(Array.isArray(projectsBody.projects)).toBe(true);
  expect(projectsBody.projects.length).toBeGreaterThan(0);
  const timelines = await request.get(`${BRIDGE_ORIGIN}/projects/demo-project/timelines`, {
    headers: bridgeHeaders(),
  });
  expect(timelines.status()).toBe(200);

  const taskAdmission = await request.post(`${BRIDGE_ORIGIN}/projects/demo-project/tasks`, {
    headers: {
      ...bridgeHeaders(),
      'Idempotency-Key': 'b8-real-release-render-v1',
    },
    data: {
      family: 'render_export',
      input: {
        timeline_ref: timelineId,
        expected_version: savedPayload.config_version,
        format: 'mp4',
        output_filename: 'b8-release-probe.mp4',
        destination: 'download',
        correlation_id: 'b8-release-probe',
      },
    },
  });
  expect(taskAdmission.status()).toBe(201);
  const admitted = await taskAdmission.json();
  expect(admitted.task.id).toEqual(expect.any(String));

  const taskList = await request.get(`${BRIDGE_ORIGIN}/projects/demo-project/tasks?limit=1&offset=0`, {
    headers: bridgeHeaders(),
  });
  expect(taskList.status()).toBe(200);
  expect((await taskList.json()).tasks).toHaveLength(1);

  const taskDetail = await request.get(
    `${BRIDGE_ORIGIN}/projects/demo-project/tasks/${admitted.task.id}`,
    { headers: bridgeHeaders() },
  );
  expect(taskDetail.status()).toBe(200);

  const taskCancel = await request.post(
    `${BRIDGE_ORIGIN}/projects/demo-project/tasks/${admitted.task.id}/cancel`,
    { headers: bridgeHeaders(), data: {} },
  );
  expect(taskCancel.status()).toBe(200);

  const generations = await request.get(`${BRIDGE_ORIGIN}/projects/demo-project/generations?limit=1`, {
    headers: bridgeHeaders(),
  });
  expect(generations.status()).toBe(200);
  expect(Array.isArray((await generations.json()).generations)).toBe(true);

  const missingMedia = await request.get(
    `${BRIDGE_ORIGIN}/projects/demo-project/media/01UNKNOWN/content`,
    { headers: bridgeHeaders() },
  );
  expect(missingMedia.status()).toBe(404);
  expect((await missingMedia.json()).error).toBe('media_not_found');
});

/**
 * A concurrent writer bumping the version mid-edit puts the editor into the
 * diverged state with the B4 banner — live 409 proof in the browser.
 */
test('concurrent write → 409 → diverged banner (B4/B5 live proof)', async ({ page, request }) => {
  await openEditorAt(page);

  // Writer 2: bump the version behind the editor's back.
  const url = await timelineUrl(request);
  const timeline = await request.get(url, { headers: bridgeHeaders() });
  expect(timeline.status()).toBe(200);
  const payload = await timeline.json();
  const saved = await request.post(`${url}/save`, {
    headers: bridgeHeaders(),
    data: {
      config: { ...payload.config, app: { ...(payload.config.app ?? {}), 'com.example.writer2': { note: 'concurrent' } } },
      registry: payload.registry,
      expected_version: payload.config_version,
    },
  });
  expect(saved.status()).toBe(200);

  // The editor's next save carries its (now stale) expected_version → 409 →
  // diverged banner with Reload / Save as copy.
  await dragFirstClipRight(page);

  // The 409 puts the editor into diverged. Two surfaces present it: the B4
  // banner (Reload / Save as copy) or the pre-existing conflict dialog
  // (Keep local draft = save-as-copy, Discard and reload). Accept whichever
  // arrives; both stash the local draft and reload.
  const banner = page.getByText(/This timeline changed elsewhere/);
  const dialog = page.getByRole('dialog', { name: /Remote timeline changes detected/ });
  await Promise.race([
    banner.waitFor({ timeout: 25_000 }),
    dialog.waitFor({ timeout: 25_000 }),
  ]);

  const keepLocal = page.getByRole('button', { name: 'Keep local draft' });
  if (await keepLocal.isVisible().catch(() => false)) {
    await keepLocal.click();
  } else {
    await page.getByRole('button', { name: 'Save as copy' }).click();
  }

  // Both actions stash the local draft and reload → the B9 recovery banner
  // offers Retry / Discard.
  await expect(page.getByText(/recovered unsaved changes/i)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText(/recovered unsaved changes/i)).not.toBeVisible();
  await expect(page.locator('[data-clip-id]').first()).toBeVisible({ timeout: 20_000 });
});

/**
 * Watchdog (B1a): with the bridge dead, an edit must surface a persistent
 * actionable banner instead of a silent "saved" badge.
 */
test('bridge death during an edit → watchdog banner with retry', async ({ page }) => {
  // Kill the real bridge out from under the editor (the harness wrote the PID
  // file on spawn). The next save gets no receipt → the B1a watchdog trips.
  await openEditorAt(page);

  const pidFile = process.env.ASTRID_BRIDGE_PID_FILE || '/tmp/astrid-real-bridge.pid';
  const pid = Number((await import('node:fs')).readFileSync(pidFile, 'utf8'));
  expect(pid).toBeGreaterThan(0);
  process.kill(pid, 'SIGKILL');

  // Edit → autosave → no ack → persistent watchdog banner (5s grace).
  await dragFirstClipRight(page);

  await expect(page.getByText(/changes have not been saved/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
});
