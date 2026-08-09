// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarqueeSelect, type MarqueeRect } from '@/tools/video-editor/hooks/useMarqueeSelect';
import {
  CLIP_ACTION_CLASS,
  CLIP_ID_ATTR,
} from '@/tools/video-editor/lib/timeline-dom';
import type { TimelineInputModality } from '@/tools/video-editor/lib/mobile-interaction-model';

const selectionMocks = vi.hoisted(() => ({
  userSelectTimelineClips: vi.fn(),
  userClearAllSelection: vi.fn(),
}));

vi.mock('@/shared/state/selectionStore.ts', () => ({
  userSelectTimelineClips: selectionMocks.userSelectTimelineClips,
  userClearAllSelection: selectionMocks.userClearAllSelection,
}));

/**
 * The autoscroller is a rAF loop over a real scroll container; these tests drive
 * scroll changes explicitly instead, so the loop only adds nondeterminism.
 */
vi.mock('@/tools/video-editor/lib/auto-scroll.ts', () => ({
  createAutoScroller: () => ({ update: vi.fn(), stop: vi.fn() }),
}));

const EDIT_AREA_LEFT = 100;
const EDIT_AREA_TOP = 50;
const EDIT_AREA_WIDTH = 600;
const EDIT_AREA_HEIGHT = 300;

/** A clip's box in *canvas* space — where it lives on the timeline, scroll-independent. */
interface CanvasBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const CLIPS: CanvasBox[] = [
  { id: 'clip-near', left: 20, top: 10, width: 80, height: 40 },
  { id: 'clip-mid', left: 200, top: 10, width: 80, height: 40 },
  { id: 'clip-far', left: 700, top: 10, width: 80, height: 40 },
  { id: 'clip-lower-row', left: 200, top: 120, width: 80, height: 40 },
];

interface Harness {
  editArea: HTMLDivElement;
  scroll: (left: number, top?: number) => void;
}

/**
 * A scroll container whose children's viewport rects track `scrollLeft/scrollTop`
 * the way a real one's do — this is the only property the coordinate-space
 * assertions below depend on.
 */
function mountEditArea(): Harness {
  const editArea = document.createElement('div');
  editArea.className = 'timeline-canvas-edit-area';
  let scrollLeft = 0;
  let scrollTop = 0;

  Object.defineProperty(editArea, 'scrollLeft', {
    get: () => scrollLeft,
    set: (next: number) => { scrollLeft = next; },
    configurable: true,
  });
  Object.defineProperty(editArea, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => { scrollTop = next; },
    configurable: true,
  });
  editArea.getBoundingClientRect = () => ({
    left: EDIT_AREA_LEFT,
    top: EDIT_AREA_TOP,
    right: EDIT_AREA_LEFT + EDIT_AREA_WIDTH,
    bottom: EDIT_AREA_TOP + EDIT_AREA_HEIGHT,
    width: EDIT_AREA_WIDTH,
    height: EDIT_AREA_HEIGHT,
    x: EDIT_AREA_LEFT,
    y: EDIT_AREA_TOP,
    toJSON: () => ({}),
  }) as DOMRect;

  for (const box of CLIPS) {
    const clip = document.createElement('div');
    clip.className = CLIP_ACTION_CLASS;
    clip.setAttribute(CLIP_ID_ATTR, box.id);
    clip.getBoundingClientRect = () => {
      const left = EDIT_AREA_LEFT + box.left - scrollLeft;
      const top = EDIT_AREA_TOP + box.top - scrollTop;
      return {
        left,
        top,
        right: left + box.width,
        bottom: top + box.height,
        width: box.width,
        height: box.height,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    };
    editArea.appendChild(clip);
  }

  document.body.appendChild(editArea);
  return {
    editArea,
    scroll: (left, top = scrollTop) => {
      scrollLeft = left;
      scrollTop = top;
    },
  };
}

/** Which clips a canvas-space rect covers — the answer the drawn rect promises. */
function clipsCoveredByCanvasRect(rect: MarqueeRect): string[] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return CLIPS
    .filter((box) => rect.x < box.left + box.width
      && right > box.left
      && rect.y < box.top + box.height
      && bottom > box.top)
    .map((box) => box.id);
}

function renderMarquee(editAreaRef: { current: HTMLElement | null }) {
  return renderHook(() => useMarqueeSelect({
    editAreaRef,
    deviceClass: 'desktop',
    interactionMode: 'select',
    gestureOwner: 'none',
    setGestureOwner: vi.fn(),
    setInputModalityFromPointerType: (): TimelineInputModality => 'mouse',
  }));
}

