import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { useAuthSafe } from '@/shared/contexts/AuthContext';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { setTaskTypeConfigCache, type TaskTypeInfo } from '@/shared/lib/taskTypeCache';

;

/**
 * Hook to fetch task type information including content_type
 * @param taskType - The task type name to look up
 * @returns Query result with task type information
 */
export const useTaskType = (taskType: string) => {
  return useQuery({
    queryKey: taskQueryKeys.type(taskType),
    queryFn: async (): Promise<TaskTypeInfo | null> => {
      const { data, error } = await supabase().from('task_types')
        .select('id, name, content_type, tool_type, display_name, category, is_visible, supports_progress')
        .eq('name', taskType)
        .maybeSingle();

      if (error) {
        console.warn(`Failed to fetch task type info for ${taskType}:`, error);
        return null;
      }

      if (!data) {
        return null;
      }

      return {
        ...data,
        is_visible: data.is_visible ?? false,
        supports_progress: data.supports_progress ?? false,
      };
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
  const { data, error } = await supabase().from('task_types')
    .select('id, name, content_type, tool_type, display_name, category, is_visible, supports_progress')
    .eq('is_active', true);

  if (error) {
    return {};
  }

  const configMap = (data || []).reduce((acc, taskType) => {
    acc[taskType.name] = {
      ...taskType,
      is_visible: taskType.is_visible ?? false,
      supports_progress: taskType.supports_progress ?? false,
    };
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
  const { isAuthenticated } = useAuthSafe();
  return useQuery({
    queryKey: taskQueryKeys.typesConfigAll,
    queryFn: fetchAllTaskTypesConfig,
    // Task-type configs feed the app shell's task/tool surfaces; with no
    // session (dev local-mode editor) there is nothing to warm, and the fetch
    // would hit a backend local mode must never touch.
    enabled: isAuthenticated,
    staleTime: 10 * 60 * 1000, // 10 minutes - task types config rarely changes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};
