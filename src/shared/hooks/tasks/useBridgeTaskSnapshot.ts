import { useEffect, useReducer } from 'react';
import { useQuery, type Query } from '@tanstack/react-query';
import type { Task } from '@/types/tasks';
import { TASK_PROCESSING_STATUSES } from '@/shared/lib/tasks/taskStatusSemantics';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { listBridgeTasks } from '@/integrations/astrid/bridgeTaskReads';
import { useAstridCapabilityCensus } from '@/integrations/astrid/capabilityCensus.ts';
import { dataFreshnessManager } from '@/shared/realtime/DataFreshnessManager';
import { upsertRealtimeTaskSnapshot } from '@/shared/state/realtimeStore';

/**
 * There is one bridge task snapshot per project scope.  Consumers (the task
 * pane, status badges, and pending-task decorations) select from this query
 * instead of each starting their own `tasks` list poller.
 */
export const TASK_SNAPSHOT_ACTIVE_MS = 2_000;
export const TASK_SNAPSHOT_IDLE_MS = 10_000;

function normalizeProjectIds(projectIds: readonly (string | null | undefined)[]): string[] {
  return [...new Set(projectIds.filter((projectId): projectId is string =>
    typeof projectId === 'string' && projectId.length > 0))].sort();
}

export function taskSnapshotScope(projectIds: readonly string[]): string {
  return projectIds.length > 0 ? projectIds.join(',') : '__no-project__';
}

export function hasProcessingTask(tasks: readonly Task[] | undefined): boolean {
  return !!tasks?.some((task) =>
    (TASK_PROCESSING_STATUSES as readonly string[]).includes(task.status));
}

/**
 * Keep the local fallback responsive while there is work, but let the
 * RealtimeConnection be the sole owner once it has established its diff poll.
 * Idle panes still get a bounded safety poll (and hidden tabs use the same
 * slower cadence), so a task admitted while the app is quiet is eventually
 * observed without four mounted panes hammering the bridge.
 */
export function taskSnapshotPollingInterval(
  tasks: readonly Task[] | undefined,
  realtimeStatus: 'connected' | 'disconnected' | 'error',
  isHidden = typeof document !== 'undefined' && document.hidden,
): number | false {
  if (realtimeStatus === 'connected') {
    return false;
  }
  if (isHidden || !hasProcessingTask(tasks)) {
    return TASK_SNAPSHOT_IDLE_MS;
  }
  return TASK_SNAPSHOT_ACTIVE_MS;
}

function useRealtimeStatus(): 'connected' | 'disconnected' | 'error' {
  const [, forceUpdate] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (typeof dataFreshnessManager.subscribe !== 'function') return undefined;
    return dataFreshnessManager.subscribe(() => forceUpdate());
  }, []);
  const diagnostics = typeof dataFreshnessManager.getDiagnostics === 'function'
    ? dataFreshnessManager.getDiagnostics()
    : null;
  return diagnostics?.realtimeStatus ?? 'disconnected';
}

export function useBridgeTaskSnapshot(
  projectIds: readonly (string | null | undefined)[],
) {
  const capabilityCensus = useAstridCapabilityCensus();
  const realtimeStatus = useRealtimeStatus();
  const normalizedProjectIds = normalizeProjectIds(projectIds);
  const scope = taskSnapshotScope(normalizedProjectIds);
  const queryKey = taskQueryKeys.snapshot(scope);

  return useQuery<Task[], Error>({
    queryKey,
    queryFn: async () => {
      const tasks = (await Promise.all(normalizedProjectIds.map((projectId) =>
        listBridgeTasks(projectId)))).flat();

      // The realtime selectors used by pending badges are projections of this
      // same read. Seeding here keeps those selectors live without another
      // bridge request per generation or shot.
      normalizedProjectIds.forEach((projectId) => {
        const projectTasks = tasks.filter((task) => task.projectId === projectId);
        projectTasks.forEach((task) => upsertRealtimeTaskSnapshot(task, projectId));
      });

      return tasks;
    },
    enabled: normalizedProjectIds.length > 0
      && capabilityCensus.capabilities.tasks !== 'unavailable',
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: (query: Query<Task[], Error>) => taskSnapshotPollingInterval(
      query.state.data,
      realtimeStatus,
    ),
  });
}
