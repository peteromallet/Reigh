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
