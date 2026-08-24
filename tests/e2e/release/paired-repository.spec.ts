import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const phase = process.env.PAIRED_RELEASE_PHASE;
const evidenceDir = process.env.PAIRED_RELEASE_EVIDENCE_DIR;
const baseUrl = process.env.PAIRED_RELEASE_BASE_URL?.replace(/\/+$/, '');
const project = process.env.PAIRED_RELEASE_DEMO_PROJECT;
const timeline = process.env.PAIRED_RELEASE_DEMO_TIMELINE;
const runawayProject = process.env.PAIRED_RELEASE_RUNAWAY_PROJECT;
const expectedExtensions = Number(process.env.PAIRED_RELEASE_EXPECTED_EXTENSIONS);
const expectedRunaway = Number(process.env.PAIRED_RELEASE_EXPECTED_RUNAWAY);

for (const [name, value] of Object.entries({
  PAIRED_RELEASE_PHASE: phase,
  PAIRED_RELEASE_EVIDENCE_DIR: evidenceDir,
  PAIRED_RELEASE_BASE_URL: baseUrl,
  PAIRED_RELEASE_DEMO_PROJECT: project,
  PAIRED_RELEASE_DEMO_TIMELINE: timeline,
  PAIRED_RELEASE_RUNAWAY_PROJECT: runawayProject,
})) {
  if (!value) throw new Error(`${name} is required`);
}
if (!['first', 'restart', 'restore'].includes(phase!)) {
  throw new Error(`unsupported PAIRED_RELEASE_PHASE: ${phase}`);
}
if (!Number.isInteger(expectedExtensions) || expectedExtensions < 1) {
  throw new Error('PAIRED_RELEASE_EXPECTED_EXTENSIONS must be a positive integer');
}
if (!Number.isInteger(expectedRunaway) || expectedRunaway < 1) {
  throw new Error('PAIRED_RELEASE_EXPECTED_RUNAWAY must be a positive integer');
}
if (process.env.ASTRID_BRIDGE_TOKEN) {
  throw new Error('ASTRID_BRIDGE_TOKEN leaked into the browser acceptance process');
}

const timelineUrl = `${baseUrl}/api/astrid/projects/${project}/timelines/${timeline}`;
const runawayUrl = `${baseUrl}/api/astrid/v1/projects/${runawayProject}/runaway-transitions?limit=1000`;
const editorUrl = `${baseUrl}/tools/video-editor?localProject=${project}&localTimeline=${timeline}&localTest=1&transcriptLaneFixture=1&runawayTimelineProject=${runawayProject}`;

type TimelineConfig = {
  clips?: Array<{
    id?: string;
    at?: number;
    hold?: number;
    duration?: number;
    clipType?: string;
    text?: string;
  }>;
  output?: { fps?: number; resolution?: string; file?: string };
};

type TimelineEnvelope = {
  config: TimelineConfig;
  registry: Record<string, unknown>;
  config_version: number;
};

type RunawaySnapshot = { count: number; hash: string };

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function timelineStateHash(timelineState: TimelineEnvelope): string {
  return sha256Text(canonicalJson({
    config: timelineState.config,
    registry: timelineState.registry,
  }));
}

async function readTimeline(request: APIRequestContext): Promise<TimelineEnvelope> {
  const response = await request.get(timelineUrl);
  expect(response.status()).toBe(200);
  return response.json() as Promise<TimelineEnvelope>;
}

async function readRunawaySnapshot(request: APIRequestContext): Promise<RunawaySnapshot | null> {
  const response = await request.get(runawayUrl);
  if (response.status() === 404) return null;
  expect(response.status()).toBe(200);
  expect(response.headers()['x-astrid-bridge-version']).toBe('v1');
  const payload = await response.json() as { count?: number; total_count?: number; transitions?: unknown[] };
  expect(payload.count).toBe(payload.transitions?.length);
  const count = payload.total_count ?? payload.count;
  if (typeof count !== 'number') throw new Error('Runaway response has no total count');
  return {
    count,
    hash: sha256Text(canonicalJson({
      timingSummary: (payload as { timing_summary?: unknown }).timing_summary,
      transitions: payload.transitions,
    })),
  };
}

function primaryClip(config: TimelineConfig) {
  return config.clips?.find((clip) => clip.id === 'paired-release-clip');
}

