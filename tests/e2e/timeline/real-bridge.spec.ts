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
import { BASE_URL, CLIP_ACTION_WITH_ID_SELECTOR, EDITOR_SETTLE_MS } from './support';

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
  const editorUrl = `${BASE_URL}/tools/video-editor?localProject=demo-project&localTimeline=${await defaultTimelineId(page.request)}&localTest=1`;
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(EDITOR_SETTLE_MS);
  await expect.poll(() => page.evaluate(async () => ({
    registrations: 'serviceWorker' in navigator
      ? (await navigator.serviceWorker.getRegistrations()).length
      : 0,
    caches: 'caches' in window ? (await caches.keys()).length : 0,
  })), { timeout: 10_000 }).toEqual({ registrations: 0, caches: 0 });
  // Renderer previews and diagnostic placeholders also carry data-clip-id.
  // The interactive production clip root is the named clip-action contract.
  await expect(page.locator(CLIP_ACTION_WITH_ID_SELECTOR).first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Change a real inspector field through the production UI. The old B8 probe
 * dragged a clip in a seeded one-clip timeline, but that geometry can snap
 * back without producing a mutation. The timing field is explicit, visible,
 * and its value is asserted before we wait for persistence.
 */
async function editFirstClipStart(
  page: import('@playwright/test').Page,
  options: { beforeCommit?: () => Promise<void> } = {},
) {
  const clip = page.locator(CLIP_ACTION_WITH_ID_SELECTOR).first();
  await clip.waitFor({ timeout: 15_000 });
  // Caption clips can be narrower than a resize handle and may be overlapped
  // by the neighboring clip's edge control. ClipAction is a real keyboard
  // button, so use its production accessibility path instead of force-clicking
  // through another interactive control.
  await clip.focus();
  await expect(clip).toBeFocused();
  await clip.press('Enter');
  await expect(clip).toHaveAttribute('data-selected', 'true');

  const timingTab = page.getByRole('tab', { name: 'Timing', exact: true });
  await expect(timingTab).toBeVisible({ timeout: 10_000 });
  await timingTab.click();

  // Base UI NumberField renders a visible text editor plus a hidden native
  // number input used for form semantics. Scope to the selected Timing panel
  // and operate the user-facing textbox, never the synchronization control.
  const timingPanel = page.getByRole('tabpanel', { name: 'Timing' });
  const startInput = timingPanel.getByRole('textbox').first();
  await expect(startInput).toBeVisible({ timeout: 10_000 });
  const current = Number(await startInput.inputValue());
  const next = (Number.isFinite(current) ? current + 0.25 : 0.25).toFixed(2);
  // NumberField is controlled and does not accept an intermediate empty value;
  // `fill()` therefore re-inserts the old zero before the replacement text.
  // Select-all + typing is the same real keyboard replacement a user performs.
  await startInput.focus();
  await startInput.press('ControlOrMeta+A');
  await startInput.pressSequentially(next);
  // Prove the browser control accepted the edit before any network wait. The
  // callback is deliberately immediately before the final commit gesture so
  // the remote writer cannot be hidden by an editor refresh.
  await expect(startInput).toHaveValue(next);
  await options.beforeCommit?.();
  await startInput.press('Enter');
  await startInput.blur();
  await expect(startInput).toHaveValue(next);
}

type BrowserNetworkAudit = {
  urls: string[];
  taskListRequests: string[];
  consoleErrors: string[];
  pageErrors: string[];
  assertAllowed: () => void;
  assertSingleTaskPollingOwner: () => void;
  assertNoUnexpectedBrowserErrors: (allowed?: RegExp[]) => void;
};

/**
 * Capture every browser-originated network endpoint for real-bridge runs.
 * The editor's only permitted network authorities are the local Vite app and
 * the loopback Astrid bridge; this catches accidental Supabase, Google Fonts,
 * or other remote calls even when the request later fails.
 */
function installBrowserNetworkAudit(page: import('@playwright/test').Page): BrowserNetworkAudit {
  const urls: string[] = [];
  const taskListRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const record = (url: string) => {
    if (!urls.includes(url)) urls.push(url);
  };
  page.on('request', (request) => {
    record(request.url());
    const parsed = new URL(request.url());
    if (
      request.method() === 'GET'
      && parsed.pathname === '/api/astrid/projects/demo-project/tasks'
      && parsed.searchParams.get('limit') === '200'
    ) {
      taskListRequests.push(request.url());
    }
  });
  page.on('websocket', (socket) => record(socket.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location().url;
      consoleErrors.push(location ? `${message.text()} (${location})` : message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const appOrigin = new URL(BASE_URL).origin;
  const bridgeOrigin = BRIDGE_ORIGIN;
  const allowedOrigins = new Set([appOrigin, bridgeOrigin]);
  const allowed = (raw: string) => {
    if (/^(about|blob|data|chrome-extension):/i.test(raw)) return true;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return false;
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return allowedOrigins.has(parsed.origin);
    }
    if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
      return allowedOrigins.has(`${parsed.protocol === 'wss:' ? 'https' : 'http'}://${parsed.host}`);
    }
    return true;
  };

  return {
    urls,
    taskListRequests,
    consoleErrors,
    pageErrors,
    assertAllowed: () => {
      const unexpected = urls.filter((url) => !allowed(url));
      expect(unexpected, 'real-bridge browser traffic must stay on local authorities').toEqual([]);
      expect(urls.filter((url) => /(supabase\.co|54321|fonts\.googleapis\.com|fonts\.gstatic\.com)/i.test(url)),
        'real-bridge browser traffic must not use Supabase or external fonts').toEqual([]);
    },
    assertSingleTaskPollingOwner: () => {
      const fallbackSnapshotPolls = taskListRequests.filter((raw) =>
        new URL(raw).searchParams.has('offset'));
      expect(
        fallbackSnapshotPolls.length,
        `the fallback snapshot owner must yield after realtime connects; saw ${taskListRequests.join(', ')}`,
      ).toBeLessThanOrEqual(2);
    },
    assertNoUnexpectedBrowserErrors: (allowed = []) => {
      const unexpectedConsole = consoleErrors.filter((message) =>
        !allowed.some((pattern) => pattern.test(message)));
      expect(unexpectedConsole, 'real-bridge browser console errors').toEqual([]);
      expect(pageErrors, 'real-bridge uncaught page errors').toEqual([]);
    },
  };
}

/** Freeze timeline reads after the first browser load so a live remote write
 * cannot silently rebase the editor before its in-flight gesture saves. The
 * browser still makes the real save request and receives the real 409. */
async function freezeTimelineReads(page: import('@playwright/test').Page) {
  let snapshot: { status: number; headers: Record<string, string>; body: Buffer } | null = null;
  const routeHandler = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' || !/\/projects\/demo-project\/timelines\/[^/]+$/.test(path)) {
      await route.continue();
      return;
    }
    if (!snapshot) {
      const response = await route.fetch();
      const headers = response.headers();
      delete headers['content-length'];
      delete headers['content-encoding'];
      snapshot = { status: response.status(), headers, body: await response.body() };
    }
    await route.fulfill(snapshot);
  };
  await page.route('**/*', routeHandler);
  return async () => {
    await page.unroute('**/*', routeHandler);
  };
}


