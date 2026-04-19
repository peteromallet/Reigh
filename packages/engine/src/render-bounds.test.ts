import { describe, expect, it } from 'vitest';
import {
  computeRenderBounds,
  computeViewportMediaLayout,
  getVisibleBoundsFromCrop,
} from './render-bounds';

describe('render-bounds', () => {
  it('intersects oversized bounds with the composition', () => {
    expect(computeRenderBounds(
      { x: 658, y: 0, width: 2256, height: 1692 },
      1920,
      1080,
    )).toEqual({
      x: 658,
      y: 0,
      width: 1262,
      height: 1080,
    });
  });

  it('computes visible bounds from crop fractions', () => {
    expect(getVisibleBoundsFromCrop(
      { x: 658, y: 0, width: 2256, height: 1692 },
      { cropRight: 0.53, cropBottom: 0.53 },
    )).toEqual({
      x: 658,
      y: 0,
      width: 1060.32,
      height: 795.24,
    });
  });

  it('builds a viewport media layout that preserves the cover slice inside the render intersection', () => {
    const layout = computeViewportMediaLayout({
      fullBounds: { x: 658, y: 0, width: 2256, height: 1692 },
      cropValues: { cropRight: 0.53, cropBottom: 0.53 },
      compositionWidth: 1920,
      compositionHeight: 1080,
      intrinsicWidth: 3000,
      intrinsicHeight: 1000,
    });

    expect(layout).not.toBeNull();
    expect(layout?.renderBounds).toEqual({
      x: 658,
      y: 0,
      width: 1060.32,
      height: 795.24,
    });
    expect(layout?.mediaBounds).toEqual({
      x: -1410,
      y: 0,
      width: 5076,
      height: 1692,
    });
  });

  it('returns null when nothing remains visible after composition clipping', () => {
    expect(computeViewportMediaLayout({
      fullBounds: { x: 2100, y: 1200, width: 200, height: 100 },
      compositionWidth: 1920,
      compositionHeight: 1080,
    })).toBeNull();
  });
});
