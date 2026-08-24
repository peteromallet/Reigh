import { useMemo } from 'react';
import { GenerationRow } from '@/domains/generation/types';
import { useRelativeTimestamp, useTaskTimestamp } from '@/shared/hooks/useUpdatingTimestamp';
import { getTaskDisplayName } from '@/shared/lib/tasks/taskConfig';
import { Task } from '@/types/tasks';
import { IMAGE_EDIT_TASK_TYPES } from '../constants';
import { getAbbreviatedTaskName } from '../utils/task-utils';

interface TaskWithDbFields extends Task {
  created_at?: string;
  generation_started_at?: string;
  generation_processed_at?: string;
}

interface UseTaskItemDisplayArgs {
  task: Task;
  parsedTaskParams: Record<string, unknown>;
  promptText: string;
  taskTypeDisplayName: string | null | undefined;
  isVideoTask: boolean;
  generationData: GenerationRow | null;
  videoOutputs: GenerationRow[] | null;
}

interface UseTaskItemDisplayResult {
  createdTimeAgo: string | null;
  processingTime: string | null;
  completedTime: string | null;
  abbreviatedTaskType: string;
  travelImageUrls: string[];
  imagesToShow: string[];
  extraImageCount: number;
  shouldShowPromptPreview: boolean;
  promptPreviewText: string;
  variantName: string | undefined;
  statusBadgeClass: string;
}

const STATUS_BADGE_CLASS: Record<Task['status'], string> = {
  'In Progress': 'bg-blue-500 text-blue-100',
  Complete: 'bg-green-500 text-green-100',
  Failed: 'bg-red-500 text-red-100',
  Queued: 'bg-purple-500 text-purple-100',
  Cancelled: 'bg-orange-500 text-orange-100',
};

export function useTaskItemDisplay({
  task,
  parsedTaskParams,
  promptText,
  taskTypeDisplayName,
  isVideoTask,
  generationData,
  videoOutputs,
}: UseTaskItemDisplayArgs): UseTaskItemDisplayResult {
  const taskWithDbFields = task as TaskWithDbFields;
  const createdTimeAgo = useTaskTimestamp(task.createdAt || taskWithDbFields.created_at);
  const processingTime = useRelativeTimestamp({
    date: task.generationStartedAt || taskWithDbFields.generation_started_at,
    preset: 'processing',
  });
  const completedTime = useRelativeTimestamp({
    date: task.generationProcessedAt || taskWithDbFields.generation_processed_at,
    preset: 'completed',
  });

  const displayTaskType = taskTypeDisplayName || getTaskDisplayName(task.taskType);
  const abbreviatedTaskType = useMemo(
    () => getAbbreviatedTaskName(displayTaskType),
    [displayTaskType],
  );

  const travelImageUrls = useMemo(() => {
    if (!isVideoTask) {
      return [];
    }

    const isIndividualSegment = task.taskType === 'individual_travel_segment';
    const orchestratorDetails = parsedTaskParams.orchestrator_details as Record<string, unknown> | undefined;
    const segmentImages = parsedTaskParams.input_image_paths_resolved;
    const timelineImages = orchestratorDetails?.input_image_paths_resolved
      || parsedTaskParams.input_image_paths_resolved;
    const selected = isIndividualSegment ? segmentImages : timelineImages;

    return Array.isArray(selected)
      ? selected.filter((url): url is string => typeof url === 'string')
      : [];
  }, [isVideoTask, parsedTaskParams, task.taskType]);

  const imagesToShow = travelImageUrls.slice(0, 4);
  const extraImageCount = Math.max(0, travelImageUrls.length - imagesToShow.length);
  const isImageEditTask = (IMAGE_EDIT_TASK_TYPES as readonly string[]).includes(task.taskType);
  const shouldShowPromptPreview = Boolean(promptText && !isVideoTask && !isImageEditTask);
  const promptPreviewText = promptText.length > 50
    ? `${promptText.substring(0, 50)}...`
    : promptText;
  const variantName = isImageEditTask
    ? undefined
    : (isVideoTask ? videoOutputs?.[0]?.name : generationData?.name);

  return {
    createdTimeAgo,
    processingTime,
    completedTime,
    abbreviatedTaskType,
    travelImageUrls,
    imagesToShow,
    extraImageCount,
    shouldShowPromptPreview,
    promptPreviewText,
    variantName: variantName ?? undefined,
    statusBadgeClass: STATUS_BADGE_CLASS[task.status] || 'bg-gray-500 text-gray-100',
  };
}
