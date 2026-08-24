import { useQuery } from '@tanstack/react-query';
import type { Task } from '@/types/tasks';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { listBridgeTasks } from '@/integrations/astrid/bridgeTaskReads';
import { useAstridCapabilityCensus } from '@/integrations/astrid/capabilityCensus.ts';
import { upsertRealtimeTaskSnapshot } from '@/shared/state/realtimeStore';

/**
 * There is one bridge task snapshot per project scope.  Consumers (the task
 * pane, status badges, and pending-task decorations) select from this query
 * instead of each starting their own `tasks` list poller.
 */
function normalizeProjectIds(projectIds: readonly (string | null | undefined)[]): string[] {
  return [...new Set(projectIds.filter((projectId): projectId is string =>
    typeof projectId === 'string' && projectId.length > 0))].sort();
}

export function taskSnapshotScope(projectIds: readonly string[]): string {
  return projectIds.length > 0 ? projectIds.join(',') : '__no-project__';
}

export function useBridgeTaskSnapshot(
  projectIds: readonly (string | null | undefined)[],
) {
  const capabilityCensus = useAstridCapabilityCensus();
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
    // RealtimeConnection is the one polling owner. It invalidates this cache
    // only when its diff detects a real task change; mounted panes never start
    // a second interval over the same bridge route.
    refetchInterval: false,
  });
}
