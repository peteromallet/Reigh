import { useQuery } from '@tanstack/react-query';
import { getVisibleTaskTypes } from '@/shared/lib/tasks/taskConfig';
import { QUERY_PRESETS, STANDARD_RETRY, STANDARD_RETRY_DELAY } from '@/shared/lib/query/queryDefaults';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { dataFreshnessManager } from '@/shared/realtime/DataFreshnessManager';
import {
  TASK_FAILURE_STATUSES,
  TASK_PROCESSING_STATUSES,
} from '@/shared/lib/tasks/taskStatusSemantics';
import { isRootBridgeTask, listBridgeTasks } from '@/integrations/astrid/bridgeTaskReads';
import { taskPollingCadence } from './taskPollingCadence';
import {
  operationFailure,
  operationSuccess,
  type OperationResult,
} from '@/shared/lib/operationResult';
import { useAstridCapabilityCensus } from '@/integrations/astrid/capabilityCensus.ts';

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

function buildEmptyTaskStatusCountsResult(): TaskStatusCountsResult {
  const zeroCounts = {
    processing: 0,
    recentSuccesses: 0,
    recentFailures: 0,
  };

  return {
    ...zeroCounts,
    degraded: false,
    failedQueries: [],
    operation: operationSuccess(zeroCounts, { policy: 'best_effort' }),
  };
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

function trackTaskStatusCountsFreshness(
  projectId: string,
  error?: unknown,
): void {
  if (error === undefined) {
    dataFreshnessManager.onFetchSuccess(taskQueryKeys.statusCounts(projectId));
    return;
  }

  dataFreshnessManager.onFetchFailure(
    taskQueryKeys.statusCounts(projectId),
    error instanceof Error ? error : new Error(String(error)),
  );
}

interface FetchTaskStatusCountsOptions {
  projectId: string | null;
  allProjectIds?: string[];
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
async function fetchTaskStatusCounts(options: FetchTaskStatusCountsOptions): Promise<TaskStatusCountsResult> {
  const { projectId, allProjectIds } = options;
  const isAllProjects = !!allProjectIds?.length;

  if (!projectId && !isAllProjects) {
    return buildEmptyTaskStatusCountsResult();
  }

  // Use projectId for freshness tracking; fall back to synthetic key for all-projects mode
  const trackingId = projectId ?? '__all-projects__';

  const visibleTaskTypes = getVisibleTaskTypes();
  const oneHourAgoMs = Date.now() - 60 * 60 * 1000;

  let tasks;
  try {
    tasks = await listBridgeTasks(isAllProjects ? allProjectIds![0] : projectId!);
  } catch (error) {
    trackTaskStatusCountsFreshness(trackingId, error);
    return buildTaskStatusCountsResult(
      trackingId,
      { processing: 0, success: 0, failure: 0 },
      ['processing', 'success', 'failure'],
    );
  }

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

  trackTaskStatusCountsFreshness(trackingId);

  return buildTaskStatusCountsResult(trackingId, counts, []);
}

// Hook to get status counts for indicators
export const useTaskStatusCounts = (
  projectId: string | null,
  options?: { allProjectIds?: string[] },
) => {
  const capabilityCensus = useAstridCapabilityCensus();
  const allProjectIds = options?.allProjectIds;
  const isAllProjects = !!allProjectIds?.length;
  const cacheProjectId = isAllProjects ? '__all-projects__' : (projectId ?? '__no-project__');

  return useQuery({
    queryKey: taskQueryKeys.statusCounts(cacheProjectId),
    queryFn: () => fetchTaskStatusCounts({ projectId, allProjectIds }),
    enabled: (isAllProjects || !!projectId)
      && capabilityCensus.capabilities.tasks !== 'unavailable',
    refetchInterval: taskPollingCadence,
    refetchIntervalInBackground: true,
    retry: STANDARD_RETRY,
    retryDelay: STANDARD_RETRY_DELAY,
    ...QUERY_PRESETS.realtimeBacked,
  });
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
