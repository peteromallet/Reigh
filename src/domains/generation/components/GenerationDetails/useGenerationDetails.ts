import { useMemo } from 'react';
import { useGetTask } from '@/shared/hooks/tasks/useTasks';
import { deriveInputImages } from '@/shared/lib/taskParamsUtils';
import { Task } from '@/types/tasks';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';

interface UseGenerationDetailsOptions {
  taskId?: string;
  task?: Task;
  inputImages?: string[];
  projectId?: string | null;
}

interface UseGenerationDetailsResult {
  task: Task | undefined;
  inputImages: string[];
  isLoading: boolean;
  isError: boolean;
  nonfatalWarning: string | null;
}

/**
 * Hook for fetching and preparing task data for GenerationDetails
 *
 * Handles:
 * - Fetching task data by ID if provided
 * - Using directly provided task if available
 * - Deriving input images from task params
 */
export function useGenerationDetails({
  taskId,
  task: taskProp,
  inputImages: inputImagesProp,
  projectId,
}: UseGenerationDetailsOptions): UseGenerationDetailsResult {
  // Fetch task data if taskId is provided and no task prop
  const { data: fetchedTask, isLoading, isError } = useGetTask(taskId || '', projectId);

  // Use provided task or fetched task
  const task = taskProp ?? fetchedTask ?? undefined;

  // Derive input images from task if not explicitly provided
  const { inputImages, nonfatalWarning } = useMemo(() => {
    if (inputImagesProp && inputImagesProp.length > 0) {
      return {
        inputImages: inputImagesProp,
        nonfatalWarning: null,
      };
    }
    if (!task?.params) {
      return {
        inputImages: [],
        nonfatalWarning: null,
      };
    }
    // Parse params if needed
    let params: Record<string, unknown>;
    try {
      params = typeof task.params === 'string' ? JSON.parse(task.params) : task.params;
    } catch (error) {
      normalizeAndPresentError(error, {
        context: 'useGenerationDetails.parseTaskParams',
        showToast: false,
        logData: { taskId: task?.id, hasStringParams: typeof task?.params === 'string' },
      });
      return {
        inputImages: [],
        nonfatalWarning: 'Task parameters could not be parsed completely, so some generation details may be missing.',
      };
    }
    return {
      inputImages: deriveInputImages(params),
      nonfatalWarning: null,
    };
  }, [inputImagesProp, task]);

  return {
    task,
    inputImages,
    isLoading: taskId ? isLoading && !taskProp : false,
    isError: taskId ? isError && !taskProp : false,
    nonfatalWarning,
  };
}
