// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHomeNavigation } from '@/shared/hooks/useHomeNavigation';

const navigate = vi.fn();
let currentLocation: { pathname: string; search: string; hash: string } = {
  pathname: '/tools/video-editor',
  search: '?localProject=demo&localTimeline=abc',
  hash: '',
};

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => currentLocation,
}));

vi.mock('@/shared/contexts/ProjectContext', () => ({
  useProjectSelectionContext: () => ({ selectedProjectId: null }),
}));

vi.mock('@/shared/state/panesStore', () => ({
  usePanesStore: () => vi.fn(),
}));

vi.mock('@/shared/hooks/useUserUIState', () => ({
  useUserUIState: vi.fn((key: string) => (
    key === 'generationMethods'
      ? { value: { onComputer: true, inCloud: true }, isLoading: false }
      : { value: { toolId: 'travel-between-images' }, isLoading: false }
  )),
}));

vi.mock('@/shared/hooks/settings/useToolSettings', () => ({
  useToolSettings: () => ({ settings: {} }),
}));

describe('useHomeNavigation', () => {
  beforeEach(() => {
    navigate.mockClear();
    currentLocation = {
      pathname: '/tools/video-editor',
      search: '?localProject=demo&localTimeline=abc',
      hash: '',
    };
  });

  it('returns to the local timeline picker from the local-mode editor', () => {
    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.navigateHome();
    });

    // Backend-free dev editor: Back stays on the editor route with the
    // project kept and the timeline dropped, instead of navigating to a
    // session-dependent app page that renders blank without a session.
    expect(navigate).toHaveBeenCalledWith('/tools/video-editor?localProject=demo&localTimeline=');
  });

  it('keeps local mode when only a project is set', () => {
    currentLocation = { pathname: '/tools/video-editor', search: '?localProject=demo', hash: '' };
    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.navigateHome();
    });

    expect(navigate).toHaveBeenCalledWith('/tools/video-editor?localProject=demo');
  });

  it('stays on the local route when only localTimeline is set', () => {
    currentLocation = { pathname: '/tools/video-editor', search: '?localTimeline=abc', hash: '' };
    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.navigateHome();
    });

    expect(navigate).toHaveBeenCalledWith('/tools/video-editor?localTimeline=');
  });

  it('navigates to the home tool path outside local mode', () => {
    currentLocation = { pathname: '/tools/video-editor', search: '?timeline=app-timeline', hash: '' };
    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.navigateHome();
    });

    expect(navigate).toHaveBeenCalledWith('/tools/travel-between-images');
  });
});
