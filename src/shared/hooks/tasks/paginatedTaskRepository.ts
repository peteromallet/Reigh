import { type Task, type TaskStatus } from '@/types/tasks';
import { filterVisibleTasks } from '@/shared/lib/tasks/taskConfig';
import { isRootBridgeTask, listBridgeTasks } from '@/integrations/astrid/bridgeTaskReads';
import {
  isProcessingStatusFilter,
  isSucceededOnlyStatus,
  sortProcessingTasks,
} from '@/shared/hooks/tasks/taskFetchPolicy';

export interface PaginatedTaskQuery {
  allProjects?: boolean;
  allProjectIds?: string[];
  effectiveProjectId: string | null;
  status?: TaskStatus[];
  taskType?: string | null;
  visibleTaskTypes: string[];
  limit: number;
  offset: number;
  page: number;
}

export interface PaginatedTasksResponse {
  tasks: Task[];
  total: number;
  hasMore: boolean;
  totalPages: number;
}

const EMPTY_PAGINATED_TASKS_RESPONSE: PaginatedTasksResponse = {
  tasks: [],
  total: 0,
  hasMore: false,
  totalPages: 0,
};

/**
 * The frozen task-list route is project-scoped by its slug and carries no
 * status/type filters, so filtering that supabase-js did in SQL happens
 * here, over one bridge read.
 */
function matchesFilters(task: Task, filters: PaginatedTaskQuery): boolean {
  if (!filters.visibleTaskTypes.includes(task.taskType)) return false;
  if (filters.status?.length && !filters.status.includes(task.status)) return false;
  if (filters.taskType && task.taskType !== filters.taskType) return false;
  return isRootBridgeTask(task.params);
}

function buildPaginatedTasksResponse(
  visibleTasks: Task[],
  needsCustomSorting: boolean,
  offset: number,
  limit: number,
): PaginatedTasksResponse {
  const paginatedTasks = needsCustomSorting
    ? sortProcessingTasks(visibleTasks).slice(offset, offset + limit)
    : visibleTasks;
  // The bridge list answers without a total count; derive it from the read
  // window exactly like the old count-less fallback branch.
  const total = Math.max(paginatedTasks.length, offset + paginatedTasks.length);
  const totalPages = Math.ceil(total / limit);
  const hasMore = paginatedTasks.length >= limit;

  return {
    tasks: paginatedTasks,
    total,
    hasMore,
    totalPages,
  };
}

export async function fetchPaginatedTasks(filters: PaginatedTaskQuery): Promise<PaginatedTasksResponse> {
  if (filters.allProjects && (!filters.allProjectIds || filters.allProjectIds.length === 0)) {
    return EMPTY_PAGINATED_TASKS_RESPONSE;
  }
  if (!filters.allProjects && !filters.effectiveProjectId) {
    return EMPTY_PAGINATED_TASKS_RESPONSE;
  }

  const needsCustomSorting = isProcessingStatusFilter(filters.status);
  const succeededOnly = isSucceededOnlyStatus(filters.status);

  const projectSlug = filters.allProjects
    ? filters.allProjectIds![0]
    : filters.effectiveProjectId!;
  const allTasks = await listBridgeTasks(projectSlug);

  let visibleTasks = allTasks.filter((task) => matchesFilters(task, filters));
  if (succeededOnly) {
    visibleTasks.sort((left, right) =>
      new Date(right.updatedAt || right.createdAt).getTime()
      - new Date(left.updatedAt || left.createdAt).getTime());
  } else {
    visibleTasks.sort((left, right) =>
      new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
  }
  visibleTasks = filterVisibleTasks(visibleTasks);

  return buildPaginatedTasksResponse(
    visibleTasks,
    needsCustomSorting,
    filters.offset,
    filters.limit,
  );
}
