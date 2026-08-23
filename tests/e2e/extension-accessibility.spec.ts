import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { PROJECT_SLUG, TIMELINE_SLUG, resetBridgeBaseline } from './timeline/support';

const RUNAWAY_PROJECT = 'extension-accessibility';
const EDITOR_URL = `/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&timelineOverlayCanary=1&transcriptLaneFixture=1&runawayTimelineProject=${RUNAWAY_PROJECT}`;
const HARNESS_URL = `/tools/video-editor/harness?scenario=populated&localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1`;
const EXTENSION_COUNT = 13;

function collectIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(`[console.error] ${message.text()}`);
  });
  return issues;
}

async function openComposedEditor(page: Page): Promise<string[]> {
  const issues = collectIssues(page);
  expect(await resetBridgeBaseline()).toBeNull();
  await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
  const response = await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('[data-lane-kind="reigh.transcript"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-lane-kind="reigh.runaway.transitions"]')).toBeVisible();
  await expect(page.getByTestId('timeline-marker-layer-legend')).toBeVisible();
  return issues;
}

async function openExtensionsPanel(page: Page): Promise<Locator> {
  let extensionsTab = page.getByRole('tab', { name: 'Extensions' });
  if (!(await extensionsTab.isVisible())) {
    await page.getByRole('button', { name: 'Inspector', exact: true }).first().click();
    extensionsTab = page.getByRole('tab', { name: 'Extensions' });
  }
  await expect(extensionsTab).toBeVisible();
  await extensionsTab.click();
  await expect(extensionsTab).toHaveAttribute('aria-selected', 'true');
  const inventory = page.getByRole('region', { name: 'Local extensions' });
  await expect(inventory).toBeVisible();
  await expect(inventory.locator('[data-video-editor-dev-local-extension]')).toHaveCount(EXTENSION_COUNT);
  return inventory;
}

async function expectViewportContained(page: Page, width: number): Promise<void> {
  const geometry = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.viewportWidth).toBe(width);
  expect(geometry.bodyWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(width + 1);
  expect(geometry.documentWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(width + 1);
}

async function expectToggleSemantics(inventory: Locator): Promise<void> {
  const rows = inventory.locator('[data-video-editor-dev-local-extension]');
  const toggles = inventory.locator('[data-video-editor-dev-local-toggle]');
  const ids = await rows.evaluateAll((elements) => elements.map((element) => (
    element.getAttribute('data-video-editor-dev-local-extension')
  )));
  expect(ids).toHaveLength(EXTENSION_COUNT);
  expect(new Set(ids).size).toBe(EXTENSION_COUNT);
  await expect(toggles).toHaveCount(EXTENSION_COUNT);

  for (let index = 0; index < EXTENSION_COUNT; index += 1) {
    const id = ids[index];
    expect(id).not.toBeNull();
    const toggle = toggles.nth(index);
    await expect(toggle).toHaveAccessibleName(`Disable ${id}`);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const box = await toggle.boundingBox();
    expect(box, id ?? `toggle ${index}`).not.toBeNull();
    expect(box!.height, `${id} target height`).toBeGreaterThanOrEqual(24);
    expect(box!.width, `${id} target width`).toBeGreaterThanOrEqual(24);
  }
}

async function saveScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
}

test('all 13 extensions expose state and retain keyboard focus through disable and re-enable', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const issues = await openComposedEditor(page);
  const inventory = await openExtensionsPanel(page);
  await expectToggleSemantics(inventory);

  const transcriptId = 'com.reigh.transcript-lane';
  const toggle = inventory.locator(`[data-video-editor-dev-local-toggle="${transcriptId}"]`);
  // WebKit models Safari's macOS default, where Option+Tab reaches every
  // control while plain Tab follows the system's reduced tab-stop preference.
  const tabKey = testInfo.project.name === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (let attempt = 0; attempt < 20 && !(await toggle.evaluate((element) => element === document.activeElement)); attempt += 1) {
    await page.keyboard.press(tabKey);
  }
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAccessibleName(`Enable ${transcriptId}`);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAccessibleName(`Disable ${transcriptId}`);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();

  const focusStyle = await toggle.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
  });
  expect(
    focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth !== '0px'
      || focusStyle.boxShadow !== 'none',
    JSON.stringify(focusStyle),
  ).toBe(true);
  expect(issues).toEqual([]);
  await saveScreenshot(page, testInfo, 'all-13-keyboard-focus.png');
});

