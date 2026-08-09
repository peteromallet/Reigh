export interface TimelineScaleOptions {
  scale: number;
  scaleWidth: number;
  startLeft: number;
}

export interface TimelineScale {
  pixelsPerSecond: number;
  timeToPixel: (time: number) => number;
  pixelToTime: (pixel: number) => number;
}

/** Zoom bounds shared by the toolbar +/- buttons and the touch pinch gesture. */
export const MIN_TIMELINE_SCALE_WIDTH = 40;
export const MAX_TIMELINE_SCALE_WIDTH = 500;
/** Multiplier applied by one press of the toolbar zoom in/out buttons. */
export const TIMELINE_ZOOM_STEP = 1.4;

export const clampTimelineScaleWidth = (scaleWidth: number): number =>
  Math.min(MAX_TIMELINE_SCALE_WIDTH, Math.max(MIN_TIMELINE_SCALE_WIDTH, scaleWidth));

/**
 * Empty runway kept past the last clip so a clip can be dragged beyond the
 * current end of the timeline. Owned by the editor, not the canvas.
 */
export const TIMELINE_TRAILING_RUNWAY_SECONDS = 20;

export interface TimelineExtentOptions {
  /** End time of the last clip on any row, in seconds. */
  maxEndSeconds: number;
  /** Seconds per ruler division (`SCALE_SECONDS`), not the zoom. */
  scale: number;
  /** Pixels per division — the zoom level. */
  scaleWidth: number;
  startLeft: number;
  /**
   * Defaults to `TIMELINE_TRAILING_RUNWAY_SECONDS`. `TimelineCanvas` passes 0:
   * it derives from content only, and its owner supplies the runway through
   * `minScaleCount`/`maxScaleCount`.
   */
  trailingRunwaySeconds?: number;
  minScaleCount?: number;
  maxScaleCount?: number;
}

export interface TimelineExtent {
  /** Number of ruler divisions the timeline spans. */
  scaleCount: number;
  /** Ruler, grid, scroll-content and overlay width in pixels. */
  totalWidth: number;
}

/**
 * The single owner of timeline width. Ruler, grid, scroll content and the
 * overlay host all size themselves from this — they must agree, so they share
 * one formula rather than three copies of it.
 */
export const computeTimelineExtent = ({
  maxEndSeconds,
  scale,
  scaleWidth,
  startLeft,
  trailingRunwaySeconds = TIMELINE_TRAILING_RUNWAY_SECONDS,
  minScaleCount,
  maxScaleCount,
}: TimelineExtentOptions): TimelineExtent => {
  const derived = Math.ceil(
    (maxEndSeconds + trailingRunwaySeconds) / Math.max(scale, Number.EPSILON),
  ) + 1;
  const lowerBounded = minScaleCount === undefined ? derived : Math.max(derived, minScaleCount);
  const scaleCount = maxScaleCount === undefined ? lowerBounded : Math.min(lowerBounded, maxScaleCount);

  return {
    scaleCount,
    totalWidth: startLeft + scaleCount * scaleWidth,
  };
};

/** End time of the last clip across every row — the extent's only data input. */
export const maxClipEndSeconds = (
  rows: readonly { actions: readonly { end: number }[] }[],
): number => rows.reduce(
  (currentMax, row) => row.actions.reduce((rowMax, action) => Math.max(rowMax, action.end), currentMax),
  0,
);

export const createTimelineScale = ({
  scale,
  scaleWidth,
  startLeft,
}: TimelineScaleOptions): TimelineScale => {
  const pixelsPerSecond = scaleWidth / Math.max(scale, Number.EPSILON);

  return {
    pixelsPerSecond,
    timeToPixel: (time: number) => startLeft + time * pixelsPerSecond,
    pixelToTime: (pixel: number) => (pixel - startLeft) / pixelsPerSecond,
  };
};
