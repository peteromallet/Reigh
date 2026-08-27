import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/shared/lib/preloading', () => ({
  preloadingService: {
    onProjectChange: vi.fn(),
  },
}));

vi.mock('./useProjectCRUD', () => ({
  determineProjectIdToSelect: vi.fn((projects: { id: string }[], preferred: string | null, lastOpened: string | null) => {
    if (!projects.length) return null;
    const ids = new Set(projects.map((p: { id: string }) => p.id));
    if (preferred && ids.has(preferred)) return preferred;
    if (lastOpened && ids.has(lastOpened)) return lastOpened;
    return projects[0].id;
  }),
}));

import { useProjectSelection } from '../useProjectSelection';

describe('useProjectSelection', () => {
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    localStorageMock = {};

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
      (key: string) => localStorageMock[key] ?? null
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
      (key: string, value: string) => {
        localStorageMock[key] = value;
      }
    );
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(
      (key: string) => {
        delete localStorageMock[key];
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultOptions = {
    userId: 'user-1',
    userPreferences: undefined,
    isLoadingPreferences: true,
    updateUserSettings: vi.fn().mockResolvedValue(undefined),
  };

  it('initializes with null when no localStorage value', () => {
    const { result } = renderHook(() => useProjectSelection(defaultOptions));

    expect(result.current.selectedProjectId).toBeNull();
  });

  it('fast-resumes from localStorage', () => {
    localStorageMock['lastSelectedProjectId'] = 'project-from-storage';

    const { result } = renderHook(() => useProjectSelection(defaultOptions));

    expect(result.current.selectedProjectId).toBe('project-from-storage');
  });

  it('uses localProject URL authority without reading stale localStorage', () => {
    localStorageMock['lastSelectedProjectId'] = 'stale-cloud-project';
    const getItem = vi.mocked(Storage.prototype.getItem);
    window.history.replaceState({}, '', '/tools/travel-between-images?localProject=desert-plant-growth');

    const { result } = renderHook(() => useProjectSelection(defaultOptions));

    expect(result.current.selectedProjectId).toBe('desert-plant-growth');
    expect(getItem).not.toHaveBeenCalledWith('lastSelectedProjectId');
    expect(defaultOptions.updateUserSettings).not.toHaveBeenCalled();
  });

  it('updates selection and fallback when local URL navigation changes project', () => {
    window.history.replaceState({}, '', '/tools/travel-between-images?localProject=first-project');
    const { result, rerender } = renderHook(() => useProjectSelection(defaultOptions));
    expect(result.current.selectedProjectId).toBe('first-project');

    window.history.replaceState({}, '', '/tools/travel-between-images?localProject=second-project');
    rerender();

    expect(result.current.selectedProjectId).toBe('second-project');
  });

  it('clears a cloud selection when the authenticated user becomes local-mode/null without persisting', () => {
    localStorageMock['lastSelectedProjectId'] = 'cloud-project';
    const updateUserSettings = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useProjectSelection({
        ...defaultOptions,
        userId,
        updateUserSettings,
      }),
      { initialProps: { userId: 'user-1' } },
    );

    expect(result.current.selectedProjectId).toBe('cloud-project');

    act(() => {
      rerender({ userId: null });
    });

    expect(result.current.selectedProjectId).toBeNull();
    expect(localStorageMock['lastSelectedProjectId']).toBeUndefined();
    expect(updateUserSettings).not.toHaveBeenCalled();
  });

  it('setSelectedProjectId updates state and localStorage', () => {
    const updateUserSettings = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProjectSelection({ ...defaultOptions, updateUserSettings })
    );

    act(() => {
      result.current.setSelectedProjectId('new-project');
    });

    expect(result.current.selectedProjectId).toBe('new-project');
    expect(localStorageMock['lastSelectedProjectId']).toBe('new-project');
    expect(updateUserSettings).toHaveBeenCalledWith('user', {
      lastOpenedProjectId: 'new-project',
    });
  });

  it('setSelectedProjectId with null clears localStorage', () => {
    localStorageMock['lastSelectedProjectId'] = 'old-project';
    const updateUserSettings = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProjectSelection({ ...defaultOptions, updateUserSettings })
    );

    act(() => {
      result.current.setSelectedProjectId(null);
    });

    expect(result.current.selectedProjectId).toBeNull();
    expect(localStorageMock['lastSelectedProjectId']).toBeUndefined();
  });

  it('handleProjectCreated sets the new project', () => {
    const updateUserSettings = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProjectSelection({ ...defaultOptions, updateUserSettings })
    );

    act(() => {
      result.current.handleProjectCreated({ id: 'new-proj', name: 'New', user_id: 'u1' });
    });

    expect(result.current.selectedProjectId).toBe('new-proj');
  });

  it('handleProjectDeleted selects next available project', () => {
    const updateUserSettings = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProjectSelection({ ...defaultOptions, updateUserSettings })
    );

    act(() => {
      result.current.handleProjectDeleted([
        { id: 'remaining-proj', name: 'Remaining', user_id: 'u1' },
      ]);
    });

    expect(result.current.selectedProjectId).toBe('remaining-proj');
    expect(localStorageMock['lastSelectedProjectId']).toBe('remaining-proj');
  });

  it('handleProjectDeleted clears selection when no projects remain', () => {
    const updateUserSettings = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProjectSelection({ ...defaultOptions, updateUserSettings })
    );

    act(() => {
      result.current.handleProjectDeleted([]);
    });

    expect(result.current.selectedProjectId).toBeNull();
  });
});
