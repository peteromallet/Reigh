// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectSessionCoordinator } from './useProjectSessionCoordinator';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useUserSettings: vi.fn(),
  useProjectSelection: vi.fn(),
  useProjectCRUD: vi.fn(),
  useProjectDefaults: vi.fn(),
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
}));

vi.mock('./UserSettingsContext', () => ({
  useUserSettings: () => mocks.useUserSettings(),
}));

vi.mock('../hooks/projects/useProjectSelection', () => ({
  useProjectSelection: (...args: unknown[]) => mocks.useProjectSelection(...args),
}));

vi.mock('../hooks/projects/useProjectCRUD', () => ({
  useProjectCRUD: (...args: unknown[]) => mocks.useProjectCRUD(...args),
}));

vi.mock('../hooks/projects/useProjectDefaults', () => ({
  useProjectDefaults: (...args: unknown[]) => mocks.useProjectDefaults(...args),
}));

describe('useProjectSessionCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('wires auth, selection, crud, and defaults hooks into one coordinator model', () => {
    const updateUserSettings = vi.fn();
    const selection = {
      selectedProjectId: 'project-1',
      handleProjectsLoaded: vi.fn(),
      handleProjectCreated: vi.fn(),
      handleProjectDeleted: vi.fn(),
      applyCrossDeviceSync: vi.fn(),
    };
    const crud = {
      projects: [{ id: 'project-1' }],
      isLoadingProjects: false,
      fetchProjects: vi.fn(),
    };
    mocks.useAuth.mockReturnValue({ userId: 'user-1' });
    mocks.useUserSettings.mockReturnValue({
      userSettings: { lastOpenedProjectId: 'project-1' },
      isLoadingSettings: false,
      updateUserSettings,
    });
    mocks.useProjectSelection.mockReturnValue(selection);
    mocks.useProjectCRUD.mockReturnValue(crud);

    const { result } = renderHook(() => useProjectSessionCoordinator());

    expect(mocks.useProjectSelection).toHaveBeenCalledWith({
      userId: 'user-1',
      userPreferences: { lastOpenedProjectId: 'project-1' },
      isLoadingPreferences: false,
      updateUserSettings,
    });
    expect(mocks.useProjectCRUD).toHaveBeenCalledWith({
      userId: 'user-1',
      selectedProjectId: 'project-1',
      onProjectsLoaded: selection.handleProjectsLoaded,
      onProjectCreated: selection.handleProjectCreated,
      onProjectDeleted: selection.handleProjectDeleted,
      updateUserSettings,
    });
    expect(mocks.useProjectDefaults).toHaveBeenCalledWith({
      userId: 'user-1',
      selectedProjectId: 'project-1',
      isLoadingProjects: false,
      projects: crud.projects,
      fetchProjects: crud.fetchProjects,
      applyCrossDeviceSync: selection.applyCrossDeviceSync,
    });
    expect(result.current).toEqual({
      userId: 'user-1',
      selection,
      crud,
    });
    expect(mocks.useAuth).toHaveBeenCalledTimes(1);
    expect(mocks.useUserSettings).toHaveBeenCalledTimes(1);
  });

  it('passes null user ids through the coordinator boundary for signed-out state', () => {
    mocks.useAuth.mockReturnValue({ userId: null });
    mocks.useUserSettings.mockReturnValue({
      userSettings: null,
      isLoadingSettings: true,
      updateUserSettings: vi.fn(),
    });
    mocks.useProjectSelection.mockReturnValue({
      selectedProjectId: null,
      handleProjectsLoaded: vi.fn(),
      handleProjectCreated: vi.fn(),
      handleProjectDeleted: vi.fn(),
      applyCrossDeviceSync: vi.fn(),
    });
    mocks.useProjectCRUD.mockReturnValue({
      projects: [],
      isLoadingProjects: true,
      fetchProjects: vi.fn(),
    });

    const { result } = renderHook(() => useProjectSessionCoordinator());

    expect(mocks.useProjectSelection).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, isLoadingPreferences: true }),
    );
    expect(mocks.useProjectCRUD).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, selectedProjectId: null }),
    );
    expect(mocks.useProjectDefaults).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, selectedProjectId: null }),
    );
    expect(result.current.userId).toBeNull();
  });

  it('does not expose the bridge identity to cloud project orchestration in local mode', () => {
    window.history.replaceState({}, '', '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline');
    const selection = {
      selectedProjectId: null,
      handleProjectsLoaded: vi.fn(),
      handleProjectCreated: vi.fn(),
      handleProjectDeleted: vi.fn(),
      applyCrossDeviceSync: vi.fn(),
    };
    const crud = {
      projects: [],
      isLoadingProjects: false,
      fetchProjects: vi.fn(),
    };
    mocks.useAuth.mockReturnValue({ userId: 'astrid-local-user' });
    mocks.useUserSettings.mockReturnValue({
      userSettings: undefined,
      isLoadingSettings: false,
      updateUserSettings: vi.fn(),
    });
    mocks.useProjectSelection.mockReturnValue(selection);
    mocks.useProjectCRUD.mockReturnValue(crud);

    const { result } = renderHook(() => useProjectSessionCoordinator());

    expect(mocks.useProjectSelection).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    expect(mocks.useProjectCRUD).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    expect(mocks.useProjectDefaults).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    expect(result.current.userId).toBeNull();
  });
});
