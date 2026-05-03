import { useCallback, useState } from 'react';
import { useVideoEditorCorePorts } from '@/tools/video-editor/core/core-runtime';
import type { VideoEditorFinalVideo } from '@/tools/video-editor/core/core-ports';

export type ShotFinalVideo = VideoEditorFinalVideo;

const MAX_DISMISSED = 256;
const dismissedFinalVideoIds = new Set<string>();
const EMPTY_FINAL_VIDEO_MAP = new Map<string, ShotFinalVideo>();

export function useFinalVideoAvailable() {
  const { finalVideoMap } = useVideoEditorCorePorts();
  const [, forceRender] = useState(0);

  const dismissFinalVideo = useCallback((finalVideoId: string) => {
    dismissedFinalVideoIds.add(finalVideoId);
    if (dismissedFinalVideoIds.size > MAX_DISMISSED) {
      const oldest = dismissedFinalVideoIds.values().next().value;
      if (oldest !== undefined) dismissedFinalVideoIds.delete(oldest);
    }
    forceRender((count) => count + 1);
  }, []);

  return {
    finalVideoMap: finalVideoMap ?? EMPTY_FINAL_VIDEO_MAP,
    dismissFinalVideo,
  };
}
