import { expect, test } from '@playwright/test';
import { EDITOR_URL, collectPageLogs } from './support';

test('records an unhandled promise rejection as a page error', async ({ page }) => {
  const issues = collectPageLogs(page);
  await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  await page.evaluate(() => {
    setTimeout(() => {
      void Promise.reject(new Error('release-gate-unhandled-rejection-sentinel'));
    }, 0);
  });

  await expect.poll(
    () => issues.filter((issue) => issue.includes('release-gate-unhandled-rejection-sentinel')),
    { timeout: 5_000 },
  ).toEqual(['[pageerror] release-gate-unhandled-rejection-sentinel']);
});
