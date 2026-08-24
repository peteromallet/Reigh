import { getHiddenTaskTypes, getVisibleTaskTypes } from '@/shared/lib/tasks/taskConfig';
import { resolveTaskProjectScope } from '@/shared/lib/tasks/resolveTaskProjectScope';
import { listBridgeTasks } from '@/integrations/astrid/bridgeTaskReads';

export interface TaskLogFilters {
  status?: string[];
  taskTypes?: string[];
  projectIds?: string[];
  // `'all'` is accepted for caller compatibility (billing filter UI) and
  // degrades to a no-op — the bridge exposes no credits_ledger route.
  costFilter?: 'all' | 'free' | 'paid';
}

export interface TaskLogProject {
  id: string;
  name: string;
}

export interface TaskLogAvailableFilters {
  taskTypes: string[];
  projects: TaskLogProject[];
  statuses: string[];
}

export interface TaskLogTaskRecord {
  id: string;
  task_type: string;
  status: string;
  created_at: string;
  generation_started_at?: string | null;
  generation_processed_at?: string | null;
  project_id: string;
}

export interface EnrichedTaskLogTask {
  id: string;
  taskType: string;
  status: string;
  createdAt: string;
  generationStartedAt?: string | null;
  generationProcessedAt?: string | null;
  projectId: string;
  cost?: number;
  duration?: number;
  projectName?: string;
}

export interface TaskLogDataResult {
  availableFilters: TaskLogAvailableFilters;
  projects: TaskLogProject[];
  tasks: EnrichedTaskLogTask[];
  total: number;
}

interface FetchTaskLogDataOptions {
  filters?: TaskLogFilters;
  limit?: number;
  offset?: number;
}

/**
 * Cost entries once came from the `credits_ledger` table; the frozen bridge
 * exposes no ledger route, so log rows carry no costs (deferred surface —
 * see docs/cutover-inventory.md).
 */
interface TaskLogCostEntry {
  task_id: string | null;
  amount: number;
  created_at: string;
}

function getTaskDuration(task: TaskLogTaskRecord): number | undefined {
  if (!task.generation_started_at || !task.generation_processed_at) {
    return undefined;
  }

  const start = new Date(task.generation_started_at);
  const end = new Date(task.generation_processed_at);
  return Math.ceil((end.getTime() - start.getTime()) / 1000);
}

export function enrichTaskLogTasks(
  tasks: TaskLogTaskRecord[],
  costs: TaskLogCostEntry[],
  projectLookup: Record<string, string>,
): EnrichedTaskLogTask[] {
  return tasks.map((task) => {
    const costEntry = costs.find((entry) => entry.task_id === task.id);

    return {
      id: task.id,
      taskType: task.task_type,
      status: task.status,
      createdAt: task.created_at,
      generationStartedAt: task.generation_started_at,
      generationProcessedAt: task.generation_processed_at,
      projectId: task.project_id,
      projectName: projectLookup[task.project_id] || 'Unknown Project',
      cost: costEntry ? Math.abs(costEntry.amount) : undefined,
      duration: getTaskDuration(task),
    };
  });
}

export function applyTaskLogCostFilter(
  tasks: EnrichedTaskLogTask[],
  costFilter: TaskLogFilters['costFilter'],
): EnrichedTaskLogTask[] {
  if (costFilter === 'free') {
    return tasks.filter((task) => !task.cost || task.cost === 0);
  }

  if (costFilter === 'paid') {
    return tasks.filter((task) => Boolean(task.cost && task.cost > 0));
  }

  return tasks;
}

function matchesTaskLogQueryFilters(
  task: TaskLogTaskRecord,
  filters: TaskLogFilters,
  hiddenTaskTypes: string[],
): boolean {
  if (hiddenTaskTypes.includes(task.task_type)) return false;
  if (filters.status?.length && !filters.status.includes(task.status)) return false;
  if (filters.taskTypes?.length && !filters.taskTypes.includes(task.task_type)) return false;
  if (filters.projectIds?.length && !filters.projectIds.includes(task.project_id)) return false;
  return true;
}

function toTaskLogRecord(task: {
  id: string;
  taskType: string;
  status: string;
  createdAt: string;
  projectId: string;
}): TaskLogTaskRecord {
  // Bridge task summaries carry no generation timing columns; those
  // durations are simply absent rather than guessed.
  return {
    id: task.id,
    task_type: task.taskType,
    status: task.status,
    created_at: task.createdAt,
    project_id: task.projectId,
  };
}

/**
 * Local single-user mode: the log reads the active project's tasks through
 * the frozen task-list route. There is no projects-by-user or
 * credits-ledger route on the bridge, so project names fall back to ids and
 * costs are absent.
 */
export async function fetchTaskLogData({
  filters = {},
  limit,
  offset,
}: FetchTaskLogDataOptions = {}): Promise<TaskLogDataResult> {
  const projectSlug = resolveTaskProjectScope(null);
  if (!projectSlug) {
    return {
      availableFilters: { taskTypes: [], projects: [], statuses: [] },
      projects: [],
      tasks: [],
      total: 0,
    };
  }

  const hiddenTaskTypes = getHiddenTaskTypes();
  const taskRows = (await listBridgeTasks(projectSlug))
    .map(toTaskLogRecord)
    .filter((task) => matchesTaskLogQueryFilters(task, filters, hiddenTaskTypes))
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

  const pagedRows = typeof limit === 'number' && typeof offset === 'number'
    ? taskRows.slice(offset, offset + limit)
    : taskRows;

  const projects: TaskLogProject[] = [...new Set(taskRows.map((task) => task.project_id))]
    .map((projectId) => ({ id: projectId, name: projectId }));
  const projectLookup = Object.fromEntries(projects.map((project) => [project.id, project.name]));

  const enrichedTasks = applyTaskLogCostFilter(
    enrichTaskLogTasks(pagedRows, [], projectLookup),
    filters.costFilter,
  );

  return {
    availableFilters: {
      taskTypes: getVisibleTaskTypes().sort((left, right) => left.localeCompare(right)),
      projects,
      statuses: [...new Set(taskRows.map((task) => task.status))].sort(
        (left, right) => left.localeCompare(right),
      ),
    },
    projects,
    tasks: enrichedTasks,
    total: taskRows.length,
  };
}
