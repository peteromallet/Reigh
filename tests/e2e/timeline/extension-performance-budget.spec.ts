import { expect, test } from '@playwright/test';
import { resetBridgeBaseline } from './support';

const EDITOR_URL = '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline'
  + '&localTest=1&timelineOverlayCanary=1&transcriptLaneFixture=render-matrix'
  + '&runawayTimelineProject=runaway-8085';

const BUDGET = {
  readyMs: 30_000,
  managerMs: 3_000,
  commandSearchMs: 1_500,
  virtualScrollMs: 2_000,
  domNodes: 5_000,
  heapBytes: 256 * 1024 * 1024,
} as const;

test.describe('extension performance and resource budgets', () => {
  test.use({ viewport: { width: 1_440, height: 900 } });

  test('bounds startup, activation, command search, virtualization, DOM, and heap', async ({ context, page }, testInfo) => {
    test.setTimeout(120_000);
    expect(await resetBridgeBaseline()).toBeNull();
    await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));

    const issues: string[] = [];
    page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') issues.push(`[console.error] ${message.text()}`);
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

    const dom = await page.evaluate(() => ({
      nodes: document.getElementsByTagName('*').length,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      mountedRunaway: document.querySelectorAll('[data-testid="runaway-transition-chip"]').length,
    }));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const rawMetrics = await cdp.send('Performance.getMetrics');
    const metrics = Object.fromEntries(rawMetrics.metrics.map(({ name, value }) => [name, value]));
    await cdp.detach();

    const evidence = {
      budgets: BUDGET,
      observed: {
        readyMs,
        managerMs,
        commandSearchMs,
        virtualScrollMs,
        domNodes: dom.nodes,
        mountedRunaway: dom.mountedRunaway,
        heapBytes: metrics.JSHeapUsedSize ?? null,
        taskDurationSeconds: metrics.TaskDuration ?? null,
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
    expect(metrics.JSHeapUsedSize, JSON.stringify(evidence)).toBeLessThanOrEqual(BUDGET.heapBytes);
    expect(issues).toEqual([]);
  });
});
