import { expect, test } from '@playwright/test';

const HARNESS_WARMUP_URL = '/tools/video-editor/harness'
  + '?scenario=populated&localTest=1'
  + '&localProject=extension-harness&localTimeline=extension-harness';

test.setTimeout(120_000);

test('prewarms the deterministic extension harness before parallel device gates', async ({ page }) => {
  const response = await page.goto(HARNESS_WARMUP_URL, {
    waitUntil: 'domcontentloaded',
  });

  expect(response?.ok()).toBe(true);
  await expect(page.locator('[data-video-editor-harness-ready="true"]')).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.locator('[data-video-editor-extension-trust-warning="true"]'),
  ).toBeVisible();
});
