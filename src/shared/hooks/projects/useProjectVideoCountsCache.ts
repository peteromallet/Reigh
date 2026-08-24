import React, { useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability';
import { useSmartPollingConfig } from '@/shared/hooks/useSmartPolling';
import { projectStatsQueryKeys } from '@/shared/lib/queryKeys/projectStats';
import { ProjectScopedCache } from '@/shared/lib/cache/ProjectScopedCache';

/** Counts stored per shot */
interface ShotCounts {
  videoCount: number;
  finalVideoCount: number;
  hasStructureVideo: boolean;
}

// Global cache instance that persists across component remounts
const globalProjectVideoCountsCache = new ProjectScopedCache<ShotCounts>();

/**
 * Check if a shot's settings contain structure video configuration.
 * Handles both new array format and legacy single-video format.
 */
/**
 * Fetch all shot video counts + structure video presence for a project
 */
async function fetchProjectShotDataFromDB(projectId: string): Promise<Map<string, ShotCounts>> {
  void projectId;
  throw bridgeCapabilityUnavailable(
    'read per-shot video counts',
    'Open the project timeline; shot statistics require the dormant Astrid shots pack.',
  );
}

/**
 * Hook to fetch and cache all shot video counts for a project
 * Provides instant access to any shot's video count within the project
 */
export function useProjectVideoCountsCache(projectId: string | null) {
  const cacheRef = useRef(globalProjectVideoCountsCache);
  const effectiveProjectId = projectId ?? '__no-project__';

  const smartPollingConfig = useSmartPollingConfig(projectStatsQueryKeys.videos(effectiveProjectId));

  const { data: projectCounts, isLoading, error, refetch } = useQuery<Map<string, ShotCounts>>({
    queryKey: projectStatsQueryKeys.videos(effectiveProjectId),
    queryFn: () => fetchProjectShotDataFromDB(projectId!),
    enabled: !!projectId,
    gcTime: 10 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    ...smartPollingConfig,
    refetchIntervalInBackground: true, // Enable background polling
  });

  // PERF: Ref for projectCounts so callbacks always read latest without needing it in deps.
  // Maps break React Query's structural sharing → projectCounts is a new reference on every
  // refetch → callbacks with projectCounts in deps are recreated → break React.memo on children.
  const projectCountsRef = useRef(projectCounts);
  projectCountsRef.current = projectCounts;

  // Ref for refetch: useQuery returns a new refetch reference on every render,
  // so using it in useCallback deps would recreate callbacks every render.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // Update cache when data changes
  React.useEffect(() => {
    if (projectCounts && projectId) {
      cacheRef.current.setProject(projectId, projectCounts);
    }
  }, [projectCounts, projectId]);

  const getShotVideoCount = useCallback((shotId: string | null): number | null => {
    if (!projectId || !shotId) return null;

    // First try cache
    const cachedCounts = cacheRef.current.getItem(projectId, shotId);
    if (cachedCounts !== null) {
      return cachedCounts.videoCount;
    }

    // Then try current query data
    const counts = projectCountsRef.current?.get(shotId);
    return counts !== undefined ? counts.videoCount : null;
  }, [projectId]);

  const getFinalVideoCount = useCallback((shotId: string | null): number | null => {
    if (!projectId || !shotId) return null;

    // First try cache
    const cachedCounts = cacheRef.current.getItem(projectId, shotId);
    if (cachedCounts !== null) {
      return cachedCounts.finalVideoCount;
    }

    // Then try current query data
    const counts = projectCountsRef.current?.get(shotId);
    return counts !== undefined ? counts.finalVideoCount : null;
  }, [projectId]);

  const getHasStructureVideo = useCallback((shotId: string | null): boolean | null => {
    if (!projectId || !shotId) return null;

    // First try cache
    const cachedCounts = cacheRef.current.getItem(projectId, shotId);
    if (cachedCounts !== null) {
      return cachedCounts.hasStructureVideo;
    }

    // Then try current query data
    const counts = projectCountsRef.current?.get(shotId);
    return counts !== undefined ? counts.hasStructureVideo : null;
  }, [projectId]);

  const getAllShotCounts = useCallback((): Map<string, ShotCounts> | null => {
    return cacheRef.current.getProjectWithFallback(projectId, projectCountsRef.current);
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

  // Invalidate cache when certain query keys change (video additions/deletions)
  const invalidateOnVideoChanges = useCallback(() => {
    if (projectId) {
      cacheRef.current.deleteProject(projectId);
      refetchRef.current();
    }
  }, [projectId]);

  return {
    getShotVideoCount,
    getFinalVideoCount,
    getHasStructureVideo,
    getAllShotCounts,
    isLoading,
    error,
    refetch,
    clearCache,
    deleteProjectCache,
    invalidateOnVideoChanges,
    logCacheState
  };
}
