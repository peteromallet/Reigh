import { useEffect, useMemo, useState } from "react";
import { useGenerationTaskMapping } from "@/domains/generation/hooks/tasks/useGenerationTaskMapping";
import { useGetTask } from "@/shared/hooks/tasks/useTasks";
import {
  buildTaskDetailsData,
  type TaskDetailsData,
  type TaskDetailsStatus,
} from "@/shared/lib/taskDetails/taskDetailsContract";
import { deriveInputImages, parseTaskParams } from "@/shared/lib/taskParamsUtils";
import { useResolveGenerationTaskMapping } from "@/domains/generation/hooks/tasks/useResolveGenerationTaskMapping";
import { normalizeAndPresentError } from "@/shared/lib/errorHandling/runtimeError";
import type { Task } from "@/types/tasks";
import type {
  GenerationTaskMappingCacheEntry,
} from '@/shared/lib/tasks/generationTaskRepository';

interface UseGenerationTaskDetailsOptions {
  generationId: string | null;
  projectId?: string | null;
  enabled?: boolean;
  resolveMappingOnDemand?: boolean;
  onApplySettingsFromTask?: (taskId: string, replaceImages: boolean, inputImages: string[]) => void;
  onClose?: () => void;
}

interface UseGenerationTaskDetailsResult {
  taskDetailsData: TaskDetailsData | null;
  taskDetailsStatus: TaskDetailsStatus;
  taskMapping: GenerationTaskMappingCacheEntry | undefined;
  taskId: string | null;
  task: Task | undefined;
  inputImages: string[];
  isLoadingTask: boolean;
  taskError: Error | null;
}

export function useGenerationTaskDetails({
  generationId,
  projectId,
  enabled = true,
  resolveMappingOnDemand = false,
  onApplySettingsFromTask,
  onClose,
}: UseGenerationTaskDetailsOptions): UseGenerationTaskDetailsResult {
  const activeGenerationId = enabled ? generationId : null;
  const [fallbackTaskId, setFallbackTaskId] = useState<string | null>(null);
  const [mappingResolutionAttempted, setMappingResolutionAttempted] = useState(false);
  const [mappingResolutionError, setMappingResolutionError] = useState<Error | null>(null);

  useEffect(() => {
    setFallbackTaskId(null);
    setMappingResolutionAttempted(false);
    setMappingResolutionError(null);
  }, [activeGenerationId]);

  const { data: taskMapping, isLoading: isLoadingMapping } = useGenerationTaskMapping(activeGenerationId || "");

  const primaryTaskLookup = useResolveGenerationTaskMapping();
  const shouldResolveOnDemand = (
    Boolean(activeGenerationId)
    && resolveMappingOnDemand
    && taskMapping?.taskId === null
    && taskMapping.status !== "query_failed"
    && fallbackTaskId === null
    && !mappingResolutionAttempted
  );

  useEffect(() => {
    if (!shouldResolveOnDemand || !activeGenerationId) {
      return;
    }
    let cancelled = false;
    setMappingResolutionAttempted(true);

    (async () => {
      try {
        const result = await primaryTaskLookup.mutateAsync(activeGenerationId);
        if (cancelled) return;
        if (result.status === "ok") {
          setMappingResolutionError(null);
          setFallbackTaskId(result.taskId ?? null);
          return;
        }
        if (result.status === "query_failed") {
          const resolutionError = new Error(
            result.queryError ?? "Failed to resolve generation-task mapping",
          );
          setMappingResolutionError(resolutionError);
          normalizeAndPresentError(
            resolutionError,
            {
              context: "useGenerationTaskDetails.resolveMappingOnDemand",
              showToast: false,
              logData: { generationId: activeGenerationId },
            },
          );
        }
      } catch (error) {
        if (cancelled) return;
        const resolutionError = error instanceof Error
          ? error
          : new Error("Failed to resolve generation-task mapping");
        setMappingResolutionError(resolutionError);
        normalizeAndPresentError(error, {
          context: "useGenerationTaskDetails.resolveMappingOnDemand",
          showToast: false,
          logData: { generationId: activeGenerationId },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeGenerationId, primaryTaskLookup, shouldResolveOnDemand]);

  const taskId = taskMapping?.taskId ?? fallbackTaskId ?? null;
  const { data: task, isLoading: isLoadingTaskData, error: taskError } = useGetTask(
    taskId || "",
    projectId,
  );
  const mappingQueryError = useMemo(() => {
    if (taskMapping?.status !== "query_failed") {
      return null;
    }
    return new Error(taskMapping.queryError ?? "Failed to resolve generation-task mapping");
  }, [taskMapping?.queryError, taskMapping?.status]);
  const combinedTaskError = taskError ?? mappingQueryError ?? mappingResolutionError;

  const inputImages = useMemo(() => {
    if (!task?.params) return [];
    return deriveInputImages(parseTaskParams(task.params));
  }, [task]);

  const hasNoTask = taskMapping !== undefined && taskMapping.taskId === null && fallbackTaskId === null;
  const isLoading = hasNoTask
    ? primaryTaskLookup.isPending
    : (isLoadingMapping || isLoadingTaskData || primaryTaskLookup.isPending);
  const taskDetailsStatus: TaskDetailsStatus = useMemo(() => {
    if (!activeGenerationId) {
      return "missing";
    }
    if (combinedTaskError) {
      return "error";
    }
    if (task) {
      return "ok";
    }
    return "missing";
  }, [activeGenerationId, combinedTaskError, task]);

  if (!activeGenerationId) {
    return {
      taskDetailsData: null,
      taskDetailsStatus: "missing",
      taskMapping: undefined,
      taskId: null,
      task: undefined,
      inputImages: [],
      isLoadingTask: false,
      taskError: null,
    };
  }

  return {
    taskDetailsData: buildTaskDetailsData({
      task: task ?? undefined,
      isLoading,
      status: taskDetailsStatus,
      error: combinedTaskError,
      inputImages,
      taskId,
      onApplySettingsFromTask,
      onClose,
    }),
    taskDetailsStatus,
    taskMapping,
    taskId,
    task: task ?? undefined,
    inputImages,
    isLoadingTask: isLoadingTaskData,
    taskError: combinedTaskError,
  };
}