function pointerDownOn(
  target: HTMLElement,
  { clientX, clientY }: { clientX: number; clientY: number },
) {
  return {
    nativeEvent: { button: 0 } as PointerEvent,
    target,
    pointerId: 1,
    pointerType: 'mouse',
    clientX,
    clientY,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
  } as unknown as React.PointerEvent<HTMLElement>;
}

function dispatchPointer(type: 'pointermove' | 'pointerup', clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.assign(event, { pointerId: 1, clientX, clientY });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('useMarqueeSelect', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = mountEditArea();
    selectionMocks.userSelectTimelineClips.mockClear();
    selectionMocks.userClearAllSelection.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('selects the clips the marquee was dragged over', () => {
    const editAreaRef = { current: harness.editArea as HTMLElement | null };
    const { result } = renderMarquee(editAreaRef);

    // Canvas (10, 5) → viewport (110, 55). Drag to canvas (320, 80).
    act(() => {
      result.current.onPointerDown(pointerDownOn(harness.editArea, { clientX: 110, clientY: 55 }));
    });
    dispatchPointer('pointermove', 420, 130);
    dispatchPointer('pointerup', 420, 130);

    expect(selectionMocks.userSelectTimelineClips).toHaveBeenCalledTimes(1);
    const [selected, options] = selectionMocks.userSelectTimelineClips.mock.calls[0];
    expect(options).toEqual({ additive: false });
    expect([...selected].sort()).toEqual(['clip-mid', 'clip-near']);
  });

  it('clears the selection on a click that never moved', () => {
    const editAreaRef = { current: harness.editArea as HTMLElement | null };
    const { result } = renderMarquee(editAreaRef);

    act(() => {
      result.current.onPointerDown(pointerDownOn(harness.editArea, { clientX: 110, clientY: 55 }));
    });
    const upEvent = new Event('pointerup', { bubbles: true, cancelable: true }) as PointerEvent;
    Object.assign(upEvent, { pointerId: 1, clientX: 110, clientY: 55 });
    Object.defineProperty(upEvent, 'target', { value: harness.editArea });
    act(() => {
      harness.editArea.dispatchEvent(upEvent);
    });

    expect(selectionMocks.userClearAllSelection).toHaveBeenCalledTimes(1);
    expect(selectionMocks.userSelectTimelineClips).not.toHaveBeenCalled();
  });

  it('keeps the drawn rect and the selected set in one coordinate space across autoscroll', () => {
    const editAreaRef = { current: harness.editArea as HTMLElement | null };
    const { result } = renderMarquee(editAreaRef);

    // Anchor at canvas (10, 5) with the canvas unscrolled.
    act(() => {
      result.current.onPointerDown(pointerDownOn(harness.editArea, { clientX: 110, clientY: 55 }));
    });
    dispatchPointer('pointermove', 400, 130);

    // Autoscroll: the container scrolls right under a stationary pointer, then
    // the scroller re-runs the selection at the same client coordinates.
    act(() => {
      harness.scroll(300);
    });
    dispatchPointer('pointermove', 400, 130);

    const drawnRect = result.current.marqueeRect;
    expect(drawnRect).not.toBeNull();

    dispatchPointer('pointerup', 400, 130);

    const [selected] = selectionMocks.userSelectTimelineClips.mock.calls[0];
    // The highlighted rectangle is the contract the user sees; the committed
    // selection must be exactly the clips that rectangle covers.
    expect([...selected].sort()).toEqual(clipsCoveredByCanvasRect(drawnRect as MarqueeRect).sort());
  });

  it('grows the drawn rect by the scrolled distance during autoscroll', () => {
    const editAreaRef = { current: harness.editArea as HTMLElement | null };
    const { result } = renderMarquee(editAreaRef);

    act(() => {
      result.current.onPointerDown(pointerDownOn(harness.editArea, { clientX: 110, clientY: 55 }));
    });
    dispatchPointer('pointermove', 400, 130);
    const beforeScroll = result.current.marqueeRect as MarqueeRect;

    act(() => {
      harness.scroll(300);
    });
    dispatchPointer('pointermove', 400, 130);
    const afterScroll = result.current.marqueeRect as MarqueeRect;

    // The anchor is pinned to the canvas, so scrolling 300px right widens the
    // rect by 300px rather than sliding it.
    expect(afterScroll.x).toBe(beforeScroll.x);
    expect(afterScroll.width).toBe(beforeScroll.width + 300);
  });
});