const bridgePortValue = process.env.ASTRID_BRIDGE_PORT;
if (!bridgePortValue) {
  throw new Error('ASTRID_BRIDGE_PORT was not published by playwright.config.ts; refusing an implicit shared bridge port');
}
const bridgePort = Number(bridgePortValue);
if (!Number.isInteger(bridgePort) || bridgePort < 1 || bridgePort > 65_535) {
  throw new Error(`Invalid ASTRID_BRIDGE_PORT: ${bridgePortValue}`);
}
const BRIDGE_ORIGIN = `http://127.0.0.1:${bridgePort}`;

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

test('release bridge has explicit auth/protocol negatives and atomic two-writer CAS', async ({ request }) => {
  const url = await timelineUrl(request);
  const validHeaders = bridgeHeaders();
  expect(validHeaders.Authorization).toMatch(/^Bearer .+/);

  const unauthenticated = await request.get(`${BRIDGE_ORIGIN}/health`);
  expect(unauthenticated.status()).toBe(401);
  expect((await unauthenticated.json()).error).toBe('unauthorized');

  const wrongToken = await request.get(`${BRIDGE_ORIGIN}/health`, {
    headers: { Authorization: 'Bearer definitely-not-the-release-token', 'X-Astrid-Bridge-Version': 'v1' },
  });
  expect(wrongToken.status()).toBe(401);
  expect((await wrongToken.json()).error).toBe('unauthorized');

  const missingProtocol = await request.get(`${BRIDGE_ORIGIN}/health`, {
    headers: { Authorization: validHeaders.Authorization },
  });
  expect(missingProtocol.status()).toBe(426);
  expect((await missingProtocol.json()).error).toBe('protocol_version_mismatch');

  const wrongProtocol = await request.get(`${BRIDGE_ORIGIN}/health`, {
    headers: { ...validHeaders, 'X-Astrid-Bridge-Version': 'v0' },
  });
  expect(wrongProtocol.status()).toBe(426);
  expect((await wrongProtocol.json()).error).toBe('protocol_version_mismatch');

  const initial = await request.get(url, { headers: validHeaders });
  expect(initial.status()).toBe(200);
  const initialPayload = await initial.json();
  const expectedVersion = initialPayload.config_version as number;
  const writerBodies = ['writer-a', 'writer-b'].map((marker) => ({
    config: {
      ...initialPayload.config,
      app: { ...(initialPayload.config.app ?? {}), 'b8.cas.writer': marker },
    },
    registry: initialPayload.registry,
    expected_version: expectedVersion,
  }));

  // Two independent writers race on the same head. Exactly one can commit;
  // the loser must be a typed, side-effect-free 409 rather than a last-write-
  // wins overwrite or a transient 500.
  const attempts = await Promise.all(writerBodies.map(async (data) => {
    const response = await request.post(`${url}/save`, { headers: validHeaders, data });
    return { data, response, payload: await response.json() };
  }));
  expect(attempts.map(({ response }) => response.status()).sort()).toEqual([200, 409]);
  const winner = attempts.find(({ response }) => response.status() === 200)!;
  const loser = attempts.find(({ response }) => response.status() === 409)!;
  expect(loser.payload.error).toBe('timeline_version_conflict');
  expect(loser.payload.config_version).toBe(winner.payload.config_version);

  const committed = await request.get(url, { headers: validHeaders });
  const committedPayload = await committed.json();
  expect(['writer-a', 'writer-b']).toContain(committedPayload.config.app['b8.cas.writer']);
  expect(committedPayload.config_version).toBe(winner.payload.config_version);

  // Replaying the exact accepted whole-document request after the head moved
  // must return the original receipt/result, not create a second event.
  const replay = await request.post(`${url}/save`, { headers: validHeaders, data: winner.data });
  expect(replay.status()).toBe(200);
  const replayPayload = await replay.json();
  expect(replayPayload.config_version).toBe(winner.payload.config_version);
  expect(replayPayload.config.app['b8.cas.writer']).toBe(winner.data.config.app['b8.cas.writer']);
});
/**
 * OpenAPI conformance (B3 envelope) against the real bridge: GET timeline,
 * POST save with CAS, GET assets.
 */
