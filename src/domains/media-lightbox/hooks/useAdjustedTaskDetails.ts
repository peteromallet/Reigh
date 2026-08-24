import { useMemo } from 'react';
import type { TaskDetailsData } from '../types';
import { resolveAdjustedTaskDetails } from './taskDetails/resolveAdjustedTaskDetails';
import { useVariantSourceTask } from './taskDetails/useVariantSourceTask';

interface UseAdjustedTaskDetailsProps {
  projectId?: string | null;
  activeVariant: {
    id: string;
    params?: Record<string, unknown> | null;
    variant_type?: string | null;
    created_at?: string;
    is_primary?: boolean | null;
  } | null;
  taskDetailsData: TaskDetailsData | undefined;
  isLoadingVariants: boolean;
  initialVariantId: string | undefined;
}

interface UseAdjustedTaskDetailsReturn {
  adjustedTaskDetailsData: TaskDetailsData | undefined;
  isLoadingVariantTask: boolean;
}

export function useAdjustedTaskDetails({
  projectId,
  activeVariant,
  taskDetailsData,
  isLoadingVariants,
  initialVariantId,
}: UseAdjustedTaskDetailsProps): UseAdjustedTaskDetailsReturn {
  const {
    variantSourceTask,
    isLoadingVariantTask,
    variantSourceTaskError,
  } = useVariantSourceTask({
    projectId,
    activeVariant,
    taskDetailsData,
  });

  const adjustedTaskDetailsData = useMemo(() => {
    return resolveAdjustedTaskDetails({
      activeVariant,
      taskDetailsData,
      variantSourceTask: variantSourceTask ?? null,
      variantSourceTaskError,
      isLoadingVariantTask,
      isLoadingVariants,
      initialVariantId,
    });
  }, [
    taskDetailsData,
    activeVariant,
    variantSourceTask,
    variantSourceTaskError,
    isLoadingVariantTask,
    isLoadingVariants,
    initialVariantId,
  ]);

  return {
    adjustedTaskDetailsData,
    isLoadingVariantTask,
  };
}
