import { useMemo } from 'react';
import {
  isMobileUA as isMobileUaSignal,
  useIsMobile as useIsMobileSignal,
  useIsTablet as useIsTabletSignal,
  useIsTouchDevice as useIsTouchDeviceSignal,
} from './deviceSignals';
import { useDeviceInfo as useDeviceInfoSignal } from './responsiveViewModel';

export const isMobileUA = isMobileUaSignal;

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
