import { useMemo } from 'react';
import {
  isMobileUA as isMobileUaSignal,
  isTabletHardware as isTabletHardwareSignal,
  useIsMobile as useIsMobileSignal,
  useIsTablet as useIsTabletSignal,
  useIsTouchDevice as useIsTouchDeviceSignal,
  useViewportWidth as useViewportWidthSignal,
} from './deviceSignals';
import { useDeviceInfo as useDeviceInfoSignal } from './responsiveViewModel';

export const isMobileUA = isMobileUaSignal;
export const isTabletHardware = isTabletHardwareSignal;

/** App-facing mobile signal, forced false in non-browser runtimes. */
export function useIsMobile() {
  const detected = useIsMobileSignal();
  if (typeof window === 'undefined') {
    return false;
  }
  return detected;
}

/** App-facing tablet signal, forced false in non-browser runtimes. */
export function useIsTablet() {
  const detected = useIsTabletSignal();
  if (typeof window === 'undefined') {
    return false;
  }
  return detected;
}

/** App-facing touch capability signal, forced false in non-browser runtimes. */
export function useIsTouchDevice() {
  const detected = useIsTouchDeviceSignal();
  if (typeof window === 'undefined') {
    return false;
  }
  return detected;
}

/** App-facing viewport width, forced to 0 in non-browser runtimes. */
export function useViewportWidth() {
  const detected = useViewportWidthSignal();
  if (typeof window === 'undefined') {
    return 0;
  }
  return detected;
}

/** Composite device view model with normalized base signals from this public module. */
export function useDeviceInfo() {
  const viewModel = useDeviceInfoSignal();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const isTouchDevice = useIsTouchDevice();

  return useMemo(() => ({
    ...viewModel,
    isTablet,
    isPhone: isMobile && !isTablet,
    isTouchDevice,
  }), [viewModel, isMobile, isTablet, isTouchDevice]);
}
