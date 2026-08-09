import { useCallback, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { isAdditiveSelectionEvent, isPrimaryPointer } from '@/shared/lib/interactions/selectionGesture.ts';
import { userClearAllSelection, userSelectTimelineClips } from '@/shared/state/selectionStore.ts';
import { createAutoScroller } from '@/tools/video-editor/lib/auto-scroll.ts';
import {
  CLIP_ACTION_WITH_ID_SELECTOR,
  CLIP_ID_DATASET_KEY,
  MARQUEE_IGNORE_SELECTOR,
} from '@/tools/video-editor/lib/timeline-dom.ts';
import {
  shouldAllowTouchMarquee,
  type TimelineDeviceClass,
  type TimelineGestureOwner,
  type TimelineInputModality,
  type TimelineInteractionMode,
} from '@/tools/video-editor/lib/mobile-interaction-model.ts';

const MARQUEE_THRESHOLD_PX = 4;

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseMarqueeSelectArgs {
  editAreaRef: MutableRefObject<HTMLElement | null>;
  deviceClass: TimelineDeviceClass;
  interactionMode: TimelineInteractionMode;
  gestureOwner: TimelineGestureOwner;
  setGestureOwner: (owner: TimelineGestureOwner) => void;
  setInputModalityFromPointerType: (pointerType: string | null | undefined) => TimelineInputModality;
}

interface MarqueeSession {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startCanvasX: number;
  startCanvasY: number;
  additive: boolean;
  hasMoved: boolean;
  claimedOwnership: boolean;
  moveListener: (event: PointerEvent) => void;
  upListener: (event: PointerEvent) => void;
  cancelListener: (event: PointerEvent) => void;
}

const intersects = (
  left: number,
  top: number,
  right: number,
  bottom: number,
  boxLeft: number,
  boxTop: number,
  boxRight: number,
  boxBottom: number,
): boolean => {
  return left < boxRight
    && right > boxLeft
    && top < boxBottom
    && bottom > boxTop;
};

export function useMarqueeSelect({
  editAreaRef,
  deviceClass,
  interactionMode,
  gestureOwner,
  setGestureOwner,
  setInputModalityFromPointerType,
}: UseMarqueeSelectArgs) {
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const sessionRef = useRef<MarqueeSession | null>(null);
  const intersectedClipIdsRef = useRef<string[]>([]);
  const autoScrollerRef = useRef<ReturnType<typeof createAutoScroller> | null>(null);
  const gestureOwnerRef = useRef(gestureOwner);
  gestureOwnerRef.current = gestureOwner;

  const clearSession = useCallback((session: MarqueeSession | null) => {
    autoScrollerRef.current?.stop();
    autoScrollerRef.current = null;
    if (!session) {
      setMarqueeRect(null);
      intersectedClipIdsRef.current = [];
      return;
    }

    window.removeEventListener('pointermove', session.moveListener);
    window.removeEventListener('pointerup', session.upListener);
    window.removeEventListener('pointercancel', session.cancelListener);
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
    if (session.claimedOwnership) {
      setGestureOwner('none');
    }
    sessionRef.current = null;
    setMarqueeRect(null);
    intersectedClipIdsRef.current = [];
  }, [setGestureOwner]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!isPrimaryPointer(event.nativeEvent)) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element) || target.closest(MARQUEE_IGNORE_SELECTOR)) {
      return;
    }

    if (gestureOwnerRef.current !== 'none' && gestureOwnerRef.current !== 'timeline') {
      return;
    }

    const inputModality = setInputModalityFromPointerType(event.pointerType);
    if (!shouldAllowTouchMarquee(deviceClass, inputModality, interactionMode)) {
      return;
    }

    const editArea = editAreaRef.current;
    if (!editArea) {
      return;
    }

    const areaRect = editArea.getBoundingClientRect();
    const startCanvasX = event.clientX - areaRect.left + editArea.scrollLeft;
    const startCanvasY = event.clientY - areaRect.top + editArea.scrollTop;

    const updateSelection = (clientX: number, clientY: number) => {
      const currentEditArea = editAreaRef.current;
      if (!currentEditArea) {
        return;
      }

      const currentRect = currentEditArea.getBoundingClientRect();
      const currentCanvasX = clientX - currentRect.left + currentEditArea.scrollLeft;
      const currentCanvasY = clientY - currentRect.top + currentEditArea.scrollTop;
      const nextRect = {
        x: Math.min(startCanvasX, currentCanvasX),
        y: Math.min(startCanvasY, currentCanvasY),
        width: Math.abs(currentCanvasX - startCanvasX),
        height: Math.abs(currentCanvasY - startCanvasY),
      };

      setMarqueeRect(nextRect);

      // Intersect in canvas space, the same space `nextRect` is drawn in. The
      // pointerdown anchor is pinned to the canvas, so during autoscroll the
      // content moves under a viewport-space anchor and the highlighted
      // rectangle and the selected set drift apart.
      const left = nextRect.x;
      const right = nextRect.x + nextRect.width;
      const top = nextRect.y;
      const bottom = nextRect.y + nextRect.height;
      intersectedClipIdsRef.current = [...currentEditArea.querySelectorAll<HTMLElement>(CLIP_ACTION_WITH_ID_SELECTOR)]
        .filter((clipElement) => {
          const clipRect = clipElement.getBoundingClientRect();
          const clipLeft = clipRect.left - currentRect.left + currentEditArea.scrollLeft;
          const clipTop = clipRect.top - currentRect.top + currentEditArea.scrollTop;
          return intersects(
            left,
            top,
            right,
            bottom,
            clipLeft,
            clipTop,
            clipLeft + clipRect.width,
            clipTop + clipRect.height,
          );
        })
        .map((clipElement) => clipElement.dataset[CLIP_ID_DATASET_KEY])
        .filter((clipId): clipId is string => Boolean(clipId));
    };
    autoScrollerRef.current = createAutoScroller(editArea, (clientX, clientY) => {
      updateSelection(clientX, clientY);
    });

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || moveEvent.pointerId !== session.pointerId) {
        return;
      }

      if (gestureOwnerRef.current === 'clip') {
        clearSession(session);
        return;
      }

      const dx = moveEvent.clientX - session.startClientX;
      const dy = moveEvent.clientY - session.startClientY;
      if (!session.hasMoved && Math.hypot(dx, dy) < MARQUEE_THRESHOLD_PX) {
        return;
      }

      if (!session.hasMoved) {
        if (gestureOwnerRef.current !== 'none' && gestureOwnerRef.current !== 'timeline') {
          clearSession(session);
          return;
        }
        session.hasMoved = true;
        session.claimedOwnership = true;
        setGestureOwner('timeline');
        // Prevent text selection while dragging the marquee
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
      }
      moveEvent.preventDefault();
      autoScrollerRef.current?.update(moveEvent.clientX, moveEvent.clientY);
      updateSelection(moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || upEvent.pointerId !== session.pointerId) {
        return;
      }

      if (session.hasMoved) {
        const clipIds = intersectedClipIdsRef.current;
        if (session.additive) {
          userSelectTimelineClips(clipIds, { additive: true });
        } else {
          userSelectTimelineClips(clipIds, { additive: false });
        }
      } else if (!session.additive) {
        // Only clear selection if the pointer-up landed inside the edit area.
        // Portal menus (context menus, lightboxes) live outside the edit area DOM,
        // so a pointer-up there should not be treated as "click on empty timeline".
        const upTarget = upEvent.target;
        if (upTarget instanceof Node && editArea.contains(upTarget)) {
          userClearAllSelection();
        }
      }

      clearSession(session);
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || cancelEvent.pointerId !== session.pointerId) {
        return;
      }

      clearSession(session);
    };

    sessionRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCanvasX,
      startCanvasY,
      additive: isAdditiveSelectionEvent(event),
      hasMoved: false,
      claimedOwnership: false,
      moveListener: handlePointerMove,
      upListener: handlePointerUp,
      cancelListener: handlePointerCancel,
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  }, [
    clearSession,
    deviceClass,
    editAreaRef,
    interactionMode,
    setGestureOwner,
    setInputModalityFromPointerType,
  ]);

  return {
    marqueeRect,
    onPointerDown,
  };
}
