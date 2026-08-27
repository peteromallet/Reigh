import { expect, test } from '@playwright/test';
import { BASE_URL, PROJECT_SLUG, TIMELINE_SLUG } from './support';

const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&transcriptLaneFixture=dense`;
const CAPABILITY_PROBE_PATH = `/api/astrid/projects/${PROJECT_SLUG}/media/__reigh_capability_probe__/content`;

test.setTimeout(60_000);

const RUNAWAY_SCALE_CASES = [
  { count: 5_000, project: 'runaway-scale-5000', lastManifestId: 'T5000', pages: 5 },
  { count: 50_000, project: 'runaway-scale-50000', lastManifestId: 'T50000', pages: 50 },
] as const;

interface DataLaneTrajectorySample {
  readonly phase: string;
  readonly frame: number;
  readonly scrollLeft: number;
  readonly mounted: number;
  readonly visibleIntersections: number;
  readonly windowStart: number;
  readonly windowEnd: number;
}

/**
 * Collect one sample on every browser animation frame while real horizontal
 * wheel input is in flight. Keeping this in the E2E suite matters: a settled
 * `scrollLeft` assertion cannot see the one-frame stale virtualization state
 * that users report during trackpad/wheel motion.
 */
async function collectWheelTrajectory(
  page: import('@playwright/test').Page,
  phase: string,
  deltas: readonly number[],
): Promise<readonly DataLaneTrajectorySample[]> {
  const durationMs = Math.max(500, deltas.length * 24 + 250);
  const tracePromise = page.evaluate(async ({ phase: samplePhase, durationMs: sampleDuration }) => {
    const editArea = document.querySelector<HTMLElement>('.timeline-canvas-edit-area');
    const row = document.querySelector<HTMLElement>('[data-lane-kind="reigh.runaway.transitions"]');
    if (!editArea || !row) throw new Error('Runaway lane trajectory requires a mounted editor row');
    const label = row.querySelector<HTMLElement>('[title="Runaway transitions"]')?.parentElement;
    const samples: DataLaneTrajectorySample[] = [];
    const startedAt = performance.now();
    let frame = 0;
    await new Promise<void>((resolve) => {
      const sample = () => {
        const scrollerRect = editArea.getBoundingClientRect();
        const visibleLeft = label?.getBoundingClientRect().right ?? scrollerRect.left;
        const visibleRight = scrollerRect.right;
        const chips = Array.from(row.querySelectorAll<HTMLElement>('[data-testid="runaway-transition-chip"]'));
        const visibleIntersections = chips.filter((chip) => {
          const rect = chip.getBoundingClientRect();
          return rect.right > visibleLeft && rect.left < visibleRight;
        }).length;
        samples.push({
          phase: samplePhase,
          frame,
          scrollLeft: editArea.scrollLeft,
          mounted: chips.length,
          visibleIntersections,
          windowStart: Number(row.dataset.windowStart ?? -1),
          windowEnd: Number(row.dataset.windowEnd ?? -1),
        });
        frame += 1;
        if (performance.now() - startedAt >= sampleDuration) {
          resolve();
        } else {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    });
    return samples;
  }, { phase, durationMs });

  for (const deltaX of deltas) {
    await page.mouse.wheel(deltaX, 0);
    await page.waitForTimeout(8);
  }
  return tracePromise;
}

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

test('keeps Runaway data visible on every frame of fast, edge, reverse, and slow wheel trajectories', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1_280, height: 800 });
  await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
  await page.goto(
    `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}`
      + '&localTest=1&timelineOverlayCanary=1&transcriptLaneFixture=1&runawayTimelineProject=runaway-8085',
    { waitUntil: 'domcontentloaded', timeout: 45_000 },
  );

  const row = page.locator('[data-lane-kind="reigh.runaway.transitions"]');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toHaveAttribute('data-total-items', '566', { timeout: 30_000 });
  const scroller = page.locator('.timeline-canvas-edit-area');
  const box = await scroller.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await scroller.evaluate((element) => { element.scrollLeft = 0; });
  await page.waitForTimeout(100);

  const trajectories = [
    { name: 'fast-right', deltas: Array.from({ length: 32 }, () => 500) },
    { name: 'right-edge', deltas: Array.from({ length: 8 }, () => 1_200) },
    { name: 'fast-reverse', deltas: Array.from({ length: 32 }, () => -500) },
    { name: 'slow-right', deltas: Array.from({ length: 40 }, () => 120) },
  ] as const;
  const samples: DataLaneTrajectorySample[] = [];
  const phasePositions: Array<{ name: string; before: number; after: number; max: number }> = [];
  for (const { name, deltas } of trajectories) {
    const before = await scroller.evaluate((element) => element.scrollLeft);
    const phaseSamples = await collectWheelTrajectory(page, name, deltas);
    samples.push(...phaseSamples);
    const after = await scroller.evaluate((element) => element.scrollLeft);
    const max = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
    phasePositions.push({ name, before, after, max });
    if (name === 'fast-right' || name === 'right-edge' || name === 'slow-right') {
      expect(after, `${name} must move right`).toBeGreaterThan(before);
    } else {
      expect(after, `${name} must move left`).toBeLessThan(before);
    }
    if (name === 'right-edge') expect(after).toBeGreaterThanOrEqual(max - 1);
  }
  await testInfo.attach('runaway-wheel-trajectory-positions.json', {
    body: JSON.stringify(phasePositions, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('runaway-wheel-trajectory.json', {
    body: JSON.stringify(samples, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('runaway-wheel-trajectory.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  expect(samples.length).toBeGreaterThan(40);
  expect(samples.every((sample) => sample.mounted <= 128)).toBe(true);
  const blankFrames = samples.filter((sample) => sample.visibleIntersections === 0);
  expect(blankFrames, `zero-visible-intersection frames: ${JSON.stringify(blankFrames.slice(0, 8))}`).toEqual([]);
});

test.describe('Runaway extension interval scale gate', () => {
  for (const { count, project, lastManifestId, pages } of RUNAWAY_SCALE_CASES) {
    test(`${count.toLocaleString()} intervals load, scroll, and select late items`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1_280, height: 800 });
      const runawayRequests: string[] = [];
      const issues: string[] = [];
      page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
          issues.push(`[console.error] ${message.text()}`);
        }
      });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === `/api/astrid/v1/projects/${project}/runaway-transitions`) {
          runawayRequests.push(request.url());
        }
      });

      await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
      await page.goto(
        `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}`
          + `&localTest=1&timelineOverlayCanary=1&transcriptLaneFixture=1`
          + `&runawayTimelineProject=${project}`,
        { waitUntil: 'domcontentloaded', timeout: 45_000 },
      );

      const row = page.locator('[data-lane-kind="reigh.runaway.transitions"]');
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row).toHaveAttribute('data-total-items', String(count), { timeout: 30_000 });
      const lane = row.getByTestId('runaway-timeline-lane');
      await expect(lane).toHaveAttribute('data-total-items', String(count), { timeout: 30_000 });
      await expect.poll(() => runawayRequests.length, { timeout: 30_000 }).toBe(pages);

      const scroller = page.locator('.timeline-canvas-edit-area');
      const earlyWindowStart = Number(await row.getAttribute('data-window-start'));
      const initialMounted = await row.getByTestId('runaway-transition-chip').count();
      expect(initialMounted).toBeGreaterThan(0);
      expect(initialMounted).toBeLessThanOrEqual(128);

      const zoomIn = page.getByRole('button', { name: 'Zoom in timeline' }).first();
      for (let index = 0; index < 30; index += 1) await zoomIn.click();
      const maxScrollLeft = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(maxScrollLeft).toBeGreaterThan(1_000);
      await scroller.evaluate((element, left) => { element.scrollLeft = left; }, maxScrollLeft);
      await expect.poll(async () => Number(await row.getAttribute('data-window-start')), { timeout: 30_000 })
        .toBeGreaterThan(earlyWindowStart);

      const lateChip = row.getByTestId('runaway-transition-chip').last();
      await expect(lateChip).toHaveAttribute('data-item-id', `${lastManifestId}@timeline`, { timeout: 30_000 });
      expect(await row.getByTestId('runaway-transition-chip').count()).toBeLessThanOrEqual(128);
      expect(await row.evaluate((element) => element.querySelectorAll('*').length)).toBeLessThanOrEqual(512);

      await lateChip.click();
      const inspector = page.getByTestId('runaway-transition-inspector');
      await expect(inspector).toBeVisible({ timeout: 15_000 });
      await expect(inspector).toContainText(`${lastManifestId} · S10`);
      await expect(inspector).toContainText(`${count} typed transitions`);

      // Scrolling is a local viewport operation: once the paginated source is
      // loaded, neither selecting nor moving to a late window may re-fetch it.
      expect(runawayRequests).toHaveLength(pages);
      expect(issues).toEqual([]);
    });
  }
});