function captionCount(config: TimelineConfig): number {
  return config.clips?.filter((clip) => clip.id?.startsWith('transcript-caption-')).length ?? 0;
}

async function openEditor(page: Page): Promise<string[]> {
  const issues: string[] = [];
  const consoleWarnings: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(`[console.error] ${message.text()}`);
    if (message.type() === 'warning') consoleWarnings.push(`[console.warn] ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`[requestfailed] ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`);
  });
  await page.addInitScript(() => {
    window.localStorage.removeItem('reigh.dev-extensions.disabled');
    window.localStorage.setItem('reigh.lastSelectedProjectId', 'stale-project-must-remain-isolated');
  });
  const response = await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(response?.ok()).toBe(true);
  try {
    await expect(page.locator('[data-clip-id="paired-release-clip"]')).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    // Preserve the useful browser failure signal in the receipt. Without this
    // context a module-evaluation crash is misreported as a missing seeded
    // clip, because Playwright only reports the final selector timeout.
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const rootHtml = await page.locator('#root').innerHTML().catch(() => '');
    const compact = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 1200);
    const diagnostics = JSON.stringify({
      url: page.url(),
      issues,
      consoleWarnings,
      failedRequests,
      bodyText: compact(bodyText),
      rootHtml: compact(rootHtml),
    });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nBrowser boot diagnostics: ${diagnostics}`);
  }
  await expect(page.locator('[data-lane-kind="reigh.transcript"]')).toBeVisible();
  return issues;
}

async function proveAllExtensionLifecycles(page: Page) {
  await page.getByRole('tab', { name: 'Extensions' }).click();
  const rows = page.locator('[data-video-editor-dev-local-extension]');
  await expect(rows).toHaveCount(expectedExtensions);
  for (let index = 0; index < expectedExtensions; index += 1) {
    await expect(rows.nth(index)).toContainText('Active');
  }

  // Drive every reviewed extension through its real DEV lifecycle control.
  // The gate returns each one to enabled immediately so later surface checks
  // still exercise the complete inventory.
  const ids = await rows.evaluateAll((elements) => elements.map((element) => (
    element.getAttribute('data-video-editor-dev-local-extension')
  )));
  expect(new Set(ids).size).toBe(expectedExtensions);
  for (const id of ids) {
    expect(id).toBeTruthy();
    const toggle = page.locator(`[data-video-editor-dev-local-toggle="${id}"]`);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(`Enable ${id}`);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(`Disable ${id}`);
  }
}

async function dragPrimaryClip(page: Page) {
  const clip = page.locator('[data-clip-id="paired-release-clip"]');
  const box = await clip.boundingBox();
  if (!box) throw new Error('primary clip has no browser geometry');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 64, y, { steps: 8 });
  await page.mouse.up();
}

async function waitForPersistedEdit(request: APIRequestContext, previousAt: number) {
  await expect.poll(async () => {
    const current = await readTimeline(request);
    return primaryClip(current.config)?.at;
  }, { timeout: 30_000 }).not.toBe(previousAt);
}

async function materializeTranscript(page: Page, request: APIRequestContext) {
  const actions = page.getByRole('button', { name: 'Transcript actions' });
  await actions.scrollIntoViewIfNeeded();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Render transcript as editable video text' }).click();
  await expect.poll(async () => captionCount((await readTimeline(request)).config), {
    timeout: 30_000,
  }).toBeGreaterThanOrEqual(2);
}

