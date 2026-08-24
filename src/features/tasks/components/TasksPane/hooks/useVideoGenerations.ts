import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readBridgeTaskOutputs } from '@/integrations/astrid/bridgeTaskOutputs';
import { Task } from '@/types/tasks';
import { GenerationRow } from '@/domains/generation/types';
import { extractTaskParentGenerationId } from '../utils/task-utils';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';

interface UseVideoGenerationsOptions {
  task: Task;
  taskParams: { parsed: Record<string, unknown>; promptText: string };
  isVideoTask: boolean;
  isCompletedVideoTask: boolean;
  isHovering: boolean;
}

/**
 * Hook to fetch video generations for video tasks
 * Only fetches when hovering (lazy loading to avoid query spam)
 */
export function useVideoGenerations({
  task,
  taskParams,
  isVideoTask,
  isCompletedVideoTask,
  isHovering,
}: UseVideoGenerationsOptions) {
  // State to control when to fetch video generations (on hover)
  const [shouldFetchVideo, setShouldFetchVideo] = useState(false);

  // State to track if user clicked the button (not just hovered)
  const [waitingForVideoToOpen, setWaitingForVideoToOpen] = useState(false);

  // Trigger video fetch when hovering over completed video tasks
  useEffect(() => {
    if (isHovering && isCompletedVideoTask && !shouldFetchVideo) {
      setShouldFetchVideo(true);
    }
  }, [isHovering, isCompletedVideoTask, shouldFetchVideo, task.id]);

  // Fetch video generations
  const { data: videoGenerations, isLoading: isLoadingVideoGen } = useQuery({
    queryKey: [...generationQueryKeys.videoForTask(task.id), task.outputLocation],
    queryFn: async () => {

      if (!isVideoTask || task.status !== 'Complete') {
        return null;
      }

      const outputs = await readBridgeTaskOutputs(task);
      const videoOutputs = outputs.filter((output) => output.type.includes('video'));
      if (videoOutputs.length > 0) return videoOutputs;

      // FINAL FALLBACK: If no generation record exists but task has outputLocation,
      // create a minimal pseudo-generation from the task data
      // This handles cases where complete-task failed to create the generation record
      if (task.outputLocation) {
        return [{
          id: task.id, // Use task ID as pseudo-generation ID
          location: task.outputLocation,
          thumbnail_url: null,
          type: 'video',
          created_at: task.createdAt,
          project_id: task.projectId,
          params: task.params,
          _is_fallback: true, // Mark as fallback so we know it's not a real generation
        }];
      }

      return outputs;
    },
    enabled: shouldFetchVideo && isVideoTask && task.status === 'Complete',
  });

  // Transform video generations to GenerationRow format
  const videoOutputs = useMemo(() => {
    if (!videoGenerations) return null;
    
    const taskParentGenerationId = extractTaskParentGenerationId(taskParams.parsed);
    
    return videoGenerations.map((gen) => {
      const genRecord = gen as Record<string, unknown>;
      // Individual segments have their parent_generation_id on the generation itself (from DB)
      // Other video tasks may have it in task params or on the generation
      const effectiveParentGenId = (genRecord.parent_generation_id as string | undefined) || taskParentGenerationId;
      const location = (genRecord.location as string | null | undefined) ?? null;
      const thumbnailUrl = (genRecord.thumbnail_url as string | null | undefined) ?? null;
      const type = (genRecord.type as string | null | undefined) ?? 'video';
      const createdAt =
        (genRecord.created_at as string | null | undefined) ||
        task.createdAt ||
        new Date().toISOString();
      const metadata = (genRecord.params as Record<string, unknown> | undefined) || {};
      const generationId =
        (genRecord.id as string | undefined) ||
        task.id;

      return {
        id: generationId,
        location,
        imageUrl: location,
        thumbUrl: thumbnailUrl || location,
        videoUrl: (genRecord.video_url as string | undefined) || location,
        type,
        createdAt,
        taskId: genRecord.task_id as string | undefined,
        metadata,
        name: (genRecord.name as string | undefined) || undefined,
        parent_generation_id: effectiveParentGenId || undefined,
        _variant_id: genRecord._variant_id as string | undefined,
        _variant_is_primary: genRecord._variant_is_primary as boolean | undefined,
      } as GenerationRow;
    });
  }, [videoGenerations, taskParams.parsed]);

  // Trigger fetch (for click before hover)
  const ensureFetch = useCallback(() => {
    setShouldFetchVideo(true);
  }, []);

  const triggerOpen = useCallback(() => {
    setShouldFetchVideo(true);
    setWaitingForVideoToOpen(true);
  }, []);

  const clearWaiting = () => {
    setWaitingForVideoToOpen(false);
  };

  return {
    videoOutputs,
    isLoadingVideoGen,
    shouldFetchVideo,
    waitingForVideoToOpen,
    ensureFetch,
    triggerOpen,
    clearWaiting,
  };
}
