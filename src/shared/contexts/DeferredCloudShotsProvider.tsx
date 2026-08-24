/** Explicitly deferred Supabase-backed relational shot view. */

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useListShots, useProjectImageStats } from '@/shared/hooks/shots';
import { useProjectSelectionContext } from '@/shared/contexts/ProjectContext';
import { ShotsContextProvider, type ShotsContextType } from './ShotsContext.tsx';

export function DeferredCloudShotsProvider({ children }: { children: ReactNode }) {
  const { selectedProjectId } = useProjectSelectionContext();
  const [isProjectTransitioning, setIsProjectTransitioning] = useState(false);
  const prevProjectIdRef = useRef<string | null>(null);
  const { data: shots, isLoading: isShotsLoading, isFetching, error, refetch } = useListShots(
    selectedProjectId,
    { maxImagesPerShot: 0 },
  );
  const { data: projectStats, isLoading: isStatsLoading } = useProjectImageStats(selectedProjectId);

  useEffect(() => {
    if (prevProjectIdRef.current !== null && prevProjectIdRef.current !== selectedProjectId) {
      setIsProjectTransitioning(true);
    }
    prevProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    if (isProjectTransitioning && !isFetching && shots !== undefined) {
      setIsProjectTransitioning(false);
    }
  }, [isFetching, isProjectTransitioning, shots]);

  const value = useMemo<ShotsContextType>(() => ({
    shots: isProjectTransitioning ? undefined : shots,
    isLoading: isShotsLoading || isStatsLoading || isProjectTransitioning,
    error,
    refetchShots: refetch,
    allImagesCount: projectStats?.allCount,
    noShotImagesCount: projectStats?.noShotCount,
  }), [error, isProjectTransitioning, isShotsLoading, isStatsLoading, projectStats, refetch, shots]);

  return <ShotsContextProvider value={value}>{children}</ShotsContextProvider>;
}
