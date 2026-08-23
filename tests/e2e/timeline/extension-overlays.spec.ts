/**
 * Extension timeline overlays — the `?timelineOverlayCanary=1` DEV canary,
 * across desktop (mouse), tablet (touch), and phone (touch).
 *
 * This is the real-browser half of T9.1 (plan step 22 + rollout
 * qualification). The jsdom suites bind the host, marker layer, pointer
 * arbitration and pinch refusal to DOM contracts; this spec drives the REAL
 * scene-phase-markers canary end to end against a live dev server:
 *
 *   - the overlay stays dark without the canary query and mounts with it,
 *   - passive timeline gestures (clip select/drag, ruler scrub) behave
 *     identically while overlays are mounted but unclaimed,
 *   - marker drag commits exactly once and lands on the frame grid,
 *   - marker content geometry tracks `startLeft + time * pps` across zoom
 *     and scroll (the ruler-strip translateX(-scrollLeft) contract),
 *   - drag-to-edge auto-scrolls the edit area,
 *   - a second-finger pinch is refused while a marker owns the gesture and
 *     works again once the claim is released (touch marker-versus-pinch),
 *   - disabling the extension MID-DRAG terminates the session cleanly
 *     (no commit, no stuck gesture owner, editor stays interactive).
 *
 * One command: `npm run test:e2e:timeline` (boots the dev server + bridge
 * stub via `playwright.config.ts` webServer entries).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  BASE_URL,
  BRIDGE_ORIGIN,
  EDITOR_SETTLE_MS,
  PROJECT_SLUG,
  TIMELINE_SLUG,
  collectPageLogs,
  countSelectedClips,
  createTouchInput,
  CLIP_ACTION_WITH_ID_SELECTOR,
  openEditor,
  pickFreeDraggableClip,
  resetBridgeBaseline,
  type TouchInput,
} from './support';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCENE_PHASE_EXTENSION_ID = 'com.reigh.scene-phase-markers';
const CANARY_PARAM = 'timelineOverlayCanary=1';
const CANARY_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&${CANARY_PARAM}`;
const BRIDGE_TIMELINE = `${BRIDGE_ORIGIN}/projects/${PROJECT_SLUG}/timelines/${TIMELINE_SLUG}`;
const EDIT_AREA_SELECTOR = '.timeline-canvas-edit-area';
const STRIP_SELECTOR = '[data-testid="timeline-extension-ruler-overlay-strip"]';
const DISABLE_TOGGLE_SELECTOR = `[data-video-editor-dev-local-toggle="${SCENE_PHASE_EXTENSION_ID}"]`;
const SCENE_MARKER_LAYER_SELECTOR =
  `[data-testid="timeline-marker-layer"][data-marker-layer-key="${SCENE_PHASE_EXTENSION_ID}:scene-markers-overlay"]`;

/** Stable marker fixture — the canary renders these on the ruler. */
const MARKERS = [
  { id: 'e2e-marker-a', time: 1 },
  { id: 'e2e-marker-b', time: 3 },
  { id: 'e2e-marker-c', time: 5 },
];

function sceneMarkerLayer(page: Page) {
  return page.locator(SCENE_MARKER_LAYER_SELECTOR);
}

