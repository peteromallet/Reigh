import { useCallback, useState } from 'react';
import { useProjectSelectionContext } from '@/shared/contexts/ProjectContext';
import {
  useShotFinalVideos,
  type ShotFinalVideo,
} from '@/tools/travel-between-images/hooks/video/useShotFinalVideos';

export type { ShotFinalVideo };

const MAX_DISMISSED = 256;
const dismissedFinalVideoIds = new Set<string>();

export function useFinalVideoAvailable() {
  const { selectedProjectId } = useProjectSelectionContext();
  const { finalVideoMap } = useShotFinalVideos(selectedProjectId);
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
    finalVideoMap,
    dismissFinalVideo,
  };
}
