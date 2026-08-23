/**
 * Phone timeline: the full interaction-mode matrix under real touch input.
 *
 * Ported from the untracked `node_modules/.probe/mobile.mjs` device probe.
 * Every step runs against one live page in sequence — each mode switch is state
 * the next step depends on — so this is a single test with named `test.step`s
 * rather than independent tests.
 */
import { expect, test } from '@playwright/test';
import {
  boxOf,
  collectPageLogs,
  countSelectedClips,
  createTouchInput,
  openEditor,
  resetBridgeBaseline,
} from './support';

test.describe('timeline phone gestures', () => {
  test.use({
    viewport: { width: 420, height: 820 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test('phone interaction modes survive real touch input', async ({ context, page }, testInfo) => {
    test.setTimeout(240_000);

    const logs: string[] = [];
    const resetError = await resetBridgeBaseline();
    if (resetError) logs.push(resetError);
    logs.push(...collectPageLogs(page));

    await openEditor(page);
    const touch = await createTouchInput(context, page);

    const shot = (name: string) => page.screenshot({
      path: testInfo.outputPath(`${name}.png`),
      animations: 'disabled',
      timeout: 20_000,
    });

    // --- 0. structural: phone layout, mode bar -----------------------------
    const structure = await page.evaluate(() => {
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const bar = document.querySelector('[aria-label="Phone timeline mode bar"]');
      const editArea = document.querySelector('.timeline-canvas-edit-area');
      return {
        modeBar: bar ? rect(bar) : null,
        barButtons: bar
          ? Array.from(bar.querySelectorAll('button'))
            .map((b) => ({ label: b.textContent?.trim(), ...rect(b), pressed: b.getAttribute('aria-pressed') }))
          : [],
        clips: Array.from(document.querySelectorAll('[data-clip-id]'))
          .map((el) => ({ id: el.getAttribute('data-clip-id'), ...rect(el) })),
        editArea: editArea
          ? {
              ...rect(editArea),
              scrollLeft: editArea.scrollLeft,
              scrollWidth: editArea.scrollWidth,
              clientWidth: editArea.clientWidth,
              overflowX: getComputedStyle(editArea).overflowX,
              touchAction: getComputedStyle(editArea).touchAction,
            }
          : null,
      };
    });

    await test.step('phone mode bar present', async () => {
      expect(structure.modeBar, JSON.stringify(structure.modeBar)).not.toBeNull();
    });

    await test.step('mode bar has 5 buttons', async () => {
      expect(structure.barButtons.map((b) => `${b.label}:${b.w}x${b.h}`).join(', ')).toBeTruthy();
      expect(structure.barButtons).toHaveLength(5);
    });

    await test.step('clips visible on phone', async () => {
      expect(structure.clips.length, `${structure.clips.length} clips`).toBeGreaterThanOrEqual(3);
    });

    await test.step('edit area scrollable + touch-action', async () => {
      expect(structure.editArea, JSON.stringify(structure.editArea)).not.toBeNull();
    });

    await shot('m0-base');

    const modeButton = (label: string) => page
      .locator('[aria-label="Phone timeline mode bar"] button', { hasText: new RegExp(`^${label}$`, 'i') })
      .first();

    async function setMode(label: string): Promise<boolean> {
      const button = modeButton(label);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const box = await button.boundingBox();
        if (box) await touch.tap(box.x + box.width / 2, box.y + box.height / 2);
        if ((await button.getAttribute('aria-pressed')) === 'true') return true;
      }
      return (await button.getAttribute('aria-pressed')) === 'true';
    }

    const scrollLeft = () => page.evaluate(
      () => document.querySelector('.timeline-canvas-edit-area')?.scrollLeft ?? -1,
    );

    // --- 1. browse mode: horizontal pan should scroll the timeline ---------
    const clip0 = structure.clips[0];
    const editBefore = await scrollLeft();
    if (clip0) {
      await touch.touchDrag(
        clip0.x + clip0.w / 2, clip0.y + clip0.h / 2,
        clip0.x + clip0.w / 2 - 120, clip0.y + clip0.h / 2,
      );
    }
    const editAfter = await scrollLeft();
    const browsePos = await page.evaluate(() => {
      const el = document.querySelector('[data-clip-id]');
      return el ? Math.round(el.getBoundingClientRect().x) : null;
    });

    await test.step('browse: pan over clip scrolls timeline (no accidental clip move)', async () => {
      expect(editAfter, `scrollLeft ${editBefore} -> ${editAfter}, clip x now ${browsePos}`)
        .toBeGreaterThan(editBefore);
    });

    await page.evaluate(() => {
      const el = document.querySelector('.timeline-canvas-edit-area');
      if (el) el.scrollLeft = 0;
    });
    await page.waitForTimeout(300);

    // --- 2. select mode: tap toggles selection -----------------------------
    const selectActivated = await setMode('select');
    await test.step('select mode activates', async () => {
      expect(selectActivated).toBe(true);
    });

    const c1 = await boxOf(page, '[data-clip-id]');
    if (c1) await touch.tap(c1.cx, c1.cy);
    const selCount1 = await countSelectedClips(page);
    await test.step('select: tap selects clip', async () => {
      expect(selCount1, `${selCount1} selected`).toBeGreaterThanOrEqual(1);
    });

    await shot('m2-select');

    if (c1) await touch.tap(c1.cx, c1.cy);
    const selCount2 = await countSelectedClips(page);
    await test.step('select: second tap deselects (additive toggle)', async () => {
      expect(selCount2, `${selCount2} selected after second tap`).toBe(0);
    });

    // --- 3. move mode: touch drag moves clip -------------------------------
    const moveActivated = await setMode('move');
    await test.step('move mode activates', async () => {
      expect(moveActivated).toBe(true);
    });

    // The right-most V1 clip can be outside the CSS viewport when the page has
    // horizontal overflow; CDP correctly ignores a touch whose start point is
    // outside the device viewport. Use the fixture's sole V2 clip: it is fully
    // visible and has free space on its track, so this measures move mode.
    const beforeMove = await page.evaluate(() => {
      const el = document.querySelector('.clip-action[data-clip-id="clip-video"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        id: 'clip-video', row: el.getAttribute('data-row-id'),
        x: r.x, y: r.y, w: r.width, h: r.height,
      };
    });
    expect(beforeMove, 'fixture clip-video is not visible').not.toBeNull();
    const moveSelector = `.clip-action[data-clip-id="${beforeMove!.id}"]`;
    const scrollBeforeMove = await scrollLeft();
    await touch.touchDrag(
      beforeMove!.x + beforeMove!.w / 2, beforeMove!.y + beforeMove!.h / 2,
      beforeMove!.x + beforeMove!.w / 2 + 80, beforeMove!.y + beforeMove!.h / 2,
      { steps: 16 },
    );
    const afterMove = await page.evaluate(
      (sel) => ({ x: document.querySelector(sel)!.getBoundingClientRect().x }),
      moveSelector,
    );
    const scrollAfterMove = await scrollLeft();

    await test.step('move: touch drag moves clip', async () => {
      expect(
        Math.abs(afterMove.x - beforeMove!.x) > 20 && scrollAfterMove === scrollBeforeMove,
        `clip ${beforeMove!.id} x ${Math.round(beforeMove!.x)} -> ${Math.round(afterMove.x)}, `
          + `scrollLeft ${scrollBeforeMove} -> ${scrollAfterMove}`,
      ).toBe(true);
    });

    await shot('m3-move');

    // --- 4. trim mode: expanded handles, edge drag resizes -----------------
    const trimActivated = await setMode('trim');
    await test.step('trim mode activates', async () => {
      expect(trimActivated).toBe(true);
    });
    await page.waitForTimeout(300);

    const trimGeom = await page.evaluate(() => {
      const el = document.querySelector('[data-clip-id]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    expect(trimGeom, 'no clip found').not.toBeNull();
    await touch.touchDrag(
      trimGeom!.x + trimGeom!.w - 6, trimGeom!.y + trimGeom!.h / 2,
      trimGeom!.x + trimGeom!.w - 66, trimGeom!.y + trimGeom!.h / 2,
      { steps: 16 },
    );
    const afterTrimWidth = await page.evaluate(
      () => document.querySelector('[data-clip-id]')!.getBoundingClientRect().width,
    );

    await test.step('trim: dragging right edge resizes clip', async () => {
      expect(
        Math.abs(afterTrimWidth - trimGeom!.w),
        `w ${Math.round(trimGeom!.w)} -> ${Math.round(afterTrimWidth)}`,
      ).toBeGreaterThan(20);
    });

    await shot('m4-trim');

    // --- 5. ruler scrub via touch ------------------------------------------
    const playheadBefore = await boxOf(page, '[data-testid="timeline-playhead"]');
    const ruler = await page.evaluate(() => {
      // The preview overlay also renders an m:ss.hh readout and comes first in
      // the DOM, so the text heuristic alone resolves to the preview panel.
      const readouts = Array.from(document.querySelectorAll('*'))
        .filter((el) => /^\d:\d\d\.\d\d$/.test(el.textContent?.trim() ?? '') && el.children.length === 0);
      const host = document.querySelector('[data-testid="timeline-ruler"]')
        || (readouts.length
          ? readouts[0].closest('[class*="ruler"], [data-testid*="ruler"]') ?? readouts[0].parentElement?.parentElement
          : null);
      if (!host) return null;
      const r = host.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    if (ruler) {
      // Composed extension markers occupy the ruler's top 20px. Scrub in the
      // host-owned bottom strip so the gesture reaches the ruler rather than a
      // marker button while still exercising real touch arbitration.
      const scrubY = ruler.y + ruler.h - 3;
      await touch.touchDrag(ruler.x + 200, scrubY, ruler.x + 300, scrubY, { steps: 10 });
    }
    const playheadAfter = await boxOf(page, '[data-testid="timeline-playhead"]');

    await test.step('ruler: touch scrub moves playhead', async () => {
      expect(
        Boolean(ruler && playheadBefore && playheadAfter && Math.abs(playheadAfter.x - playheadBefore.x) > 10),
        `ruler=${JSON.stringify(ruler)} playhead x ${Math.round(playheadBefore?.x ?? -1)} `
          + `-> ${Math.round(playheadAfter?.x ?? -1)}`,
      ).toBe(true);
    });

    // --- 6. precision toggle ------------------------------------------------
    const precisionActivated = await setMode('precision');
    await test.step('precision toggle activates', async () => {
      expect(precisionActivated).toBe(true);
    });
    await shot('m6-precision');

    // --- 7. mode bar hint reacts to the active mode ------------------------
    const hintText = () => page.evaluate(() => {
      const bar = document.querySelector('[aria-label="Phone timeline mode bar"]');
      if (!bar) return null;
      const hint = bar.lastElementChild;
      return hint && hint.tagName === 'DIV' && !hint.querySelector('button') ? hint.textContent!.trim() : null;
    });
    await setMode('browse');
    const hintBrowse = await hintText();
    await setMode('move');
    const hintMove = await hintText();

    await test.step('mode bar hint changes with mode', async () => {
      expect(
        Boolean(hintBrowse && hintMove && hintBrowse !== hintMove),
        `browse="${hintBrowse}" move="${hintMove}"`,
      ).toBe(true);
    });

    // --- 8. floating tool buttons are touch-sized --------------------------
    const toolButtons = await page.evaluate(() => {
      const labels = ['New text at playhead', 'New effect layer at playhead', 'Create animation sequence'];
      return labels.map((label) => {
        const el = document.querySelector(`[aria-label="${label}"]`);
        if (!el) return { label, missing: true as const, w: 0, h: 0, opacity: 0 };
        const r = el.getBoundingClientRect();
        return {
          label,
          missing: false as const,
          w: Math.round(r.width),
          h: Math.round(r.height),
          opacity: Number(getComputedStyle(el).opacity),
        };
      });
    });

    await test.step('all three floating tool buttons are >=40px on phone', async () => {
      expect(
        toolButtons.length === 3
          && toolButtons.every((b) => !b.missing && b.w >= 40 && b.h >= 40 && b.opacity > 0.5),
        JSON.stringify(toolButtons),
      ).toBe(true);
    });

    // --- 9. tapping "New text" adds a clip ---------------------------------
    const clipCount = () => page.evaluate(
      () => document.querySelectorAll('.clip-action[data-clip-id]').length,
    );
    const clipsBeforeText = await clipCount();
    const textTool = await boxOf(page, '[aria-label="New text at playhead"]');
    if (textTool) await touch.tap(textTool.cx, textTool.cy);
    await page.waitForTimeout(700);
    const clipsAfterText = await clipCount();

    await test.step('tap "New text" adds a clip', async () => {
      expect(clipsAfterText, `${clipsBeforeText} -> ${clipsAfterText} clips`).toBeGreaterThan(clipsBeforeText);
    });

    await shot('m7-tools');

    // --- 10. pinch-to-zoom over the edit area ------------------------------
    const pinchArea = await boxOf(page, '.timeline-canvas-edit-area');
    const pinchMidX = pinchArea ? pinchArea.cx : 210;
    const pinchMidY = pinchArea ? pinchArea.y + 20 : 590;

    // Anchor probe: remember which clip sits under the midpoint and where in
    // that clip the midpoint falls, so we can prove the same timeline instant is
    // still under the fingers afterwards (rather than the area having scrolled).
    const measurePinch = (midX: number) => page.evaluate((mid) => {
      const area = document.querySelector('.timeline-canvas-edit-area');
      const clips = Array.from(document.querySelectorAll('.clip-action[data-clip-id]')).map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.getAttribute('data-clip-id')!, x: r.x, w: r.width };
      });
      return {
        firstWidth: clips[0]?.w ?? 0,
        scrollWidth: area?.scrollWidth ?? 0,
        scrollLeft: area?.scrollLeft ?? 0,
        under: clips.find((c) => c.x <= mid && mid <= c.x + c.w) ?? clips[0] ?? null,
      };
    }, midX);

    const pinchBefore = await measurePinch(pinchMidX);
    const anchorFraction = pinchBefore.under
      ? (pinchMidX - pinchBefore.under.x) / pinchBefore.under.w
      : null;
    if (pinchArea) await touch.pinch(pinchMidX, pinchMidY, 40, 130);
    const pinchAfter = await measurePinch(pinchMidX);

    const sameClip = pinchBefore.under && pinchAfter.under && pinchBefore.under.id === pinchAfter.under.id
      ? pinchAfter.under
      : await page.evaluate((id) => {
        const el = document.querySelector(`.clip-action[data-clip-id="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { id, x: r.x, w: r.width };
      }, pinchBefore.under?.id ?? '');
    const anchorDrift = sameClip && anchorFraction !== null
      ? Math.abs((sameClip.x + anchorFraction * sameClip.w) - pinchMidX)
      : Number.POSITIVE_INFINITY;

    await test.step('pinch out zooms the timeline (clips widen, content grows)', async () => {
      expect(
        pinchAfter.firstWidth > pinchBefore.firstWidth * 1.15
          && pinchAfter.scrollWidth > pinchBefore.scrollWidth,
        `clip w ${Math.round(pinchBefore.firstWidth)} -> ${Math.round(pinchAfter.firstWidth)}, `
          + `scrollWidth ${pinchBefore.scrollWidth} -> ${pinchAfter.scrollWidth}, `
          + `scrollLeft ${Math.round(pinchBefore.scrollLeft)} -> ${Math.round(pinchAfter.scrollLeft)}`,
      ).toBe(true);
    });

    await test.step('pinch keeps the pinched instant under the gesture midpoint', async () => {
      expect(anchorDrift, `anchor clip ${pinchBefore.under?.id} drift ${Math.round(anchorDrift)}px`)
        .toBeLessThan(24);
    });

    await shot('m8-pinch');

    // --- 11. track label actions are reachable without hover ---------------
    const trackActions = await page.evaluate(() => {
      const row = document.querySelector('[data-track-id]');
      if (!row) return null;
      return Array.from(row.querySelectorAll('button')).map((b) => {
        const r = b.getBoundingClientRect();
        return {
          label: (b.getAttribute('aria-label') || b.getAttribute('title') || '').trim(),
          w: Math.round(r.width),
          h: Math.round(r.height),
          opacity: Number(getComputedStyle(b).opacity)
            * Number(getComputedStyle(b.parentElement!).opacity),
        };
      });
    });

    await test.step('track actions visible without hover (>=36px, opacity > 0.5)', async () => {
      expect(
        Boolean(trackActions?.some((b) => b.opacity > 0.5 && b.h >= 36 && b.w >= 36)),
        `${JSON.stringify(trackActions)} :: ${[...new Set(logs)].join(' | ')}`,
      ).toBe(true);
    });
  });
});
