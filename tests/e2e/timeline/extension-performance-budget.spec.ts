import { expect, test, type BrowserContext } from '@playwright/test';
import { resetBridgeBaseline } from './support';

const EDITOR_URL = '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline'
  + '&localTest=1&timelineOverlayCanary=1&transcriptLaneFixture=render-matrix'
  + '&runawayTimelineProject=runaway-8085';
const RUNAWAY_REQUEST = '**/api/astrid/v1/projects/runaway-8085/runaway-transitions?*';
const PROJECT_DATA_PATH = /\/api\/astrid\/v1\/projects\/demo-project\/timelines\/demo-timeline(?:\/registry)?$/;
const BRIDGE_DATA_PATH = new RegExp(
  `${PROJECT_DATA_PATH.source}|/api/astrid/v1/projects/[^/]+/runaway-transitions$`,
);

const BUDGET = {
  readyMs: 30_000,
  hydrationMs: 20_000,
  serializedProjectDataBytes: 1 * 1024 * 1024,
  managerMs: 3_000,
  contributionCount: 128,
  commandSearchMs: 1_500,
  virtualScrollMs: 2_000,
  quietWindowMs: 5_000,
  quietBridgeRequests: 4,
  burstBridgeRequests: 4,
  domNodes: 5_000,
  heapBytes: 256 * 1024 * 1024,
  heapGrowthBytes: 64 * 1024 * 1024,
} as const;

type PerformanceMetric = { name: string; value: number };

async function readHeapBytes(
  cdp: Awaited<ReturnType<BrowserContext['newCDPSession']>>,
): Promise<number | null> {
  try {
    await cdp.send('HeapProfiler.collectGarbage');
  } catch {
    // HeapProfiler is Chromium-specific; keep the absolute metric assertion
    // when forced GC is unavailable in another browser.
  }
  const rawMetrics = await cdp.send('Performance.getMetrics');
  const metrics = Object.fromEntries(
    (rawMetrics.metrics as PerformanceMetric[]).map(({ name, value }) => [name, value]),
  );
  return typeof metrics.JSHeapUsedSize === 'number' ? metrics.JSHeapUsedSize : null;
}

