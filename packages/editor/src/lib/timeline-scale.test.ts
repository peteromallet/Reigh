import { describe, expect, it } from 'vitest';
import { createTimelineScale } from './timeline-scale';

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
