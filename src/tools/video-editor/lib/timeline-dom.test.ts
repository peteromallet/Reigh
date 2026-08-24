// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTION_ID_ATTR,
  CLIP_BODY_SELECTOR,
  CLIP_ACTION_CLASS,
  CLIP_ACTION_SELECTOR,
  CLIP_ID_ATTR,
  CLIP_ID_DATASET_KEY,
  CLIP_SELECTED_ATTR,
  EDIT_AREA_CLASS,
  EDIT_AREA_SELECTOR,
  MARQUEE_IGNORE_SELECTOR,
  OVERLAY_INTERACTIVE_ATTR,
  OVERLAY_INTERACTIVE_DATASET_KEY,
  RESIZE_EDGE_ATTR,
  RESIZE_EDGE_DATASET_KEY,
  ROW_ID_ATTR,
  ROW_ID_DATASET_KEY,
  SHELL_REGION_ATTR,
  SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR,
  SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_DATASET_KEY,
  SHOT_GROUP_DRAG_ANCHOR_ROW_ID_ATTR,
  SHOT_GROUP_DRAG_ANCHOR_ROW_ID_DATASET_KEY,
  TIMELINE_AREA_CONTEXT_MENU_IGNORE_SELECTOR,
  TOUCH_GESTURE_MODE_ATTR,
  TRACK_ID_ATTR,
  TIMELINE_DOM,
  datasetKeyForAttribute,
} from '@/tools/video-editor/lib/timeline-dom.ts';

const VIDEO_EDITOR_ROOT = resolve(import.meta.dirname, '..');
const OVERRIDES_CSS = join(VIDEO_EDITOR_ROOT, 'components/TimelineEditor/timeline-overrides.css');

const TOKENS = [
  CLIP_ACTION_CLASS,
  EDIT_AREA_CLASS,
  CLIP_ID_ATTR,
  CLIP_SELECTED_ATTR,
  ROW_ID_ATTR,
  RESIZE_EDGE_ATTR,
  ACTION_ID_ATTR,
  TRACK_ID_ATTR,
  TOUCH_GESTURE_MODE_ATTR,
  SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR,
  SHOT_GROUP_DRAG_ANCHOR_ROW_ID_ATTR,
  SHELL_REGION_ATTR,
  OVERLAY_INTERACTIVE_ATTR,
];

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function selectorsMentioningTokens(css: string): string[] {
  return [...stripComments(css).matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .map((match) => match[1].trim().replace(/\s+/g, ' '))
    .filter((selector) => TOKENS.some((token) => selector.includes(token)));
}

function cssFilesUnderVideoEditor(): string[] {
  return readdirSync(VIDEO_EDITOR_ROOT, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.css'))
    .map((entry) => join(VIDEO_EDITOR_ROOT, entry));
}

describe('timeline DOM contract', () => {
  it('provides a unique clip-body selector distinct from trim handles', () => {
    expect(CLIP_BODY_SELECTOR).toBe(`${CLIP_ACTION_SELECTOR}[${CLIP_ID_ATTR}]`);
  });

  it('keeps every dataset reader in step with its attribute name', () => {
    expect(datasetKeyForAttribute(CLIP_ID_ATTR)).toBe(CLIP_ID_DATASET_KEY);
    expect(datasetKeyForAttribute(ROW_ID_ATTR)).toBe(ROW_ID_DATASET_KEY);
    expect(datasetKeyForAttribute(RESIZE_EDGE_ATTR)).toBe(RESIZE_EDGE_DATASET_KEY);
    expect(datasetKeyForAttribute(SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR))
      .toBe(SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_DATASET_KEY);
    expect(datasetKeyForAttribute(SHOT_GROUP_DRAG_ANCHOR_ROW_ID_ATTR))
      .toBe(SHOT_GROUP_DRAG_ANCHOR_ROW_ID_DATASET_KEY);
    expect(datasetKeyForAttribute(OVERLAY_INTERACTIVE_ATTR))
      .toBe(OVERLAY_INTERACTIVE_DATASET_KEY);
  });

  it('exposes every token through TIMELINE_DOM', () => {
    expect([...Object.values(TIMELINE_DOM)].sort()).toEqual([...TOKENS].sort());
  });

  it('ignores an element bearing the exported overlay-interactive attribute in marquee and context-menu exclusions', () => {
    // The host sets OVERLAY_INTERACTIVE_ATTR on the one claimed overlay
    // wrapper, so an overlay drag can never start a marquee or open the
    // empty-canvas context menu on the same pointerdown. Both exclusion
    // selectors must carry the exported contract as their own selector term:
    // any element with the attribute matches `[attr]` and is therefore ignored.
    const selectorTerms = (selector: string) =>
      selector.split(',').map((term) => term.trim());

    expect(selectorTerms(MARQUEE_IGNORE_SELECTOR))
      .toContain(`[${OVERLAY_INTERACTIVE_ATTR}]`);
    expect(selectorTerms(TIMELINE_AREA_CONTEXT_MENU_IGNORE_SELECTOR))
      .toContain(`[${OVERLAY_INTERACTIVE_ATTR}]`);
  });

  // CSS cannot import TypeScript, so the stylesheet repeats these tokens as
  // literals. Renaming a constant fails here until the stylesheet follows.
  it('pins the selectors timeline-overrides.css builds from the contract', () => {
    const selectors = selectorsMentioningTokens(readFileSync(OVERRIDES_CSS, 'utf8'));

    expect(new Set(selectors)).toEqual(new Set([
      `${EDIT_AREA_SELECTOR}::before`,
      `${EDIT_AREA_SELECTOR}[${TOUCH_GESTURE_MODE_ATTR}='marquee']`,
      `${EDIT_AREA_SELECTOR}[${TOUCH_GESTURE_MODE_ATTR}='move'] ${CLIP_ACTION_SELECTOR}`,
      `${EDIT_AREA_SELECTOR}[${TOUCH_GESTURE_MODE_ATTR}='trim'] [${RESIZE_EDGE_ATTR}]`,
      `${EDIT_AREA_SELECTOR}[${TOUCH_GESTURE_MODE_ATTR}='trim'] [${RESIZE_EDGE_ATTR}]::after`,
    ]));
  });

  it('is the only stylesheet in the tool that references the contract', () => {
    const referencing = cssFilesUnderVideoEditor()
      .filter((file) => selectorsMentioningTokens(readFileSync(file, 'utf8')).length > 0);

    expect(referencing).toEqual([OVERRIDES_CSS]);
  });
});
