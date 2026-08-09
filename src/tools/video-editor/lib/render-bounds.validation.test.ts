import { describe, expect, it } from 'vitest';
import { configToRows, rowsToConfig } from '@/tools/video-editor/lib/timeline-data';
import {
  computeRenderBounds,
  computeViewportMediaLayout,
  getVisibleBoundsFromCrop,
} from '@/tools/video-editor/lib/render-bounds';
import type { TimelineConfig } from '@/tools/video-editor/types';

const composition = { width: 1920, height: 1080 };
const intrinsic = { width: 3000, height: 1000 };
const crop = { cropRight: 0.53, cropBottom: 0.53 };

const expectOverlayAndRenderToMatch = (fullBounds: { x: number; y: number; width: number; height: number }) => {
  const visibleBounds = getVisibleBoundsFromCrop(fullBounds, crop);
  const overlayBounds = computeRenderBounds(visibleBounds, composition.width, composition.height);
  const renderLayout = computeViewportMediaLayout({
    fullBounds,
    cropValues: crop,
    compositionWidth: composition.width,
    compositionHeight: composition.height,
    intrinsicWidth: intrinsic.width,
    intrinsicHeight: intrinsic.height,
  });

  expect(renderLayout).not.toBeNull();
  expect(renderLayout?.renderBounds).toEqual(overlayBounds);
};

const roundTripConfig = (config: TimelineConfig): TimelineConfig => {
  const { rows, meta, clipOrder, tracks } = configToRows(config);
  return rowsToConfig(
    rows,
    meta,
    config.output,
    clipOrder,
    tracks,
    config.pinnedShotGroups,
  );
};

