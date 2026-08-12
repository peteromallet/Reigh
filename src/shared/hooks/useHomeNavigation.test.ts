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

  it('carries the local params onto the home tool path from the local-mode editor', () => {
    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.navigateHome();
    });

    // Same home as app mode, with the local params riding along so the
    // destination renders the full app shell (auth gate exempts on any route).
    expect(navigate).toHaveBeenCalledWith('/tools/travel-between-images?localProject=demo&localTimeline=abc');
  });

  it('copies only the params present in local mode', () => {
    currentLocation = { pathname: '/tools/video-editor', search: '?localProject=demo', hash: '' };
    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.navigateHome();
    });

    expect(navigate).toHaveBeenCalledWith('/tools/travel-between-images?localProject=demo');
  });

  it('keeps bare local params as the mode signal', () => {
    currentLocation = { pathname: '/tools/video-editor', search: '?localTimeline=abc', hash: '' };
    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.navigateHome();
    });

    expect(navigate).toHaveBeenCalledWith('/tools/travel-between-images?localTimeline=abc');
  });

  it('navigates to the home tool path outside local mode', () => {
    currentLocation = { pathname: '/tools/video-editor', search: '?timeline=app-timeline', hash: '' };
    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.navigateHome();
    });

    expect(navigate).toHaveBeenCalledWith('/tools/travel-between-images');
  });

  it('targets the home tool when DEV is off (params ride along but are inert in prod)', () => {
    const originalDev = import.meta.env.DEV;
    (import.meta.env as Record<string, unknown>).DEV = false;
    currentLocation = { pathname: '/tools/video-editor', search: '?localProject=demo&localTimeline=abc', hash: '' };

    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.navigateHome();
    });

    // The mode decision is DEV-gated (route state); the param-copy helper is
    // DEV-agnostic, so the URL still carries the params — inert because Layout
    // will not exempt and the auth gate redirects to /home in production.
    expect(navigate).toHaveBeenCalledWith('/tools/travel-between-images?localProject=demo&localTimeline=abc');

    (import.meta.env as Record<string, unknown>).DEV = originalDev;
  });
});