async function expectMarkerLayerComposition(page: Page, expectedTotal: number): Promise<void> {
  const legend = page.getByTestId('timeline-marker-layer-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText(`/${expectedTotal}`);
  const previous = legend.getByRole('button', { name: 'Previous marker layers' });
  const next = legend.getByRole('button', { name: 'Next marker layers' });

  for (let guard = 0; guard < expectedTotal && !(await previous.isDisabled()); guard += 1) {
    await previous.click();
  }
  await expect(previous).toBeDisabled();

  const seenLayerKeys = new Set<string>();
  for (let guard = 0; guard < expectedTotal; guard += 1) {
    await expect(legend).toContainText(`/${expectedTotal}`);
    const layerKeys = await page.locator('[data-testid="timeline-marker-layer"]')
      .evaluateAll((layers) => layers.map((layer) => layer.getAttribute('data-marker-layer-key')));
    expect(layerKeys.length).toBeGreaterThan(0);
    for (const key of layerKeys) {
      expect(key).not.toBeNull();
      seenLayerKeys.add(key!);
    }

    if (await next.isDisabled()) break;
    const oldLabel = await legend.textContent();
    await next.click();
    await expect.poll(() => legend.textContent()).not.toBe(oldLabel);
  }

  expect(seenLayerKeys.size).toBe(expectedTotal);
  while (!(await previous.isDisabled())) {
    await previous.click();
  }
}

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

/**
 * Restore the stub's clip baseline and then seed the canary's marker data.
 * `resetBridgeBaseline` replaces the config wholesale (dropping `app`), so
 * seeding must always happen after it.
 */
async function seedSceneMarkers(markers: Array<{ id: string; time: number }> = MARKERS): Promise<string | null> {
  try {
    const current = await (await fetch(BRIDGE_TIMELINE)).json();
    const config = {
      ...(current.config ?? {}),
      app: {
        ...(current.config?.app ?? {}),
        [SCENE_PHASE_EXTENSION_ID]: { sceneMarkers: markers },
      },
    };
    const response = await fetch(`${BRIDGE_TIMELINE}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    return response.ok ? null : `[seed] ${response.status}`;
  } catch (error) {
    return `[seed] ${(error as Error).message}`;
  }
}

/**
 * Open the editor with the canary query. Clears the dev-local disable store
 * and editor zoom preference once per page session so each test starts from a
 * known state while a later Vite reload preserves the disabled state that the
 * test intentionally established.
 */
async function openCanaryEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const initializedKey = 'reigh.e2e.extension-overlays.initialized';
      if (window.sessionStorage.getItem(initializedKey) !== '1') {
        window.localStorage.removeItem('reigh.dev-extensions.disabled');
        window.localStorage.removeItem('video-editor:preferences:demo-timeline');
        window.sessionStorage.setItem(initializedKey, '1');
      }
    } catch {
      // storage unavailable — defaults apply
    }
  });
  await page.goto(CANARY_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(EDITOR_SETTLE_MS);
}

interface RulerMetrics {
  /** Pixels per second, measured from two adjacent ruler labels. */
  pps: number;
  /** Ruler content origin (`startLeft`), derived from the time-0 label. */
  startLeft: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * Derive the timeline's live time→pixel geometry from the ruler labels
 * (`translateX(tick.left + 6)` on each major label) instead of importing
 * internals. Both label and marker coordinates live in the same
 * ruler-translated content space, so `startLeft + time * pps` is directly
 * comparable to a marker's strip-relative content x.
 */
async function rulerMetrics(page: Page): Promise<RulerMetrics> {
  return page.evaluate((editAreaSelector) => {
    const parse = (text: string): number => {
      const match = /^(\d+):(\d\d)\.(\d\d)$/.exec(text);
      if (!match) return 0;
      return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 100;
    };
    const ruler = document.querySelector('[data-testid="timeline-ruler"]');
    const rulerX = ruler?.getBoundingClientRect().x ?? 0;
    const scrollArea = document.querySelector(editAreaSelector);
    const scrollLeft = scrollArea?.scrollLeft ?? 0;
    const labels = Array.from(document.querySelectorAll('[data-testid="timeline-ruler"] span'))
      .map((el) => ({ text: el.textContent?.trim() ?? '', x: el.getBoundingClientRect().x }))
      .filter((label) => /^\d+:\d\d\.\d\d$/.test(label.text))
      .sort((a, b) => a.x - b.x);

    let pps = 0;
    let startLeft = 0;
    if (labels.length >= 2) {
      const first = labels[0];
      const second = labels[1];
      const dt = parse(second.text) - parse(first.text);
      const dx = second.x - first.x;
      pps = dt > 0 ? dx / dt : 0;
      startLeft = first.x - rulerX + scrollLeft - 6 - parse(first.text) * pps;
    }

    return {
      pps,
      startLeft,
      scrollLeft,
      scrollWidth: scrollArea?.scrollWidth ?? 0,
      clientWidth: scrollArea?.clientWidth ?? 0,
    };
  }, EDIT_AREA_SELECTOR);
}

/**
 * Ensure the ruler shows at least `min` major time labels so rulerMetrics can
 * derive pps. Narrow viewports (phone) may show only one label at default
 * zoom. Zoom OUT at most 3 steps (keeps pps > 10 for the spec's assertion),
 * then scroll the edit area right to reveal later labels without changing pps.
 */
async function ensureRulerLabels(page: Page, min = 2): Promise<void> {
  const zoomOut = page.getByRole('button', { name: 'Zoom out timeline' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const count = await rulerLabelCount(page);
    if (count >= min) return;
    if (await zoomOut.count()) {
      await zoomOut.first().click();
      await page.waitForTimeout(250);
    }
  }
  for (let scroll = 0; scroll < 4; scroll += 1) {
    if ((await rulerLabelCount(page)) >= min) return;
    await page.evaluate((selector) => {
      const area = document.querySelector(selector) as HTMLElement | null;
      if (area) area.scrollLeft += area.clientWidth / 2;
    }, EDIT_AREA_SELECTOR);
    await page.waitForTimeout(200);
  }
}

/** Count of major `m:ss.ff` labels currently visible on the ruler. */
async function rulerLabelCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ruler = document.querySelector('[data-testid="timeline-ruler"]');
    if (!ruler) return 0;
    return Array.from(ruler.querySelectorAll('span'))
      .filter((el) => /^\d+:\d\d\.\d\d$/.test(el.textContent?.trim() ?? ''))
      .length;
  });
}

/**
 * Marker content x in the ruler strip's own coordinate space. The strip is
 * translated `translateX(-scrollLeft)` by the host, so this value is
 * scroll-independent and must equal `startLeft + time * pps`.
 */
async function markerContentX(page: Page, markerId: string): Promise<number | null> {
  return page.evaluate(({ stripSelector, id }) => {
    const marker = document.querySelector(`[data-marker-id="${id}"]`);
    const strip = document.querySelector(stripSelector);
    if (!marker || !strip) return null;
    return marker.getBoundingClientRect().x - strip.getBoundingClientRect().x;
  }, { stripSelector: STRIP_SELECTOR, id: markerId });
}

/** Marker viewport x (page-relative), or null when not rendered. */
async function markerViewportX(page: Page, markerId: string): Promise<number | null> {
  return page.evaluate((id) => {
    const marker = document.querySelector(`[data-marker-id="${id}"]`);
    return marker ? marker.getBoundingClientRect().x : null;
  }, markerId);
}

async function markerTime(page: Page, markerId: string): Promise<number | null> {
  const value = await page.getAttribute(`[data-marker-id="${markerId}"]`, 'data-marker-time');
  return value === null ? null : Number(value);
}

/** Poll the DOM marker attribute until it reaches `expected` (± tolerance). */
async function waitForDomMarkerTime(
  page: Page,
  markerId: string,
  expected: number,
  tolerance = 0.06,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const current = await markerTime(page, markerId);
    if (current !== null && Math.abs(current - expected) <= tolerance) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`marker ${markerId} DOM time did not reach ${expected} (last=${current})`);
    }
    await page.waitForTimeout(200);
  }
}

/** Poll the bridge's persisted config until the marker lands at `expected`. */
async function readBridgeSceneMarkers(): Promise<Array<{ id: string; time: number }>> {
  const response = await fetch(BRIDGE_TIMELINE);
  const data = await response.json();
  const app = data.config?.app?.[SCENE_PHASE_EXTENSION_ID];
  return Array.isArray(app?.sceneMarkers) ? app.sceneMarkers : [];
}

async function waitForBridgeMarkerTime(
  markerId: string,
  expected: number,
  tolerance = 0.06,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const markers = await readBridgeSceneMarkers();
    const marker = markers.find((entry) => entry.id === markerId);
    if (marker && Math.abs(marker.time - expected) <= tolerance) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `bridge marker ${markerId} did not reach ${expected} (last=${JSON.stringify(markers)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Mouse drag on a ruler marker: down at its center, move `dx`, release. */
async function dragMarkerBy(page: Page, markerId: string, dx: number): Promise<void> {
  const marker = page.locator(`[data-marker-id="${markerId}"]`);
  await marker.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await marker.boundingBox();
  if (!box) {
    throw new Error(`marker ${markerId} has no bounding box`);
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 8 });
  await page.mouse.up();
}

/** Touch drag on a ruler marker via raw CDP touch input. */
async function touchDragMarker(
  touch: TouchInput,
  page: Page,
  markerId: string,
  dx: number,
): Promise<void> {
  const marker = page.locator(`[data-marker-id="${markerId}"]`);
  await marker.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await marker.boundingBox();
  if (!box) {
    throw new Error(`marker ${markerId} has no bounding box`);
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await touch.touchDrag(x, y, x + dx, y, { steps: 14 });
}

/**
 * Touch marker-versus-pinch: finger 1 claims a marker drag (crossing the
 * 4 px activation threshold), then finger 2 attempts a two-finger pinch on
 * the edit area. The host's claim must make the pinch handler refuse to
 * initialize/continue, so the scale must not change.
 */
async function touchDragMarkerThenPinch(
  context: BrowserContext,
  page: Page,
  markerId: string,
  editAreaCenterY: number,
): Promise<void> {
  const cdp = await context.newCDPSession(page);
  const box = await page.locator(`[data-marker-id="${markerId}"]`).boundingBox();
  if (!box) {
    throw new Error(`marker ${markerId} has no bounding box`);
  }
  const mx = box.x + box.width / 2;
  const my = box.y + box.height / 2;
  const areaCenterX = await page.evaluate((selector) => {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    return rect ? rect.x + rect.width / 2 : 0;
  }, EDIT_AREA_SELECTOR);

  // Finger 1: touchStart on the marker, then cross the activation threshold.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mx, y: my }] });
  for (let i = 1; i <= 3; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: mx + i * 6, y: my }],
    });
    await page.waitForTimeout(16);
  }

  // Finger 2: a pinch attempt on the edit area while the marker owns the claim.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: mx + 18, y: my },
      { x: areaCenterX - 40, y: editAreaCenterY },
    ],
  });
  for (let i = 1; i <= 8; i += 1) {
    const spread = 40 + i * 8;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: mx + 18, y: my },
        { x: areaCenterX - spread, y: editAreaCenterY },
      ],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
}