for (const viewport of [
  { name: 'tablet', width: 834, height: 1194 },
  { name: 'phone', width: 420, height: 820 },
] as const) {
  test(`all 13 extension states remain reachable at ${viewport.name} size`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const issues = await openComposedEditor(page);
    const inventory = await openExtensionsPanel(page);
    await expectToggleSemantics(inventory);
    await expectViewportContained(page, viewport.width);
    expect(issues).toEqual([]);
    await saveScreenshot(page, testInfo, `all-13-${viewport.name}.png`);
  });
}

test('200% CSS page-content zoom, reduced motion, names, expanded state, and contrast remain accessible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const issues = collectIssues(page);
  await page.goto(HARNESS_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });

  const manager = page.locator('[data-video-editor-harness-scenario="populated"]');
  await expect(manager).toBeVisible();
  const diagnostics = manager.locator('[data-video-editor-extension-diagnostics-toggle="ext.inspector-tools"]');
  await diagnostics.focus();
  await expect(diagnostics).toBeFocused();
  await expect(diagnostics).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(diagnostics).toHaveAccessibleName('Hide diagnostics for Inspector Tools');
  await expect(diagnostics).toHaveAttribute('aria-expanded', 'true');
  await expect(diagnostics).toBeFocused();
  await expect(manager.getByRole('log', { name: '1 diagnostic for Inspector Tools' })).toBeVisible();

  const motion = await manager.locator('button').evaluateAll((buttons) => buttons.map((button) => {
    const style = getComputedStyle(button);
    return {
      name: button.getAttribute('aria-label') ?? button.textContent?.trim(),
      animationName: style.animationName,
      transitionProperty: style.transitionProperty,
    };
  }));
  expect(motion.filter((item) => item.animationName !== 'none' || item.transitionProperty !== 'none')).toEqual([]);

  const contrast = await manager.evaluate((root) => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (value: string): Rgba => {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return { r: values[0] ?? 0, g: values[1] ?? 0, b: values[2] ?? 0, a: values[3] ?? 1 };
    };
    const composite = (foreground: Rgba, background: Rgba): Rgba => {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      };
    };
    const luminance = (color: Rgba): number => {
      const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const ratio = (left: Rgba, right: Rgba): number => {
      const a = luminance(left);
      const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const backgroundFor = (element: Element): Rgba => {
      const chain: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) chain.unshift(current);
      return chain.reduce(
        (background, current) => composite(parse(getComputedStyle(current).backgroundColor), background),
        { r: 255, g: 255, b: 255, a: 1 },
      );
    };
    const selectors = [
      '[data-video-editor-extension-trust-warning="true"] > div > div > div:last-child',
      '[data-video-editor-extension-toggle] span',
      '[data-video-editor-extension-diagnostics-toggle] span:first-of-type',
    ];
    return selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)).map((element) => {
      const background = backgroundFor(element);
      const foreground = composite(parse(getComputedStyle(element).color), background);
      return { text: element.textContent?.trim() ?? selector, ratio: ratio(foreground, background) };
    }));
  });
  expect(contrast.length).toBeGreaterThan(0);
  for (const sample of contrast) {
    expect(sample.ratio, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
  }

  const geometry = await manager.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
  });
  expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
  expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.width).toBeGreaterThan(0);
  expect(issues).toEqual([]);
  await diagnostics.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('zoom-200-reduced-motion.png') });
});
