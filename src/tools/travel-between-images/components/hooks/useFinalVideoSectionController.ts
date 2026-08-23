import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GenerationRow } from '@/domains/generation/types';
import { listBridgeTasks } from '@/integrations/astrid/bridgeTaskReads';
import { taskPollingCadence } from '@/shared/hooks/tasks/taskPollingCadence';
import { useIsMobile } from '@/shared/hooks/mobile';
import { useSegmentOutputsForShot } from '@/shared/hooks/segments';
import { useTaskDetails } from '@/shared/components/ShotImageManager/hooks/useTaskDetails';
import { useVariantBadges } from '@/shared/hooks/variants/useVariantBadges';
import { useShareGeneration } from '@/shared/hooks/useShareGeneration';
import { useMarkVariantViewed } from '@/shared/hooks/variants/useMarkVariantViewed';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import type {
  FinalVideoSectionProgress,
  FinalVideoSectionProps,
  FinalVideoVariantBadgeData,
} from '../FinalVideoSection.types';

const EMPTY_PROGRESS: FinalVideoSectionProgress = { completed: 0, total: 0 };

function getTaskParams(task: { params?: unknown }): Record<string, unknown> {
  if (!task.params || typeof task.params !== 'object' || Array.isArray(task.params)) {
    return {};
  }
  return task.params as Record<string, unknown>;
}

function getTaskImages(task: { params?: unknown } | undefined): string[] {
  if (!task) {
    return [];
  }

  const params = getTaskParams(task);
  const rawOrchestratorDetails = params.orchestrator_details;
  const orchestratorDetails =
    rawOrchestratorDetails && typeof rawOrchestratorDetails === 'object' && !Array.isArray(rawOrchestratorDetails)
      ? (rawOrchestratorDetails as Record<string, unknown>)
      : {};

  const inputPaths =
    params.input_image_paths_resolved ??
    orchestratorDetails.input_image_paths_resolved ??
    params.input_images ??
    [];

  return Array.isArray(inputPaths) ? inputPaths.filter((path): path is string => typeof path === 'string') : [];
}

function matchesJoinTask(
  task: { params: unknown },
  shotId: string,
  parentGenerationIds: Set<string>,
): boolean {
  if (!task.params || typeof task.params !== 'object' || Array.isArray(task.params)) {
    return false;
  }

  const params = task.params as Record<string, unknown>;
  const rawOrchestratorDetails = params.orchestrator_details;
  const orchestratorDetails =
    rawOrchestratorDetails && typeof rawOrchestratorDetails === 'object' && !Array.isArray(rawOrchestratorDetails)
      ? (rawOrchestratorDetails as Record<string, unknown>)
      : {};

  const taskShotId = orchestratorDetails.shot_id ?? params.shot_id;
  if (taskShotId === shotId) {
    return true;
  }

  const taskParentGenerationId =
    orchestratorDetails.parent_generation_id ?? params.parent_generation_id;

  return typeof taskParentGenerationId === 'string' && parentGenerationIds.has(taskParentGenerationId);
}

