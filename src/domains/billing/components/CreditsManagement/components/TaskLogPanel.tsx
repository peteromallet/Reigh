import { useState } from 'react';
import { Activity, Download, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { UpdatingTimeCell } from '@/shared/components/UpdatingTimeCell';
import { getTaskDisplayName } from '@/shared/lib/tasks/taskConfig';
import { TaskLogFilters } from './TaskLogFilters';
import { getTaskLogFilterSummary } from '../taskLogFilterDescriptors';
import type {
  TaskLogAvailableFilters,
  TaskLogFilters as TaskLogFiltersType,
  TaskLogPagination,
  TaskLogTask,
} from '../types';

interface TaskLogPanelProps {
  tasks: TaskLogTask[] | undefined;
  pagination: TaskLogPagination | undefined;
  availableFilters: TaskLogAvailableFilters | undefined;
  isLoading: boolean;
  filters: TaskLogFiltersType;
  filterCount: number;
  page: number;
  isDownloading: boolean;
  onPageChange: (page: number) => void;
  onUpdateFilter: <K extends keyof TaskLogFiltersType>(filterType: K, value: TaskLogFiltersType[K]) => void;
  onToggleArrayFilter: (filterType: 'status' | 'taskTypes' | 'projectIds', value: string) => void;
  onClearFilters: () => void;
  onDownload: () => void;
}

export function TaskLogPanel({
  tasks,
  pagination,
  availableFilters,
  isLoading,
  filters,
  filterCount,
  page,
  isDownloading,
  onPageChange,
  onUpdateFilter,
  onToggleArrayFilter,
  onClearFilters,
  onDownload,
}: TaskLogPanelProps) {
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const filterSummary = getTaskLogFilterSummary(availableFilters);

  const handleCopyTaskId = (taskId: string) => {
    navigator.clipboard.writeText(taskId);
    setCopiedTaskId(taskId);
    setTimeout(() => setCopiedTaskId(null), 2000);
  };

  return (
    <div>
      {/* Mobile notice */}
      <div className="sm:hidden p-3 bg-blue-50 border border-blue-200 rounded-lg text-center">
        <p className="text-sm text-blue-700">More details are available on desktop</p>
      </div>

      {/* Filters Bar */}
      <TaskLogFilters
        filters={filters}
        availableFilters={availableFilters}
        filterCount={filterCount}
        onUpdateFilter={onUpdateFilter}
        onToggleArrayFilter={onToggleArrayFilter}
        onClearFilters={onClearFilters}
      />

      {/* Download Button Section */}
      <div className="flex justify-end items-center gap-2 mb-4">
        <span className="text-sm text-gray-500">
          {pagination?.total || 0} task{(pagination?.total || 0) !== 1 ? 's' : ''}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onDownload}
          disabled={isDownloading || !tasks?.length}
          className="h-8"
        >
          {isDownloading ? (
            <div className="animate-spin">
              <Download className="w-4 h-4" />
            </div>
          ) : (
            <>
              <Download className="w-4 h-4 mr-1" />
              Download CSV
            </>
          )}
        </Button>
      </div>

      {/* Helper text when no filters are active */}
      {filterCount === 0 && filterSummary && (
        <div className="text-center py-2">
          <p className="text-sm text-gray-600">
            💡 <strong>Tip:</strong> Use the filters above to analyze tasks by {filterSummary}
          </p>
        </div>
      )}

      {/* Task Table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <TaskLogTableSkeleton />
        ) : (tasks?.length || 0) === 0 ? (
          <TaskLogEmptyState filterCount={filterCount} onClearFilters={onClearFilters} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">ID</TableHead>
                    <TableHead className="w-16">Date</TableHead>
                    <TableHead className="w-28">Task Type</TableHead>
                    <TableHead className="hidden sm:table-cell w-20">Project</TableHead>
                    <TableHead className="hidden sm:table-cell w-20">Status</TableHead>
                    <TableHead className="hidden sm:table-cell w-16">Duration</TableHead>
                    <TableHead className="w-16">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks?.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="p-2">
                        <button
                          onClick={() => handleCopyTaskId(task.id)}
                          className={`flex items-center gap-1 px-1 py-0.5 text-[10px] rounded transition-colors border ${
                            copiedTaskId === task.id
                              ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/50 border-green-300 dark:border-green-700'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted border-border hover:border-foreground/30'
                          }`}
                          title={`Copy task ID: ${task.id}`}
                        >
                          {copiedTaskId === task.id ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs p-2">
                        <UpdatingTimeCell date={task.createdAt} />
                      </TableCell>
                      <TableCell className="p-2">
                        <Badge variant="outline" className="capitalize py-0.5 px-1.5 text-[10px] whitespace-nowrap">
                          {getTaskDisplayName(task.taskType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-gray-600 truncate p-2">
                        {task.projectName || 'Unknown'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell p-2">
                        <Badge
                          variant={
                            task.status === 'Complete' ? 'default' :
                            task.status === 'Failed' ? 'destructive' :
                            'secondary'
                          }
                          className="text-[10px] px-1.5 py-0.5"
                        >
                          {task.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-gray-600 p-2">
                        {task.duration ? `${task.duration}s` : '-'}
                      </TableCell>
                      <TableCell
                        className={`font-light text-xs p-2 ${
                          task.cost ? 'text-red-600' : 'text-gray-400'
                        }`}
                      >
                        {task.cost ? `$${parseFloat(task.cost.toString()).toFixed(3)}` : 'Free'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted">
                <div className="text-sm text-muted-foreground">
                  Page {pagination.currentPage} of {pagination.totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="h-8"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page + 1)}
                    disabled={!pagination.hasMore}
                    className="h-8"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TaskLogTableSkeleton() {
  return (
    <div className="overflow-x-auto">
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">ID</TableHead>
            <TableHead className="w-16">Date</TableHead>
            <TableHead className="w-28">Task Type</TableHead>
            <TableHead className="hidden sm:table-cell w-20">Project</TableHead>
            <TableHead className="hidden sm:table-cell w-20">Status</TableHead>
            <TableHead className="hidden sm:table-cell w-16">Duration</TableHead>
            <TableHead className="w-16">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <TableRow key={i}>
              <TableCell className="p-2">
                <Skeleton className="h-5 w-8" />
              </TableCell>
              <TableCell className="p-2">
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell className="p-2">
                <Skeleton className="h-5 w-20 rounded-full" />
              </TableCell>
              <TableCell className="hidden sm:table-cell p-2">
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell className="hidden sm:table-cell p-2">
                <Skeleton className="h-5 w-16 rounded-full" />
              </TableCell>
              <TableCell className="hidden sm:table-cell p-2">
                <Skeleton className="h-4 w-12" />
              </TableCell>
              <TableCell className="p-2">
                <Skeleton className="h-4 w-10" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface TaskLogEmptyStateProps {
  filterCount: number;
  onClearFilters: () => void;
}

function TaskLogEmptyState({ filterCount, onClearFilters }: TaskLogEmptyStateProps) {
  return (
    <div className="p-8 text-center">
      <Activity className="w-8 h-8 text-gray-400 mx-auto mb-2" />
      <p className="text-gray-600">
        {filterCount > 0 ? 'No tasks match your filters' : 'No tasks yet'}
      </p>
      <p className="text-sm text-gray-500 mt-1">
        {filterCount > 0 ?
          'Try adjusting your filters to see more results' :
          'Create some AI generations to see your task history'
        }
      </p>
      {filterCount > 0 && (
        <Button variant="outline" size="sm" onClick={onClearFilters} className="mt-2">
          Clear Filters
        </Button>
      )}
    </div>
  );
}
