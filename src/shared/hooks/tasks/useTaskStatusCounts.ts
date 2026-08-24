import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getVisibleTaskTypes } from '@/shared/lib/tasks/taskConfig';
import { QUERY_PRESETS } from '@/shared/lib/query/queryDefaults';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import {
  TASK_FAILURE_STATUSES,
  TASK_PROCESSING_STATUSES,
} from '@/shared/lib/tasks/taskStatusSemantics';
import { isRootBridgeTask } from '@/integrations/astrid/bridgeTaskReads';
import {
  operationFailure,
  operationSuccess,
  type OperationResult,
} from '@/shared/lib/operationResult';
import { useBridgeTaskSnapshot } from './useBridgeTaskSnapshot';

type TaskStatusCountsQuery = 'processing' | 'success' | 'failure';

interface TaskStatusCountsResult {
  processing: number;
  recentSuccesses: number;
  recentFailures: number;
  degraded: boolean;
  failedQueries: TaskStatusCountsQuery[];
  errorCode?: 'task_status_counts_partial_failure';
  operation: OperationResult<{
    processing: number;
    recentSuccesses: number;
    recentFailures: number;
  }>;
}

function buildTaskStatusCountsResult(
  projectId: string,
  counts: { processing: number; success: number; failure: number },
  failedQueries: TaskStatusCountsQuery[],
): TaskStatusCountsResult {
  return {
    processing: counts.processing,
    recentSuccesses: counts.success,
    recentFailures: counts.failure,
    degraded: failedQueries.length > 0,
    failedQueries,
    ...(failedQueries.length > 0
      ? { errorCode: 'task_status_counts_partial_failure' as const }
      : {}),
    operation:
      failedQueries.length > 0
        ? operationFailure(new Error('Task status counts query partially failed'), {
            errorCode: 'task_status_counts_partial_failure',
            policy: 'degrade',
            recoverable: true,
            message: `Partial task status count failure (${failedQueries.join(', ')})`,
            cause: { failedQueries, projectId },
          })
        : operationSuccess(
            {
              processing: counts.processing,
              recentSuccesses: counts.success,
              recentFailures: counts.failure,
            },
            { policy: 'best_effort' },
          ),
  };
}

function taskTimestampMs(task: { createdAt: string; updatedAt?: string }): number {
  return new Date(task.updatedAt || task.createdAt).getTime();
}

/**
 * The three supabase-js head-count queries collapse into ONE bridge list
 * read with in-memory counting — the frozen route has no aggregate form.
 * A read failure degrades all three counters together (there are no partial
 * failures left to mask).
 */
function deriveTaskStatusCounts(
  tasks: readonly import('@/types/tasks').Task[],
  projectId: string,
): TaskStatusCountsResult {
  const visibleTaskTypes = getVisibleTaskTypes();
  const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
  const inScope = tasks.filter(
    (task) => visibleTaskTypes.includes(task.taskType) && isRootBridgeTask(task.params),
  );
  const counts = {
    processing: inScope.filter((task) =>
      (TASK_PROCESSING_STATUSES as readonly string[]).includes(task.status)).length,
    success: inScope.filter((task) =>
      task.status === 'Complete' && taskTimestampMs(task) >= oneHourAgoMs).length,
    failure: inScope.filter((task) =>
      (TASK_FAILURE_STATUSES as readonly string[]).includes(task.status)
      && taskTimestampMs(task) >= oneHourAgoMs).length,
  };

  return buildTaskStatusCountsResult(projectId, counts, []);
}

// Hook to get status counts for indicators
export const useTaskStatusCounts = (
  projectId: string | null,
  options?: { allProjectIds?: string[] },
) => {
  const allProjectIds = options?.allProjectIds;
  const isAllProjects = !!allProjectIds?.length;
  const projectIds = isAllProjects
    ? [...new Set(allProjectIds)].sort()
    : (projectId ? [projectId] : []);
  const snapshotQuery = useBridgeTaskSnapshot(projectIds);
  const cacheProjectId = isAllProjects ? '__all-projects__' : (projectId ?? '__no-project__');

  const data = useMemo(() => {
    if (!snapshotQuery.data) return undefined;
    return deriveTaskStatusCounts(snapshotQuery.data, cacheProjectId);
  }, [cacheProjectId, snapshotQuery.data]);

  return {
    ...snapshotQuery,
    data,
  };
};

/**
 * Hook to get all visible task types from the config
 * Simply returns the allowlist from taskConfig - no database query needed
 */
export const useAllTaskTypes = (_projectId: string | null) => {
  return useQuery({
    queryKey: taskQueryKeys.allTypes,
    queryFn: () => getVisibleTaskTypes(),
    ...QUERY_PRESETS.immutable,
    gcTime: Infinity,
  });
};