/** Scroll the edit area back to the left edge (content origin). */
async function resetScrollLeft(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const area = document.querySelector(selector);
    if (area) area.scrollLeft = 0;
  }, EDIT_AREA_SELECTOR);
  await page.waitForTimeout(300);
}

/**
 * Disable the canary extension mid-drag via the ExtensionManager's dev-local
 * toggle. A real second pointer cannot reach the toggle — the dragging mouse
 * holds pointer capture on the marker button, which retargets every pointer
 * event — so this uses DOM-level clicks, which still exercise the real
 * store → page memo → lifecycle → host teardown path. The Extensions tab is
 * activated first because Radix mounts its TabsContent only when active (the
 * panel may be hidden entirely on phone, but the tab trigger is always in
 * the DOM).
 */
async function disableExtensionMidDrag(page: Page): Promise<void> {
  async function openExtensionsTab(): Promise<boolean> {
    return page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]'))
        .find((el) => (el.textContent ?? '').trim() === 'Extensions');
      if (!tab) return false;
      (tab as HTMLElement).click();
      return true;
    });
  }
  let extensionsTabOpened = await openExtensionsTab();

  if (!extensionsTabOpened) {
    // Phone/condensed layouts hide the panel behind a Properties/Inspector
    // toggle; try each with a short timeout before giving up.
    for (const label of ['Properties', 'Inspector']) {
      const trigger = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      try {
        await trigger.click({ timeout: 3_000 });
        await page.waitForTimeout(500);
      } catch {
        // Not present in this layout — try the next candidate.
      }
      extensionsTabOpened = await openExtensionsTab();
      if (extensionsTabOpened) break;
    }
  }

  if (!extensionsTabOpened) {
    throw new Error('Extensions tab not found in DOM');
  }
  await page.waitForTimeout(300);
  // The dev-local toggle is a plain button whose state contract is its
  // aria-label: "Disable <id>" when enabled, "Enable <id>" when disabled.
  // Click exactly ONCE — retrying a toggle is state-reversing — then verify
  // the flipped label. The marker-layer count assertion that follows verifies
  // the actual page/runtime teardown path.
  const toggle = page.locator(DISABLE_TOGGLE_SELECTOR);
  await toggle.evaluate((element) => {
    (element as HTMLElement).click();
  });
  await expect(toggle).toHaveAttribute(
    'aria-label',
    `Enable ${SCENE_PHASE_EXTENSION_ID}`,
    { timeout: 5_000 },
  );
}

