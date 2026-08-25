import { expect, test } from '@playwright/test';
import { BASE_URL, PROJECT_SLUG, TIMELINE_SLUG, browserEvidencePath } from './support';

const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&transcriptLaneFixture=1`;
const CAPABILITY_PROBE_PATH = `/api/astrid/projects/${PROJECT_SLUG}/media/__reigh_capability_probe__/content`;

const EXPECTED_TRANSCRIPT_ACTION_LABELS = [
  'Render transcript as editable video text',
  'Regenerate transcript captions and replace edits',
  'Propose caption edits back to transcript source',
  'Accept pending caption edits for transcript source update',
  'Reject pending caption edits for transcript source update',
] as const;

const viewports = [
  { name: 'desktop', width: 1440, height: 900, screenshot: '22-lane-actions-desktop.png' },
  { name: 'tablet', width: 768, height: 900, screenshot: '23-lane-actions-tablet.png' },
  { name: 'phone', width: 390, height: 844, screenshot: '24-lane-actions-phone.png' },
] as const;

for (const viewport of viewports) {
  test(`keeps the host lane-action affordance visible at ${viewport.name} width`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
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
    const trigger = row.getByRole('button', { name: 'Transcript actions' });
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await page.locator('.timeline-canvas-edit-area').evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    await expect(trigger).toBeInViewport();
    const triggerBox = await trigger.boundingBox();
    const scrollerBox = await page.locator('.timeline-canvas-edit-area').boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(scrollerBox).not.toBeNull();
    expect(triggerBox!.x).toBeGreaterThanOrEqual(Math.max(0, scrollerBox!.x) - 1);
    expect(
      triggerBox!.x + triggerBox!.width,
      JSON.stringify({ triggerBox, scrollerBox, viewport }),
    ).toBeLessThanOrEqual(
      Math.min(viewport.width, scrollerBox!.x + scrollerBox!.width) + 1,
    );
    if (viewport.name === 'phone') {
      const rail = row.getByTestId('data-lane-action-rail');
      const [railBox, chipBox, railBackground] = await Promise.all([
        rail.boundingBox(),
        row.getByTestId('transcript-lane-chip').first().boundingBox(),
        rail.evaluate((element) => getComputedStyle(element).backgroundColor),
      ]);
      expect(railBox).not.toBeNull();
      expect(chipBox).not.toBeNull();
      expect(railBackground).not.toBe('rgba(0, 0, 0, 0)');
      expect(railBox!.width).toBeGreaterThanOrEqual(79);
      expect(railBox!.x).toBeLessThanOrEqual(triggerBox!.x);
      expect(
        railBox!.x + railBox!.width,
        JSON.stringify({ railBox, triggerBox, viewport }),
      ).toBeGreaterThanOrEqual(triggerBox!.x + triggerBox!.width);
      const visibleChipLeft = Math.max(chipBox!.x, scrollerBox!.x);
      const visibleChipRight = Math.min(chipBox!.x + chipBox!.width, railBox!.x);
      expect(
        visibleChipRight - visibleChipLeft,
        JSON.stringify({ chipBox, railBox, triggerBox, viewport }),
      ).toBeGreaterThan(20);
      expect(visibleChipRight).toBeLessThanOrEqual(triggerBox!.x - 1);
    }

    const triggerCenter = {
      x: triggerBox!.x + triggerBox!.width / 2,
      y: triggerBox!.y + triggerBox!.height / 2,
    };
    const hit = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        trigger: target?.closest('[data-testid="data-lane-actions-trigger"]') !== null,
        target: target?.outerHTML.slice(0, 300) ?? null,
      };
    }, triggerCenter);
    expect(hit.trigger, JSON.stringify({ hit, triggerBox, scrollerBox })).toBe(true);
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Transcript actions' });
    await expect(menu).toBeVisible();
    const menuItems = menu.getByRole('menuitem');
    await expect(menuItems).toHaveCount(EXPECTED_TRANSCRIPT_ACTION_LABELS.length);
    const accessibleLabels = await menuItems.evaluateAll((items) => items.map(
      (item) => item.getAttribute('aria-label') ?? item.textContent?.trim() ?? '',
    ));
    expect(accessibleLabels).toEqual([...EXPECTED_TRANSCRIPT_ACTION_LABELS]);
    for (const label of EXPECTED_TRANSCRIPT_ACTION_LABELS) {
      const item = menu.getByRole('menuitem', { name: label, exact: true });
      await expect(item).toBeVisible();
      await expect(item).toBeEnabled();
      const itemBox = await item.boundingBox();
      expect(itemBox, label).not.toBeNull();
      expect(itemBox!.x).toBeGreaterThanOrEqual(0);
      expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    await menuItems.first().focus();
    await expect(menuItems.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menuItems.nth(1)).toBeFocused();
    await page.screenshot({ path: browserEvidencePath(testInfo, `chrome-acceptance/${viewport.screenshot}`), fullPage: true });
    expect(issues).toEqual([]);
  });
}
