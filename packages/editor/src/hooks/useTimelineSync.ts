import { useCallback, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import type { PreviewHandle, TimelineCanvasHandle } from './render-types.js';

export interface UseTimelineSyncOptions {
  timelineRef: RefObject<TimelineCanvasHandle | null>;
  previewRef: RefObject<PreviewHandle | null>;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  isSyncingFromPreview: MutableRefObject<boolean>;
  isSyncingFromTimeline: MutableRefObject<boolean>;
}

export interface UseTimelineSyncResult {
  onPreviewTimeUpdate: (time: number) => void;
  onCursorDrag: (time: number) => void;
  onClickTimeArea: (time: number) => void;
}

export function useTimelineSync({
  timelineRef,
  previewRef,
  setCurrentTime,
  isSyncingFromPreview,
  isSyncingFromTimeline,
}: UseTimelineSyncOptions): UseTimelineSyncResult {
  const lastTimeUpdateRef = useRef(0);

  const onPreviewTimeUpdate = useCallback((time: number) => {
    if (isSyncingFromTimeline.current) {
      return;
    }

    timelineRef.current?.setTime(time);

    const now = performance.now();
    if (now - lastTimeUpdateRef.current > 250) {
      lastTimeUpdateRef.current = now;
      isSyncingFromPreview.current = true;
      setCurrentTime(time);
      requestAnimationFrame(() => {
        isSyncingFromPreview.current = false;
      });
    }
  }, [isSyncingFromPreview, isSyncingFromTimeline, setCurrentTime, timelineRef]);

  const onCursorDrag = useCallback((time: number) => {
    if (isSyncingFromPreview.current) {
      return;
    }

    isSyncingFromTimeline.current = true;
    previewRef.current?.seek(time);
    setCurrentTime(time);
    requestAnimationFrame(() => {
      isSyncingFromTimeline.current = false;
    });
  }, [isSyncingFromPreview, isSyncingFromTimeline, previewRef, setCurrentTime]);

  const onClickTimeArea = useCallback((time: number) => {
    previewRef.current?.seek(time);
    setCurrentTime(time);
  }, [previewRef, setCurrentTime]);

  return { onPreviewTimeUpdate, onCursorDrag, onClickTimeArea };
}
