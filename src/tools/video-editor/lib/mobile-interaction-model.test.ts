import { describe, expect, it } from 'vitest';
import {
  resolveTimelineDeviceClass,
  shouldEnableTimelinePinchZoom,
  shouldPinHoverAffordances,
  shouldTapTimelineToolButtons,
  type TimelineDeviceClass,
} from '@/tools/video-editor/lib/mobile-interaction-model';

const TOUCH_DEVICES: TimelineDeviceClass[] = ['phone', 'tablet'];

describe('device class', () => {
  it('gives a desktop with a touchscreen the desktop editor, not the phone one', () => {
    // 27-inch touch monitor: coarse pointer (so computeIsMobile is true) at a
    // width no tablet reaches, and no tablet UA.
    expect(resolveTimelineDeviceClass({
      isMobile: true,
      isTablet: false,
      viewportWidth: 2560,
      isTabletHardware: false,
    })).toBe('desktop');
  });

  it('keeps an iPad Pro in landscape on the tablet editor past the tablet width bound', () => {
    // 1366px exceeds computeIsTablet's width band; only the hardware hint saves it.
    expect(resolveTimelineDeviceClass({
      isMobile: true,
      isTablet: false,
      viewportWidth: 1366,
      isTabletHardware: true,
    })).toBe('tablet');
  });

  it('still classifies mid-width coarse-pointer viewports as phone', () => {
    // Pinned, not changed: below the tablet bound the pre-existing verdict stands.
    expect(resolveTimelineDeviceClass({
      isMobile: true,
      isTablet: false,
      viewportWidth: 800,
      isTabletHardware: false,
    })).toBe('phone');
  });

  it('classifies a small touch viewport as phone', () => {
    expect(resolveTimelineDeviceClass({
      isMobile: true,
      isTablet: false,
      viewportWidth: 420,
      isTabletHardware: false,
    })).toBe('phone');
  });

  it('keeps the tablet signal and the plain desktop verdict unchanged', () => {
    expect(resolveTimelineDeviceClass({
      isMobile: true,
      isTablet: true,
      viewportWidth: 1024,
      isTabletHardware: true,
    })).toBe('tablet');
    expect(resolveTimelineDeviceClass({
      isMobile: false,
      isTablet: false,
      viewportWidth: 1600,
      isTabletHardware: false,
    })).toBe('desktop');
  });
});

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
