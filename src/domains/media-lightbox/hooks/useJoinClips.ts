/**
 * useJoinClips - Handles adding videos to the join clips queue
 *
 * Manages state and handlers for adding the current video to the pending
 * join clips list (stored in localStorage) and navigating to the join-clips tool.
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import {
  getPendingJoinClipsStorageKey,
  type PendingJoinClipEntry,
} from '@/shared/lib/joinClips/pendingQueue';
import { enqueueJoinClipsIntent } from '@/shared/lib/joinClips/intentStore';
import { readUserIdFromStorage } from '@/shared/lib/supabaseSession';
import { TOOL_ROUTES } from '@/shared/lib/tooling/toolRoutes';
import { GenerationRow } from '@/domains/generation/types';

interface UseJoinClipsProps {
  media: GenerationRow;
  isVideo: boolean;
  selectedProjectId: string | null;
}

interface UseJoinClipsReturn {
  isAddingToJoin: boolean;
  addToJoinSuccess: boolean;
  handleAddToJoin: () => void;
  handleGoToJoin: () => void;
}

export function useJoinClips({
  media,
  isVideo,
  selectedProjectId,
}: UseJoinClipsProps): UseJoinClipsReturn {
  const [isAddingToJoin, setIsAddingToJoin] = useState(false);
  const [addToJoinSuccess, setAddToJoinSuccess] = useState(false);
  const navigate = useNavigate();

  const handleAddToJoin = useCallback(() => {
    if (!media || !isVideo) {
      return;
    }

    setIsAddingToJoin(true);
    try {
      // Get the video URL from the media object
      // For videos, 'location' is the primary storage field
      // 'url' is not a declared field on GenerationRow but may exist at runtime from raw DB data
      const mediaRecord = media as unknown as Record<string, unknown>;
      const videoUrl = media.location || (mediaRecord.url as string | undefined) || media.imageUrl;
      const thumbnailUrl = media.thumbUrl;

      if (!videoUrl) {
        normalizeAndPresentError(new Error('No video URL found on media object'), {
          context: 'useJoinClips',
          showToast: false,
          logData: { mediaId: media.id, isVideo },
        });
        setIsAddingToJoin(false);
        return;
      }

      const userId = readUserIdFromStorage();
      const queueKey = getPendingJoinClipsStorageKey(selectedProjectId, userId);

      // Get existing pending clips or start fresh
      const existingData = localStorage.getItem(queueKey);
      const parsedPending = existingData ? JSON.parse(existingData) : [];
      const pendingClips: PendingJoinClipEntry[] = Array.isArray(parsedPending) ? parsedPending : [];

      // Add new clip (avoid duplicates by generationId)
      if (!pendingClips.some(clip => clip.generationId === media.id)) {
        const newClip: PendingJoinClipEntry = {
          videoUrl,
          thumbnailUrl: thumbnailUrl ?? undefined,
          generationId: media.id,
          timestamp: Date.now(),
          ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
          ...(userId ? { userId } : {}),
        };
        enqueueJoinClipsIntent(newClip, { projectId: selectedProjectId, userId });
        pendingClips.push(newClip);
        localStorage.setItem(queueKey, JSON.stringify(pendingClips));
      }

      setAddToJoinSuccess(true);
      setTimeout(() => setAddToJoinSuccess(false), 2000);
    } catch (error) {
      normalizeAndPresentError(error, { context: 'useJoinClips', showToast: false });
    } finally {
      setIsAddingToJoin(false);
    }
  }, [media, isVideo, selectedProjectId]);

  const handleGoToJoin = useCallback(() => {
    navigate(TOOL_ROUTES.JOIN_CLIPS);
  }, [navigate]);

  return {
    isAddingToJoin,
    addToJoinSuccess,
    handleAddToJoin,
    handleGoToJoin,
  };
}
