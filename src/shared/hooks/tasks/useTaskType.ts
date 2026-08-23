import { useQuery } from '@tanstack/react-query';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { setTaskTypeConfigCache, type TaskTypeInfo } from '@/shared/lib/taskTypeCache';
import {
  getTaskTypeConfigFallback,
  getTaskTypeFallbackEntries,
} from '@/shared/lib/taskTypeConfigFallback';

/**
 * Task-type display config is APP configuration, not bridge data: the old
 * Supabase `task_types` table has no doc-27 §4.1 route, and the versioned
 * local registry (`taskTypeConfigFallback`) is its single surviving source.
 * Both hooks read that one registry — no second authority.
 */

function entryToTaskTypeInfo(
  name: string,
  entry: NonNullable<ReturnType<typeof getTaskTypeConfigFallback>>,
): TaskTypeInfo {
  return {
    id: name,
    name,
    // `content_type` was live-DB-only metadata; consumers already infer
    // image content via KNOWN_IMAGE_TASK_TYPES and handle null otherwise.
    content_type: entry.contentType ?? null,
    tool_type: null,
    display_name: entry.displayName ?? name,
    category: entry.category ?? 'utility',
    is_visible: entry.isVisible ?? false,
    supports_progress: entry.supportsProgress ?? false,
  };
}

/**
 * Hook to fetch task type information including content_type
 * @param taskType - The task type name to look up
 * @returns Query result with task type information
 */
export const useTaskType = (taskType: string) => {
  return useQuery({
    queryKey: taskQueryKeys.type(taskType),
    queryFn: async (): Promise<TaskTypeInfo | null> => {
      const entry = getTaskTypeConfigFallback(taskType);
      if (!entry) {
        return null;
      }
      return entryToTaskTypeInfo(taskType, entry);
    },
    enabled: !!taskType,
    staleTime: 5 * 60 * 1000, // 5 minutes - task types don't change often
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

/**
 * Fetch all task types config directly (for initialization)
 * This is called once on app load to populate the cache
 */
async function fetchAllTaskTypesConfig(): Promise<Record<string, TaskTypeInfo>> {
  const configMap = getTaskTypeFallbackEntries().reduce((acc, [name, entry]) => {
    acc[name] = entryToTaskTypeInfo(name, entry);
    return acc;
  }, {} as Record<string, TaskTypeInfo>);

  setTaskTypeConfigCache(configMap);
  return configMap;
}

/**
 * Hook to fetch and cache ALL task type configs
 * Should be called once near the app root to initialize the cache
 * @returns Query result with all task type configurations
 */
export const useAllTaskTypesConfig = () => {
  return useQuery({
    queryKey: taskQueryKeys.typesConfigAll,
    queryFn: fetchAllTaskTypesConfig,
    // Local registry read — no session gating required (the old gate existed
    // because the supabase table needed an authenticated client).
    staleTime: 10 * 60 * 1000, // 10 minutes - task types config rarely changes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};
