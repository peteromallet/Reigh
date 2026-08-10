/**
 * Desktop timeline: structural layout + mouse interaction.
 *
 * Ported from the untracked `node_modules/.probe/interact.mjs` device probe.
 * See `support.ts` for what this covers that the jsdom conformance suite cannot.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageLogs,
  countSelectedClips,
  openEditor,
  resetBridgeBaseline,
} from './support';

test.describe('timeline desktop interaction', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('renders and responds to mouse interaction on desktop', async ({ context, page }, testInfo) => {
    test.setTimeout(180_000);

    const logs: string[] = [];
    const resetError = await resetBridgeBaseline();
    if (resetError) logs.push(resetError);
    logs.push(...collectPageLogs(page));

    await openEditor(page);

    const geom = await page.evaluate(() => {
      const q = (s: string) => document.querySelector(s);
      const rect = (el: Element | null) => (el
        ? (({ x, y, width, height }) => ({
            x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height),
          }))(el.getBoundingClientRect())
        : null);
      const grid = q('main.grid');
      return {
        gridRows: grid ? getComputedStyle(grid).gridTemplateRows : null,
        preview: rect(q('[data-testid="video-editor-preview-surface"]')),
        playhead: rect(q('[data-testid="timeline-playhead"]')),
        tracks: Array.from(document.querySelectorAll('[data-track-id]'))
          .map((el) => ({ id: el.getAttribute('data-track-id'), ...rect(el)! })),
        clips: Array.from(document.querySelectorAll('[data-clip-id]'))
          .map((el) => ({ id: el.getAttribute('data-clip-id'), ...rect(el)! })),
        rulerTicks: Array.from(document.querySelectorAll('main.grid *'))
          .filter((el) => /^\d:\d\d\.\d\d$/.test(el.textContent?.trim() ?? '')).length,
      };
    });

    await test.step('preview surface has non-zero height', async () => {
      expect(geom.preview?.h ?? 0, JSON.stringify(geom.preview)).toBeGreaterThan(200);
    });

    await test.step('timeline tracks rendered', async () => {
      expect(geom.tracks.map((t) => `${t.id}:${t.h}px`).join(', ')).toBeTruthy();
      expect(geom.tracks.length).toBeGreaterThanOrEqual(3);
    });

    await test.step('every track has non-zero height', async () => {
      expect(geom.tracks.map((t) => t.h).filter((h) => h <= 10)).toEqual([]);
    });

    await test.step('clips rendered', async () => {
      expect(geom.clips.length, `${geom.clips.length} clip elements`).toBeGreaterThanOrEqual(4);
    });

    await test.step('clips have non-zero width', async () => {
      expect(geom.clips.map((c) => c.w).filter((w) => w <= 5)).toEqual([]);
    });

    await test.step('playhead rendered', async () => {
      expect(geom.playhead, JSON.stringify(geom.playhead)).not.toBeNull();
    });

    await test.step('time ruler ticks rendered', async () => {
      expect(geom.rulerTicks, `${geom.rulerTicks} ticks`).toBeGreaterThanOrEqual(5);
    });

    await test.step('grid declares 4 rows', async () => {
      expect((geom.gridRows ?? '').trim().split(/\s+/), geom.gridRows ?? '').toHaveLength(4);
    });

    await test.step('timeline fully inside viewport', async () => {
      expect(geom.tracks.map((t) => t.y + t.h).filter((bottom) => bottom > 1000)).toEqual([]);
    });

    // --- interaction: select a clip ---------------------------------------
    const firstClip = page.locator('[data-clip-id]').first();
    const clipId = await firstClip.getAttribute('data-clip-id');
    await firstClip.click({ timeout: 8_000 });
    await page.waitForTimeout(1_500);

    const inspector = await page.evaluate(() => {
      const placeholder = Array.from(document.querySelectorAll('div'))
        .find((d) => /select a clip to edit timing/i.test(d.textContent ?? '') && d.children.length === 0);
      return { placeholderStillShown: Boolean(placeholder), body: document.body.innerText.slice(0, 4_000) };
    });

    await test.step('clicking a clip selects it', async () => {
      expect(
        /timing|position|duration|start/i.test(inspector.body) && !inspector.placeholderStillShown,
        `clip=${clipId}`,
      ).toBe(true);
    });

    await test.step('selection state reflected on a clip', async () => {
      expect(await countSelectedClips(page)).toBeGreaterThanOrEqual(1);
    });

    await page.screenshot({
      path: testInfo.outputPath('interact-selected.png'),
      animations: 'disabled',
      timeout: 20_000,
    });

    // --- interaction: zoom -------------------------------------------------
    const clipWidth = () => page.evaluate(
      () => document.querySelector('[data-clip-id]')?.getBoundingClientRect().width ?? 0,
    );
    const beforeZoom = await clipWidth();
    await page.locator('button[aria-label="Zoom in timeline"]').first().click({ timeout: 5_000 });
    await page.waitForTimeout(1_200);
    const afterZoom = await clipWidth();

    await test.step('zoom in widens clips', async () => {
      expect(afterZoom, `${Math.round(beforeZoom)} -> ${Math.round(afterZoom)}`).toBeGreaterThan(beforeZoom);
    });

    // --- interaction: playback ---------------------------------------------
    const clockText = () => page.evaluate(
      () => document.body.innerText.match(/\d:\d\d\.\d\d/)?.[0] ?? null,
    );
    const timeBefore = await clockText();
    await page.locator('button[aria-label*="play" i], button[title*="play" i]').first().click({ timeout: 5_000 });
    await page.waitForTimeout(2_500);
    const timeAfter = await clockText();

    await test.step('playback advances the clock', async () => {
      expect(
        Boolean(timeBefore && timeAfter && timeBefore !== timeAfter),
        `${timeBefore} -> ${timeAfter} :: ${[...new Set(logs)].join(' | ')}`,
      ).toBe(true);
    });

    await page.screenshot({
      path: testInfo.outputPath('interact-final.png'),
      animations: 'disabled',
      timeout: 20_000,
    });
  });
});
