// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { computeDropPosition } from '@/tools/video-editor/lib/drop-position';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data';

function makeTimelineData(): TimelineData {
  return {
    config: {
      output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      clips: [],
    },
    configVersion: 1,
    registry: { assets: {} },
    resolvedConfig: {
      output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      clips: [],
      registry: {},
    },
    rows: [{
      id: 'V1',
      actions: [{ id: 'existing', start: 0, end: 10, effectId: 'effect-existing' }],
    }],
    meta: {},
    effects: {},
    assetMap: {},
    output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    clipOrder: { V1: ['existing'] },
    signature: 'sig',
    stableSignature: 'stable-sig',
  };
}

function makeKindMismatchData(): TimelineData {
  return {
    ...makeTimelineData(),
    rows: [
      { id: 'A1', actions: [] },
      { id: 'V1', actions: [] },
    ],
    tracks: [
      { id: 'A1', kind: 'audio', label: 'A1' },
      { id: 'V1', kind: 'visual', label: 'V1' },
    ],
    clipOrder: { A1: [], V1: [] },
  };
}

function makeCollisionFallbackData(): TimelineData {
  return {
    ...makeTimelineData(),
    rows: [
      { id: 'V1', actions: [{ id: 'existing', start: 0, end: 10, effectId: 'effect-existing' }] },
      { id: 'V2', actions: [] },
    ],
    tracks: [
      { id: 'V1', kind: 'visual', label: 'V1' },
      { id: 'V2', kind: 'visual', label: 'V2' },
    ],
    clipOrder: { V1: ['existing'], V2: [] },
  };
}

/** Single empty visual row – no siblings to interfere with ghost geometry. */
function makeCleanData(): TimelineData {
  return {
    ...makeTimelineData(),
    rows: [{ id: 'V1', actions: [] }],
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    clipOrder: { V1: [] },
  };
}

function makeWrapper() {
  const wrapper = document.createElement('div');
  wrapper.className = 'timeline-wrapper';
  const editArea = document.createElement('div');
  editArea.className = 'timeline-canvas-edit-area';

  wrapper.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 100,
    width: 1000,
    height: 100,
    toJSON: () => ({}),
  });
  editArea.getBoundingClientRect = wrapper.getBoundingClientRect;

  wrapper.appendChild(editArea);
  document.body.appendChild(wrapper);

  return {
    wrapper,
    cleanup: () => wrapper.remove(),
  };
}

