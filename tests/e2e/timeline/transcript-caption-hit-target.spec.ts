import { expect, test } from '@playwright/test';
import {
  BASE_URL,
  CLIP_BODY_SELECTOR,
  PROJECT_SLUG,
  TIMELINE_SLUG,
} from './support.ts';

const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&transcriptLaneFixture=render-matrix&runawayTimelineProject=runaway-8085`;
const CAPTION_SELECTOR = `${CLIP_BODY_SELECTOR}[data-clip-id^="transcript-caption-"]`;
const EXPECTED_CAPTIONS = [
  'Ava: café — 👩🏽‍🚀',
  'Борис: overlapping reply',
  '李: second speaker after gap',
  'Ava + 李: final overlap — مرحبًا',
];

test.describe('materialized transcript caption clip hit targets', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('selects every generated caption and shows its exact text in the Inspector', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
    await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const transcriptRow = page.locator('[data-lane-kind="reigh.transcript"]');
    await expect(transcriptRow).toBeVisible({ timeout: 30_000 });
    await page.locator('.timeline-canvas-edit-area').evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    await transcriptRow.getByRole('button', { name: 'Transcript actions' }).click();
    await page.getByRole('menuitem', { name: 'Render transcript as editable video text' }).click();

    const captions = page.locator(CAPTION_SELECTOR);
    await expect(captions).toHaveCount(EXPECTED_CAPTIONS.length, { timeout: 20_000 });
    const geometry = await captions.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.getAttribute('data-clip-id'),
        width: rect.width,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
    }));
    expect(geometry.every(({ width }) => width >= 24)).toBe(true);
    let overlapCount = 0;
    for (let leftIndex = 0; leftIndex < geometry.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < geometry.length; rightIndex += 1) {
        const left = geometry[leftIndex]!;
        const right = geometry[rightIndex]!;
        const horizontallyOverlaps = left.left < right.right && right.left < left.right;
        if (!horizontallyOverlaps) continue;
        overlapCount += 1;
        expect(
          left.bottom <= right.top + 0.5 || right.bottom <= left.top + 0.5,
          `overlapping caption hit targets must be vertically disjoint: ${JSON.stringify({ left, right })}`,
        ).toBe(true);
      }
    }
    expect(overlapCount).toBeGreaterThan(0);

    const inspectorText = page.locator('textarea:visible').first();
    for (const expectedText of EXPECTED_CAPTIONS) {
      const clip = captions.filter({ hasText: expectedText }).first();
      await expect(clip).toBeVisible();
      await clip.click();
      await expect(clip).toHaveAttribute('data-selected', 'true');
      await expect(inspectorText).toHaveValue(expectedText);
    }
  });
});