// ---------------------------------------------------------------------------
// Desktop (mouse)
// ---------------------------------------------------------------------------

test.describe('timeline extension overlays (desktop)', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('canary gate, passive parity, geometry, drag, auto-scroll, disable mid-drag', async ({ page }, testInfo) => {
    test.setTimeout(240_000);

    const logs: string[] = [];
    const resetError = await resetBridgeBaseline();
    if (resetError) logs.push(resetError);
    const seedError = await seedSceneMarkers();
    if (seedError) logs.push(seedError);
    logs.push(...collectPageLogs(page));

    const shot = (name: string) => page.screenshot({
      path: testInfo.outputPath(`desktop-${name}.png`),
      animations: 'disabled',
      timeout: 20_000,
    });

    // --- 1. DEV gate follows the EXTENSION's enablement, not a URL param ---
    // The overlay host mounts whenever an enabled dev-local extension declares
    // a `timelineOverlay` contribution — no ?timelineOverlayCanary=1 needed in
    // DEV. Disabling that extension unmounts the host (marker layer gone).
    await openEditor(page);
    await test.step('host mounts in DEV with an enabled overlay extension (no URL param)', async () => {
      const markerLayer = sceneMarkerLayer(page);
      await expect(markerLayer).toBeVisible({ timeout: 20_000 });
      await expect(markerLayer).toHaveAttribute('data-marker-count', '3');
      // The canary owns one stable layer while the ten Creative Lab marker
      // extensions remain independently mounted and reachable.
      await expectMarkerLayerComposition(page, 11);
    });

    await test.step('disabling the overlay extension unmounts the host', async () => {
      // Open the Extensions tab and flip the dev-local toggle off.
      await page.locator('[role="tab"]', { hasText: 'Extensions' }).first().click({ timeout: 8_000 });
      const toggle = page.locator(DISABLE_TOGGLE_SELECTOR);
      await toggle.evaluate((element) => {
        (element as HTMLElement).click();
      });
      await expect(toggle).toHaveAttribute(
        'aria-label',
        `Enable ${SCENE_PHASE_EXTENSION_ID}`,
        { timeout: 5_000 },
      );
      await expect(sceneMarkerLayer(page)).toHaveCount(0, { timeout: 10_000 });
      await expectMarkerLayerComposition(page, 10);
      await expect(sceneMarkerLayer(page).locator('[data-marker-id]')).toHaveCount(0);
      // Re-enable so the canary-on step below starts from a known state.
      await toggle.evaluate((element) => {
        (element as HTMLElement).click();
      });
      await expect(toggle).toHaveAttribute(
        'aria-label',
        `Disable ${SCENE_PHASE_EXTENSION_ID}`,
        { timeout: 5_000 },
      );
    });

    // --- 2. enabled extension + seeded markers mount on the ruler ---------
    await openCanaryEditor(page);
    const markerLayer = sceneMarkerLayer(page);
    await expect(markerLayer).toBeVisible({ timeout: 20_000 });
    await expect(markerLayer).toHaveAttribute('data-marker-count', '3');
    await expect(page.locator('[data-marker-id="e2e-marker-a"]')).toBeVisible();
    await expect(page.locator('[data-marker-id="e2e-marker-b"]')).toBeVisible();
    await expect(page.locator('[data-marker-id="e2e-marker-c"]')).toBeVisible();
    await shot('canary-mounted');

    // --- 3. passive parity: no overlay claim, gestures unchanged ----------
    await test.step('clip select works while overlays are mounted but unclaimed', async () => {
      await page.locator(`${EDIT_AREA_SELECTOR} [data-clip-id]`).first().click({ timeout: 8_000 });
      expect(await countSelectedClips(page)).toBeGreaterThanOrEqual(1);
    });

    await test.step('clip drag works while overlays are mounted but unclaimed', async () => {
      // Pick a clip with free space to its right: the timeline snaps an
      // overlapping drop back to the clip's origin, so a blind +48px drag on
      // a packed neighbour would measure the packing rule, not the gesture.
      const freeClip = await pickFreeDraggableClip(page);
      expect(freeClip, 'expected a draggable clip').not.toBeNull();
      const clip = page.locator(`${EDIT_AREA_SELECTOR} ${CLIP_ACTION_WITH_ID_SELECTOR}[data-clip-id="${freeClip!.id}"]`);
      const before = await clip.boundingBox();
      if (!before) throw new Error('no clip to drag');
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      await page.mouse.move(before.x + before.width / 2 + 48, before.y + before.height / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(1_000);
      const after = await clip.boundingBox();
      expect(after && Math.abs(after.x - before.x), `${before.x} -> ${after?.x}`).toBeGreaterThan(25);
    });

    await test.step('ruler scrub (playhead drag) works while overlays are mounted but unclaimed', async () => {
      const beforeTransform = await page.getAttribute('[data-testid="timeline-playhead"]', 'style');
      const ruler = await page.locator('[data-testid="timeline-ruler"]').boundingBox();
      if (!ruler) throw new Error('no ruler');
      await page.mouse.move(ruler.x + 220, ruler.y + 15);
      await page.mouse.down();
      await page.mouse.move(ruler.x + 340, ruler.y + 15, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const afterTransform = await page.getAttribute('[data-testid="timeline-playhead"]', 'style');
      expect(afterTransform, `${beforeTransform} -> ${afterTransform}`).not.toBe(beforeTransform);
    });
    await shot('passive');

    // --- 4. marker geometry at default zoom --------------------------------
    const metrics0 = await rulerMetrics(page);
    await test.step('ruler metrics are measurable', async () => {
      expect(metrics0.pps, `pps=${metrics0.pps}`).toBeGreaterThan(10);
    });

    await test.step('marker content x equals startLeft + time * pps', async () => {
      for (const marker of MARKERS) {
        const contentX = await markerContentX(page, marker.id);
        const expected = metrics0.startLeft + marker.time * metrics0.pps;
        expect(
          contentX !== null && Math.abs(contentX - expected),
          `${marker.id} contentX=${contentX} expected=${expected}`,
        ).toBeLessThan(4);
      }
    });

    // --- 5. marker drag commits once, on the frame grid --------------------
    await test.step('marker drag commits a frame-snapped time', async () => {
      // +2s at the live pps → exactly 2s, frame-exact at any fps.
      const dx = Math.round(2 * metrics0.pps);
      await dragMarkerBy(page, 'e2e-marker-a', dx);
      const expected = 1 + 2;
      await waitForDomMarkerTime(page, 'e2e-marker-a', expected);
      await waitForBridgeMarkerTime('e2e-marker-a', expected);
    });
    await shot('dragged');

    // --- 6. scale + scroll geometry ----------------------------------------
    await test.step('zoom in: marker content x tracks the new pps', async () => {
      const zoomIn = page.locator('button[aria-label="Zoom in timeline"]').first();
      for (let i = 0; i < 4; i += 1) {
        await zoomIn.click({ timeout: 5_000 });
        await page.waitForTimeout(250);
      }
      const metrics1 = await rulerMetrics(page);
      expect(metrics1.pps, `pps ${metrics0.pps} -> ${metrics1.pps}`).toBeGreaterThan(metrics0.pps * 2);
      for (const marker of MARKERS) {
        const currentTime = await markerTime(page, marker.id);
        const contentX = await markerContentX(page, marker.id);
        const expected = metrics1.startLeft + (currentTime ?? marker.time) * metrics1.pps;
        expect(
          contentX !== null && Math.abs(contentX - expected),
          `${marker.id} contentX=${contentX} expected=${expected} at pps=${metrics1.pps}`,
        ).toBeLessThan(4);
      }
      // Zoomed far enough that the content overflows the edit area (scrollable).
      expect(metrics1.scrollWidth, `scrollWidth=${metrics1.scrollWidth} clientWidth=${metrics1.clientWidth}`)
        .toBeGreaterThan(metrics1.clientWidth + 100);
    });

    await test.step('scroll: marker viewport x shifts by -scrollLeft, content x is stable', async () => {
      const before = await markerContentX(page, 'e2e-marker-b');
      const viewportBefore = await markerViewportX(page, 'e2e-marker-b');
      const scrollDelta = 200;
      await page.evaluate(({ selector, delta }) => {
        const area = document.querySelector(selector);
        if (area) area.scrollLeft = delta;
      }, { selector: EDIT_AREA_SELECTOR, delta: scrollDelta });
      await page.waitForTimeout(400);

      const afterContent = await markerContentX(page, 'e2e-marker-b');
      const metrics2 = await rulerMetrics(page);
      expect(metrics2.scrollLeft, `scrollLeft=${metrics2.scrollLeft}`).toBeGreaterThanOrEqual(scrollDelta - 2);
      // Content x is scroll-independent.
      expect(afterContent !== null && Math.abs(afterContent - (before ?? 0)), `${before} -> ${afterContent}`).toBeLessThan(2);
      // Viewport x moved left by the scroll delta.
      const viewportAfter = await markerViewportX(page, 'e2e-marker-b');
      expect(
        viewportAfter !== null && viewportBefore !== null && Math.abs(viewportAfter - viewportBefore + scrollDelta),
        `viewportX ${viewportBefore} -> ${viewportAfter} (delta ${scrollDelta})`,
      ).toBeLessThan(4);
    });

    // --- 7. drag-to-edge auto-scroll ---------------------------------------
    await test.step('dragging a marker into the edge zone auto-scrolls the edit area', async () => {
      const area = await page.evaluate((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { right: rect.right, top: rect.top, height: rect.height } : null;
      }, EDIT_AREA_SELECTOR);
      if (!area) throw new Error('no edit area');
      const marker = page.locator('[data-marker-id="e2e-marker-c"]');
      const box = await marker.boundingBox();
      if (!box) throw new Error('marker-c has no bounding box');
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      const beforeScroll = await page.evaluate((selector) => document.querySelector(selector)?.scrollLeft ?? 0, EDIT_AREA_SELECTOR);

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Drag into the 40px right-edge zone, then hold while rAF auto-scrolls.
      await page.mouse.move(area.right - 10, startY, { steps: 10 });
      await page.waitForTimeout(1_400);
      const duringScroll = await page.evaluate((selector) => document.querySelector(selector)?.scrollLeft ?? 0, EDIT_AREA_SELECTOR);
      await page.mouse.up();
      await page.waitForTimeout(400);

      expect(
        duringScroll,
        `scrollLeft ${beforeScroll} -> ${duringScroll} while held at the edge`,
      ).toBeGreaterThan(beforeScroll + 20);
      // And the marker followed the scrolled content (commit happened).
      await expect.poll(() => markerTime(page, 'e2e-marker-c'), { timeout: 10_000 }).not.toBeNull();
    });
    await shot('autoscroll');

    // --- 8. disable mid-drag ------------------------------------------------
    await test.step('disabling the extension mid-drag terminates the session cleanly', async () => {
      // Bring the view back to the content origin so the marker is clickable.
      await resetScrollLeft(page);
      const marker = page.locator('[data-marker-id="e2e-marker-b"]');
      await expect(marker).toBeVisible({ timeout: 10_000 });
      const box = await marker.boundingBox();
      if (!box) throw new Error('marker-b has no bounding box');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // Open the Extensions tab so the toggle is the real manager surface.
      await page.locator('[role="tab"]', { hasText: 'Extensions' }).first().click({ timeout: 8_000 });

      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 12, cy, { steps: 3 }); // cross the 4px activation threshold
      await expect
        .poll(async () => page.getAttribute(`[data-marker-id="e2e-marker-b"]`, 'data-marker-dragging'), { timeout: 5_000 })
        .toBe('true');

      // Disable while the marker owns the claim → host teardown cancels the session.
      await disableExtensionMidDrag(page);
      await page.mouse.move(cx + 24, cy, { steps: 3 });
      await page.mouse.up();

      await expect(sceneMarkerLayer(page)).toHaveCount(0, { timeout: 10_000 });
      await expectMarkerLayerComposition(page, 10);
      await expect(sceneMarkerLayer(page).locator('[data-marker-id]')).toHaveCount(0);
      expect(logs.filter((line) => line.startsWith('[pageerror]')), [...new Set(logs)].join(' | ')).toEqual([]);

      // The editor itself is still interactive — the gesture owner was released.
      await page.locator(`${EDIT_AREA_SELECTOR} [data-clip-id]`).first().click({ timeout: 8_000 });
      expect(await countSelectedClips(page)).toBeGreaterThanOrEqual(1);
    });
    await shot('disabled');
  });

  test('B key marks a phase at the live playhead: scrub, then mark', async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    // Capture logs by reference: collectPageLogs registers page listeners on
    // the SAME array we assert against, so the final assertion is not vacuous.
    const logs: string[] = [];
    const resetError = await resetBridgeBaseline();
    if (resetError) logs.push(resetError);
    // resetBridgeBaseline preserves config.app, so explicitly clear any
    // scene markers a previous spec left in the bridge's persisted config.
    const clearError = await seedSceneMarkers([]);
    if (clearError) logs.push(clearError);
    logs.push(...collectPageLogs(page));

    const shot = (name: string) => page.screenshot({
      path: testInfo.outputPath(`desktop-bkey-${name}.png`),
      animations: 'disabled',
      timeout: 20_000,
    });

    // Start clean: the canary URL with NO seeded markers. The overlay host is
    // mounted (canary), so the marker layer exists but carries 0 markers.
    await openCanaryEditor(page);
    const markerLayer = sceneMarkerLayer(page);
    await expect(markerLayer).toBeVisible({ timeout: 20_000 });
    await expect(markerLayer).toHaveAttribute('data-marker-count', '0');

    // Focus a non-editable timeline surface so the B keybinding is not
    // swallowed by an editable target.
    await page.locator(`${EDIT_AREA_SELECTOR} [data-clip-id]`).first().click({ timeout: 8_000 });

    // Scrub the ruler to a NONZERO playhead: the canvas publishes it into
    // the provider-owned timeline view store through handleSetTime. The B
    // command must read that published value — proving the host→store→
    // command path, not a defaulted 0s marker.
    const ruler = await page.locator('[data-testid="timeline-ruler"]').boundingBox();
    if (!ruler) throw new Error('no ruler');
    // The composed marker layers own the ruler's top 20px. Scrub through the
    // host-owned bottom strip so the gesture reaches the playhead surface.
    const scrubY = ruler.y + ruler.height - 3;
    await page.mouse.move(ruler.x + 80, scrubY);
    await page.mouse.down();
    await page.mouse.move(ruler.x + 420, scrubY, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const scrubbedTime = await page.evaluate(() => {
      const playhead = document.querySelector('[data-testid="timeline-playhead"]');
      const transform = playhead?.getAttribute('style') ?? '';
      const match = /translateX\(([\d.]+)px\)/.exec(transform);
      return match ? Number(match[1]) : null;
    });
    expect(scrubbedTime, `playhead transform px (${scrubbedTime})`).toBeGreaterThan(40);

    // Press B: the command must read the playhead from the provider-owned
    // timeline view store (renderer-independent) and write a marker at the
    // scrubbed time, NOT at 0s.
    await page.keyboard.press('b');
    await expect(markerLayer).toHaveAttribute('data-marker-count', '1', { timeout: 10_000 });
    await expect(markerLayer.locator('[data-marker-id]')).toHaveCount(1);
    await expect(markerLayer.locator('[data-marker-id]').first()).toBeVisible();
    await shot('marked');

    // The marker must be persisted through project-data (bridge config.app)
    // at the scrubbed time. The editor saves asynchronously, so poll.
    await expect.poll(async () => (await readBridgeSceneMarkers()).length, { timeout: 15_000 }).toBe(1);
    const persisted = await readBridgeSceneMarkers();
    expect(persisted[0]!.time, JSON.stringify(persisted)).toBeGreaterThan(0);

    // Reload: the marker must survive the round trip and re-render.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(EDITOR_SETTLE_MS);
    await expect(sceneMarkerLayer(page)).toBeVisible({ timeout: 20_000 });
    await expect(sceneMarkerLayer(page)).toHaveAttribute('data-marker-count', '1');
    await expect(sceneMarkerLayer(page).locator('[data-marker-id]')).toHaveCount(1);
    await shot('reloaded');

    expect(logs.filter((line) => line.startsWith('[pageerror]')), [...new Set(logs)].join(' | ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tablet (touch)
// ---------------------------------------------------------------------------

test.describe('timeline extension overlays (tablet)', () => {
  test.use({
    viewport: { width: 834, height: 1194 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
      + ' (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  test('touch marker drag and marker-versus-pinch arbitration', async ({ context, page }, testInfo) => {
    test.setTimeout(240_000);

    const logs: string[] = [];
    const resetError = await resetBridgeBaseline();
    if (resetError) logs.push(resetError);
    const seedError = await seedSceneMarkers();
    if (seedError) logs.push(seedError);
    logs.push(...collectPageLogs(page));

    await openCanaryEditor(page);
    const touch = await createTouchInput(context, page);

    const shot = (name: string) => page.screenshot({
      path: testInfo.outputPath(`tablet-${name}.png`),
      animations: 'disabled',
      timeout: 20_000,
    });

    const markerLayer = sceneMarkerLayer(page);
    await expect(markerLayer).toBeVisible({ timeout: 20_000 });
    await expect(markerLayer).toHaveAttribute('data-marker-count', '3');
    await shot('mounted');

    // --- 1. touch marker drag commits once ---------------------------------
    await test.step('touch marker drag commits a frame-snapped time', async () => {
      await ensureRulerLabels(page);
      const metrics = await rulerMetrics(page);
      // ensureRulerLabels may have scrolled the edit area to reveal ruler
      // labels; the marker drag needs markers visible, so reset scroll.
      await page.evaluate((selector) => {
        const area = document.querySelector(selector) as HTMLElement | null;
        if (area) area.scrollLeft = 0;
      }, EDIT_AREA_SELECTOR);
      await page.waitForTimeout(150);
      expect(metrics.pps, `pps=${metrics.pps}`).toBeGreaterThan(10);
      // +2.5s at the live pps → 5.5s, frame-exact at any fps.
      const dx = Math.round(2.5 * metrics.pps);
      await touchDragMarker(touch, page, 'e2e-marker-b', dx);
      await waitForDomMarkerTime(page, 'e2e-marker-b', 5.5);
      await waitForBridgeMarkerTime('e2e-marker-b', 5.5);
    });
    await shot('dragged');

    // --- 2. pinch works while no overlay owns the gesture ------------------
    const editAreaCenterY = await page.evaluate((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? rect.top + rect.height / 2 : 0;
    }, EDIT_AREA_SELECTOR);
    const areaCenterX = await page.evaluate((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? rect.x + rect.width / 2 : 0;
    }, EDIT_AREA_SELECTOR);
    const clipWidth = () => page.evaluate(
      () => document.querySelector('.clip-action[data-clip-id]')?.getBoundingClientRect().width ?? 0,
    );

    await test.step('two-finger pinch zooms while no overlay owns the gesture', async () => {
      const before = await clipWidth();
      await touch.pinch(areaCenterX, editAreaCenterY, 50, 130, 12);
      const after = await clipWidth();
      expect(after, `clip width ${before} -> ${after}`).toBeGreaterThan(before * 1.5);
    });

    // --- 3. pinch is refused while a marker owns the gesture ----------------
    await test.step('a second-finger pinch is refused while a marker drag owns the claim', async () => {
      const before = await clipWidth();
      await touchDragMarkerThenPinch(context, page, 'e2e-marker-c', editAreaCenterY);
      const after = await clipWidth();
      expect(
        Math.abs(after - before),
        `clip width ${before} -> ${after} (pinch must be refused during the marker drag)`,
      ).toBeLessThan(1);
    });

    // --- 4. releasing the claim restores pinch ------------------------------
    await test.step('pinch works again once the marker claim is released', async () => {
      const before = await clipWidth();
      await touch.pinch(areaCenterX, editAreaCenterY, 40, 100, 10);
      const after = await clipWidth();
      expect(after, `clip width ${before} -> ${after}`).toBeGreaterThan(before * 1.2);
    });

    expect(logs.filter((line) => line.startsWith('[pageerror]')), [...new Set(logs)].join(' | ')).toEqual([]);
    await shot('final');
  });
});

// ---------------------------------------------------------------------------
// Phone (touch)
// ---------------------------------------------------------------------------

test.describe('timeline extension overlays (phone)', () => {
  test.use({
    viewport: { width: 420, height: 820 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test('touch marker drag and disable-mid-drag on phone', async ({ context, page }, testInfo) => {
    test.setTimeout(240_000);

    const logs: string[] = [];
    const resetError = await resetBridgeBaseline();
    if (resetError) logs.push(resetError);
    const seedError = await seedSceneMarkers();
    if (seedError) logs.push(seedError);
    logs.push(...collectPageLogs(page));

    await openCanaryEditor(page);
    const touch = await createTouchInput(context, page);

    const shot = (name: string) => page.screenshot({
      path: testInfo.outputPath(`phone-${name}.png`),
      animations: 'disabled',
      timeout: 20_000,
    });

    const markerLayer = sceneMarkerLayer(page);
    await expect(markerLayer).toBeVisible({ timeout: 20_000 });
    await expect(markerLayer).toHaveAttribute('data-marker-count', '3');
    await shot('mounted');

    // --- 1. touch marker drag commits once ---------------------------------
    await test.step('touch marker drag commits a frame-snapped time', async () => {
      await ensureRulerLabels(page);
      const metrics = await rulerMetrics(page);
      // ensureRulerLabels may have scrolled the edit area to reveal ruler
      // labels; the marker drag needs markers visible, so reset scroll.
      await page.evaluate((selector) => {
        const area = document.querySelector(selector) as HTMLElement | null;
        if (area) area.scrollLeft = 0;
      }, EDIT_AREA_SELECTOR);
      await page.waitForTimeout(150);
      expect(metrics.pps, `pps=${metrics.pps}`).toBeGreaterThan(10);
      const dx = Math.round(2 * metrics.pps);
      await touchDragMarker(touch, page, 'e2e-marker-a', dx);
      await waitForDomMarkerTime(page, 'e2e-marker-a', 3);
      await waitForBridgeMarkerTime('e2e-marker-a', 3);
    });
    await shot('dragged');

    // --- 2. disable mid-drag ------------------------------------------------
    await test.step('disabling the extension mid-drag terminates the session cleanly', async () => {
      const box = await page.locator('[data-marker-id="e2e-marker-b"]').boundingBox();
      if (!box) throw new Error('marker-b has no bounding box');
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;

      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 4; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + i * 6, y }],
        });
        await page.waitForTimeout(16);
      }
      await expect
        .poll(async () => page.getAttribute(`[data-marker-id="e2e-marker-b"]`, 'data-marker-dragging'), { timeout: 5_000 })
        .toBe('true');

      // Disable while the marker owns the claim → host teardown cancels the
      // session. Cancel the now-orphaned browser touch stream: ending it over
      // the Inspector can synthesize a click on the toggle and re-enable the
      // extension, which would test click synthesis rather than host teardown.
      await disableExtensionMidDrag(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await page.waitForTimeout(400);

      await expect(sceneMarkerLayer(page)).toHaveCount(0, { timeout: 10_000 });
      await expectMarkerLayerComposition(page, 10);
      await expect(sceneMarkerLayer(page).locator('[data-marker-id]')).toHaveCount(0);
      expect(logs.filter((line) => line.startsWith('[pageerror]')), [...new Set(logs)].join(' | ')).toEqual([]);

      // The editor is still interactive — tap a clip, it selects. The
      // Inspector dialog used to reach the toggle still covers the timeline on
      // phone, so close it first (its trigger toggles).
      await page.evaluate(() => {
        const trigger = Array.from(document.querySelectorAll('button'))
          .find((b) => /Inspector/i.test((b.textContent ?? '').trim()));
        trigger?.click();
      });
      await page.waitForTimeout(400);
      const clip = await page.locator(`${EDIT_AREA_SELECTOR} [data-clip-id]`).first().boundingBox();
      if (!clip) throw new Error('no clip to tap');
      await touch.tap(clip.x + clip.width / 2, clip.y + clip.height / 2);
      expect(await countSelectedClips(page)).toBeGreaterThanOrEqual(1);
    });
    await shot('disabled');
  });
});
