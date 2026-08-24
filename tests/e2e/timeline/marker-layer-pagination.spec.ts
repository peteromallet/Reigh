import { expect, test } from '@playwright/test';
import { BASE_URL, PROJECT_SLUG, TIMELINE_SLUG, browserEvidencePath } from './support';

const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&timelineOverlayCanary=1`;

test('declutters composed marker layers into deterministic accessible pages', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const issues: string[] = [];
  page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(`[console.error] ${message.text()}`);
  });
  await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
  await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  const legend = page.getByTestId('timeline-marker-layer-legend');
  await expect(legend).toBeVisible({ timeout: 20_000 });
  await expect(legend).toContainText(/Layers 1–6\/\d+/);
  const firstKeys = await page.locator('[data-testid="timeline-marker-layer"]')
    .evaluateAll((layers) => layers.map((layer) => layer.getAttribute('data-marker-layer-key')));
  expect(firstKeys.length).toBeGreaterThan(0);
  expect(firstKeys.length).toBeLessThanOrEqual(6);
  expect(new Set(firstKeys).size).toBe(firstKeys.length);
  const legendBox = await legend.boundingBox();
  expect(legendBox).not.toBeNull();
  expect(legendBox!.x + legendBox!.width).toBeLessThanOrEqual(1200);
  await page.screenshot({ path: browserEvidencePath(testInfo, 'chrome-acceptance/25-marker-layers-page-1.png'), fullPage: true });

  await page.getByRole('button', { name: 'Next marker layers' }).click();
  await expect(legend).toHaveAttribute('data-marker-layer-page', '1');
  const secondKeys = await page.locator('[data-testid="timeline-marker-layer"]')
    .evaluateAll((layers) => layers.map((layer) => layer.getAttribute('data-marker-layer-key')));
  expect(secondKeys.length).toBeGreaterThan(0);
  expect(secondKeys.length).toBeLessThanOrEqual(6);
  expect(secondKeys.some((key) => firstKeys.includes(key))).toBe(false);
  await page.screenshot({ path: browserEvidencePath(testInfo, 'chrome-acceptance/26-marker-layers-page-2.png'), fullPage: true });
  expect(issues).toEqual([]);
});

test('uses the three-layer ruler budget on a phone viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
  await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const legend = page.getByTestId('timeline-marker-layer-legend');
  await expect(legend).toBeVisible({ timeout: 20_000 });
  await expect(legend).toContainText(/Layers 1–3\/\d+/);
  await expect(page.locator('[data-testid="timeline-marker-layer"]')).toHaveCount(3);
  await page.screenshot({ path: browserEvidencePath(testInfo, 'chrome-acceptance/27-marker-layers-phone.png'), fullPage: true });
});
