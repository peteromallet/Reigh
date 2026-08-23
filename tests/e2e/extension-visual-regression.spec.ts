import { expect, test, type Page, type Route } from '@playwright/test';
import { resetBridgeBaseline } from './timeline/support';

const COMPOSED_URL = '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline'
  + '&localTest=1&timelineOverlayCanary=1&transcriptLaneFixture=render-matrix'
  + '&runawayTimelineProject=runaway-8085';
const DEGRADED_PROJECT = 'runaway-visual-states';
const DEGRADED_URL = '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline'
  + `&localTest=1&transcriptLaneFixture=render-matrix&runawayTimelineProject=${DEGRADED_PROJECT}`;
const RUNAWAY_REQUEST = `**/api/astrid/v1/projects/${DEGRADED_PROJECT}/runaway-transitions?*`;

const emptyResponse = {
  api_version: 'v1',
  project: DEGRADED_PROJECT,
  count: 0,
  total_count: 0,
  snapshot: `runaway-v1:${DEGRADED_PROJECT}:visual`,
  page: { limit: 1000, next_cursor: null },
  timing_summary: {
    evidence_id: 'visual-state-evidence',
    run_id: 'visual-state-run',
    summary: 'Deterministic visual-state fixture',
    created_at: '2026-08-23T00:00:00Z',
    data: { frame_count: 0, transition_count: 0, fps: 48, segment_counts: {} },
  },
  transitions: [],
};

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 },
] as const;

test.describe.configure({ mode: 'serial' });

async function initializeLocalMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.removeItem('reigh.dev-extensions.disabled');
  });
}

async function stabilizeTimeline(page: Page): Promise<void> {
  const stabilizingCss = `
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }
      .timeline-scroll { scrollbar-width: none !important; }
      .timeline-scroll::-webkit-scrollbar { display: none !important; }
    `;
  // Local bridge discovery can perform one startup navigation while an editor
  // route settles. Retry the idempotent freeze against the final document.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.addStyleTag({ content: stabilizingCss });
      await page.evaluate(async () => {
        for (const video of document.querySelectorAll('video')) video.pause();
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
      });
      break;
    } catch (error) {
      if (attempt === 2 || !String(error).includes('Execution context was destroyed')) throw error;
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(200);
    }
  }
  const surface = page.locator('.timeline-wrapper');
  await expect(surface).toBeVisible();
  await page.locator('.timeline-canvas-edit-area').evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(100);
}

async function expectTimelineSnapshot(page: Page, name: string): Promise<void> {
  await stabilizeTimeline(page);
  await expect(page.locator('.timeline-wrapper')).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    threshold: 0.2,
    maxDiffPixelRatio: 0.005,
  });
}

async function openComposedEditor(page: Page): Promise<void> {
  expect(await resetBridgeBaseline()).toBeNull();
  await initializeLocalMode(page);
  const response = await page.goto(COMPOSED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('[data-lane-kind="reigh.transcript"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('runaway-timeline-lane')).toHaveAttribute('data-total-items', '566');
  await expect.poll(() => page.getByTestId('runaway-transition-chip').count()).toBeGreaterThan(0);
  expect(await page.getByTestId('runaway-transition-chip').count()).toBeLessThanOrEqual(128);
  await expect(page.getByTestId('timeline-marker-layer-legend')).toBeVisible();
}

async function expectDensityLabelClearOfRunawayChips(page: Page): Promise<void> {
  const intersections = await page.locator('[data-lane-kind="reigh.runaway.transitions"]').evaluate((lane) => {
    const density = lane.querySelector('[data-testid="data-lane-density-summary"]');
    if (!density) return -1;
    const summary = density.getBoundingClientRect();
    return [...lane.querySelectorAll('[data-testid="runaway-transition-chip"]')].filter((chip) => {
      const rect = chip.getBoundingClientRect();
      return Math.min(summary.right, rect.right) > Math.max(summary.left, rect.left)
        && Math.min(summary.bottom, rect.bottom) > Math.max(summary.top, rect.top);
    }).length;
  });
  expect(intersections, 'the host density label must not cover selectable Runaway chips').toBe(0);
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'X-Astrid-Bridge-Version': 'v1' },
    body: JSON.stringify(body),
  });
}

for (const viewport of viewports) {
  test(`matches the composed extension timeline at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openComposedEditor(page);
    await expect(page.getByTestId('runaway-lane-summary')).toHaveCount(0);
    await expectDensityLabelClearOfRunawayChips(page);
    await expectTimelineSnapshot(page, `composed-${viewport.name}.png`);
  });
}

test('matches the Runaway loading state', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(RUNAWAY_REQUEST, async (route) => {
    await gate;
    await fulfillJson(route, emptyResponse);
  });
  await initializeLocalMode(page);
  await page.goto(DEGRADED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByTestId('runaway-load-state')).toHaveAttribute('data-status', 'loading');
  await expectTimelineSnapshot(page, 'runaway-loading.png');
  release();
  await expect(page.getByTestId('runaway-load-state')).toHaveAttribute('data-status', 'empty');
});

test('matches the Runaway empty state', async ({ page }) => {
  await page.route(RUNAWAY_REQUEST, (route) => fulfillJson(route, emptyResponse));
  await initializeLocalMode(page);
  await page.goto(DEGRADED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByTestId('runaway-load-state')).toHaveAttribute('data-status', 'empty');
  await expectTimelineSnapshot(page, 'runaway-empty.png');
});

test('matches the Runaway malformed-response error state', async ({ page }) => {
  await page.route(RUNAWAY_REQUEST, (route) => fulfillJson(route, { ...emptyResponse, transitions: 'malformed' }));
  await initializeLocalMode(page);
  await page.goto(DEGRADED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByTestId('runaway-load-state')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('runaway-retry')).toBeVisible();
  await expectTimelineSnapshot(page, 'runaway-error.png');
});
