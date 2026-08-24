import { useAuth } from './AuthContext';
import { useUserSettings } from './UserSettingsContext';
import { useProjectSelection } from '@/shared/hooks/projects/useProjectSelection';
import { useProjectCRUD } from '@/shared/hooks/projects/useProjectCRUD';
import { useProjectDefaults } from '@/shared/hooks/projects/useProjectDefaults';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';

export function useProjectSessionCoordinator() {
  const { userId } = useAuth();
  const isLocalMode = hasLocalModeUrlParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  // The bridge identity is useful to the editor itself, but it must not be
  // presented as an app/cloud user to the legacy project session coordinator.
  // Doing so would run project discovery and user-record setup on a local URL.
  const sessionUserId = isLocalMode ? null : (userId ?? null);
  const {
    userSettings: userPreferences,
    isLoadingSettings: isLoadingPreferences,
    updateUserSettings,
  } = useUserSettings();

  const selection = useProjectSelection({
    userId: sessionUserId,
    userPreferences,
    isLoadingPreferences,
    updateUserSettings,
  });

  const crud = useProjectCRUD({
    userId: sessionUserId,
    selectedProjectId: selection.selectedProjectId,
    onProjectsLoaded: selection.handleProjectsLoaded,
    onProjectCreated: selection.handleProjectCreated,
    onProjectDeleted: selection.handleProjectDeleted,
    updateUserSettings,
  });

  useProjectDefaults({
    userId: sessionUserId,
    selectedProjectId: selection.selectedProjectId,
    isLoadingProjects: crud.isLoadingProjects,
    projects: crud.projects,
    fetchProjects: crud.fetchProjects,
    applyCrossDeviceSync: selection.applyCrossDeviceSync,
  });

  return {
    userId: sessionUserId,
    selection,
    crud,
  };
}