export function useFinalVideoSectionController({
  shotId,
  projectId,
  onApplySettingsFromTask,
  selectedParentId: controlledSelectedParentId,
  onSelectedParentChange,
  parentGenerations: parentGenerationsFromProps,
  segmentProgress: segmentProgressFromProps,
  isParentLoading = false,
  getFinalVideoCount,
  onDelete,
  readOnly = false,
  preloadedParent,
}: FinalVideoSectionProps) {
  const isMobile = useIsMobile();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const isControlled =
    controlledSelectedParentId !== undefined && onSelectedParentChange !== undefined;
  const skipHook = readOnly && preloadedParent !== undefined;
  const hasParentData =
    (parentGenerationsFromProps && parentGenerationsFromProps.length > 0) || isControlled;

  const hookResult = useSegmentOutputsForShot(
    skipHook || hasParentData ? null : shotId,
    skipHook || hasParentData ? '' : projectId,
    undefined,
    controlledSelectedParentId,
    onSelectedParentChange,
  );

  const parentGenerations = useMemo(() => {
    if (skipHook && preloadedParent) {
      return [preloadedParent];
    }
    if (parentGenerationsFromProps && parentGenerationsFromProps.length > 0) {
      return parentGenerationsFromProps;
    }
    return hookResult.parentGenerations;
  }, [skipHook, preloadedParent, parentGenerationsFromProps, hookResult.parentGenerations]);

  const selectedParentId =
    skipHook && preloadedParent
      ? preloadedParent.id
      : isControlled
        ? controlledSelectedParentId ?? null
        : hookResult.selectedParentId;
  const setSelectedParentId = isControlled
    ? (onSelectedParentChange as (id: string | null) => void)
    : hookResult.setSelectedParentId;

  const segmentProgress = skipHook
    ? EMPTY_PROGRESS
    : segmentProgressFromProps && segmentProgressFromProps.total > 0
      ? segmentProgressFromProps
      : hookResult.segmentProgress;

  const isLoading = skipHook
    ? false
    : hasParentData
      ? isParentLoading
      : hookResult.isLoading;

  const selectedParent = useMemo(() => {
    if (!selectedParentId) {
      return null;
    }
    return parentGenerations.find((parent) => parent.id === selectedParentId) || null;
  }, [parentGenerations, selectedParentId]);
  const variantGenerationId = selectedParent?.variant_fetch_generation_id ?? selectedParentId;

  const hasFinalOutput = Boolean(selectedParent?.location);

  const { getBadgeData } = useVariantBadges(
    variantGenerationId ? [variantGenerationId] : [],
    Boolean(variantGenerationId && hasFinalOutput),
  );

  const rawBadgeData = variantGenerationId ? getBadgeData(variantGenerationId) : null;
  const badgeData: FinalVideoVariantBadgeData | null = rawBadgeData
    ? {
        derivedCount: rawBadgeData.derivedCount,
        unviewedVariantCount: rawBadgeData.unviewedVariantCount,
        hasUnviewedVariants: rawBadgeData.hasUnviewedVariants,
      }
    : null;

  const { markAllViewed } = useMarkVariantViewed();
  const handleMarkAllVariantsViewed = useCallback(() => {
    if (variantGenerationId) {
      markAllViewed(variantGenerationId);
    }
  }, [variantGenerationId, markAllViewed]);

  const parentVideoRow = useMemo(() => {
    if (!selectedParent) {
      return null;
    }
    return { ...selectedParent, type: 'video' } as GenerationRow;
  }, [selectedParent]);

  const {
    taskDetailsData,
    taskMapping,
    task,
    taskError,
  } = useTaskDetails({
    generationId: selectedParentId,
    projectId,
    onApplySettingsFromTask,
  });

  const {
    handleShare,
    isCreatingShare,
    shareCopied,
    shareSlug,
  } = useShareGeneration(selectedParentId ?? undefined, taskMapping?.taskId, shotId);

  const parentGenerationIdsForQuery = useMemo(
    () => parentGenerations.map((parent) => parent.id),
    [parentGenerations],
  );

  const { data: activeJoinTask } = useQuery({
    queryKey: [...taskQueryKeys.activeJoinClips(shotId), projectId, parentGenerationIdsForQuery],
    queryFn: async () => {
      if (!shotId || !projectId) {
        return null;
      }

      const processing = await listBridgeTasks(projectId);
      const joinCandidates = processing
        .filter((task) =>
          (task.status === 'Queued' || task.status === 'In Progress')
          && (task.taskType === 'join_clips_orchestrator' || task.taskType === 'travel_stitch'))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .map((task) => ({ id: task.id, status: task.status, params: task.params as unknown }));

      const parentGenerationIds = new Set(parentGenerationIdsForQuery);
      return (
        joinCandidates.find((candidateTask) =>
          matchesJoinTask(candidateTask, shotId, parentGenerationIds),
        ) || null
      );
    },
    enabled: Boolean(shotId && projectId),
    refetchInterval: taskPollingCadence,
    staleTime: 1000,
  });

  const hasActiveJoinTask = Boolean(activeJoinTask);

  const inputImages = useMemo(() => getTaskImages(task), [task]);

  const selectedIndex = parentGenerations.findIndex((parent) => parent.id === selectedParentId);

  const handleLightboxOpen = useCallback(() => {
    setIsLightboxOpen(true);
  }, []);

  const handleLightboxClose = useCallback(() => {
    setIsLightboxOpen(false);
  }, []);

  const handleOutputSelect = useCallback(
    (id: string) => {
      setSelectedParentId(id);
    },
    [setSelectedParentId],
  );

  const handleDelete = useCallback(() => {
    if (selectedParentId && onDelete) {
      onDelete(selectedParentId);
    }
  }, [selectedParentId, onDelete]);

  const isCurrentlyLoading = isLoading || isParentLoading;

  const cachedFinalVideoCount = getFinalVideoCount?.(shotId) ?? null;
  const willHaveFinalVideo = cachedFinalVideoCount !== null && cachedFinalVideoCount > 0;
  const hasCompletedParent = parentGenerations.some((parent) => Boolean(parent.location));
  const shouldShowSkeleton = !hasFinalOutput && (
    (willHaveFinalVideo && (isCurrentlyLoading || parentGenerations.length > 0)) ||
    (hasCompletedParent && !selectedParentId)
  );

  return {
    isMobile,
    isLightboxOpen,
    handleLightboxOpen,
    handleLightboxClose,
    parentGenerations,
    selectedParentId,
    selectedIndex,
    hasFinalOutput,
    badgeData,
    handleMarkAllVariantsViewed,
    parentVideoRow,
    taskDetailsData,
    taskMapping,
    task,
    taskError,
    inputImages,
    handleShare,
    isCreatingShare,
    shareCopied,
    shareSlug,
    handleOutputSelect,
    segmentProgress,
    handleDelete,
    isCurrentlyLoading,
    shouldShowSkeleton,
    hasActiveJoinTask,
  };
}
