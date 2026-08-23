import { expect, test, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';
import { BASE_URL, PROJECT_SLUG, TIMELINE_SLUG } from './support';

const PROJECT = 'runaway-browser-recovery';
const RUNAWAY_REQUEST = `**/api/astrid/v1/projects/${PROJECT}/runaway-transitions?*`;
const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&runawayTimelineProject=${PROJECT}`;
const EVIDENCE = resolve(process.cwd(), 'docs/extensions/evidence/chrome-acceptance');

const validResponse = {
  api_version: 'v1',
  project: PROJECT,
  count: 2,
  total_count: 2,
  snapshot: `runaway-v1:${PROJECT}:browser-recovery`,
  page: { limit: 1000, next_cursor: null },
  timing_summary: {
    evidence_id: 'browser-recovery-evidence',
    run_id: 'browser-recovery-run',
    summary: 'Browser recovery fixture',
    created_at: '2026-08-23T00:00:00Z',
    data: {
      frame_count: 96,
      transition_count: 2,
      fps: 48,
      segment_counts: { S01: 1, S02: 1 },
    },
  },
  transitions: [
    {
      id: 'browser-row-1',
      run_id: 'browser-recovery-run',
      task_id: null,
      ordinal: 0,
      start_ms: 0,
      duration_ms: 1000,
      prompt: 'rose recovery chord',
      metadata: {
        manifest_id: 'T0001', segment_id: 'S01', segment_label: 'Opening',
        timing_mode: 'hard_cut', colour_name: 'rose', colour_hex: '#D47795',
        frame: 0, fps: 48,
      },
      created_at: '2026-08-23T00:00:00Z',
    },
    {
      id: 'browser-row-2',
      run_id: 'browser-recovery-run',
      task_id: null,
      ordinal: 1,
      start_ms: 1000,
      duration_ms: 1000,
      prompt: 'teal recovery chord',
      metadata: {
        manifest_id: 'T0002', segment_id: 'S02', segment_label: 'Recovery',
        timing_mode: 'hold', colour_name: 'teal', colour_hex: '#26A7D0',
        frame: 48, fps: 48,
      },
      created_at: '2026-08-23T00:00:00Z',
    },
  ],
};

function collectIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(`[console.error] ${message.text()}`);
  });
  return issues;
}

async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.removeItem('reigh.dev-extensions.disabled');
  });
  await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__REIGH_LOCAL_TEST__))).toBe(true);
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'X-Astrid-Bridge-Version': 'v1' },
    body: JSON.stringify(body),
  });
}

test.describe('Runaway typed timeline degraded-state recovery', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shows loading then an explicit empty state without console/page errors', async ({ page }) => {
    const issues = collectIssues(page);
    await page.route(RUNAWAY_REQUEST, async (route) => {
      await new Promise((done) => setTimeout(done, 1_500));
      await fulfillJson(route, {
        ...validResponse,
        count: 0,
        total_count: 0,
        transitions: [],
      });
    });
    await openEditor(page);

    const state = page.getByTestId('runaway-load-state');
    await expect(state).toHaveAttribute('data-status', 'loading');
    await page.screenshot({ path: resolve(EVIDENCE, '17-runaway-loading.png'), fullPage: true });
    await expect(state).toHaveAttribute('data-status', 'empty', { timeout: 10_000 });
    await expect(state).toContainText(`No Runaway transitions were found for ${PROJECT}.`);
    await page.screenshot({ path: resolve(EVIDENCE, '18-runaway-empty.png'), fullPage: true });
    expect(issues).toEqual([]);
  });

  test('shows malformed-data error once and manually retries cleanly', async ({ page }) => {
    const issues = collectIssues(page);
    let requests = 0;
    await page.route(RUNAWAY_REQUEST, async (route) => {
      requests += 1;
      await fulfillJson(route, requests === 1
        ? { ...validResponse, transitions: 'malformed' }
        : validResponse);
    });
    await openEditor(page);

    const state = page.getByTestId('runaway-load-state');
    await expect(state).toHaveAttribute('data-status', 'error');
    await expect(state).toContainText('Runaway bridge response must contain transitions[]');
    await expect(page.getByTestId('runaway-retry')).toBeVisible();
    await page.screenshot({ path: resolve(EVIDENCE, '19-runaway-malformed-retry.png'), fullPage: true });
    expect(requests).toBe(1);
    expect(issues).toEqual([]);

    await page.getByTestId('runaway-retry').click();
    await expect(page.getByTestId('runaway-transition-chip')).toHaveCount(2);
    await expect(state).toHaveCount(0);
    expect(requests).toBe(2);
    expect(issues).toEqual([]);
  });

  test('deduplicates an offline failure and automatically recovers on online', async ({ page }) => {
    const issues = collectIssues(page);
    let requests = 0;
    await page.route(RUNAWAY_REQUEST, async (route) => {
      requests += 1;
      if (requests === 1) {
        await route.abort('internetdisconnected');
        return;
      }
      await fulfillJson(route, validResponse);
    });
    await openEditor(page);

    const state = page.getByTestId('runaway-load-state');
    await expect(state).toHaveAttribute('data-status', 'error');
    await expect(page.getByTestId('runaway-retry')).toBeVisible();
    await page.screenshot({ path: resolve(EVIDENCE, '20-runaway-offline.png'), fullPage: true });
    expect(requests).toBe(1);
    expect(issues.filter((issue) => issue.includes('[Runaway Timeline Viewer]'))).toEqual([]);
    expect(issues.filter((issue) => issue.startsWith('[pageerror]'))).toEqual([]);

    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('runaway-transition-chip')).toHaveCount(2);
    await expect(state).toHaveCount(0);
    await page.screenshot({ path: resolve(EVIDENCE, '21-runaway-online-recovered.png'), fullPage: true });
    expect(requests).toBe(2);
    expect(issues.filter((issue) => issue.includes('[Runaway Timeline Viewer]'))).toEqual([]);
    expect(issues.filter((issue) => issue.startsWith('[pageerror]'))).toEqual([]);
  });
});
