import { describe, expect, it } from 'vitest';
import {
  shouldEnableTimelinePinchZoom,
  shouldPinHoverAffordances,
  shouldTapTimelineToolButtons,
  type TimelineDeviceClass,
} from '@/tools/video-editor/lib/mobile-interaction-model';

const TOUCH_DEVICES: TimelineDeviceClass[] = ['phone', 'tablet'];

describe('touch affordance policies', () => {
  it('pins hover-revealed affordances open on touch devices only', () => {
    expect(shouldPinHoverAffordances('desktop')).toBe(false);
    TOUCH_DEVICES.forEach((deviceClass) => {
      expect(shouldPinHoverAffordances(deviceClass)).toBe(true);
    });
  });

  it('turns the drag-only timeline tool buttons into tap actions on touch devices only', () => {
    expect(shouldTapTimelineToolButtons('desktop')).toBe(false);
    TOUCH_DEVICES.forEach((deviceClass) => {
      expect(shouldTapTimelineToolButtons(deviceClass)).toBe(true);
    });
  });

  it('enables pinch zoom on touch devices only', () => {
    expect(shouldEnableTimelinePinchZoom('desktop')).toBe(false);
    TOUCH_DEVICES.forEach((deviceClass) => {
      expect(shouldEnableTimelinePinchZoom(deviceClass)).toBe(true);
    });
  });
});
