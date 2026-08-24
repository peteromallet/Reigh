/**
 * Shared harness for the timeline device specs.
 *
 * These specs are the *real-browser* half of the timeline's interaction
 * contract: `src/tools/video-editor/lib/mobile-interaction-conformance.test.tsx`
 * binds every policy predicate to a rendered attribute and a stylesheet rule,
 * but it runs in jsdom and says so in its own header — it cannot see whether the
 * browser's own gesture arbitration (back-swipe, pan, pinch) leaves the editor's
 * gestures reachable. That is what these do, over CDP touch input.
 *
 * One command: `npm run test:e2e:timeline` (after a one-time
 * `npx playwright install chromium`). Its opt-in flag makes `playwright.config.ts`
 * boot *both* live processes these specs need — the dev server and the local-mode
 * bridge stub — as `webServer` entries. A second terminal is unnecessary: the
 * harness owns fresh editor and bridge ports for the run and fails loudly if
 * an explicitly supplied port is occupied.
 *
 * Both endpoints are env-parameterized. `BASE_URL` or
 * `PLAYWRIGHT_BASE_URL` wins; otherwise the origin follows the
 * run-isolated `PLAYWRIGHT_PORT` published by `playwright.config.ts`.
 * `ASTRID_BRIDGE_PORT` is likewise run-isolated.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';
import {
  CLIP_BODY_SELECTOR,
  EDIT_AREA_SELECTOR,
  SELECTED_CLIP_SELECTOR,
} from '../../../src/tools/video-editor/lib/timeline-dom.ts';
import {
  readCanonicalBaseUrl,
  resolveCanonicalBaseUrl,
} from './isolated-port.mjs';

export {
  CLIP_BODY_SELECTOR,
  CLIP_ACTION_WITH_ID_SELECTOR,
} from '../../../src/tools/video-editor/lib/timeline-dom.ts';

const editorPortValue = process.env.PLAYWRIGHT_PORT;
const editorPort = editorPortValue == null || editorPortValue === '' ? null : Number(editorPortValue);
if (editorPort != null && (!Number.isInteger(editorPort) || editorPort < 1 || editorPort > 65_535)) {
  throw new Error(`Invalid PLAYWRIGHT_PORT: ${editorPortValue}`);
}
if (!process.env.BASE_URL && !process.env.PLAYWRIGHT_BASE_URL && editorPort == null) {
  throw new Error('PLAYWRIGHT_PORT or BASE_URL must be published by the Playwright config; refusing an implicit shared editor port');
}
const configuredBaseURL = readCanonicalBaseUrl();
if (configuredBaseURL && editorPort != null && configuredBaseURL.port !== editorPort) {
  throw new Error(`Configured base URL port ${configuredBaseURL.port} does not match PLAYWRIGHT_PORT=${editorPort}`);
}
export const BASE_URL = configuredBaseURL?.url
  ?? resolveCanonicalBaseUrl(editorPort as number);
const bridgePortValue = process.env.ASTRID_BRIDGE_PORT;
if (!bridgePortValue) {
  throw new Error('ASTRID_BRIDGE_PORT was not published by playwright.config.ts; refusing an implicit shared bridge port');
}
export const BRIDGE_PORT = Number(bridgePortValue);
if (!Number.isInteger(BRIDGE_PORT) || BRIDGE_PORT < 1 || BRIDGE_PORT > 65_535) {
  throw new Error(`Invalid ASTRID_BRIDGE_PORT: ${bridgePortValue}`);
}
export const BRIDGE_ORIGIN = `http://127.0.0.1:${BRIDGE_PORT}`;

export const PROJECT_SLUG = 'demo-project';
export const TIMELINE_SLUG = 'demo-timeline';

export const EDITOR_URL =
  `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1`;

const BRIDGE_TIMELINE = `${BRIDGE_ORIGIN}/projects/${PROJECT_SLUG}/timelines/${TIMELINE_SLUG}`;

/** How long the editor needs to boot, resolve assets and lay the timeline out. */
export const EDITOR_SETTLE_MS = 9_000;

/**
 * Clip layout the specs assert against. The bridge stub persists saves and the
 * gestures under test really do commit edits, so every spec restores this first
 * or the second run measures the first run's leftovers.
 */
export const BASELINE_CLIPS = [
  { id: 'clip-hero', at: 0, track: 'V1', asset: 'demo-hero', clipType: 'media', hold: 4 },
  { id: 'clip-title', at: 4, track: 'V1', clipType: 'text', hold: 2.5, text: { content: 'Hello timeline' } },
  { id: 'clip-detail', at: 6.5, track: 'V1', asset: 'demo-detail', clipType: 'media', hold: 4 },
  { id: 'clip-video', at: 1.5, track: 'V2', asset: 'demo-clip', clipType: 'media', hold: 5 },
];

