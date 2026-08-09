/**
 * Tablet timeline: mode reachability, touch clip-drag, and the marquee gesture.
 *
 * Ported from the untracked `node_modules/.probe/ipad.mjs` device probe, run in
 * both orientations. The marquee step is deliberately last: when the select-mode
 * edit area loses its `touch-action` rule the browser claims that drag as its
 * back-navigation swipe and the tab leaves the editor, so anything after it
 * would be measuring `about:blank`.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageLogs,
  countSelectedClips,
  createTouchInput,
  openEditor,
  pickFreeDraggableClip,
  resetBridgeBaseline,
  seedFakeSession,
} from './support';

const IPAD_USER_AGENT = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  + ' (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const ORIENTATIONS = [
  { name: 'portrait', viewport: { width: 834, height: 1194 }, tag: 'ipad-port' },
  { name: 'landscape', viewport: { width: 1180, height: 820 }, tag: 'ipad-land' },
] as const;

for (const orientation of ORIENTATIONS) {
  test.describe(`timeline tablet gestures (${orientation.name})`, () => {
    test.use({
      viewport: orientation.viewport,
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      userAgent: IPAD_USER_AGENT,
    });

    test(`tablet ${orientation.name}: modes, drag and marquee under touch`, async ({ context, page }, testInfo) => {
      test.setTimeout(240_000);

      const logs: string[] = [];
      const resetError = await resetBridgeBaseline();
      if (resetError) logs.push(resetError);
      await seedFakeSession(context);
      logs.push(...collectPageLogs(page));

      await openEditor(page);
      const touch = await createTouchInput(context, page);

      const shot = (name: string) => page.screenshot({
        path: testInfo.outputPath(`${orientation.tag}-${name}.png`),
        animations: 'disabled',
        timeout: 20_000,
      });

      // --- structural audit ------------------------------------------------
      const structure = await page.evaluate(() => {
        const rect = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const q = (s: string) => document.querySelector(s);
        const editArea = q('.timeline-canvas-edit-area');
        const preview = q('[data-testid="video-editor-preview-surface"]');
        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          phoneBar: Boolean(q('[aria-label="Phone timeline mode bar"]')),
          clips: Array.from(document.querySelectorAll('[data-clip-id]'))
            .map((el) => ({ id: el.getAttribute('data-clip-id'), ...rect(el) })),
          editArea: editArea ? rect(editArea) : null,
          preview: preview ? rect(preview) : null,
        };
      });

      testInfo.annotations.push({ type: 'viewport', description: JSON.stringify(structure.viewport) });
      testInfo.annotations.push({
        type: 'phone mode bar on tablet (expected false)',
        description: String(structure.phoneBar),
      });

      await test.step('clips render on tablet', async () => {
        expect(structure.clips.length, `${structure.clips.length}`).toBeGreaterThanOrEqual(3);
      });

      await test.step('preview has real height', async () => {
        expect(structure.preview?.h ?? 0, JSON.stringify(structure.preview)).toBeGreaterThan(150);
      });

      await test.step('timeline edit area visible', async () => {
        expect(structure.editArea?.h ?? 0, JSON.stringify(structure.editArea)).toBeGreaterThan(80);
      });

      await shot('base');

      // --- select (tablet default): tap -------------------------------------
      const c0 = structure.clips[0];
      if (c0) await touch.tap(c0.x + c0.w / 2, c0.y + c0.h / 2);
      const tapSelected = await countSelectedClips(page);

      await test.step('tablet default select: tap selects clip', async () => {
        expect(tapSelected, `${tapSelected} selected`).toBeGreaterThanOrEqual(1);
      });

      await shot('selected');

      // --- how do you reach move/trim on tablet? ----------------------------
      const modeUi = await page.evaluate(() => {
        const hits: { t: string; w: number; h: number; visible: boolean }[] = [];
        for (const el of document.querySelectorAll('button, [role="tab"], [role="radio"]')) {
          const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
          if (/^(browse|select|move|trim|precision)$/i.test(label) || /interaction mode/i.test(label)) {
            const r = el.getBoundingClientRect();
            hits.push({
              t: label.slice(0, 30),
              w: Math.round(r.width),
              h: Math.round(r.height),
              visible: r.width > 0 && r.height > 0,
            });
          }
        }
        return hits;
      });
      const visibleModeUi = modeUi.filter((m) => m.visible);

      await test.step('some visible way to switch interaction mode', async () => {
        expect(visibleModeUi.length, JSON.stringify(visibleModeUi)).toBeGreaterThanOrEqual(2);
      });

      await test.step('every switchable mode has a >=44px control on tablet', async () => {
        const missing = ['browse', 'select', 'move', 'trim', 'precision'].filter(
          (mode) => !visibleModeUi.some((m) => m.t.toLowerCase() === mode && m.h >= 44),
        );
        expect(missing, JSON.stringify(visibleModeUi.map((m) => `${m.t} ${m.w}x${m.h}`))).toEqual([]);
      });

      // --- move mode: switch via the switcher, then drag a clip -------------
      const moveButton = page.locator('button', { hasText: /^move$/i }).first();
      const moveVisible = await moveButton.isVisible().catch(() => false);
      expect(moveVisible, 'no visible Move control — drag not attempted').toBe(true);

      const moveBox = (await moveButton.boundingBox())!;
      await touch.tap(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
      const movePressed = await moveButton.getAttribute('aria-pressed');

      await test.step('tablet move mode: switcher marks Move active', async () => {
        expect(movePressed, `aria-pressed=${movePressed}`).toBe('true');
      });

      const scrollLeft = () => page.evaluate(
        () => document.querySelector('.timeline-canvas-edit-area')?.scrollLeft ?? -1,
      );
      const beforeMove = await pickFreeDraggableClip(page);
      expect(beforeMove, 'no clip found').not.toBeNull();
      const scrollBefore = await scrollLeft();
      await touch.touchDrag(
        beforeMove!.x + beforeMove!.w / 2, beforeMove!.y + beforeMove!.h / 2,
        beforeMove!.x + beforeMove!.w / 2 + 90, beforeMove!.y + beforeMove!.h / 2,
        { steps: 16 },
      );
      const afterMove = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? { x: el.getBoundingClientRect().x } : null;
      }, `.clip-action[data-clip-id="${beforeMove!.id}"]`);
      const scrollAfter = await scrollLeft();

      await test.step('tablet move mode: touch drag moves clip', async () => {
        expect(
          Boolean(afterMove) && Math.abs(afterMove!.x - beforeMove!.x) > 25 && scrollAfter === scrollBefore,
          `${beforeMove!.id} x ${Math.round(beforeMove!.x)} -> ${afterMove ? Math.round(afterMove.x) : 'gone'}, `
            + `scrollLeft ${scrollBefore} -> ${scrollAfter}`,
        ).toBe(true);
      });

      // --- marquee (tablet, select mode) ------------------------------------
      const selectButton = page.locator('button', { hasText: /^select$/i }).first();
      if (await selectButton.isVisible().catch(() => false)) {
        const sb = (await selectButton.boundingBox())!;
        await touch.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
      }
      const gestureMode = await page.evaluate(
        () => document.querySelector('.timeline-canvas-edit-area')?.getAttribute('data-touch-gesture-mode') ?? null,
      );

      await test.step('tablet select mode: edit area owns the marquee gesture', async () => {
        expect(gestureMode, `data-touch-gesture-mode=${gestureMode}`).toBe('marquee');
      });

      const ea = await page.evaluate(() => {
        const el = document.querySelector('.timeline-canvas-edit-area');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      });
      expect(ea, 'no edit area for the marquee drag').not.toBeNull();

      const startX = ea!.x + 160;
      const endX = ea!.x + Math.min(ea!.w - 20, 560);
      const startY = ea!.y + ea!.h - 12;
      const endY = ea!.y + 8;

      // Tap the empty canvas first so the count below is the marquee's work and
      // not whatever the move-mode drag left selected.
      await touch.tap(startX, startY);
      const beforeMarquee = await countSelectedClips(page);
      await touch.touchDrag(startX, startY, endX, endY, { steps: 16 });
      const shellAlive = await page.evaluate(() => Boolean(document.querySelector('main.grid')));
      const marqueeSelected = await countSelectedClips(page);

      await test.step('tablet marquee: shell survives the drag', async () => {
        expect(shellAlive, `url=${page.url()}`).toBe(true);
      });

      await test.step('tablet marquee: diagonal drag selects clips', async () => {
        expect(
          marqueeSelected,
          `${marqueeSelected} selected (${beforeMarquee} before the drag) :: ${[...new Set(logs)].join(' | ')}`,
        ).toBeGreaterThanOrEqual(1);
      });

      await shot('final');
    });
  });
}
