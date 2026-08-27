import React, { useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability';
import { useSmartPollingConfig } from '@/shared/hooks/useSmartPolling';
import type { GenerationModeNormalized } from '@/shared/lib/settingsResolution';
import { settingsQueryKeys } from '@/shared/lib/queryKeys/settings';
import { ProjectScopedCache } from '@/shared/lib/cache/ProjectScopedCache';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';

// Global cache instance that persists across component remounts
const globalProjectGenerationModesCache = new ProjectScopedCache<GenerationModeNormalized>();

/**
 * Fetch all shot generation modes for a project
 */
async function fetchProjectGenerationModesFromDB(projectId: string): Promise<Map<string, GenerationModeNormalized>> {
  void projectId;
  throw bridgeCapabilityUnavailable(
    'read per-shot generation modes',
    'Use timeline mode; the dormant Astrid shots pack must expose shot settings before this cache can be enabled.',
  );
}

/**
 * Hook to fetch and cache all shot generation modes for a project
 * Provides instant access to any shot's generation mode within the project
 *
 * @param projectId - The project ID to fetch modes for
 * @param options.enabled - Additional condition to enable the query (default: true)
 */
export function useProjectGenerationModesCache(projectId: string | null, options?: { enabled?: boolean }) {
  const { enabled = true } = options ?? {};
  const isLocalMode = hasLocalModeUrlParams(typeof window === 'undefined' ? '' : window.location.search);
  const cacheRef = useRef(globalProjectGenerationModesCache);
  const queryClient = useQueryClient();
  
  const smartPollingConfig = useSmartPollingConfig(settingsQueryKeys.generationModes(projectId ?? '__no-project__'));
  
  // Query to fetch all shot generation modes for the project
  const { data: projectModes, isLoading, error, refetch } = useQuery<Map<string, GenerationModeNormalized>>({
    queryKey: settingsQueryKeys.generationModes(projectId!),
    queryFn: () => fetchProjectGenerationModesFromDB(projectId!),
    // Document-derived local shots do not have a relational generation-mode
    // table. Keep the established editor's settings controls available while
    // avoiding a guaranteed bridge-capability error on first render.
    enabled: !!projectId && enabled && !isLocalMode,
    gcTime: 10 * 60 * 1000, // 10 minutes
    placeholderData: (previousData) => previousData, // Keep showing previous data while refetching
    ...smartPollingConfig,
    refetchIntervalInBackground: true, // Enable background polling
  });
  
  // PERF: Ref for projectModes so callbacks always read latest without needing it in deps.
  // Maps break React Query's structural sharing → projectModes is a new reference on every
  // refetch → callbacks with projectModes in deps are recreated → break React.memo on children.
  const projectModesRef = useRef(projectModes);
  projectModesRef.current = projectModes;

  // Update cache when data changes
  React.useEffect(() => {
    if (projectModes && projectId) {
      cacheRef.current.setProject(projectId, projectModes);
    }
  }, [projectModes, projectId]);

  const getShotGenerationMode = useCallback((shotId: string | null, isMobile: boolean = false): GenerationModeNormalized | null => {
    // Mobile always uses batch mode
    if (isMobile) {
      return 'batch';
    }

    if (!projectId || !shotId) return null;

    // First try cache
    const cachedMode = cacheRef.current.getItem(projectId, shotId);
    if (cachedMode !== null) {
      return cachedMode;
    }

    // Then try current query data
    const value = projectModesRef.current?.get(shotId);
    return value !== undefined ? value : null;
  }, [projectId]);

  const getAllShotModes = useCallback((): Map<string, GenerationModeNormalized> | null => {
    return cacheRef.current.getProjectWithFallback(projectId, projectModesRef.current);
  }, [projectId]);
  
  const clearCache = useCallback((): void => {
    cacheRef.current.clear();
  }, []);
  
  const deleteProjectCache = useCallback((projectId: string | null): void => {
    if (!projectId) return;
    cacheRef.current.deleteProject(projectId);
  }, []);
  
  // Debug function to log cache state
  const logCacheState = useCallback((): void => {
  }, []);
  
  // Optimistically update a single shot's mode in cache
  const updateShotMode = useCallback((shotId: string | null, mode: GenerationModeNormalized) => {
    if (!projectId || !shotId) return;
    
    // Update in-memory cache immediately
    const currentModes = cacheRef.current.getProject(projectId);
    if (currentModes) {
      currentModes.set(shotId, mode);
      cacheRef.current.setProject(projectId, currentModes);
    }
    
    // CRITICAL: Also update React Query cache so it persists across re-renders
    // The previous code created updatedModes but never saved it!
    queryClient.setQueryData<Map<string, GenerationModeNormalized>>(
      settingsQueryKeys.generationModes(projectId!),
      (oldData) => {
        if (!oldData) return oldData;
        const newData = new Map(oldData);
        newData.set(shotId, mode);
        return newData;
      }
    );
  }, [projectId, queryClient]);
  
  // Invalidate cache when mode changes (for manual refresh if needed)
  const invalidateOnModeChange = useCallback(() => {
    if (projectId) {
      cacheRef.current.deleteProject(projectId);
      refetch();
    }
  }, [projectId, refetch]);

  return {
    getShotGenerationMode,
    getAllShotModes,
    updateShotMode,
    isLoading,
    error,
    refetch,
    clearCache,
    deleteProjectCache,
    invalidateOnModeChange,
    logCacheState
  };
}
