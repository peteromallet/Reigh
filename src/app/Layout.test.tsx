// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

const state = {
  isVideoEditorShellActive: false,
  isAuthenticated: false,
  isLoading: false,
};
let locationSearch = '';
let locationPathname = '/tools/travel-between-images';

vi.mock('@/app/hooks/useVideoEditorRouteState', () => ({
  isVideoEditorRoute: (pathname: string) => pathname === '/tools/video-editor' || pathname.startsWith('/tools/video-editor/'),
  useVideoEditorRouteState: () => ({
    isEditorRoute: false,
    timelineId: null,
    isVideoEditorShellActive: state.isVideoEditorShellActive,
  }),
}));

vi.mock('@/shared/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: state.isAuthenticated, isLoading: state.isLoading }),
}));

vi.mock('@/shared/state/panesStore', () => ({
  usePanesStore: (selector: (s: unknown) => unknown) => selector({
    isTasksPaneLocked: false,
    tasksPaneWidth: 320,
    isShotsPaneLocked: false,
    shotsPaneWidth: 280,
    isGenerationsPaneLocked: false,
    generationsPaneHeight: 320,
  }),
}));

vi.mock('@/features/editor/components/EditorPaneTab', () => ({
  EditorPane: () => <div data-testid="editor-pane" />,
}));
vi.mock('@/features/tasks/components/TasksPane/TasksPane', () => ({
  TasksPane: () => <div data-testid="tasks-pane" />,
}));
vi.mock('@/shared/components/ToolsPane/ToolsPane', () => ({
  ToolsPane: () => <div data-testid="tools-pane" />,
}));
vi.mock('@/features/gallery/components/GenerationsPane/GenerationsPane', () => ({
  GenerationsPane: () => <div data-testid="generations-pane" />,
}));
vi.mock('@/shared/components/SettingsModal/SettingsModal', () => ({
  SettingsModal: () => <div data-testid="settings-modal" />,
}));
vi.mock('@/shared/components/modals/OnboardingModal', () => ({
  OnboardingModal: () => null,
}));
vi.mock('@/shared/components/ProductTour', () => ({ ProductTour: () => null }));
vi.mock('@/shared/components/ReighLoading', () => ({
  ReighLoading: () => <div data-testid="reigh-loading" />,
}));
vi.mock('@/shared/runtime/ChunkLoadErrorBoundary', () => ({
  ChunkLoadErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/SocialIcons', () => ({
  SocialIcons: () => null,
}));
vi.mock('./components/LayoutMainContent', () => ({
  LayoutMainContent: () => <div data-testid="main-content" />,
}));
vi.mock('./hooks/useSplitViewScroll', () => ({
  useSplitViewScroll: () => ({ splitViewWrapperRef: { current: null } }),
}));
vi.mock('./hooks/useGlobalPaneShortcuts', () => ({
  useGlobalPaneShortcuts: () => undefined,
}));
vi.mock('./hooks/useSettingsModal', () => ({
  useSettingsModal: () => ({
    isSettingsModalOpen: false,
    setIsSettingsModalOpen: vi.fn(),
    settingsInitialTab: undefined,
    settingsCreditsTab: undefined,
    handleOpenSettings: vi.fn(),
  }),
}));
vi.mock('./hooks/useOnboardingFlow', () => ({
  useOnboardingFlow: () => ({ showOnboardingModal: false, handleOnboardingClose: vi.fn() }),
}));
vi.mock('./hooks/useResetCurrentShotOnRouteChange', () => ({
  useResetCurrentShotOnRouteChange: () => undefined,
}));
vi.mock('@/shared/hooks/mobile', () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));
vi.mock('@/shared/lib/typedEvents', () => ({
  dispatchAppEvent: vi.fn(),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useLocation: () => ({ pathname: locationPathname, search: locationSearch, hash: '' }),
  };
});

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/tools/travel-between-images']}>
      <Layout />
    </MemoryRouter>,
  );
}

describe('Layout route access', () => {
  beforeEach(() => {
    state.isVideoEditorShellActive = false;
    state.isAuthenticated = false;
    state.isLoading = false;
    locationSearch = '';
    locationPathname = '/tools/travel-between-images';
  });

  it('renders the full app chrome when the bridge probe resolved a user', () => {
    state.isAuthenticated = true;

    renderLayout();

    // The auth gate passes on the probe alone: all panes unsuppressed.
    expect(screen.getByTestId('tools-pane')).toBeInTheDocument();
    expect(screen.getByTestId('editor-pane')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-pane')).toBeInTheDocument();
    expect(screen.getByTestId('generations-pane')).toBeInTheDocument();
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
  });

  it('renders degraded-but-alive chrome while the probe is pending (no redirect loop)', () => {
    state.isLoading = true;

    renderLayout();

    // Loading state renders the spinner — never a <Navigate> hop.
    expect(screen.getByTestId('reigh-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('tools-pane')).not.toBeInTheDocument();
  });

  it('redirects to /home when the probe failed', () => {
    renderLayout();

    // The auth gate returns <Navigate to="/home">: none of the chrome renders.
    expect(screen.queryByTestId('tools-pane')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editor-pane')).not.toBeInTheDocument();
    expect(screen.queryByTestId('main-content')).not.toBeInTheDocument();
  });

  it('keeps the deterministic localTest editor route sessionless without redirecting to Home', () => {
    locationPathname = '/tools/video-editor';
    locationSearch = '?localProject=demo-project&localTimeline=demo-timeline&localTest=1';

    renderLayout();

    expect(screen.getByTestId('main-content')).toBeInTheDocument();
    expect(screen.getByTestId('tools-pane')).toBeInTheDocument();
  });

  it('does not let localTest bypass auth on another protected route', () => {
    locationSearch = '?localTest=1';

    renderLayout();

    expect(screen.queryByTestId('main-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tools-pane')).not.toBeInTheDocument();
  });

  it('does not let an incomplete local editor URL bypass auth', () => {
    locationPathname = '/tools/video-editor';
    locationSearch = '?localTest=1&localProject=demo-project&localTimeline=';

    renderLayout();

    expect(screen.queryByTestId('main-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tools-pane')).not.toBeInTheDocument();
  });
});