/** Track order is fixture state too — the touch grip makes reordering reachable. */
export const BASELINE_TRACK_ORDER = ['V1', 'V2', 'A1'];
export const BASELINE_TRACKS = [
  { id: 'V1', kind: 'visual', label: 'V1', scale: 1, fit: 'contain', opacity: 1, blendMode: 'normal' },
  { id: 'V2', kind: 'visual', label: 'V2', scale: 1, fit: 'contain', opacity: 1, blendMode: 'normal' },
  { id: 'A1', kind: 'audio', label: 'A1', scale: 1, fit: 'contain', opacity: 1, blendMode: 'normal' },
];

function resetBridgeBaselineOnce(): Promise<string | null> {
  return (async () => {
    try {
      const healthResponse = await fetch(`${BRIDGE_ORIGIN}/health`);
      if (!healthResponse.ok) return `[reset] bridge health returned ${healthResponse.status}`;
      const health = await healthResponse.json();
      if (health?.ok !== true) return '[reset] bridge health response was not {ok:true}';
      const response = await fetch(BRIDGE_TIMELINE);
      if (!response.ok) return `[reset] bridge fixture GET returned ${response.status}`;
      const current = await response.json();
      if (!Number.isInteger(current.config_version)) {
        return '[reset] bridge fixture GET did not include an integer config_version';
      }
      const currentAssetIds = Object.keys(current.registry?.assets ?? {}).sort();
      const expectedAssetIds = ['demo-clip', 'demo-detail', 'demo-hero'];
      if (currentAssetIds.join(',') !== expectedAssetIds.join(',')) {
        return `[reset] unexpected bridge fixture assets: ${currentAssetIds.join(',')}`;
      }
      const config = {
        ...(current.config ?? {}),
        tracks: BASELINE_TRACKS.map((track) => ({ ...track })),
        clips: BASELINE_CLIPS.map((clip) => ({ ...clip, ...(clip.text ? { text: { ...clip.text } } : {}) })),
      };
      const saveResponse = await fetch(`${BRIDGE_TIMELINE}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, expected_version: current.config_version }),
      });
      if (!saveResponse.ok) return `[reset] bridge fixture save returned ${saveResponse.status}`;
      const saved = await saveResponse.json();
      if (saved.config_version !== current.config_version + 1) {
        return `[reset] bridge fixture version mismatch after save: expected ${current.config_version + 1}, got ${saved.config_version}`;
      }
      if (!isDeepStrictEqual(saved.config, config)) {
        return `[reset] bridge fixture config mismatch after save: expected ${JSON.stringify(config)}, got ${JSON.stringify(saved.config)}`;
      }
      if (!isDeepStrictEqual(saved.registry?.assets, current.registry?.assets)) {
        return '[reset] bridge fixture registry changed unexpectedly during baseline reset';
      }
      return null;
    } catch (error) {
      return `[reset] ${(error as Error).message}`;
    }
  })();
}

// Playwright can invoke hooks from multiple projects/pages in the same worker.
// Queue resets so two GET → CAS-save sequences cannot interleave and silently
// restore an intermediate fixture.
let resetTail: Promise<void> = Promise.resolve();
export function resetBridgeBaseline(): Promise<string | null> {
  const result = resetTail.then(resetBridgeBaselineOnce, resetBridgeBaselineOnce);
  resetTail = result.then(() => undefined, () => undefined);
  return result;
}

const pageIssues = new WeakMap<Page, string[]>();

/** Collect every browser/page error. Local-test mode intentionally has no broad noise allowlist. */
export function collectPageLogs(page: Page): string[] {
  const existing = pageIssues.get(page);
  if (existing) return existing;
  const logs: string[] = [];
  pageIssues.set(page, logs);
  page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      logs.push(`[console.error] ${message.text().slice(0, 300)}`);
    }
  });
  return logs;
}

export function assertNoUnexpectedPageErrors(logs: readonly string[]): void {
  if (logs.length > 0) {
    throw new Error(`Unexpected browser errors:\n${[...new Set(logs)].join('\n')}`);
  }
}

export interface TouchInput {
  tap(x: number, y: number): Promise<void>;
  touchDrag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: { steps?: number; holdMs?: number; stepMs?: number },
  ): Promise<void>;
  pinch(cx: number, cy: number, from: number, to: number, steps?: number): Promise<void>;
}

/**
 * Raw CDP touch input.
 *
 * Playwright's `page.touchscreen` only taps; these gestures need real multi-step
 * touchmove streams (and two-finger streams for pinch) because the behavior under
 * test *is* how the browser arbitrates a sustained touch drag against the page.
 */
export async function createTouchInput(context: BrowserContext, page: Page): Promise<TouchInput> {
  const cdp = await context.newCDPSession(page);

  return {
    async tap(x, y) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(500);
    },

    async touchDrag(x1, y1, x2, y2, { steps = 14, holdMs = 0, stepMs = 16 } = {}) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
      if (holdMs) await page.waitForTimeout(holdMs);
      for (let i = 1; i <= steps; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }],
        });
        await page.waitForTimeout(stepMs);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
    },

    async pinch(cx, cy, from, to, steps = 12) {
      const points = (spread: number) => [{ x: cx - spread, y: cy }, { x: cx + spread, y: cy }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
      for (let i = 1; i <= steps; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: points(from + ((to - from) * i) / steps),
        });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(600);
    },
  };
}

/**
 * Open the editor in local mode and wait for it to settle.
 *
 * Local mode must never talk to a backend: no session is seeded, so every
 * auth-gated query is disabled. This waits for the editor, then asserts zero
 * Supabase REST/auth requests — with a stale project id pre-seeded, covering
 * the regression where leftover project selection re-enabled queries.
 */
export async function openEditor(page: Page): Promise<void> {
  const issues = collectPageLogs(page);
  const forbiddenRequests: string[] = [];
  const notFoundResponses: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/(supabase\.co|127\.0\.0\.1:54321|localhost:54321|\/auth\/v1\/|\/rest\/v1\/|\/functions\/v1\/)/.test(url)) {
      forbiddenRequests.push(url);
    }
  });
  page.on('response', (response) => {
    if (response.status() === 404) notFoundResponses.push(response.url());
  });
  // Pre-seed a stale project selection: local mode must not let leftover
  // project state re-enable backend queries (the regression Codex flagged).
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('reigh.lastSelectedProjectId', 'stale-project-from-earlier-session');
    } catch {
      // storage unavailable — the assertion below still covers the happy path
    }
  });
  await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(EDITOR_SETTLE_MS);
  const localTestSnapshot = await page.evaluate(() => window.__REIGH_LOCAL_TEST__);
  if (
    !localTestSnapshot?.enabled
    || !Array.isArray(localTestSnapshot.diagnostics.loader)
    || !Array.isArray(localTestSnapshot.diagnostics.runtime)
  ) {
    throw new Error('localTest=1 did not initialize structured window.__REIGH_LOCAL_TEST__ diagnostics');
  }
  if (forbiddenRequests.length > 0) {
    throw new Error(`local-test editor made forbidden remote requests:\n${[...new Set(forbiddenRequests)].join('\n')}`);
  }
  const backendCalls = await page.evaluate(() => {
    const urls = performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /(supabase\.co|127\.0\.0\.1:54321|localhost:54321)/.test(n));
    return urls.length;
  });
  if (backendCalls > 0) {
    throw new Error(`local-mode editor made ${backendCalls} backend request(s); local mode must be backend-free`);
  }
  // The local Astrid capability probe intentionally asks the bridge for a
  // sentinel media row and receives 404. Keep that expected negative probe
  // visible in the network audit, while refusing every other missing asset.
  const unexpectedNotFound = notFoundResponses.filter(
    (url) => !url.includes('/api/astrid/projects/demo-project/media/__reigh_capability_probe__/content'),
  );
  if (unexpectedNotFound.length > 0) {
    throw new Error(`local-test editor made unexpected 404 request(s):\n${[...new Set(unexpectedNotFound)].join('\n')}`);
  }
  const expected404ConsoleText = '[console.error] Failed to load resource: the server responded with a status of 404 (Not Found)';
  for (let i = 0; i < notFoundResponses.length - unexpectedNotFound.length; i += 1) {
    const index = issues.indexOf(expected404ConsoleText);
    if (index < 0) break;
    issues.splice(index, 1);
  }
  assertNoUnexpectedPageErrors(issues);
}

/**
 * Selection is published as `data-selected="true"` on the clip root
 * (`ClipAction.tsx` via `clipActionAttrs`), so this reads the DOM contract, not
 * the accent-border classes a theming change would silently move.
 */
export function countSelectedClips(page: Page): Promise<number> {
  return page.evaluate(
    (selector) => document.querySelectorAll(selector).length,
    SELECTED_CLIP_SELECTOR as string,
  );
}

export interface ElementBox { x: number; y: number; w: number; h: number; cx: number; cy: number }

/** Rounded viewport box of the first match, or null. */
export function boxOf(page: Page, selector: string): Promise<ElementBox | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, selector);
}

/**
 * Pick a clip that is on screen and has room to its right on its own track.
 *
 * The timeline resolves an overlapping drop by snapping back to the nearest free
 * slot, which for a packed neighbour is the clip's own origin — so dragging any
 * other clip would measure the packing rule rather than the gesture.
 */
export function pickFreeDraggableClip(page: Page) {
  return page.evaluate((selectors: { editArea: string; clipWithId: string }) => {
    const area = document.querySelector(selectors.editArea)?.getBoundingClientRect();
    if (!area) return null;
    const clips = Array.from(document.querySelectorAll(selectors.clipWithId)).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-clip-id'),
        row: el.getAttribute('data-row-id'),
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      };
    });
    const onScreen = clips.filter((c) => c.x + c.w / 2 > area.left && c.x + c.w / 2 < area.right - 40);
    const free = onScreen.find((c) => !clips.some(
      (other) => other.id !== c.id && other.row === c.row && other.x > c.x && other.x < c.x + c.w + 140,
    ));
    return free ?? onScreen[0] ?? clips[0] ?? null;
  }, { editArea: EDIT_AREA_SELECTOR as string, clipWithId: CLIP_BODY_SELECTOR as string });
}
