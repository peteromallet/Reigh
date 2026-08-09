import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

export const MIN_TIMELINE_HEIGHT = 140;
export const MIN_PREVIEW_HEIGHT = 180;
export const CHROME_OVERHEAD = MIN_TIMELINE_HEIGHT + 40 + 28 + 24;

/**
 * Desktop preview/timeline split: the drag handle between the two rows, the
 * resulting timeline height, and the maximize toggle. Emits the grid template
 * the desktop layout applies.
 *
 * Four rows, in DOM order: preview, divider/toolbar, extension activity
 * region, timeline. The activity region row must be declared — otherwise the
 * timeline lands in an implicit `auto` row, the activity region takes the
 * timeline's sizing, and the preview's `1fr` collapses to zero height.
 */
export function useTimelineShellDividerDrag() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const [timelineHeight, setTimelineHeight] = useState<number | null>(null);
  const [isTimelineMaximized, setIsTimelineMaximized] = useState(false);

  const onDividerMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setIsTimelineMaximized(false);
    const container = containerRef.current;
    const divider = dividerRef.current;
    if (!container || !divider) {
      return;
    }

    divider.classList.add('is-dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const nextHeight = Math.max(MIN_TIMELINE_HEIGHT, rect.bottom - moveEvent.clientY);
      if (rect.height - nextHeight < MIN_PREVIEW_HEIGHT) {
        return;
      }
      container.style.gridTemplateRows = `minmax(0,1fr) auto auto ${nextHeight}px`;
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      divider.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const match = container.style.gridTemplateRows.match(/(\d+)px$/);
      container.style.gridTemplateRows = '';
      if (match) {
        setTimelineHeight(Number.parseInt(match[1], 10));
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  const gridTemplateRows = isTimelineMaximized
    ? `${MIN_PREVIEW_HEIGHT}px auto auto 1fr`
    : (timelineHeight
      ? `minmax(0,1fr) auto auto ${timelineHeight}px`
      : 'minmax(0,1fr) auto auto minmax(200px,36%)');

  return {
    containerRef,
    dividerRef,
    isTimelineMaximized,
    setIsTimelineMaximized,
    onDividerMouseDown,
    gridTemplateRows,
  };
}