test('real release bridge serves timeline, task, generation, and media surfaces', async ({ request }) => {
  const validHeaders = bridgeHeaders();
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

  // Render admission is fenced to the exact saved timeline version. Advance
  // the head, then prove a stale render request is rejected before a task or
  // receipt is allocated.
  const renderBump = await request.post(`${url}/save`, {
    headers: validHeaders,
    data: {
      config: { ...savedPayload.config, app: { ...(savedPayload.config.app ?? {}), 'b8.render.bump': true } },
      registry: savedPayload.registry,
      expected_version: savedPayload.config_version,
    },
  });
  expect(renderBump.status()).toBe(200);
  const renderBumpPayload = await renderBump.json();
  const staleRender = await request.post(`${BRIDGE_ORIGIN}/projects/demo-project/tasks`, {
    headers: { ...validHeaders, 'Idempotency-Key': 'b8-real-release-stale-render-v1' },
    data: {
      family: 'render_export',
      input: {
        timeline_ref: timelineId,
        expected_version: savedPayload.config_version,
        format: 'mp4',
        output_filename: 'b8-stale-render.mp4',
        destination: 'download',
        correlation_id: 'b8-stale-render',
      },
    },
  });
  expect(staleRender.status()).toBe(409);
  const staleRenderPayload = await staleRender.json();
  expect(staleRenderPayload.error).toBe('conflict');
  expect(staleRenderPayload.config_version).toBe(renderBumpPayload.config_version);

  const taskAdmission = await request.post(`${BRIDGE_ORIGIN}/projects/demo-project/tasks`, {
    headers: {
      ...bridgeHeaders(),
      'Idempotency-Key': 'b8-real-release-render-v1',
    },
    data: {
      family: 'render_export',
      input: {
        timeline_ref: timelineId,
        expected_version: renderBumpPayload.config_version,
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

  // The same task request is a receipt replay (200, same task id); reusing
  // the key with different canonical input is a typed 409 mismatch and must
  // not create a second task.
  const replayedTask = await request.post(`${BRIDGE_ORIGIN}/projects/demo-project/tasks`, {
    headers: { ...validHeaders, 'Idempotency-Key': 'b8-real-release-render-v1' },
    data: {
      family: 'render_export',
      input: {
        timeline_ref: timelineId,
        expected_version: renderBumpPayload.config_version,
        format: 'mp4',
        output_filename: 'b8-release-probe.mp4',
        destination: 'download',
        correlation_id: 'b8-release-probe',
      },
    },
  });
  expect(replayedTask.status()).toBe(200);
  expect((await replayedTask.json()).task.id).toBe(admitted.task.id);

  const mismatchedTask = await request.post(`${BRIDGE_ORIGIN}/projects/demo-project/tasks`, {
    headers: { ...validHeaders, 'Idempotency-Key': 'b8-real-release-render-v1' },
    data: {
      family: 'render_export',
      input: {
        timeline_ref: timelineId,
        expected_version: renderBumpPayload.config_version,
        format: 'mp4',
        output_filename: 'b8-different-output.mp4',
        destination: 'download',
        correlation_id: 'b8-different-request',
      },
    },
  });
  expect(mismatchedTask.status()).toBe(409);
  expect((await mismatchedTask.json()).error).toBe('idempotency_mismatch');

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
  const audit = installBrowserNetworkAudit(page);
  const unfreezeTimelineReads = await freezeTimelineReads(page);
  const url = await timelineUrl(request);
  const initialResponse = await request.get(url, { headers: bridgeHeaders() });
  expect(initialResponse.status()).toBe(200);
  const initialPayload = await initialResponse.json();
  const browserSaveBodies: Array<{ expected_version?: unknown; config?: Record<string, unknown> }> = [];
  const browserSaveStatuses: number[] = [];
  page.on('request', (browserRequest) => {
    if (browserRequest.method() !== 'POST' || !/\/save$/.test(new URL(browserRequest.url()).pathname)) return;
    try {
      const body = JSON.parse(browserRequest.postData() ?? '{}') as { expected_version?: unknown; config?: Record<string, unknown> };
      browserSaveBodies.push(body);
    } catch {
      // The assertion below will fail with a useful empty-save diagnostic.
    }
  });
  page.on('response', (browserResponse) => {
    if (browserResponse.request().method() === 'POST' && /\/save$/.test(new URL(browserResponse.url()).pathname)) {
      browserSaveStatuses.push(browserResponse.status());
    }
  });
  await openEditorAt(page);

  // Writer 2 commits immediately after writer 1's visible inspector edit,
  // but before its final Enter/blur. Timeline GETs are frozen to writer 1's
  // original snapshot, so no polling/realtime update can silently replace its
  // expected_version before the real save request.
  const commitRemoteWriter = () => request.post(`${url}/save`, {
    headers: bridgeHeaders(),
    data: {
      config: { ...initialPayload.config, app: { ...(initialPayload.config.app ?? {}), 'b8.browser.writer2': { note: 'concurrent' } } },
      registry: initialPayload.registry,
      expected_version: initialPayload.config_version,
    },
  });

  // The editor's next save carries its (now stale) expected_version → 409 →
  // diverged banner with Reload / Save as copy.
  await editFirstClipStart(page, {
    beforeCommit: async () => {
      const saved = await commitRemoteWriter();
      expect(saved.status()).toBe(200);
    },
  });
  await expect.poll(
    () => browserSaveBodies.filter((body) => body.expected_version === initialPayload.config_version).length,
    { timeout: 25_000 },
  ).toBeGreaterThan(0);
  await expect.poll(() => browserSaveStatuses.includes(409), { timeout: 25_000 }).toBe(true);

  // The browser has now received the real stale-save response. Remove the
  // deterministic read freeze before any recovery action so the subsequent
  // reload must fetch and adopt writer 2's remote head.
  await unfreezeTimelineReads();

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
  const reloadResponsePromise = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return response.request().method() === 'GET'
      && /\/projects\/demo-project\/timelines\/[^/]+$/.test(path)
      && response.status() === 200;
  }, { timeout: 25_000 });
  if (await keepLocal.isVisible().catch(() => false)) {
    await keepLocal.click();
  } else {
    await page.getByRole('button', { name: 'Save as copy' }).click();
  }
  const reloaded = await reloadResponsePromise;
  const reloadedPayload = await reloaded.json();
  expect(reloadedPayload.config.app['b8.browser.writer2']).toEqual({ note: 'concurrent' });
  expect(reloadedPayload.config_version).toBeGreaterThan(initialPayload.config_version);

  // Both actions stash the local draft and reload → the B9 recovery banner
  // offers Retry / Discard.
  await expect(page.getByText(/recovered unsaved changes/i)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByText(/recovered unsaved changes/i)).not.toBeVisible();
  await expect(page.locator(CLIP_ACTION_WITH_ID_SELECTOR).first()).toBeVisible({ timeout: 20_000 });

  const persisted = await request.get(url, { headers: bridgeHeaders() });
  expect(persisted.status()).toBe(200);
  const persistedPayload = await persisted.json();
  expect(persistedPayload.config.app['b8.browser.writer2']).toEqual({ note: 'concurrent' });
  expect(persistedPayload.config.clips).toEqual(initialPayload.config.clips);
  audit.assertAllowed();
  audit.assertSingleTaskPollingOwner();
  audit.assertNoUnexpectedBrowserErrors([
    /404.*\/media\/__reigh_capability_probe__\/content/i,
    /409.*\/save/i,
  ]);
});

/** B9 positive path: a persisted one-slot draft retries with its original
 * CAS base version, then the acknowledgement clears the recovery slot. */
test('B9 recovery Retry re-POSTs the draft at its base version and clears the slot', async ({ page, request }) => {
  const url = await timelineUrl(request);
  const timeline = await (await request.get(url, { headers: bridgeHeaders() })).json();
  const baseVersion = timeline.config_version as number;
  const timelineId = url.split('/').at(-1)!;
  const draftConfig = {
    ...timeline.config,
    clips: (timeline.config.clips ?? []).map((clip: { at?: number }, index: number) =>
      index === 0 ? { ...clip, at: (clip.at ?? 0) + 2 } : clip),
  };

  await openEditorAt(page);
  await page.evaluate(async ({ timelineId: id, draftConfig: config, registry, baseVersion: version }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('reigh.timeline-drafts', 1);
      open.addEventListener('upgradeneeded', () => {
        if (!open.result.objectStoreNames.contains('timeline-drafts')) {
          open.result.createObjectStore('timeline-drafts', { keyPath: 'key' });
        }
      });
      open.addEventListener('success', () => resolve(open.result));
      open.addEventListener('error', () => reject(open.error));
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('timeline-drafts', 'readwrite');
      transaction.objectStore('timeline-drafts').put({
        key: id, timelineId: id, draft: { config, registry }, baseVersion: version,
        updatedAt: new Date().toISOString(),
      });
      transaction.addEventListener('complete', () => resolve());
      transaction.addEventListener('error', () => reject(transaction.error));
    });
    database.close();
  }, { timelineId, draftConfig, registry: timeline.registry, baseVersion });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/recovered unsaved changes/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(CLIP_ACTION_WITH_ID_SELECTOR).first()).toBeVisible({ timeout: 20_000 });

  const retryPost = page.waitForRequest((browserRequest) =>
    browserRequest.method() === 'POST' && /\/save$/.test(new URL(browserRequest.url()).pathname), { timeout: 20_000 });
  const retryResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/save$/.test(new URL(response.url()).pathname), { timeout: 20_000 });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  const post = await retryPost;
  const response = await retryResponse;
  expect(post.postDataJSON().expected_version).toBe(baseVersion);
  expect(response.status()).toBe(200);

  await expect(page.getByText(/recovered unsaved changes/i)).not.toBeVisible({ timeout: 15_000 });
  const draftSlot = await page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase | null>((resolve) => {
      const open = indexedDB.open('reigh.timeline-drafts', 1);
      open.addEventListener('success', () => resolve(open.result));
      open.addEventListener('error', () => resolve(null));
    });
    if (!database) return 'no-db';
    const record = await new Promise<unknown>((resolve) => {
      const transaction = database.transaction('timeline-drafts', 'readonly');
      const get = transaction.objectStore('timeline-drafts').get(id);
      get.addEventListener('success', () => resolve(get.result));
      get.addEventListener('error', () => resolve('read-error'));
    });
    database.close();
    return record ?? null;
  }, timelineId);
  expect(draftSlot).toBeNull();
  const after = await (await request.get(url, { headers: bridgeHeaders() })).json();
  expect(after.config.clips[0].at).toBeGreaterThan(timeline.config.clips[0].at);
});

