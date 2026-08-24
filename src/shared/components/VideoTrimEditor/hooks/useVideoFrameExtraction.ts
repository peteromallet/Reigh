import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrimState } from '@/shared/types/videoTrim';

interface FrameQueueItem {
  time: number;
  callback: (frame: string | null) => void;
}

interface UseVideoFrameExtractionParams {
  videoUrl?: string;
  trimState: TrimState;
}

interface UseVideoFrameExtractionResult {
  frameExtractionVideoRef: React.RefObject<HTMLVideoElement | null>;
  frameExtractionVideoElementRef: React.RefCallback<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  canvasElementRef: React.RefCallback<HTMLCanvasElement>;
  startFrame: string | null;
  endFrame: string | null;
  isVideoReady: boolean;
  handleVideoLoaded: () => void;
}

function clampSeekTime(rawTime: number, duration: number): number | null {
  if (!Number.isFinite(rawTime) || rawTime < 0 || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const minValue = 0.001;
  const maxValue = Math.max(minValue, duration - 0.01);
  const clampedTime = Math.min(Math.max(minValue, rawTime), maxValue);
  return Number.isFinite(clampedTime) ? clampedTime : null;
}

export function useVideoFrameExtraction({
  videoUrl,
  trimState,
}: UseVideoFrameExtractionParams): UseVideoFrameExtractionResult {
  const frameExtractionVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameExtractionVideoElementRef = useCallback((node: HTMLVideoElement | null) => {
    frameExtractionVideoRef.current = node;
  }, []);
  const canvasElementRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
  }, []);

  const [startFrame, setStartFrame] = useState<string | null>(null);
  const [endFrame, setEndFrame] = useState<string | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);

  const extractionQueueRef = useRef<FrameQueueItem[]>([]);
  const isExtractingRef = useRef(false);

  const lastStartUpdateRef = useRef(0);
  const lastEndUpdateRef = useRef(0);
  const pendingStartUpdateRef = useRef<NodeJS.Timeout | null>(null);
  const pendingEndUpdateRef = useRef<NodeJS.Timeout | null>(null);
  const prevStartTrimRef = useRef(trimState.startTrim);
  const prevEndTrimRef = useRef(trimState.endTrim);
  const initialExtractionDoneRef = useRef(false);

  const handleVideoLoaded = useCallback(() => {
    setIsVideoReady(true);
  }, []);

  useEffect(() => {
    setIsVideoReady(false);
    setStartFrame(null);
    setEndFrame(null);

    extractionQueueRef.current = [];
    isExtractingRef.current = false;
    initialExtractionDoneRef.current = false;
    prevStartTrimRef.current = trimState.startTrim;
    prevEndTrimRef.current = trimState.endTrim;

    if (pendingStartUpdateRef.current) {
      clearTimeout(pendingStartUpdateRef.current);
      pendingStartUpdateRef.current = null;
    }
    if (pendingEndUpdateRef.current) {
      clearTimeout(pendingEndUpdateRef.current);
      pendingEndUpdateRef.current = null;
    }
  }, [videoUrl]);

  const processExtractionQueue = useCallback(() => {
    if (isExtractingRef.current || extractionQueueRef.current.length === 0) {
      return;
    }

    const video = frameExtractionVideoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      return;
    }

    const queueItem = extractionQueueRef.current.shift();
    if (!queueItem) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      queueItem.callback(null);
      processExtractionQueue();
      return;
    }

    const clampedTime = clampSeekTime(queueItem.time, video.duration);
    if (clampedTime === null) {
      queueItem.callback(null);
      processExtractionQueue();
      return;
    }

    isExtractingRef.current = true;

    const handleSeeked = () => {
      video.removeEventListener('seeked', handleSeeked);

      const aspectRatio = video.videoWidth / video.videoHeight;
      if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
        queueItem.callback(null);
        isExtractingRef.current = false;
        processExtractionQueue();
        return;
      }

      canvas.width = 160;
      canvas.height = Math.round(160 / aspectRatio);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      queueItem.callback(canvas.toDataURL('image/jpeg', 0.8));
      isExtractingRef.current = false;
      processExtractionQueue();
    };

    video.addEventListener('seeked', handleSeeked);
    video.currentTime = clampedTime;
  }, []);

  const queueFrameExtraction = useCallback(
    (time: number, callback: (frame: string | null) => void) => {
      extractionQueueRef.current.push({ time, callback });
      processExtractionQueue();
    },
    [processExtractionQueue]
  );

  useEffect(() => {
    if (!videoUrl || !isVideoReady || trimState.videoDuration === 0) {
      return;
    }
    if (initialExtractionDoneRef.current) {
      return;
    }

    initialExtractionDoneRef.current = true;

    const startTime = trimState.startTrim;
    const endTime = Math.max(0.001, trimState.videoDuration - trimState.endTrim - 0.1);

    if (Number.isFinite(startTime)) {
      queueFrameExtraction(startTime, (frame) => {
        setStartFrame(frame);
        lastStartUpdateRef.current = Date.now();
      });
    }

    if (Number.isFinite(endTime)) {
      queueFrameExtraction(endTime, (frame) => {
        setEndFrame(frame);
        lastEndUpdateRef.current = Date.now();
      });
    }
  }, [
    videoUrl,
    isVideoReady,
    trimState.videoDuration,
    trimState.startTrim,
    trimState.endTrim,
    queueFrameExtraction,
  ]);

  useEffect(() => {
    if (!videoUrl || !isVideoReady || trimState.videoDuration === 0) {
      return;
    }
    if (!initialExtractionDoneRef.current) {
      return;
    }
    if (prevStartTrimRef.current === trimState.startTrim) {
      return;
    }

    prevStartTrimRef.current = trimState.startTrim;

    const updateStartFrame = () => {
      if (!Number.isFinite(trimState.startTrim)) {
        return;
      }
      queueFrameExtraction(trimState.startTrim, (frame) => {
        setStartFrame(frame);
        lastStartUpdateRef.current = Date.now();
      });
    };

    if (pendingStartUpdateRef.current) {
      clearTimeout(pendingStartUpdateRef.current);
      pendingStartUpdateRef.current = null;
    }

    const throttleMs = 60;
    const elapsed = Date.now() - lastStartUpdateRef.current;
    if (elapsed >= throttleMs) {
      updateStartFrame();
    } else {
      pendingStartUpdateRef.current = setTimeout(
        updateStartFrame,
        throttleMs - elapsed
      );
    }

    return () => {
      if (pendingStartUpdateRef.current) {
        clearTimeout(pendingStartUpdateRef.current);
        pendingStartUpdateRef.current = null;
      }
    };
  }, [
    videoUrl,
    isVideoReady,
    trimState.startTrim,
    trimState.videoDuration,
    queueFrameExtraction,
  ]);

  useEffect(() => {
    if (!videoUrl || !isVideoReady || trimState.videoDuration === 0) {
      return;
    }
    if (!initialExtractionDoneRef.current) {
      return;
    }
    if (prevEndTrimRef.current === trimState.endTrim) {
      return;
    }

    prevEndTrimRef.current = trimState.endTrim;

    const updateEndFrame = () => {
      const keepEndTime = trimState.videoDuration - trimState.endTrim;
      if (!Number.isFinite(keepEndTime)) {
        return;
      }
      queueFrameExtraction(Math.max(0.001, keepEndTime - 0.1), (frame) => {
        setEndFrame(frame);
        lastEndUpdateRef.current = Date.now();
      });
    };

    if (pendingEndUpdateRef.current) {
      clearTimeout(pendingEndUpdateRef.current);
      pendingEndUpdateRef.current = null;
    }

    const throttleMs = 60;
    const elapsed = Date.now() - lastEndUpdateRef.current;
    if (elapsed >= throttleMs) {
      updateEndFrame();
    } else {
      pendingEndUpdateRef.current = setTimeout(updateEndFrame, throttleMs - elapsed);
    }

    return () => {
      if (pendingEndUpdateRef.current) {
        clearTimeout(pendingEndUpdateRef.current);
        pendingEndUpdateRef.current = null;
      }
    };
  }, [
    videoUrl,
    isVideoReady,
    trimState.endTrim,
    trimState.videoDuration,
    queueFrameExtraction,
  ]);

  return {
    frameExtractionVideoRef,
    frameExtractionVideoElementRef,
    canvasRef,
    canvasElementRef,
    startFrame,
    endFrame,
    isVideoReady,
    handleVideoLoaded,
  };
}
