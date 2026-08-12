// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

const state = {
  isVideoEditorShellActive: false,
  isLocalModeSession: false,
  isAuthenticated: false,
  isLoading: false,
};

vi.mock('@/app/hooks/useVideoEditorRouteState', () => ({
  useVideoEditorRouteState: () => ({
    isEditorRoute: false,
    timelineId: null,
    isVideoEditorShellActive: state.isVideoEditorShellActive,
    isLocalModeSession: state.isLocalModeSession,
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
    useLocation: () => ({ pathname: '/tools/travel-between-images', search: '', hash: '' }),
  };
});

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/tools/travel-between-images']}>
      <Layout />
    </MemoryRouter>,
  );
}

describe('Layout chrome in local mode', () => {
  beforeEach(() => {
    state.isVideoEditorShellActive = false;
    state.isLocalModeSession = false;
    state.isAuthenticated = false;
    state.isLoading = false;
  });

  it('renders the full app chrome in DEV local mode without a session', () => {
    state.isLocalModeSession = true;

    renderLayout();

    // The auth gate is exempted and the panes are unsuppressed: the user gets
    // the same sidebar/buttons as app mode.
    expect(screen.getByTestId('tools-pane')).toBeInTheDocument();
    expect(screen.getByTestId('editor-pane')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-pane')).toBeInTheDocument();
    expect(screen.getByTestId('generations-pane')).toBeInTheDocument();
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
  });

  it('renders the app chrome in app mode when authenticated', () => {
    state.isAuthenticated = true;

    renderLayout();

    expect(screen.getByTestId('tools-pane')).toBeInTheDocument();
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
  });

  it('redirects to /home without a session and without local params', () => {
    renderLayout();

    // The auth gate returns <Navigate to="/home">: none of the chrome renders.
    expect(screen.queryByTestId('tools-pane')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editor-pane')).not.toBeInTheDocument();
    expect(screen.queryByTestId('main-content')).not.toBeInTheDocument();
  });
});
