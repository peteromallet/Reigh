import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBridgeTaskClient } from '@/integrations/astrid/bridgeTaskReads';
import { asRecord } from '@/shared/lib/typeCoercion';
import { Task } from '@/types/tasks';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';

interface CascadedTaskInfo {
  error_message: string | null;
  task_type: string;
}

interface TaskErrorDisplay {
  /** The cascaded source task ID parsed from the error message, or null */
  cascadedTaskId: string | null;
  /** The fetched cascaded task data (error_message + task_type), or null */
  cascadedTask: CascadedTaskInfo | null;
  /** Whether the cascaded task query is still loading */
  isCascadedTaskLoading: boolean;
}

/**
 * Hook to handle cascaded error display for failed tasks.
 *
 * Parses "Cascaded failed from related task <uuid>" from the task's errorMessage,
 * then fetches that related task's error_message and task_type for display.
 */
export function useTaskErrorDisplay(task: Task): TaskErrorDisplay {
  const cascadedTaskId = useMemo(() => {
    const match = task.errorMessage?.match(/Cascaded failed from related task ([a-f0-9-]+)/i);
    return match ? match[1] : null;
  }, [task.errorMessage]);

  const { data: cascadedTask = null, isLoading: isCascadedTaskLoading } = useQuery({
    queryKey: taskQueryKeys.cascadedError(cascadedTaskId!),
    queryFn: async () => {
      if (!cascadedTaskId) return null;
      const detail = await getBridgeTaskClient(task.projectId).tasks.get(cascadedTaskId);
      const spec = asRecord(detail.spec);
      return {
        error_message: typeof spec?.error_message === 'string' ? spec.error_message : null,
        task_type: typeof spec?.source_task_type === 'string'
          ? spec.source_task_type
          : detail.capability,
      } satisfies CascadedTaskInfo;
    },
    enabled: !!cascadedTaskId && task.status === 'Failed',
  });

  return { cascadedTaskId, cascadedTask, isCascadedTaskLoading };
}