test.describe('extension performance and resource budgets', () => {
  test.use({ viewport: { width: 1_440, height: 900 } });

  test('bounds startup, activation, command search, virtualization, DOM, and heap', async ({ context, page }, testInfo) => {
    test.setTimeout(120_000);
    expect(await resetBridgeBaseline()).toBeNull();
    await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));

    const issues: string[] = [];
    const bridgeDataRequests: string[] = [];
    const projectDataBodies: Promise<number>[] = [];
    page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') issues.push(`[console.error] ${message.text()}`);
    });
    page.on('request', (request) => {
      if (BRIDGE_DATA_PATH.test(new URL(request.url()).pathname)) {
        bridgeDataRequests.push(request.url());
      }
    });
    page.on('response', (response) => {
      if (response.request().method() === 'GET'
        && PROJECT_DATA_PATH.test(new URL(response.url()).pathname)) {
        projectDataBodies.push(response.body().then((body) => body.byteLength).catch(() => 0));
      }
    });

    const readyStartedAt = Date.now();
    const response = await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    expect(response?.ok()).toBe(true);
    await expect(page.locator('[data-lane-kind="reigh.transcript"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-lane-kind="reigh.runaway.transitions"]')).toBeVisible();
    await expect(page.getByText(/566 transitions/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Transcript actions' })).toBeVisible();
    await expect(page.getByTestId('runaway-timeline-lane')).toHaveAttribute('data-total-items', '566');
    const readyMs = Date.now() - readyStartedAt;
    const navigationTiming = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return { domContentLoadedEventEnd: entry?.domContentLoadedEventEnd ?? 0 };
    });
    const readyNow = await page.evaluate(() => performance.now());
    const hydrationMs = Math.max(0, readyNow - navigationTiming.domContentLoadedEventEnd);
    await expect.poll(() => projectDataBodies.length, {
      message: 'the local bridge must expose a serialized timeline payload',
      timeout: 5_000,
    }).toBeGreaterThan(0);
    const projectDataBytes = Math.max(0, ...(await Promise.all(projectDataBodies)));
    expect(projectDataBytes, 'timeline project data must have a measurable serialized payload').toBeGreaterThan(0);
    expect(hydrationMs).toBeLessThanOrEqual(BUDGET.hydrationMs);
    expect(projectDataBytes).toBeLessThanOrEqual(BUDGET.serializedProjectDataBytes);

    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const heapBeforeBytes = await readHeapBytes(cdp);

    const virtualScrollStartedAt = Date.now();
    await page.locator('.timeline-canvas-edit-area').evaluate((scroller) => {
      scroller.scrollLeft = scroller.scrollWidth;
      scroller.dispatchEvent(new Event('scroll'));
    });
    await expect(page.getByTestId('runaway-timeline-lane')).toHaveAttribute('data-window-end', '566');
    const virtualScrollMs = Date.now() - virtualScrollStartedAt;

    const managerStartedAt = Date.now();
    await page.getByRole('tab', { name: 'Extensions' }).click();
    await expect(page.getByRole('button', { name: /^(Disable|Enable) com\.reigh\./ })).toHaveCount(13);
    const managerMs = Date.now() - managerStartedAt;

    const commandStartedAt = Date.now();
    await page.keyboard.press('ControlOrMeta+Shift+P');
    const commandInput = page.getByPlaceholder('Type a command…');
    await expect(commandInput).toBeVisible();
    await commandInput.fill('Drop Foley Cue Scaffolds');
    await expect(page.getByText('Drop Foley Cue Scaffolds', { exact: true })).toBeVisible();
    const commandSearchMs = Date.now() - commandStartedAt;
    await page.keyboard.press('Escape');

    const contributionCount = (await page.locator('[data-video-editor-extension-package-id]').allTextContents())
      .reduce((total, text) => total + [...text.matchAll(/\b(\d+) contributions?\b/g)]
        .reduce((subtotal, match) => subtotal + Number(match[1]), 0), 0);
    expect(contributionCount).toBeGreaterThan(0);
    expect(contributionCount).toBeLessThanOrEqual(BUDGET.contributionCount);

    const requestsBeforeBurst = bridgeDataRequests.length;
    await page.locator('.timeline-canvas-edit-area').evaluate((scroller) => {
      const end = scroller.scrollWidth;
      for (let index = 0; index < 24; index += 1) {
        // Keep the burst at the already-realized end position so the assertion
        // remains about request coalescing, not a race with window relocation.
        scroller.scrollLeft = index === 23 ? end : Math.max(0, end - (index % 3));
        scroller.dispatchEvent(new Event('scroll'));
      }
    });
    await expect(page.getByTestId('runaway-timeline-lane')).toHaveAttribute('data-window-end', '566');
    const burstBridgeRequests = bridgeDataRequests.length - requestsBeforeBurst;
    expect(burstBridgeRequests).toBeLessThanOrEqual(BUDGET.burstBridgeRequests);

    const quietWindowStart = bridgeDataRequests.length;
    await page.waitForTimeout(BUDGET.quietWindowMs);
    const quietBridgeRequests = bridgeDataRequests.length - quietWindowStart;
    expect(quietBridgeRequests).toBeLessThanOrEqual(BUDGET.quietBridgeRequests);

    const dom = await page.evaluate(() => ({
      nodes: document.getElementsByTagName('*').length,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      mountedRunaway: document.querySelectorAll('[data-testid="runaway-transition-chip"]').length,
    }));
    const heapAfterBytes = await readHeapBytes(cdp);
    const heapGrowthBytes = heapBeforeBytes === null || heapAfterBytes === null
      ? null
      : Math.max(0, heapAfterBytes - heapBeforeBytes);
    if (heapGrowthBytes !== null) {
      expect(heapGrowthBytes).toBeLessThanOrEqual(BUDGET.heapGrowthBytes);
    }
    await cdp.detach();

    const evidence = {
      budgets: BUDGET,
      observed: {
        readyMs,
        hydrationMs,
        serializedProjectDataBytes: projectDataBytes,
        managerMs,
        contributionCount,
        commandSearchMs,
        virtualScrollMs,
        burstBridgeRequests,
        quietBridgeRequests,
        domNodes: dom.nodes,
        mountedRunaway: dom.mountedRunaway,
        heapBytes: heapAfterBytes,
        heapGrowthBytes,
      },
    };
    await testInfo.attach('extension-performance-budget.json', {
      body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
      contentType: 'application/json',
    });
    console.info(`[extension-performance] ${JSON.stringify(evidence.observed)}`);

    expect(readyMs, JSON.stringify(evidence)).toBeLessThanOrEqual(BUDGET.readyMs);
    expect(managerMs, JSON.stringify(evidence)).toBeLessThanOrEqual(BUDGET.managerMs);
    expect(commandSearchMs, JSON.stringify(evidence)).toBeLessThanOrEqual(BUDGET.commandSearchMs);
    expect(virtualScrollMs, JSON.stringify(evidence)).toBeLessThanOrEqual(BUDGET.virtualScrollMs);
    expect(dom.nodes, JSON.stringify(evidence)).toBeLessThanOrEqual(BUDGET.domNodes);
    expect(dom.mountedRunaway).toBeLessThanOrEqual(128);
    expect(dom.bodyWidth).toBeLessThanOrEqual(dom.viewportWidth);
    if (heapAfterBytes !== null) {
      expect(heapAfterBytes, JSON.stringify(evidence)).toBeLessThanOrEqual(BUDGET.heapBytes);
    }
    expect(issues).toEqual([]);
  });

  test('bounds an aborted bridge load and exposes a recoverable degraded state', async ({ page }) => {
    test.setTimeout(60_000);
    let requests = 0;
    const issues: string[] = [];
    page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') issues.push(`[console.error] ${message.text()}`);
    });
    await page.route(RUNAWAY_REQUEST, async (route) => {
      requests += 1;
      await route.abort('internetdisconnected');
    });
    await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
    await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const state = page.getByTestId('runaway-load-state');
    await expect(state).toHaveAttribute('data-status', 'error', { timeout: 20_000 });
    await expect(page.getByTestId('runaway-retry')).toBeVisible();
    expect(requests).toBe(1);
    expect(issues).toEqual([]);
  });
});
