import { expect, test } from '@playwright/test';
import { BASE_URL, PROJECT_SLUG, TIMELINE_SLUG } from './support';

const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&transcriptLaneFixture=dense`;
const CAPABILITY_PROBE_PATH = `/api/astrid/projects/${PROJECT_SLUG}/media/__reigh_capability_probe__/content`;

test.setTimeout(60_000);

test('dense data lane paints late viewport items with bounded DOM and real geometry', async ({ page }, testInfo) => {
  // At the 100px/s zoom ceiling a 900px viewport spans the whole four-second
  // fixture. The sparse-window cap then quite correctly centers both the
  // origin and late scroll around the same 128 items. Keep the viewport narrow
  // enough that the two source windows are genuinely different.
  await page.setViewportSize({ width: 500, height: 760 });
  const issues: string[] = [];
  page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      issues.push(`[console.error] ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    let expectedProbe = false;
    try {
      expectedProbe = response.status() === 404 && new URL(response.url()).pathname === CAPABILITY_PROBE_PATH;
    } catch {
      // Keep malformed URLs actionable below.
    }
    if (response.status() >= 400 && !expectedProbe) {
      issues.push(`[http ${response.status()}] ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    let expectedProbeAbort = false;
    try {
      expectedProbeAbort = failure === 'net::ERR_ABORTED'
        && new URL(request.url()).pathname === CAPABILITY_PROBE_PATH;
    } catch {
      // Keep malformed URLs actionable below.
    }
    if (!expectedProbeAbort) {
      issues.push(`[requestfailed] ${request.url()} — ${failure}`);
    }
  });
  await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
  await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  const row = page.locator('[data-lane-kind="reigh.transcript"]');
  await expect(row).toBeVisible({ timeout: 20_000 });
  const scroller = page.locator('.timeline-canvas-edit-area');
  const zoomIn = page.getByRole('button', { name: 'Zoom in timeline' }).first();
  for (let index = 0; index < 30; index += 1) await zoomIn.click();

  await scroller.evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = element.scrollHeight;
  });
  const chips = row.locator('[data-testid="transcript-lane-chip"]');
  await expect.poll(() => chips.count()).toBeGreaterThan(0);
  const earlyIds = await chips.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-item-id')).filter(Boolean) as string[]);
  const earlyWindowStart = Number(await row.getAttribute('data-window-start'));

  const maxScrollLeft = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(maxScrollLeft).toBeGreaterThan(500);
  await scroller.evaluate((element) => { element.scrollLeft = 100; });
  await expect.poll(async () => Number(await row.getAttribute('data-viewport-start'))).toBeGreaterThan(0);
  const pixelsPerSecond = 100 / Number(await row.getAttribute('data-viewport-start'));
  // The fixture contributes 500 intervals across 0–4 source seconds. Target a
  // real late interval rather than the editor's intentionally empty runway.
  const lateScrollLeft = Math.min(maxScrollLeft, 3.5 * pixelsPerSecond);
  await scroller.evaluate((element, left) => { element.scrollLeft = left; }, lateScrollLeft);
  await expect.poll(async () => Number(await row.getAttribute('data-window-start')))
    .toBeGreaterThan(earlyWindowStart);
  await expect.poll(() => chips.count()).toBeGreaterThan(0);

  const lateIds = await chips.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-item-id')).filter(Boolean) as string[]);
  const lateWindowStart = Number(await row.getAttribute('data-window-start'));
  expect(lateWindowStart).toBeGreaterThan(earlyWindowStart);
  expect(lateIds.length).toBeGreaterThan(0);
  expect(lateIds.length).toBeLessThanOrEqual(128);
  expect(earlyIds.filter((id) => lateIds.includes(id))).toEqual([]);
  const totalItems = Number(await row.getAttribute('data-total-items'));
  expect(totalItems).toBeGreaterThan(128);

  const geometry = await page.evaluate(() => {
    const editArea = document.querySelector<HTMLElement>('.timeline-canvas-edit-area');
    const lane = document.querySelector<HTMLElement>('[data-lane-kind="reigh.transcript"]');
    const label = lane?.querySelector<HTMLElement>('[title="Transcript"]')?.parentElement;
    const itemRects = Array.from(
      lane?.querySelectorAll<HTMLElement>('[data-testid="transcript-lane-chip"]') ?? [],
      (element) => element.getBoundingClientRect(),
    );
    if (!editArea || !lane || !label) return null;
    const scrollerRect = editArea.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const visibleLeft = labelRect.right;
    const visibleRight = scrollerRect.right;
    return {
      scrollLeft: editArea.scrollLeft,
      maxScrollLeft: editArea.scrollWidth - editArea.clientWidth,
      mounted: itemRects.length,
      visibleIntersections: itemRects.filter((rect) => rect.right >= visibleLeft && rect.left <= visibleRight).length,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.scrollLeft).toBeGreaterThanOrEqual(lateScrollLeft - 1);
  expect(geometry!.mounted).toBeLessThanOrEqual(128);
  expect(geometry!.visibleIntersections).toBeGreaterThan(0);

  await testInfo.attach('dense-lane-late-scroll', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(issues).toEqual([]);
});
