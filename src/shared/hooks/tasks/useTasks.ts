import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { Task, TaskStatus } from '@/types/tasks';
import { getVisibleTaskTypes } from '@/shared/lib/tasks/taskConfig';
import { QUERY_PRESETS } from '@/shared/lib/query/queryDefaults';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { useProcessingRefetchGuard } from '@/shared/hooks/tasks/useProcessingRefetchGuard';
import { fetchTaskInProject } from '@/integrations/supabase/repositories/taskRepository';
import {
  type PaginatedTasksResponse as RepositoryPaginatedTasksResponse,
} from '@/shared/hooks/tasks/paginatedTaskRepository';
import { paginateTaskSnapshot } from '@/shared/hooks/tasks/paginatedTaskRepository';
import { useBridgeTaskSnapshot } from '@/shared/hooks/tasks/useBridgeTaskSnapshot';
import { resolveTaskProjectScope } from '@/shared/lib/tasks/resolveTaskProjectScope';
import {
  getRealtimeTaskSnapshot,
  useRealtimeTask,
  upsertRealtimeTaskSnapshot,
} from '@/shared/state/realtimeStore';

// Types for API responses and request bodies
// Ensure these align with your server-side definitions and Task type in @/types/tasks.ts

interface PaginatedTasksParams {
  projectId?: string | null;
  status?: TaskStatus[];
  limit?: number;
  offset?: number;
  taskType?: string | null; // Filter by specific task type
  allProjects?: boolean; // If true, query across all projects
  allProjectIds?: string[]; // List of project IDs to query when allProjects is true
}

export type PaginatedTasksResponse = RepositoryPaginatedTasksResponse;
function seedTaskSnapshot(task: Task | null | undefined, projectId?: string | null): Task | null | undefined {
  if (!task) {
    return task;
  }

  return upsertRealtimeTaskSnapshot(task, projectId) ?? task;
}

async function fetchSingleTask(taskId: string, projectId?: string | null): Promise<Task | null> {
  const effectiveProjectId = resolveTaskProjectScope(projectId);
  if (!taskId || !effectiveProjectId) {
    return null;
  }

  const task = await fetchTaskInProject(taskId, effectiveProjectId);
  return seedTaskSnapshot(task, effectiveProjectId) ?? null;
}

export function getCachedTaskSnapshot(
  queryClient: QueryClient,
  taskId: string,
  projectId?: string | null,
): Task | null | undefined {
  const effectiveProjectId = resolveTaskProjectScope(projectId);
  if (!taskId || !effectiveProjectId) {
    return undefined;
  }

  const storeTask = getRealtimeTaskSnapshot(taskId, effectiveProjectId);
  if (storeTask) {
    return storeTask;
  }

  const cachedTask = queryClient.getQueryData<Task | null>(
    taskQueryKeys.single(taskId, effectiveProjectId),
  );
  return seedTaskSnapshot(cachedTask, effectiveProjectId);
}

export function createSingleTaskQueryOptions(
  taskId: string,
  projectId?: string | null,
): UseQueryOptions<Task | null, Error> {
  const effectiveProjectId = resolveTaskProjectScope(projectId);

  return {
    queryKey: taskQueryKeys.single(taskId, effectiveProjectId),
    queryFn: () => fetchSingleTask(taskId, effectiveProjectId),
    enabled: !!taskId && !!effectiveProjectId,
    ...QUERY_PRESETS.immutable,
  };
}

export async function fetchAndSeedTaskQuery(
  queryClient: QueryClient,
  taskId: string,
  projectId?: string | null,
): Promise<Task | null> {
  return queryClient.fetchQuery(createSingleTaskQueryOptions(taskId, projectId));
}

// Hook to get a single task by ID
// Uses IMMUTABLE_PRESET since task data rarely changes after creation
export const useGetTask = (taskId: string, projectId?: string | null) => {
  const effectiveProjectId = resolveTaskProjectScope(projectId);
  const queryClient = useQueryClient();
  const storeTask = useRealtimeTask(taskId, effectiveProjectId);

  useEffect(() => {
    getCachedTaskSnapshot(queryClient, taskId, effectiveProjectId);
  }, [effectiveProjectId, queryClient, taskId]);

  const query = useQuery<Task | null, Error>(createSingleTaskQueryOptions(taskId, effectiveProjectId));

  useEffect(() => {
    if (query.data !== undefined) {
      seedTaskSnapshot(query.data, effectiveProjectId);
    }
  }, [effectiveProjectId, query.data]);

  return {
    ...query,
    data: storeTask ?? query.data,
  };
};

// Hook to list tasks with pagination - GALLERY PATTERN
export const usePaginatedTasks = (params: PaginatedTasksParams) => {
  const { projectId, status, limit = 50, offset = 0, taskType, allProjects, allProjectIds } = params;
  const effectiveProjectId: string | null = projectId ?? null;
  const projectIds = allProjects
    ? [...new Set(allProjectIds ?? [])].sort()
    : (effectiveProjectId ? [effectiveProjectId] : []);
  const visibleTaskTypes = getVisibleTaskTypes();
  const snapshotQuery = useBridgeTaskSnapshot(projectIds);
  const page = Math.floor(offset / limit) + 1;

  const paginatedData = useMemo(() => {
    if (!snapshotQuery.data) return undefined;
    return paginateTaskSnapshot(snapshotQuery.data, {
      allProjects,
      allProjectIds,
      effectiveProjectId,
      status,
      taskType,
      visibleTaskTypes,
      limit,
      offset,
      page,
    });
  }, [allProjects, allProjectIds, effectiveProjectId, limit, offset, page, snapshotQuery.data, status, taskType, visibleTaskTypes]);

  const query = {
    ...snapshotQuery,
    data: paginatedData,
  };

  useProcessingRefetchGuard(status, query);

  return query;
};