/**
 * Watchdog (B1a): with the bridge dead, an edit must surface a persistent
 * actionable banner instead of a silent "saved" badge.
 */
test('bridge death during an edit → watchdog banner with retry', async ({ page }) => {
  const audit = installBrowserNetworkAudit(page);
  // Kill the real bridge out from under the editor (the harness wrote the PID
  // file on spawn). The next save gets no receipt → the B1a watchdog trips.
  await openEditorAt(page);

  const pidFile = process.env.ASTRID_BRIDGE_PID_FILE || '/tmp/astrid-real-bridge.pid';
  const pid = Number((await import('node:fs')).readFileSync(pidFile, 'utf8'));
  expect(pid).toBeGreaterThan(0);
  process.kill(pid, 'SIGKILL');

  // Edit → autosave → no ack → persistent watchdog banner (5s grace).
  await editFirstClipStart(page);

  await expect(page.getByText(/changes have not been saved/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  audit.assertAllowed();
  audit.assertSingleTaskPollingOwner();
  audit.assertNoUnexpectedBrowserErrors([
    /404.*\/media\/__reigh_capability_probe__\/content/i,
    /failed to load resource.*\/api\/astrid\//i,
    /fetch.*astrid/i,
    /network.*astrid/i,
    /proxy.*astrid/i,
  ]);
});
