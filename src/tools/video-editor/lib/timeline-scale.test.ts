import { describe, expect, it } from 'vitest';
import {
  clampTimelineScaleWidth,
  computeTimelineExtent,
  createTimelineScale,
  MAX_TIMELINE_SCALE_WIDTH,
  MIN_TIMELINE_SCALE_WIDTH,
  maxClipEndSeconds,
  TIMELINE_TRAILING_RUNWAY_SECONDS,
  TIMELINE_ZOOM_STEP,
} from '@/tools/video-editor/lib/timeline-scale';

describe('createTimelineScale', () => {
  it('converts between time and pixel coordinates using the shared start offset', () => {
    const scale = createTimelineScale({ scale: 2, scaleWidth: 100, startLeft: 25 });

    expect(scale.pixelsPerSecond).toBe(50);
    expect(scale.timeToPixel(3)).toBe(175);
    expect(scale.pixelToTime(175)).toBe(3);
  });

  it('guards pixels-per-second against zero scale input', () => {
    const scale = createTimelineScale({ scale: 0, scaleWidth: 100, startLeft: 0 });

    expect(scale.pixelsPerSecond).toBeGreaterThan(0);
    expect(scale.pixelToTime(scale.timeToPixel(1.5))).toBeCloseTo(1.5, 5);
  });
});

describe('computeTimelineExtent', () => {
  const rows = [
    { actions: [{ end: 4 }, { end: 12 }] },
    { actions: [{ end: 31 }] },
  ];

  it('adds the trailing runway past the last clip by default', () => {
    expect(maxClipEndSeconds(rows)).toBe(31);
    expect(computeTimelineExtent({
      maxEndSeconds: 31,
      scale: 5,
      scaleWidth: 40,
      startLeft: 144,
    })).toEqual({
      scaleCount: Math.ceil((31 + TIMELINE_TRAILING_RUNWAY_SECONDS) / 5) + 1,
      totalWidth: 144 + (Math.ceil((31 + TIMELINE_TRAILING_RUNWAY_SECONDS) / 5) + 1) * 40,
    });
  });

  it('honours an explicit zero runway and the caller-supplied bounds', () => {
    expect(computeTimelineExtent({
      maxEndSeconds: 31,
      scale: 5,
      scaleWidth: 40,
      startLeft: 0,
      trailingRunwaySeconds: 0,
    }).scaleCount).toBe(8);
    expect(computeTimelineExtent({
      maxEndSeconds: 31,
      scale: 5,
      scaleWidth: 40,
      startLeft: 0,
      trailingRunwaySeconds: 0,
      maxScaleCount: 4,
    }).scaleCount).toBe(4);
    expect(computeTimelineExtent({
      maxEndSeconds: 0,
      scale: 5,
      scaleWidth: 40,
      startLeft: 0,
      trailingRunwaySeconds: 0,
      minScaleCount: 12,
    }).scaleCount).toBe(12);
  });

  it('guards against a zero scale', () => {
    expect(computeTimelineExtent({
      maxEndSeconds: 1,
      scale: 0,
      scaleWidth: 40,
      startLeft: 0,
      maxScaleCount: 9,
    }).scaleCount).toBe(9);
  });

  // The invariant behind Key Invariant 4: TimelineEditorCore owns the runway and
  // pins the canvas to its scaleCount, so the canvas's content-only derivation
  // can never disagree with the overlay width computed from the same extent.
  it('makes the canvas agree with its owner for every clip length', () => {
    for (const maxEndSeconds of [0, 0.4, 2, 17, 31, 240]) {
      const owner = computeTimelineExtent({ maxEndSeconds, scale: 5, scaleWidth: 40, startLeft: 144 });
      const canvas = computeTimelineExtent({
        maxEndSeconds,
        scale: 5,
        scaleWidth: 40,
        startLeft: 144,
        trailingRunwaySeconds: 0,
        minScaleCount: owner.scaleCount,
        maxScaleCount: owner.scaleCount,
      });

      expect(canvas).toEqual(owner);
    }
  });
});

describe('clampTimelineScaleWidth', () => {
  it('holds the zoom inside the bounds shared by the toolbar buttons and pinch', () => {
    expect(clampTimelineScaleWidth(MIN_TIMELINE_SCALE_WIDTH / TIMELINE_ZOOM_STEP)).toBe(MIN_TIMELINE_SCALE_WIDTH);
    expect(clampTimelineScaleWidth(MAX_TIMELINE_SCALE_WIDTH * TIMELINE_ZOOM_STEP)).toBe(MAX_TIMELINE_SCALE_WIDTH);
    expect(clampTimelineScaleWidth(160)).toBe(160);
  });
});
