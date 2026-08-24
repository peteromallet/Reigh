import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  PROJECT_SLUG,
  TIMELINE_SLUG,
  resetBridgeBaseline,
} from './timeline/support';

const RUNAWAY_PROJECT = 'cross-browser-release-gate';
const EDITOR_URL = `/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&timelineOverlayCanary=1&transcriptLaneFixture=1&runawayTimelineProject=${RUNAWAY_PROJECT}`;
const EVIDENCE_ROOT = resolve(process.cwd(), 'docs/extensions/evidence/cross-browser');

function collectIssues(page: Page): string[] {
  const issues: string[] = [];
  const expectedCapabilityProbe = (url: string, status: number) => {
    const parsed = new URL(url);
    return status === 404
      && /^\/api\/astrid\/projects\/[^/]+\/media\/__reigh_capability_probe__\/content$/.test(parsed.pathname);
  };
  page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    // Chromium/Firefox/WebKit emit a generic console.error for any failed
    // resource. HTTP status is classified below, where the URL is available;
    // retain application/page errors here.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      issues.push(`[console.error] ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !expectedCapabilityProbe(response.url(), response.status())) {
      issues.push(`[http ${response.status()}] ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    // A failed capability probe is an expected degraded local-bridge result;
    // unexpected transport failures remain release-gate failures.
    if (!expectedCapabilityProbe(request.url(), 404)) {
      issues.push(`[requestfailed] ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`);
    }
  });
  return issues;
}

function evidencePath(testInfo: TestInfo, fileName: string): string {
  const directory = resolve(EVIDENCE_ROOT, testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  return resolve(directory, fileName);
}

async function openCombinedEditor(page: Page): Promise<string[]> {
  const issues = collectIssues(page);
  expect(await resetBridgeBaseline()).toBeNull();
  await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
  const response = await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('[data-lane-kind="reigh.transcript"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-lane-kind="reigh.runaway.transitions"]')).toBeVisible();
  // The lane is virtualized: the exact mounted count depends on viewport and
  // engine layout. Assert that data arrived and the host stays within its
  // documented 128-item mount budget instead of baking in one raster count.
  await expect.poll(() => page.getByTestId('runaway-transition-chip').count()).toBeGreaterThan(0);
  expect(await page.getByTestId('runaway-transition-chip').count()).toBeLessThanOrEqual(128);
  await expect(page.getByTestId('timeline-marker-layer-legend')).toBeVisible();
  return issues;
}

test('extension inventory host renders active and diagnostic state', async ({ page }) => {
  const issues = collectIssues(page);
  await page.goto(`/tools/video-editor/harness?scenario=populated&localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1`, {
    waitUntil: 'domcontentloaded',
  });

  const cards = page.locator('[data-video-editor-extension-package-id]');
  await expect(cards).toHaveCount(3);
  await expect(page.locator('[data-video-editor-extension-package-state="loaded"]')).toHaveCount(3);
  await expect(page.getByLabel('Extension summary: 3 packages, 3 loaded')).toBeVisible();
  await expect(page.locator('[data-video-editor-activity-event]')).toHaveCount(3);
  await expect(page.locator('[data-video-editor-extension-trust-warning="true"]')).toBeVisible();

  const diagnosticButton = page.getByRole('button', {
    name: 'Show diagnostics for Inspector Tools',
  });
  await diagnosticButton.focus();
  await expect(diagnosticButton).toBeFocused();
  await diagnosticButton.press('Enter');
  await expect(page.getByRole('button', { name: 'Hide diagnostics for Inspector Tools' })).toBeVisible();
  expect(issues).toEqual([]);
});

test('combined extension surfaces compose and expose keyboard semantics', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const issues = await openCombinedEditor(page);

  const markerLayers = page.locator('[data-testid="timeline-marker-layer"]');
  const pager = page.getByRole('group', { name: 'Marker layer pages' });
  const next = pager.getByRole('button', { name: 'Next marker layers' });
  const firstKeys = await markerLayers.evaluateAll((layers) =>
    layers.map((layer) => layer.getAttribute('data-marker-layer-key')),
  );
  expect(firstKeys).toHaveLength(6);
  expect(new Set(firstKeys).size).toBe(firstKeys.length);

  await next.focus();
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pager).toHaveAttribute('data-marker-layer-page', '1');
  const secondKeys = await markerLayers.evaluateAll((layers) =>
    layers.map((layer) => layer.getAttribute('data-marker-layer-key')),
  );
  expect(secondKeys).toHaveLength(5);
  expect(secondKeys.some((key) => firstKeys.includes(key))).toBe(false);

  const transcriptActions = page.getByRole('button', { name: 'Transcript actions' });
  await transcriptActions.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Transcript actions' });
  await expect(menu).toBeVisible();
  const transcriptMenuItems = menu.getByRole('menuitem');
  await expect(transcriptMenuItems).toHaveText([
    'Add missing',
    'Regenerate',
    'Propose edits',
    'Accept proposals',
    'Reject proposals',
  ]);
  await expect(transcriptMenuItems.nth(0)).toHaveAccessibleName('Render transcript as editable video text');
  await expect(transcriptMenuItems.nth(1)).toHaveAccessibleName('Regenerate transcript captions and replace edits');
  await expect(transcriptMenuItems.nth(2)).toHaveAccessibleName('Propose caption edits back to transcript source');
  await expect(transcriptMenuItems.nth(3)).toHaveAccessibleName('Accept pending caption edits for transcript source update');
  await expect(transcriptMenuItems.nth(4)).toHaveAccessibleName('Reject pending caption edits for transcript source update');
  await expect(transcriptMenuItems.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(transcriptActions).toBeFocused();

  const accessibleItems = page.locator(
    '[data-lane-kind="reigh.transcript"] [aria-label], [data-lane-kind="reigh.runaway.transitions"] [aria-label]',
  );
  expect(await accessibleItems.count()).toBeGreaterThanOrEqual(4);
  expect(issues).toEqual([]);
  await page.screenshot({
    path: evidencePath(testInfo, 'combined-extension-surfaces.png'),
    fullPage: true,
  });
});

test('combined extension controls remain visible and operable at phone width', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const issues = await openCombinedEditor(page);

  const geometry = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.bodyWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewportWidth);

  const pager = page.getByRole('group', { name: 'Marker layer pages' });
  await expect(pager).toContainText(/Layers 1[–-]3\/11/);
  await expect(page.locator('[data-testid="timeline-marker-layer"]')).toHaveCount(3);

  const transcriptActions = page.getByRole('button', { name: 'Transcript actions' });
  await page.locator('.timeline-canvas-edit-area').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight;
  });
  await expect(transcriptActions).toBeInViewport();
  await transcriptActions.click();
  const menu = page.getByRole('menu', { name: 'Transcript actions' });
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
  expect(issues).toEqual([]);
  await page.screenshot({
    path: evidencePath(testInfo, 'phone-extension-surfaces.png'),
    fullPage: true,
  });
});
