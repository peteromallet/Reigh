import { useState, useEffect, useRef, useCallback, RefCallback, RefObject } from 'react';

/**
 * Hook to measure a container's width using ResizeObserver.
 * Returns the current width and a ref to attach to the container.
 *
 * Uses window.innerWidth as initial estimate to avoid layout shift on first render.
 * Only updates width when layout is stable (avoids intermediate states during mount).
 *
 * @returns [ref, width] - Attach ref to container, width updates on resize
 */
export function useContainerWidth(): [RefCallback<HTMLDivElement>, number] {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setContainerRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    containerRef.current = node;
  }, []);
  // Start with window width as estimate to avoid 0 on first render
  const initialEstimate = typeof window !== 'undefined'
    ? Math.floor(window.innerWidth * 0.9)
    : 800;
  const [width, setWidth] = useState(initialEstimate);
  const hasReceivedStableWidth = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Set up ResizeObserver - this is the source of truth for width
    // Debounced to avoid rapid recalculations during animated resizes (e.g. pane lock/unlock)
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        if (newWidth <= 0) continue;

        if (!hasReceivedStableWidth.current) {
          // First measurement: apply immediately to prevent layout flash
          // (e.g. gallery in a narrow panel starts with full-viewport estimate)
          hasReceivedStableWidth.current = true;
          setWidth(newWidth);
        } else {
          // Subsequent measurements: debounce for smooth animated resizes
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => setWidth(newWidth), 150);
        }
      }
    });

    resizeObserver.observe(element);

    // Fallback: if ResizeObserver hasn't fired after a short delay, use offsetWidth
    const fallbackTimeout = setTimeout(() => {
      if (!hasReceivedStableWidth.current && element.offsetWidth > 0) {
        setWidth(element.offsetWidth);
      }
    }, 100);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(fallbackTimeout);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [initialEstimate]);

  return [setContainerRef, width];
}

interface ContainerDimensions {
  width: number;
  height: number;
}

/**
 * Hook to measure a container's width and the full viewport height.
 * Returns dimensions and a ref to attach to the container.
 *
 * Width: measured from the container element
 * Height: full viewport height (window.innerHeight) minus an offset for controls
 *
 * This is used for calculating how many gallery rows fit in a full viewport,
 * regardless of scroll position or where the gallery is on the page.
 *
 * @param heightOffset - Pixels to subtract from viewport height (e.g., for header + pagination)
 * @param skipHeaderDetection - Skip auto-detecting sticky/fixed headers (e.g., on mobile where there's no header)
 * @returns [ref, dimensions] - Attach ref to container, dimensions update on resize
 */
export function useContainerDimensions(
  heightOffset: number = 0,
  skipHeaderDetection: boolean = false
): [RefObject<HTMLDivElement | null>, ContainerDimensions] {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Start with window dimensions as estimate
  const initialWidthEstimate = typeof window !== 'undefined'
    ? Math.floor(window.innerWidth * 0.9)
    : 800;
  const initialHeightEstimate = typeof window !== 'undefined'
    ? window.innerHeight - heightOffset
    : 600;

  const [dimensions, setDimensions] = useState<ContainerDimensions>({
    width: initialWidthEstimate,
    height: initialHeightEstimate,
  });
  const hasReceivedStableDimensions = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateDimensions = () => {
      const newWidth = element.getBoundingClientRect().width;

      // Detect sticky/fixed header height by scanning for header-like elements
      // pinned at the top of the viewport (the site header is a sibling, not ancestor)
      // Skip on mobile/iPad where there's no fixed header
      let fixedChromeHeight = 0;
      if (!skipHeaderDetection) {
        const candidates = document.querySelectorAll('[class*="sticky"], [class*="fixed"]');
        for (const el of candidates) {
          const style = getComputedStyle(el);
          if (style.position !== 'sticky' && style.position !== 'fixed') continue;
          const rect = el.getBoundingClientRect();
          // Must be at the top (within 10px) and header-sized (under 200px)
          if (rect.top <= 10 && rect.height > 0 && rect.height < 200) {
            fixedChromeHeight = Math.max(fixedChromeHeight, rect.height);
          }
        }
      }

      // Available height = viewport - fixed header - caller's offset (pagination, gallery chrome, etc.)
      const availableHeight = window.innerHeight - fixedChromeHeight - heightOffset;

      // Only accept dimensions that are reasonable
      if (newWidth > initialWidthEstimate * 0.5 && availableHeight > 200) {
        hasReceivedStableDimensions.current = true;
        setDimensions({
          width: newWidth,
          height: Math.max(200, availableHeight),
        });
      }
    };

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateDimensions, 150);
    };

    // Set up ResizeObserver for container width changes
    // Debounced to avoid rapid recalculations during animated resizes (e.g. pane lock/unlock)
    const resizeObserver = new ResizeObserver(() => {
      debouncedUpdate();
    });

    resizeObserver.observe(element);

    // Also listen to window resize for viewport height changes
    window.addEventListener('resize', debouncedUpdate);

    // Initial measurement after a short delay for layout stability
    const fallbackTimeout = setTimeout(() => {
      if (!hasReceivedStableDimensions.current) {
        updateDimensions();
      }
    }, 100);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', debouncedUpdate);
      clearTimeout(fallbackTimeout);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [initialWidthEstimate, heightOffset, skipHeaderDetection]);

  return [containerRef, dimensions];
}