async function renderAndDownload(
  page: Page,
  timelineState: TimelineEnvelope,
  persistedStateHash: string,
): Promise<{ bytes: number; sha256: string }> {
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  const downloadLink = page.getByRole('link', { name: 'Download', exact: true });
  await expect(downloadLink).toBeVisible({ timeout: 240_000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await downloadLink.click();
  const download = await downloadPromise;
  const path = resolve(evidenceDir!, 'paired-release-render.mp4');
  await download.saveAs(path);
  const bytes = (await stat(path)).size;
  expect(bytes).toBeGreaterThan(10_000);
  const body = await readFile(path);
  expect(body.subarray(4, 8).toString('ascii')).toBe('ftyp');
  const expectedFps = timelineState.config.output?.fps;
  expect(expectedFps).toBe(24);
  const expectedDuration = Math.max(...(timelineState.config.clips ?? []).map((clip) => (
    Number(clip.at ?? 0) + Number(clip.hold ?? clip.duration ?? 0)
  )));
  const captionMidpoints = (timelineState.config.clips ?? [])
    .filter((clip) => clip.id?.startsWith('transcript-caption-'))
    .map((clip) => Number(clip.at ?? 0) + Number(clip.hold ?? clip.duration ?? 0) / 2)
    .filter(Number.isFinite);
  expect(expectedDuration).toBeGreaterThan(0);
  expect(captionMidpoints.length).toBeGreaterThanOrEqual(2);
  await writeFile(
    resolve(evidenceDir!, 'render-browser-receipt.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      persistedStateHash,
      expectedDuration,
      expectedFps,
      captionMidpoints,
      bytes,
      sha256: createHash('sha256').update(body).digest('hex'),
    }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  return { bytes, sha256: createHash('sha256').update(body).digest('hex') };
}

test(`paired repository acceptance phase: ${phase}`, async ({ page, request }) => {
  await mkdir(evidenceDir!, { recursive: true });
  const initial = await readTimeline(request);
  const initialStateHash = timelineStateHash(initial);
  const initialAt = primaryClip(initial.config)?.at;
  expect(typeof initialAt).toBe('number');
  const runawaySnapshot = await readRunawaySnapshot(request);
  const issues = await openEditor(page);
  await proveAllExtensionLifecycles(page);

  if (phase === 'first') {
    expect(runawaySnapshot?.count).toBe(expectedRunaway);
    await writeFile(
      resolve(evidenceDir!, 'browser-first-baseline.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        timelineStateHash: initialStateHash,
        timeline: initial,
      }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    await expect(page.locator('[data-lane-kind="reigh.runaway.transitions"]')).toBeVisible();
    await dragPrimaryClip(page);
    await waitForPersistedEdit(request, initialAt!);
    await materializeTranscript(page, request);
    const saved = await readTimeline(request);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-clip-id="paired-release-clip"]')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.locator('[data-clip-id^="transcript-caption-"]').count()).toBeGreaterThanOrEqual(2);
    expect(primaryClip(saved.config)?.at).not.toBe(initialAt);
  } else if (phase === 'restart') {
    const firstState = JSON.parse(
      await readFile(resolve(evidenceDir!, 'browser-first-state.json'), 'utf8'),
    ) as { timelineStateHash?: string; runawayHash?: string; runawayCount?: number };
    expect(runawaySnapshot?.count).toBe(expectedRunaway);
    expect(initialStateHash).toBe(firstState.timelineStateHash);
    expect(runawaySnapshot?.hash).toBe(firstState.runawayHash);
    expect(runawaySnapshot?.count).toBe(firstState.runawayCount);
    expect(initialAt).toBeGreaterThan(0);
    expect(captionCount(initial.config)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.locator('[data-clip-id^="transcript-caption-"]').count()).toBeGreaterThanOrEqual(2);
    await renderAndDownload(page, initial, initialStateHash);
  } else {
    const baseline = JSON.parse(
      await readFile(resolve(evidenceDir!, 'browser-first-baseline.json'), 'utf8'),
    ) as { timelineStateHash?: string };
    expect(runawaySnapshot).toBeNull();
    expect(initialStateHash).toBe(baseline.timelineStateHash);
    expect(initialAt).toBe(0);
    expect(captionCount(initial.config)).toBe(0);
  }

  const final = await readTimeline(request);
  const finalStateHash = timelineStateHash(final);
  const state = {
    schemaVersion: 1,
    phase,
    configVersion: final.config_version,
    timelineStateHash: finalStateHash,
    primaryClipAt: primaryClip(final.config)?.at,
    captionCount: captionCount(final.config),
    runawayCount: runawaySnapshot?.count ?? null,
    runawayHash: runawaySnapshot?.hash ?? null,
    extensionCount: expectedExtensions,
  };
  await writeFile(
    resolve(evidenceDir!, `timeline-${phase}.json`),
    `${JSON.stringify({ schemaVersion: 1, timelineStateHash: finalStateHash, timeline: final }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  await page.screenshot({ path: resolve(evidenceDir!, `browser-${phase}.png`), fullPage: true });
  await writeFile(
    resolve(evidenceDir!, `browser-${phase}-state.json`),
    `${JSON.stringify(state, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  expect(issues).toEqual([]);
});
