import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { BASE_URL, PROJECT_SLUG, TIMELINE_SLUG } from './support';

const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&transcriptLaneFixture=1`;
const EVIDENCE = resolve(process.cwd(), 'docs/extensions/evidence/chrome-acceptance');

const viewports = [
  { name: 'desktop', width: 1440, height: 900, screenshot: '22-lane-actions-desktop.png' },
  { name: 'tablet', width: 768, height: 900, screenshot: '23-lane-actions-tablet.png' },
  { name: 'phone', width: 390, height: 844, screenshot: '24-lane-actions-phone.png' },
] as const;

for (const viewport of viewports) {
  test(`keeps the host lane-action affordance visible at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const issues: string[] = [];
    page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') issues.push(`[console.error] ${message.text()}`);
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
    await expect(menu.getByRole('menuitem')).toHaveCount(3);
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.screenshot({ path: resolve(EVIDENCE, viewport.screenshot), fullPage: true });
    expect(issues).toEqual([]);
  });
}
