import { expect, test } from '@playwright/test';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BASE_URL,
  PROJECT_SLUG,
  TIMELINE_SLUG,
  resetBridgeBaseline,
} from './support';

const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&transcriptLaneFixture=1`;
const EVIDENCE = resolve(process.cwd(), 'docs/extensions/evidence/chrome-acceptance');

test.describe('caption materialization render and export', () => {
  test.use({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });

  test('renders the materialized transcript into a downloadable MP4 without font-stretch warning flood', async ({ page }) => {
    test.setTimeout(300_000);
    await mkdir(EVIDENCE, { recursive: true });
    expect(await resetBridgeBaseline()).toBeNull();

    const consoleWarnings: Array<{
      type: string;
      text: string;
      location: { url: string; lineNumber: number; columnNumber: number };
    }> = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        consoleWarnings.push({
          type: message.type(),
          text: message.text(),
          location: message.location(),
        });
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // CDP log metadata makes an upstream warning actionable if Chromium emits it.
    const cdp = await page.context().newCDPSession(page);
    const cdpLogEntries: Array<{
      source: string;
      level: string;
      text: string;
      url?: string;
      lineNumber?: number;
      stackTrace?: unknown;
    }> = [];
    await cdp.send('Log.enable');
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (/fontstretch|canvasfontstretch/i.test(entry.text)) {
        cdpLogEntries.push({
          source: entry.source,
          level: entry.level,
          text: entry.text,
          url: entry.url,
          lineNumber: entry.lineNumber,
          stackTrace: entry.stackTrace,
        });
      }
    });

    await page.addInitScript(() => {
      localStorage.removeItem('reigh.dev-extensions.disabled');
    });
    await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const transcriptRow = page.locator('[data-lane-kind="reigh.transcript"]');
    const actions = transcriptRow.getByRole('button', { name: 'Transcript actions' });
    await expect(actions).toBeVisible({ timeout: 20_000 });
    await page.locator('.timeline-canvas-edit-area').evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    await actions.click();
    await page.getByRole('menuitem', { name: 'Render transcript as editable video text' }).click();

    // Each logical caption can appear in several synchronized editor surfaces;
    // assert materialization, not an implementation-specific DOM multiplier.
    await expect.poll(
      () => page.locator('[data-clip-id^="transcript-caption-"]').count(),
      { timeout: 20_000 },
    ).toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: 'Render', exact: true }).click();

    const downloadLink = page.getByRole('link', { name: /download/i });
    await expect(downloadLink).toBeVisible({ timeout: 240_000 });
    await page.screenshot({
      path: resolve(EVIDENCE, '28-headless-remotion-4.0.503-render-complete.png'),
      fullPage: true,
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await downloadLink.click();
    const download = await downloadPromise;
    const outputPath = resolve(EVIDENCE, '28-headless-caption-render-remotion-4.0.503.mp4');
    await download.saveAs(outputPath);
    expect((await stat(outputPath)).size).toBeGreaterThan(100_000);
    expect((await readFile(outputPath)).subarray(4, 8).toString('ascii')).toBe('ftyp');

    const fontStretchWarnings = consoleWarnings.filter((message) => /fontstretch|canvasfontstretch/i.test(message.text));
    await writeFile(
      resolve(EVIDENCE, '28-render-console-diagnostics.json'),
      `${JSON.stringify({
        node: process.version,
        consoleWarnings,
        pageErrors,
        fontStretchWarnings,
        cdpFontStretchLogEntries: cdpLogEntries,
      }, null, 2)}\n`,
      'utf8',
    );
    expect(
      fontStretchWarnings,
      JSON.stringify({ fontStretchWarnings, cdpLogEntries }, null, 2),
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