describe('render bounds validation', () => {
  it('matches overlay and render bounds for the large cropped clip case', () => {
    expectOverlayAndRenderToMatch({ x: 658, y: 0, width: 2256, height: 1692 });
  });

  it('keeps overlay and render bounds aligned while a large cropped clip moves', () => {
    expectOverlayAndRenderToMatch({ x: 658, y: 0, width: 2256, height: 1692 });
    expectOverlayAndRenderToMatch({ x: 320, y: 120, width: 2256, height: 1692 });
    expectOverlayAndRenderToMatch({ x: -180, y: 40, width: 2256, height: 1692 });
  });

  it('keeps overlay and render bounds aligned after a same-aspect resize', () => {
    expectOverlayAndRenderToMatch({ x: 658, y: 0, width: 1800, height: 1350 });
  });

  it('leaves in-bounds clips visually unchanged', () => {
    const fullBounds = { x: 100, y: 80, width: 640, height: 360 };
    const renderLayout = computeViewportMediaLayout({
      fullBounds,
      compositionWidth: composition.width,
      compositionHeight: composition.height,
      intrinsicWidth: 640,
      intrinsicHeight: 360,
    });

    expect(renderLayout?.renderBounds).toEqual(fullBounds);
    expect(renderLayout?.mediaBounds).toEqual({ x: 0, y: 0, width: 640, height: 360 });
  });

  it('updates render bounds consistently as crop expands and contracts', () => {
    const fullBounds = { x: 658, y: 0, width: 2256, height: 1692 };
    const tighterCrop = { cropRight: 0.53, cropBottom: 0.53 };
    const looserCrop = { cropRight: 0.2, cropBottom: 0.15 };
    const tighterLayout = computeViewportMediaLayout({
      fullBounds,
      cropValues: tighterCrop,
      compositionWidth: composition.width,
      compositionHeight: composition.height,
      intrinsicWidth: intrinsic.width,
      intrinsicHeight: intrinsic.height,
    });
    const looserLayout = computeViewportMediaLayout({
      fullBounds,
      cropValues: looserCrop,
      compositionWidth: composition.width,
      compositionHeight: composition.height,
      intrinsicWidth: intrinsic.width,
      intrinsicHeight: intrinsic.height,
    });

    expect(tighterLayout?.renderBounds).toEqual(
      computeRenderBounds(getVisibleBoundsFromCrop(fullBounds, tighterCrop), composition.width, composition.height),
    );
    expect(looserLayout?.renderBounds).toEqual(
      computeRenderBounds(getVisibleBoundsFromCrop(fullBounds, looserCrop), composition.width, composition.height),
    );
    expect((looserLayout?.renderBounds.width ?? 0)).toBeGreaterThan(tighterLayout?.renderBounds.width ?? 0);
    expect((looserLayout?.renderBounds.height ?? 0)).toBeGreaterThan(tighterLayout?.renderBounds.height ?? 0);
  });

  it('preserves stored clip values across editor round-trip serialization', () => {
    const config: TimelineConfig = {
      output: {
        resolution: '1920x1080',
        fps: 30,
        file: 'out.mp4',
      },
      tracks: [
        {
          id: 'V1',
          kind: 'visual',
          label: 'Visual',
          fit: 'manual',
        },
      ],
      clips: [
        {
          id: 'clip-1',
          at: 0,
          track: 'V1',
          clipType: 'hold',
          asset: 'image-1',
          hold: 5,
          x: 658,
          y: 0,
          width: 2256,
          height: 1692,
          cropRight: 0.53,
          cropBottom: 0.53,
          opacity: 1,
        },
      ],
      pinnedShotGroups: [
        {
          shotId: 'shot-1',
          trackId: 'V1',
          clipIds: ['clip-1'],
          mode: 'images',
        },
      ],
    };
    const nextConfig = roundTripConfig(config);
    const [nextClip] = nextConfig.clips;

    expect(nextClip).toMatchObject({
      id: 'clip-1',
      x: 658,
      y: 0,
      width: 2256,
      height: 1692,
      cropRight: 0.53,
      cropBottom: 0.53,
      opacity: 1,
    });
    expect(nextConfig.pinnedShotGroups).toEqual([{
      shotId: 'shot-1',
      trackId: 'V1',
      clipIds: ['clip-1'],
      mode: 'images',
      videoAssetKey: undefined,
      imageClipSnapshot: undefined,
    }]);
  });

  it('preserves adjacent grouped hold boundaries across repeated editor round-trips', () => {
    // The commit funnel snaps timeline times to the frame grid
    // (`lib/time-grid.ts`): the seeded off-grid values (1.3334 s is 40.002
    // frames at 30fps) land on exact frame instants on the FIRST round-trip
    // and are bit-stable ever after. What this test protects — adjacent
    // grouped boundaries stay coincident, nothing drifts across cycles —
    // still holds; only the resting values moved onto the grid.
    const expectedBoundary = 2.3333; // frame 70 @30fps, 4-decimal serialized
    let nextConfig: TimelineConfig = {
      output: {
        resolution: '1920x1080',
        fps: 30,
        file: 'out.mp4',
      },
      tracks: [
        {
          id: 'V1',
          kind: 'visual',
          label: 'Visual',
        },
      ],
      clips: [
        {
          id: 'clip-left',
          at: 1,
          track: 'V1',
          clipType: 'hold',
          hold: 1.3334,
        },
        {
          id: 'clip-right',
          at: expectedBoundary,
          track: 'V1',
          clipType: 'hold',
          hold: 0.6666,
        },
      ],
      pinnedShotGroups: [
        {
          shotId: 'shot-1',
          trackId: 'V1',
          clipIds: ['clip-left', 'clip-right'],
          mode: 'images',
        },
      ],
    };

    for (let cycle = 0; cycle < 6; cycle += 1) {
      nextConfig = roundTripConfig(nextConfig);
      const [leftClip, rightClip] = nextConfig.clips;
      const serializedBoundary = leftClip.at + (leftClip.hold ?? 0);

      expect(leftClip.at).toBe(1);
      expect(leftClip.hold).toBeCloseTo(1.3333, 10);
      expect(serializedBoundary).toBeCloseTo(expectedBoundary, 10);
      expect(rightClip.at).toBeCloseTo(expectedBoundary, 10);
      expect(rightClip.at).toBeCloseTo(serializedBoundary, 10);
      expect(rightClip.hold).toBeCloseTo(0.6667, 10);
      expect(rightClip.at + (rightClip.hold ?? 0)).toBeCloseTo(3, 10);
    }
  });
});
