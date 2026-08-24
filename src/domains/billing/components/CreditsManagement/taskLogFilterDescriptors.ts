import { getTaskDisplayName } from '@/shared/lib/tasks/taskConfig';
import type {
  TaskLogArrayFilterKey,
  TaskLogAvailableFilters,
  TaskLogFilters,
} from './types';

interface TaskLogFilterOption {
  value: string;
  label: string;
}

interface TaskLogRadioFilterOption {
  value: TaskLogFilters['costFilter'];
  label: string;
}

interface TaskLogDescriptorBase<K extends keyof TaskLogFilters> {
  key: K;
  label: string;
  title: string;
  summaryLabel: string;
  clearValue: TaskLogFilters[K];
  badgeCount: (filters: TaskLogFilters) => number;
}

interface TaskLogRadioFilterDescriptor extends TaskLogDescriptorBase<'costFilter'> {
  kind: 'radio';
  widthClass: string;
  options: TaskLogRadioFilterOption[];
}

interface TaskLogMultiFilterDescriptor extends TaskLogDescriptorBase<TaskLogArrayFilterKey> {
  kind: 'multi';
  widthClass: string;
  allLabel: (availableFilters: TaskLogAvailableFilters | undefined) => string;
  getOptions: (availableFilters: TaskLogAvailableFilters | undefined) => TaskLogFilterOption[];
}

export type TaskLogFilterDescriptor =
  | TaskLogRadioFilterDescriptor
  | TaskLogMultiFilterDescriptor;

const TASK_LOG_FILTER_DESCRIPTORS: TaskLogFilterDescriptor[] = [
  {
    key: 'costFilter',
    kind: 'radio',
    label: 'Cost',
    title: 'Filter by Cost',
    summaryLabel: 'cost',
    clearValue: 'all',
    widthClass: 'w-48',
    badgeCount: (filters) => (filters.costFilter === 'all' ? 0 : 1),
    options: [
      { value: 'all', label: 'All Costs' },
      { value: 'free', label: 'Free Tasks' },
      { value: 'paid', label: 'Paid Tasks' },
    ],
  },
  {
    key: 'status',
    kind: 'multi',
    label: 'Status',
    title: 'Filter by Status',
    summaryLabel: 'status',
    clearValue: [],
    widthClass: 'w-48',
    badgeCount: (filters) => filters.status.length,
    allLabel: (availableFilters) => `All Statuses (${availableFilters?.statuses.length ?? 0})`,
    getOptions: (availableFilters) =>
      (availableFilters?.statuses ?? []).map((status) => ({
        value: status,
        label: status,
      })),
  },
  {
    key: 'taskTypes',
    kind: 'multi',
    label: 'Task Type',
    title: 'Filter by Task Type',
    summaryLabel: 'task type',
    clearValue: [],
    widthClass: 'w-56',
    badgeCount: (filters) => filters.taskTypes.length,
    allLabel: (availableFilters) => `All Types (${availableFilters?.taskTypes.length ?? 0})`,
    getOptions: (availableFilters) =>
      (availableFilters?.taskTypes ?? []).map((taskType) => ({
        value: taskType,
        label: getTaskDisplayName(taskType),
      })),
  },
  {
    key: 'projectIds',
    kind: 'multi',
    label: 'Project',
    title: 'Filter by Project',
    summaryLabel: 'project',
    clearValue: [],
    widthClass: 'w-64',
    badgeCount: (filters) => filters.projectIds.length,
    allLabel: (availableFilters) => `All Projects (${availableFilters?.projects.length ?? 0})`,
    getOptions: (availableFilters) =>
      (availableFilters?.projects ?? []).map((project) => ({
        value: project.id,
        label: project.name,
      })),
  },
];

export function getTaskLogFilterCount(filters: TaskLogFilters): number {
  return TASK_LOG_FILTER_DESCRIPTORS.reduce((count, descriptor) => (
    descriptor.badgeCount(filters) > 0 ? count + 1 : count
  ), 0);
}

export function getVisibleTaskLogFilterDescriptors(
  availableFilters: TaskLogAvailableFilters | undefined,
): TaskLogFilterDescriptor[] {
  return TASK_LOG_FILTER_DESCRIPTORS.filter((descriptor) => (
    descriptor.kind === 'radio' || descriptor.getOptions(availableFilters).length > 0
  ));
}

function formatFilterSummary(labels: string[]): string | null {
  if (labels.length === 0) {
    return null;
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

export function getTaskLogFilterSummary(
  availableFilters: TaskLogAvailableFilters | undefined,
): string | null {
  const summaryLabels = TASK_LOG_FILTER_DESCRIPTORS.flatMap((descriptor) => {
    if (descriptor.kind === 'radio') {
      return [descriptor.summaryLabel];
    }

    return descriptor.getOptions(availableFilters).length > 1
      ? [descriptor.summaryLabel]
      : [];
  });

  return formatFilterSummary(summaryLabels);
}
