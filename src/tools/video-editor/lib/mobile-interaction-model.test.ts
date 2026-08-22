import { describe, expect, it } from 'vitest';
import {
  areTimelineInteractionTargetsEqual,
  createMobileInteractionPolicy,
  resolveTimelineDeviceClass,
  shouldEnableTimelinePinchZoom,
  shouldPinHoverAffordances,
  shouldTapTimelineToolButtons,
  type TimelineDeviceClass,
  type TimelineGestureOwner,
  type TimelineInteractionTarget,
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

describe('gesture owner', () => {
  it('accepts overlay as a host-internal gesture owner', () => {
    // Overlay contributions own the pointer while they hold the host claim;
    // the owner value has to exist before the claim record can set it.
    const owner: TimelineGestureOwner = 'overlay';
    expect(owner).toBe('overlay');
  });

  it('accepts an overlay interaction target alongside the overlay owner', () => {
    // The host points context/inspector targets at the claimed overlay.
    const target: TimelineInteractionTarget = {
      kind: 'overlay',
      extensionId: 'com.example.overlay',
      contributionId: 'ov.markers',
    };
    expect(target.kind).toBe('overlay');
    expect(target.extensionId).toBe('com.example.overlay');
    expect(target.contributionId).toBe('ov.markers');
  });

  it('does not expose a public gesture-owner setter or lease model', async () => {
    // The host assigns overlay ownership through its internal claim record;
    // there must be no exported mutator or lease API for extensions to reach.
    const mod = await import('@/tools/video-editor/lib/mobile-interaction-model');
    const exportedNames = Object.keys(mod);
    expect(
      exportedNames.some((name) =>
        /setGestureOwner|leaseGesture|claimGesture|grantGesture|acquireGesture/i.test(name),
      ),
    ).toBe(false);
  });

  it('starts every policy with no gesture owner', () => {
    // Ownership begins unclaimed; only a host gesture (or a later overlay
    // claim) may change it.
    expect(createMobileInteractionPolicy('desktop').gestureOwner).toBe('none');
    expect(createMobileInteractionPolicy('tablet').gestureOwner).toBe('none');
    expect(createMobileInteractionPolicy('phone').gestureOwner).toBe('none');
  });
});

describe('data lane interaction targets', () => {
  it('accepts dataLane and dataItem as valid target kinds', () => {
    const laneTarget: TimelineInteractionTarget = { kind: 'dataLane', laneId: 'transcript' };
    const itemTarget: TimelineInteractionTarget = {
      kind: 'dataItem',
      laneId: 'transcript',
      itemId: 'asset-1:0',
    };

    expect(laneTarget.kind).toBe('dataLane');
    expect(itemTarget.kind).toBe('dataItem');
  });

  it('adds no gesture owner for the data target kinds', () => {
    expect(createMobileInteractionPolicy('desktop').gestureOwner).toBe('none');
  });

  it('treats targets differing only by laneId or itemId as distinct', () => {
    const base = { kind: 'dataItem' as const, laneId: 'transcript', itemId: 'asset-1:0' };

    expect(areTimelineInteractionTargetsEqual(base, { ...base })).toBe(true);
    expect(areTimelineInteractionTargetsEqual(base, { ...base, itemId: 'asset-1:1' })).toBe(false);
    expect(areTimelineInteractionTargetsEqual(base, { ...base, laneId: 'notes' })).toBe(false);
    expect(areTimelineInteractionTargetsEqual(base, { kind: 'dataItem', itemId: 'asset-1:0' })).toBe(false);
  });

  it('keeps absent optional lane ids equal on both sides', () => {
    expect(areTimelineInteractionTargetsEqual({ kind: 'dataLane' }, { kind: 'dataLane' })).toBe(true);
    expect(areTimelineInteractionTargetsEqual({ kind: 'dataLane', laneId: 'a' }, { kind: 'dataLane' })).toBe(false);
    expect(areTimelineInteractionTargetsEqual({ kind: 'clip', clipId: 'c1' }, { kind: 'clip', clipId: 'c1' })).toBe(true);
  });
});