describe('computeDropPosition', () => {
  it('does not use long clip duration as the live edge-snap threshold', () => {
    const { wrapper, cleanup } = makeWrapper();
    try {
      const position = computeDropPosition({
        clientX: 500,
        clientY: 12,
        wrapper,
        dataRef: { current: makeTimelineData() },
        scale: 1,
        scaleWidth: 100,
        startLeft: 0,
        rowHeight: 36,
        sourceKind: 'visual',
        clipDuration: 1000,
        clipOffsetX: 0,
        excludeClipIds: new Set(['dragged']),
      });

      expect(position.time).toBe(5);
      expect(position.screenCoords.clipLeft).toBe(500);
      expect(position.screenCoords.clipWidth).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it('reroutes incompatible hovered rows to the nearest compatible track', () => {
    const { wrapper, cleanup } = makeWrapper();
    try {
      const position = computeDropPosition({
        clientX: 500,
        clientY: 12,
        wrapper,
        dataRef: { current: makeKindMismatchData() },
        scale: 1,
        scaleWidth: 100,
        startLeft: 0,
        rowHeight: 36,
        sourceKind: 'visual',
        clipDuration: 2,
        clipOffsetX: 0,
        excludeClipIds: new Set(['dragged']),
      });

      expect(position.trackId).toBe('V1');
      expect(position.rowIndex).toBe(1);
      expect(position.isNewTrack).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('falls back to the nearest compatible free track before requesting a new track', () => {
    const { wrapper, cleanup } = makeWrapper();
    try {
      const position = computeDropPosition({
        clientX: 500,
        clientY: 12,
        wrapper,
        dataRef: { current: makeCollisionFallbackData() },
        scale: 1,
        scaleWidth: 100,
        startLeft: 0,
        rowHeight: 36,
        sourceKind: 'visual',
        clipDuration: 2,
        clipOffsetX: 0,
        excludeClipIds: new Set(['dragged']),
      });

      expect(position.trackId).toBe('V2');
      expect(position.rowIndex).toBe(1);
      expect(position.isNewTrack).toBe(false);
    } finally {
      cleanup();
    }
  });
});

// ── Long-clip ghost clipping ───────────────────────────────────────────

describe('long-clip ghost clipping', () => {
  // All tests below use scale=1, scaleWidth=100, startLeft=0 → pixelsPerSecond=100.
  // The viewport is [0, 1000] (editRect.left=0, editRect.right=1000).
  // clipOffsetX is deliberately omitted (undefined) so effectiveOffsetX defaults
  // to (clipDuration * pixelsPerSecond) / 2, which centers the long clip on the pointer.

  it('clamps ghost to the visible left edge when true start is offscreen left', () => {
    const { wrapper, cleanup } = makeWrapper();
    try {
      const editArea = wrapper.querySelector('.timeline-canvas-edit-area')! as HTMLElement;
      // scrollLeft=200 ensures leftInGrid stays non-negative while trueLeft dips below 0.
      // Without this scroll, leftInGrid would be negative → time clamped to 0 → trueLeft=0.
      Object.defineProperty(editArea, 'scrollLeft', {
        value: 200,
        writable: true,
        configurable: true,
      });

      const position = computeDropPosition({
        clientX: 300,
        clientY: 12,
        wrapper,
        dataRef: { current: makeCleanData() },
        scale: 1,
        scaleWidth: 100,
        startLeft: 0,
        rowHeight: 36,
        sourceKind: 'visual',
        clipDuration: 10,
        // effectiveOffsetX = (10*100)/2 = 500
        // trueLeft = clientX - effectiveOffsetX = 300 - 500 = -200
        excludeClipIds: new Set(['dragged']),
      });

      // Ghost clips to the visible left edge since trueLeft is negative.
      expect(position.screenCoords.clipLeft).toBe(0);
      // Ghost has nonzero width because the true rectangle ([-200, 800]) intersects the viewport.
      expect(position.screenCoords.clipWidth).toBeGreaterThan(0);
      expect(position.screenCoords.clipWidth).toBe(800); // min(800, 1000) - 0
      // The line/label anchor stays at trueLeft so the time label remains accurate.
      expect(position.screenCoords.ghostCenter).toBe(-200);

      // Target resolution stays kind-compatible.
      expect(position.trackId).toBe('V1');
      expect(position.trackKind).toBe('visual');
      expect(position.isReject).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('clamps ghost to the visible right edge when true end is offscreen right', () => {
    const { wrapper, cleanup } = makeWrapper();
    try {
      const position = computeDropPosition({
        clientX: 800,
        clientY: 12,
        wrapper,
        dataRef: { current: makeCleanData() },
        scale: 1,
        scaleWidth: 100,
        startLeft: 0,
        rowHeight: 36,
        sourceKind: 'visual',
        clipDuration: 10,
        clipOffsetX: 0, // clip starts exactly at pointer; no centering
        // effectiveOffsetX=0, trueLeft=timeToPixel(8)=800, trueRight=800+1000=1800
        excludeClipIds: new Set(['dragged']),
      });

      // Ghost starts at trueLeft=800 (inside the viewport).
      expect(position.screenCoords.clipLeft).toBe(800);
      // Ghost width is clipped to the viewport right edge: min(1800, 1000) - 800 = 200.
      expect(position.screenCoords.clipWidth).toBe(200);
      expect(position.screenCoords.clipWidth).toBeGreaterThan(0);
      // Anchor stays at trueLeft.
      expect(position.screenCoords.ghostCenter).toBe(800);

      // Kind-compatible resolution is preserved.
      expect(position.trackId).toBe('V1');
      expect(position.trackKind).toBe('visual');
    } finally {
      cleanup();
    }
  });

  it('sets ghost width to zero when the true rectangle is fully outside the viewport (right)', () => {
    const { wrapper, cleanup } = makeWrapper();
    try {
      const position = computeDropPosition({
        clientX: 400,
        clientY: 12,
        wrapper,
        dataRef: { current: makeCleanData() },
        scale: 1,
        scaleWidth: 100,
        startLeft: 0,
        rowHeight: 36,
        sourceKind: 'visual',
        clipDuration: 1,
        clipOffsetX: -600,
        // effectiveOffsetX = -600, leftInGrid = 400 + 600 = 1000, time = 10
        // trueLeft = timeToPixel(10) = 1000, trueRight = 1000 + 100 = 1100
        // intersects = 1000 < 1000 → false
        excludeClipIds: new Set(['dragged']),
      });

      // Ghost width is zero when the true rectangle doesn't intersect the viewport.
      expect(position.screenCoords.clipWidth).toBe(0);
      // ghostLeft falls back to visibleLeft when there's no intersection.
      expect(position.screenCoords.clipLeft).toBe(0);

      // The plan itself is still valid; the clip is just offscreen.
      expect(position.plan?.valid).toBe(true);
      expect(position.plan?.rejectReason).toBeNull();
      expect(position.trackId).toBe('V1');
    } finally {
      cleanup();
    }
  });

  it('sets ghost width to zero when true rectangle is fully left of the viewport', () => {
    const { wrapper, cleanup } = makeWrapper();
    try {
      const editArea = wrapper.querySelector('.timeline-canvas-edit-area')! as HTMLElement;
      // scrollLeft ensures leftInGrid stays positive even though the clip
      // rectangle ends up entirely left of the visible viewport.
      Object.defineProperty(editArea, 'scrollLeft', {
        value: 2000,
        writable: true,
        configurable: true,
      });

      const position = computeDropPosition({
        clientX: 100,
        clientY: 12,
        wrapper,
        dataRef: { current: makeCleanData() },
        scale: 1,
        scaleWidth: 100,
        startLeft: 0,
        rowHeight: 36,
        sourceKind: 'visual',
        clipDuration: 1,
        clipOffsetX: 3500,
        // effectiveOffsetX = 3500, leftInGrid = 100 + 2000 - 3500 = -1400 → time=0
        // trueLeft = timeToPixel(0) - 2000 = -2000, trueRight = -2000 + 100 = -1900
        // intersects = -2000 < 1000 && -1900 > 0 = true && false = false
        excludeClipIds: new Set(['dragged']),
      });

      expect(position.screenCoords.clipWidth).toBe(0);
      expect(position.screenCoords.clipLeft).toBe(0);
      expect(position.plan?.valid).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('preserves kind-compatible target resolution with long offscreen clips', () => {
    const { wrapper, cleanup } = makeWrapper();
    try {
      const editArea = wrapper.querySelector('.timeline-canvas-edit-area')! as HTMLElement;
      Object.defineProperty(editArea, 'scrollLeft', {
        value: 200,
        writable: true,
        configurable: true,
      });

      const position = computeDropPosition({
        clientX: 300,
        clientY: 18, // row 0 (audio) — kind mismatch triggers reroute to row 1 (visual)
        wrapper,
        dataRef: { current: makeKindMismatchData() },
        scale: 1,
        scaleWidth: 100,
        startLeft: 0,
        rowHeight: 36,
        sourceKind: 'visual',
        clipDuration: 10,
        // trueLeft ≈ 300 - 500 = -200 (offscreen left)
        excludeClipIds: new Set(['dragged']),
      });

      // Even with the ghost partially offscreen, kind resolution still
      // redirects from the audio row (row 0) to the nearest visual row (row 1).
      expect(position.trackId).toBe('V1');
      expect(position.rowIndex).toBe(1);
      expect(position.trackKind).toBe('visual');
      expect(position.isReject).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('shows ghost spanning the full visible viewport when both true edges are offscreen', () => {
    // ADOS-shaped clip: trueLeft < 0 AND trueRight > viewport width.
    // Ghost should span [visibleLeft, visibleRight] = [0, 1000], anchor stays at trueLeft.
    const { wrapper, cleanup } = makeWrapper();
    try {
      const editArea = wrapper.querySelector('.timeline-canvas-edit-area')! as HTMLElement;
      Object.defineProperty(editArea, 'scrollLeft', {
        value: 500,
        writable: true,
        configurable: true,
      });

      const position = computeDropPosition({
        clientX: 200,
        clientY: 12,
        wrapper,
        dataRef: { current: makeCleanData() },
        scale: 1,
        scaleWidth: 100,
        startLeft: 0,
        rowHeight: 36,
        sourceKind: 'visual',
        clipDuration: 1590,
        clipOffsetX: 10000,
        // effectiveOffsetX = 10000.
        // leftInGrid = clientX + scrollLeft - effectiveOffsetX = 200 + 500 - 10000 = -9300 → time=0.
        // trueLeft = timeToPixel(0) - scrollLeft = 0 - 500 = -500.
        // trueRight = trueLeft + pixelWidth(1590 * 100) = -500 + 159000 = 158500.
        // intersects: -500 < 1000 ∧ 158500 > 0 → true.
        // ghostLeft = max(-500, 0) = 0, ghostWidth = min(158500, 1000) - 0 = 1000.
        excludeClipIds: new Set(['dragged']),
      });

      // Ghost spans the full visible viewport when true rectangle exceeds both edges.
      expect(position.screenCoords.clipLeft).toBe(0);
      expect(position.screenCoords.clipWidth).toBe(1000);
      expect(position.screenCoords.clipWidth).toBeGreaterThan(0);
      // Anchor stays at trueLeft (offscreen left), so the time label stays accurate.
      expect(position.screenCoords.ghostCenter).toBeLessThan(0);
    } finally {
      cleanup();
    }
  });
});
