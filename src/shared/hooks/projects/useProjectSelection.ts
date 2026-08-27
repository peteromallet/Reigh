import { useState, useEffect, useRef, useCallback } from 'react';
import { Project } from '@/types/project';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { preloadingService } from '@/shared/lib/preloading';
import { UserPreferences } from '@/shared/settings/userPreferences';
import { determineProjectIdToSelect } from './useProjectCRUD';
import { setProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { getLocalProjectSlug, hasLocalModeUrlParams } from '@/shared/dev/devSession';

interface UseProjectSelectionOptions {
  userId: string | null;
  userPreferences: UserPreferences | undefined;
  isLoadingPreferences: boolean;
  updateUserSettings: (scope: 'user', patch: Partial<UserPreferences>) => Promise<void>;
}

/**
 * Manages which project is selected, including:
 * - Fast resume from localStorage
 * - Cross-device sync from server preferences
 * - Persistence to both localStorage and server
 */
export function useProjectSelection({
  userId,
  userPreferences,
  isLoadingPreferences,
  updateUserSettings,
}: UseProjectSelectionOptions) {
  const localProjectSlug = getLocalProjectSlug(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  const isLocalMode = hasLocalModeUrlParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  // CROSS-DEVICE SYNC: Track if we had a localStorage value at startup
  const hadLocalStorageValueRef = useRef<boolean>(false);
  const hasAppliedServerPreferencesRef = useRef<boolean>(false);
  const previousUserIdRef = useRef(userId);

  // FAST RESUME: Try to restore selectedProjectId from localStorage immediately.
  // Only for a real user: with no session (dev local-mode editor), restoring a
  // stale project id would re-enable the project-scoped Supabase queries
  // (shots, generations) against a backend local mode must never touch.
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(() => {
    if (localProjectSlug) {
      hadLocalStorageValueRef.current = false;
      return localProjectSlug;
    }
    if (!userId || isLocalMode) {
      hadLocalStorageValueRef.current = false;
      return null;
    }
    try {
      const stored = localStorage.getItem('lastSelectedProjectId');
      if (stored) {
        hadLocalStorageValueRef.current = true;
        return stored;
      } else {
        hadLocalStorageValueRef.current = false;
      }
    } catch (e) {
      console.error('[ProjectContext:FastResume] localStorage access failed:', e);
      hadLocalStorageValueRef.current = false;
    }
    return null;
  });

  // Keep a ref for synchronous access to latest preferences
  const userPreferencesRef = useRef(userPreferences);
  useEffect(() => {
    userPreferencesRef.current = userPreferences;
  }, [userPreferences]);

  // Keep a ref so handleProjectsLoaded reads current selectedProjectId without
  // being listed as a dep (which would rebuild fetchProjects on every selection change)
  const selectedProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
    setProjectSelectionFallbackId(selectedProjectId);
  }, [selectedProjectId]);

  // A localProject URL owns selection for every tool. This also handles
  // client-side navigation between local projects without consulting cloud
  // preferences or stale lastSelectedProjectId storage.
  const previousLocalModeRef = useRef(isLocalMode);
  useEffect(() => {
    if (isLocalMode) {
      previousLocalModeRef.current = true;
      const nextProjectId = localProjectSlug;
      if (selectedProjectIdRef.current !== nextProjectId) {
        selectedProjectIdRef.current = nextProjectId;
        setSelectedProjectIdState(nextProjectId);
      }
      setProjectSelectionFallbackId(nextProjectId);
      return;
    }

    if (previousLocalModeRef.current) {
      previousLocalModeRef.current = false;
      selectedProjectIdRef.current = null;
      setSelectedProjectIdState(null);
      setProjectSelectionFallbackId(null);
    }
  }, [isLocalMode, localProjectSlug]);

  // CROSS-DEVICE SYNC: Reset sync flag when user logs out
  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    previousUserIdRef.current = userId;

    if (previousUserId && !userId && !isLocalMode) {
      // Auth/local-mode transitions must not retain a cloud project identity:
      // otherwise project-scoped Supabase queries can briefly outlive the
      // session. Clear local resume state without writing a logout preference.
      hadLocalStorageValueRef.current = false;
      hasAppliedServerPreferencesRef.current = false;
      setSelectedProjectIdState(null);
      try {
        localStorage.removeItem('lastSelectedProjectId');
      } catch (e) {
        normalizeAndPresentError(e, { context: 'ProjectContext.logout', showToast: false });
      }
      preloadingService.onProjectChange(null);
    }
  }, [isLocalMode, userId]);

  // CROSS-DEVICE SYNC: When preferences load on a new device (no localStorage),
  // update the selected project to match the server's lastOpenedProjectId
  const applyCrossDeviceSync = useCallback((projects: Project[]) => {
    if (hadLocalStorageValueRef.current) return;
    if (hasAppliedServerPreferencesRef.current) return;
    if (isLoadingPreferences || !userPreferences) return;
    if (!projects.length) return;

    const serverLastOpenedId = userPreferences.lastOpenedProjectId;

    if (serverLastOpenedId && serverLastOpenedId !== selectedProjectId) {
      const projectExists = projects.some(p => p.id === serverLastOpenedId);
      if (projectExists) {
        setSelectedProjectIdState(serverLastOpenedId);
        try {
          localStorage.setItem('lastSelectedProjectId', serverLastOpenedId);
        } catch (e) {
          normalizeAndPresentError(e, { context: 'ProjectContext.crossDeviceSync', showToast: false });
        }
      }
    }

    hasAppliedServerPreferencesRef.current = true;
  }, [isLoadingPreferences, userPreferences, selectedProjectId]);

  const handleSetSelectedProjectId = useCallback((projectId: string | null) => {
    preloadingService.onProjectChange(projectId);

    setSelectedProjectIdState(projectId);

    // Local project identity is URL-owned and must never be persisted as a
    // cloud resume preference.
    if (isLocalMode) {
      setProjectSelectionFallbackId(projectId);
      return;
    }

    if (projectId) {
      try {
        localStorage.setItem('lastSelectedProjectId', projectId);
      } catch (e) {
        normalizeAndPresentError(e, { context: 'ProjectContext.fastResume', showToast: false });
      }
      updateUserSettings('user', { lastOpenedProjectId: projectId });
    } else {
      try {
        localStorage.removeItem('lastSelectedProjectId');
      } catch (e) {
        normalizeAndPresentError(e, { context: 'ProjectContext.fastResume', showToast: false });
      }
      updateUserSettings('user', { lastOpenedProjectId: undefined });
    }
  }, [isLocalMode, updateUserSettings]);

  /** Called when projects are loaded — decides which project to select. */
  const handleProjectsLoaded = useCallback((projects: Project[], isNewDefault: boolean) => {
    if (isNewDefault) {
      // Brand new default project: select it directly
      handleSetSelectedProjectId(projects[0].id);
    } else {
      const lastOpenedProjectId = userPreferencesRef.current?.lastOpenedProjectId;
      const current = selectedProjectIdRef.current;
      const projectIdToSelect = determineProjectIdToSelect(projects, current, lastOpenedProjectId);

      if (projectIdToSelect !== current) {
        handleSetSelectedProjectId(projectIdToSelect);
      }
    }
  }, [handleSetSelectedProjectId]);

  /** Called after a new project is created. */
  const handleProjectCreated = useCallback((project: Project) => {
    handleSetSelectedProjectId(project.id);
  }, [handleSetSelectedProjectId]);

  /** Called after a project is deleted — selects the next project. */
  const handleProjectDeleted = useCallback((remainingProjects: Project[]) => {
    const nextProjectId = determineProjectIdToSelect(remainingProjects, null, null);
    setSelectedProjectIdState(nextProjectId);

    // Also update localStorage for fast resume (avoid stale deleted ID on refresh)
    try {
      if (nextProjectId) {
        localStorage.setItem('lastSelectedProjectId', nextProjectId);
      } else {
        localStorage.removeItem('lastSelectedProjectId');
      }
    } catch { /* localStorage unavailable */ }

    if (nextProjectId) {
      updateUserSettings('user', { lastOpenedProjectId: nextProjectId });
    } else {
      updateUserSettings('user', { lastOpenedProjectId: undefined });
    }
  }, [updateUserSettings]);

  return {
    selectedProjectId,
    setSelectedProjectId: handleSetSelectedProjectId,
    applyCrossDeviceSync,
    handleProjectsLoaded,
    handleProjectCreated,
    handleProjectDeleted,
    userPreferencesRef,
  };
}
