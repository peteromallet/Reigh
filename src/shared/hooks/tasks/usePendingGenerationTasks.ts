import { useQuery } from '@tanstack/react-query';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { resolveTaskProjectScope } from '@/shared/lib/tasks/resolveTaskProjectScope';
import { listBridgeTasks } from '@/integrations/astrid/bridgeTaskReads';
import { taskPollingCadence } from './taskPollingCadence';
import { TASK_STATUS } from '@/types/tasks';
import {
  useRealtimePendingGenerationTasks,
  upsertRealtimeTaskSnapshots,
  type PendingGenerationTaskSnapshot,
} from '@/shared/state/realtimeStore';

type PendingGenerationTask = PendingGenerationTaskSnapshot;

interface UsePendingGenerationTasksReturn {
  /** Number of pending tasks that will create variants/derived from this generation */
  pendingCount: number;
  /** The pending tasks */
  pendingTasks: PendingGenerationTask[];
  /** Loading state */
  isLoading: boolean;
}

/**
 * Check if task params reference a specific generation ID as a source.
 * Checks common param fields where source generation is stored.
 */
export function taskReferencesGeneration(
  params: Record<string, unknown> | null,
  generationId: string
): boolean {
  if (!params || !generationId) return false;

  // Direct source references
  if (params.based_on === generationId) return true;
  if (params.source_generation_id === generationId) return true;
  if (params.generation_id === generationId) return true;
  if (params.input_generation_id === generationId) return true;
  if (params.parent_generation_id === generationId) return true;
  if (params.start_image_generation_id === generationId) return true;
  if (params.end_image_generation_id === generationId) return true;
  // Video segment tasks use pair_shot_generation_id
  if (params.pair_shot_generation_id === generationId) return true;
  if (Array.isArray(params.input_image_generation_ids) && params.input_image_generation_ids.includes(generationId)) {
    return true;
  }

  // Check nested in orchestrator_details
  const orchDetails = params.orchestrator_details as Record<string, unknown> | undefined;
  if (orchDetails) {
    if (orchDetails.based_on === generationId) return true;
    if (orchDetails.source_generation_id === generationId) return true;
    if (orchDetails.parent_generation_id === generationId) return true;
    if (
      Array.isArray(orchDetails.input_image_generation_ids)
      && orchDetails.input_image_generation_ids.includes(generationId)
    ) {
      return true;
    }
    // Check pair_shot_generation_ids array
    if (Array.isArray(orchDetails.pair_shot_generation_ids)) {
      if (orchDetails.pair_shot_generation_ids.includes(generationId)) return true;
    }
  }

  // Check full_orchestrator_payload
  const fullPayload = params.full_orchestrator_payload as Record<string, unknown> | undefined;
  if (fullPayload) {
    if (fullPayload.based_on === generationId) return true;
    if (fullPayload.source_generation_id === generationId) return true;
    if (fullPayload.parent_generation_id === generationId) return true;
  }

  // Check individual_segment_params (used by individual_travel_segment)
  const individualParams = params.individual_segment_params as Record<string, unknown> | undefined;
  if (individualParams) {
    if (individualParams.pair_shot_generation_id === generationId) return true;
  }

  return false;
}

export function usePendingGenerationTasks(
  generationId: string | null | undefined,
  projectId: string | null | undefined
): UsePendingGenerationTasksReturn {
  const effectiveProjectId = resolveTaskProjectScope(projectId);
  const pendingSelection = useRealtimePendingGenerationTasks(generationId, effectiveProjectId);

  const { isLoading } = useQuery({
    queryKey: [...taskQueryKeys.pendingGeneration(generationId ?? ''), effectiveProjectId],
    queryFn: async () => {
      if (!generationId || !effectiveProjectId) {
        return [];
      }

      const processing = await listBridgeTasks(effectiveProjectId);
      const pending = processing.filter((task) => task.status === TASK_STATUS.QUEUED
        || task.status === TASK_STATUS.IN_PROGRESS);
      return upsertRealtimeTaskSnapshots(pending, effectiveProjectId);
    },
    enabled: !!generationId && !!effectiveProjectId,
    refetchInterval: taskPollingCadence,
    staleTime: 0,
    gcTime: 10000,
    refetchOnWindowFocus: 'always',
  });

  return {
    pendingCount: pendingSelection.pendingCount,
    pendingTasks: pendingSelection.pendingTasks as PendingGenerationTask[],
    isLoading,
  };
}

// NOTE: Default export removed - use named export { usePendingGenerationTasks } instead
