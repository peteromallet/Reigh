import * as React from 'react';
import {
  MOBILE_BREAKPOINT,
  computeIsMobile,
  computeIsTablet,
  computeIsTouchDevice,
  isMobileUA,
  isTabletHardware,
} from '@/shared/hooks/mobile/deviceDetection';
import { reportNonFatalMobileError } from '@/shared/hooks/mobile/mobileErrorReporter';

export { isMobileUA, isTabletHardware };

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => computeIsMobile(reportNonFatalMobileError));

  React.useEffect(() => {
    const mqWidth = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const mqPointer = window.matchMedia('(pointer: coarse)');

    const onChange = () => setIsMobile(computeIsMobile(reportNonFatalMobileError));

    mqWidth.addEventListener('change', onChange);
    mqPointer.addEventListener('change', onChange);
    window.addEventListener('resize', onChange);

    return () => {
      mqWidth.removeEventListener('change', onChange);
      mqPointer.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

  return isMobile;
}

// Hook to detect tablet specifically (iPad-like devices)
// Tablets can lock one pane at a time, unlike phones.
export function useIsTablet() {
  const [isTablet, setIsTablet] = React.useState<boolean>(() => computeIsTablet(reportNonFatalMobileError));

  React.useEffect(() => {
    // Mirror useIsMobile's listener set: computeIsTablet reads pointer coarseness
    // as well as width, so a pointer change (plugging in a touchscreen) must
    // re-evaluate both signals or they transiently disagree.
    const mqPointer = window.matchMedia('(pointer: coarse)');
    const onChange = () => setIsTablet(computeIsTablet(reportNonFatalMobileError));

    mqPointer.addEventListener('change', onChange);
    window.addEventListener('resize', onChange);

    return () => {
      mqPointer.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

  return isTablet;
}

/**
 * Reactive viewport width in CSS pixels; `0` in non-browser runtimes.
 *
 * The boolean signals above collapse width into a verdict. Consumers that have
 * to reason about the width itself — e.g. telling a desktop-sized touchscreen
 * apart from a tablet — need the number, not the verdict.
 */
export function useViewportWidth() {
  const [width, setWidth] = React.useState<number>(() => (
    typeof window === 'undefined' ? 0 : window.innerWidth
  ));

  React.useEffect(() => {
    const onChange = () => setWidth(window.innerWidth);

    // Resolve once on mount: an SSR/hydration pass seeded 0.
    onChange();
    window.addEventListener('resize', onChange);

    return () => {
      window.removeEventListener('resize', onChange);
    };
  }, []);

  return width;
}

/** Touch-capable device (phones, tablets, touch laptops). */
export function useIsTouchDevice() {
  const [isTouchDevice, setIsTouchDevice] = React.useState<boolean>(() => computeIsTouchDevice(reportNonFatalMobileError));

  React.useEffect(() => {
    const onChange = () => setIsTouchDevice(computeIsTouchDevice(reportNonFatalMobileError));

    window.addEventListener('resize', onChange);

    return () => {
      window.removeEventListener('resize', onChange);
    };
  }, []);

  return isTouchDevice;
}
