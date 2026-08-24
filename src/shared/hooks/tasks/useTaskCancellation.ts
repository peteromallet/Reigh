import { useMutation, useQueryClient } from '@tanstack/react-query';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { getBridgeTaskClient } from '@/integrations/astrid/bridgeTaskReads';
import { BridgeRouteError } from '@/integrations/astrid/transport';

/**
 * Cancel one task through the frozen `POST …/tasks/:task_id/cancel` route.
 * A running task requires the live attempt fence: the first unfenced cancel
 * answers 409 with (or we recover it via) the current attempt read, and the
 * fenced retry commits. Cancelling an already-terminal task replays its
 * state without error.
 */
export async function cancelBridgeTask(projectSlug: string, taskId: string): Promise<void> {
  const client = getBridgeTaskClient(projectSlug);
  try {
    await client.tasks.cancel(taskId);
    return;
  } catch (error) {
    if (!(error instanceof BridgeRouteError) || error.status !== 409) {
      throw error;
    }
  }

  const detail = await client.tasks.get(taskId);
  const liveAttempt = (detail.attempts ?? []).find((attempt) => attempt.status === 'running');
  if (!liveAttempt) {
    throw new Error(`Cannot cancel running task ${taskId}: no live attempt to fence with`);
  }

  await client.tasks.cancel(taskId, {
    attempt_id: liveAttempt.attempt_id,
    lease_id: liveAttempt.lease_id,
    status_version: liveAttempt.status_version,
  });
}


async function cancelTask(projectId: string | null | undefined, taskId: string): Promise<void> {
  const client = getBridgeTaskClient(projectId ?? '');

  const summary = await client.tasks.get(taskId);
  // Already in a terminal state — treat as a no-op success
  if (summary.status !== 'queued' && summary.status !== 'running') {
    return;
  }

  await cancelBridgeTask(projectId ?? '', taskId);

  if (!orchestratorTaskType(summary).includes('orchestrator')) {
    return;
  }



  // Find all queued subtasks that reference this orchestrator
  const page = await client.tasks.list();
  const subtasks = page.tasks.filter((task) => {
    if (task.status !== 'queued') {
      return false;
    }
    const params = task.spec?.params ?? {};
    return params.orchestrator_task_id_ref === taskId || params.orchestrator_task_id === taskId;
  });

  await Promise.allSettled(subtasks.map((subtask) => cancelBridgeTask(projectId ?? '', subtask.task_id)));
}

/** The app-facing task type of a bridge summary (mirrors bridgeTaskReads). */
function orchestratorTaskType(summary: { spec?: { family?: string; source_task_type?: string }; capability: string }): string {
  return summary.spec?.family ?? summary.spec?.source_task_type ?? summary.capability;
}

export const useCancelTask = (projectId: string | null) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => cancelTask(projectId, taskId),
    onSuccess: () => {
      // Immediately invalidate tasks queries so cancelled task disappears
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.paginatedAll });
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.statusCountsAll });
      // Immediately invalidate pending task queries so indicators update instantly
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'pending-segment-tasks' ||
          query.queryKey[0] === 'pending-generation-tasks'
      });
    },
    onError: (error: Error) => {
      console.error('[useCancelTask] Raw error from server:', error.message, error);
      normalizeAndPresentError(error, { context: 'useCancelTask', toastTitle: 'Failed to cancel task' });
    },
  });
};

interface CancelAllPendingTasksResponse {
  cancelledCount: number;
  message: string;
}

/**
 * Cancel all pending tasks for a project. For orchestrator tasks, also
 * cancels their subtasks.
 */
async function cancelPendingTasks(projectId: string): Promise<CancelAllPendingTasksResponse> {
  const client = getBridgeTaskClient(projectId);
  const page = await client.tasks.list();
  const pendingTasks = page.tasks.filter((task) => task.status === 'queued');

  // Collect all task IDs to cancel (including subtasks)
  const tasksToCancel = new Set<string>();

  // Add all pending tasks
  pendingTasks.forEach((task) => tasksToCancel.add(task.task_id));

  // Find orchestrator tasks and their subtasks
  const orchestratorIds = pendingTasks
    .filter((task) => orchestratorTaskType(task).includes('orchestrator'))
    .map((task) => task.task_id);

  if (orchestratorIds.length > 0) {
    pendingTasks.forEach((task) => {
      const params = task.spec?.params ?? {};
      const orchestratorRef = params.orchestrator_task_id_ref || params.orchestrator_task_id;

      if (typeof orchestratorRef === 'string' && orchestratorIds.includes(orchestratorRef)) {
        tasksToCancel.add(task.task_id);
      }
    });
  }

  const taskIdsArray = Array.from(tasksToCancel);
  await Promise.allSettled(
    taskIdsArray.map((taskId) => cancelBridgeTask(projectId, taskId)),
  );

  return {
    cancelledCount: taskIdsArray.length,
    message: `${taskIdsArray.length} tasks cancelled (including subtasks)`,
  };
}

// Hook to cancel pending tasks
const useCancelPendingTasks = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelPendingTasks,
    onSuccess: () => {
      // Immediately invalidate tasks queries so cancelled tasks disappear
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.paginatedAll });
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.statusCountsAll });
    },
    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'useCancelPendingTasks', toastTitle: 'Failed to cancel pending tasks' });
    },
  });
};

// Export alias for backward compatibility
export const useCancelAllPendingTasks = useCancelPendingTasks;
