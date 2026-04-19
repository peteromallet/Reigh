import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './routes';

const {
  probeStoredSessionTokenMock,
  normalizeAndPresentErrorMock,
  useAuthMock,
  useProjectSelectionContextMock,
  useToolSettingsMock,
  useTimelinesListMock,
  supabaseDataProviderCtorMock,
  createBrowserMediaPickerMock,
  editorProviderMock,
  timelineEditorShellMock,
} = vi.hoisted(() => ({
  probeStoredSessionTokenMock: vi.fn(),
  normalizeAndPresentErrorMock: vi.fn(),
  useAuthMock: vi.fn(),
  useProjectSelectionContextMock: vi.fn(),
  useToolSettingsMock: vi.fn(),
  useTimelinesListMock: vi.fn(),
  supabaseDataProviderCtorMock: vi.fn(),
  createBrowserMediaPickerMock: vi.fn(),
  editorProviderMock: vi.fn(),
  timelineEditorShellMock: vi.fn(),
}));

vi.mock('@/pages/Home/HomePage', () => ({
  default: () => <div data-testid="home-page" />,
}));
vi.mock('@/pages/ArtPage', () => ({
  default: () => <div data-testid="art-page" />,
}));
vi.mock('@/pages/PaymentSuccessPage', () => ({
  default: () => <div data-testid="payment-success-page" />,
}));
vi.mock('@/pages/PaymentCancelPage', () => ({
  default: () => <div data-testid="payment-cancel-page" />,
}));
vi.mock('@/pages/SharePage', () => ({
  default: () => <div data-testid="share-page" />,
}));
vi.mock('@/tools/image-generation/pages/ImageGenerationToolPage', () => ({
  default: () => <div data-testid="image-generation-page" />,
}));
vi.mock('@/tools/travel-between-images/pages/VideoTravelToolPage', () => ({
  default: () => <div data-testid="video-travel-page" />,
}));
vi.mock('@/tools/character-animate/pages/CharacterAnimatePage', () => ({
  default: () => <div data-testid="character-animate-page" />,
}));
vi.mock('@/tools/join-clips/pages/JoinClipsPage', () => ({
  default: () => <div data-testid="join-clips-page" />,
}));
vi.mock('@/tools/edit-video/pages/EditVideoPage', () => ({
  default: () => <div data-testid="edit-video-page" />,
}));
vi.mock('@/tools/edit-images/pages/EditImagesPage', () => ({
  default: () => <div data-testid="edit-images-page" />,
}));
vi.mock('@/tools/training-data-helper/pages/TrainingDataHelperPage', () => ({
  default: () => <div data-testid="training-data-helper-page" />,
}));
vi.mock('@/pages/Blog/BlogListPage', () => ({
  default: () => <div data-testid="blog-list-page" />,
}));
vi.mock('@/pages/Blog/BlogPostPage', () => ({
  default: () => <div data-testid="blog-post-page" />,
}));
vi.mock('@/pages/NotFoundPage', () => ({
  default: () => <div data-testid="not-found-page" />,
}));
vi.mock('@/pages/ShotsPage', () => ({
  default: () => <div data-testid="shots-page" />,
}));
vi.mock('@/app/Layout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    Layout: () => <Outlet />,
  };
});
vi.mock('./DefaultToolRedirect', () => ({
  DefaultToolRedirect: () => <div data-testid="default-tool-redirect" />,
}));
vi.mock('@/shared/components/ReighLoading', () => ({
  ReighLoading: () => <div data-testid="reigh-loading" />,
}));
vi.mock('@/shared/components/ToolErrorBoundary', () => ({
  ToolErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/shared/lib/supabaseSession', () => ({
  probeStoredSessionToken: probeStoredSessionTokenMock,
}));
vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: normalizeAndPresentErrorMock,
}));
vi.mock('@/shared/contexts/AuthContext', () => ({
  useAuth: (...args: unknown[]) => useAuthMock(...args),
}));
vi.mock('@/shared/contexts/ProjectContext', () => ({
  useProjectSelectionContext: (...args: unknown[]) => useProjectSelectionContextMock(...args),
}));
vi.mock('@/shared/hooks/settings/useToolSettings', () => ({
  useToolSettings: (...args: unknown[]) => useToolSettingsMock(...args),
}));
vi.mock('@/tools/video-editor-host/hooks/useTimelinesList', () => ({
  useTimelinesList: (...args: unknown[]) => useTimelinesListMock(...args),
}));
vi.mock('@/tools/video-editor-host/data/SupabaseDataProvider', () => ({
  SupabaseDataProvider: class MockSupabaseDataProvider {
    constructor(args: unknown) {
      supabaseDataProviderCtorMock(args);
    }
  },
}));
vi.mock('@tbd/editor', () => ({
  createBrowserMediaPicker: () => {
    createBrowserMediaPickerMock();
    return { open: vi.fn() };
  },
  EditorProvider: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    timelineId: string;
    hostContext: { userId: string; brand: { appName: string } };
  }) => {
    editorProviderMock(props);
    return <div data-testid="editor-provider">{children}</div>;
  },
  TimelineEditorShell: (props: { timelineId?: string }) => {
    timelineEditorShellMock(props);
    return <div data-testid="timeline-editor-shell">mounted</div>;
  },
}));

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('AppRoutes', () => {
  beforeEach(() => {
    probeStoredSessionTokenMock.mockReset();
    probeStoredSessionTokenMock.mockReturnValue({ ok: true, value: null });
    normalizeAndPresentErrorMock.mockReset();
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({ userId: null });
    useProjectSelectionContextMock.mockReset();
    useProjectSelectionContextMock.mockReturnValue({ selectedProjectId: null });
    useToolSettingsMock.mockReset();
    useToolSettingsMock.mockReturnValue({ settings: null, update: vi.fn().mockResolvedValue(undefined) });
    useTimelinesListMock.mockReset();
    useTimelinesListMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: [],
      createTimeline: { isPending: false, mutateAsync: vi.fn() },
      renameTimeline: { mutateAsync: vi.fn() },
      deleteTimeline: { mutateAsync: vi.fn() },
    });
    supabaseDataProviderCtorMock.mockReset();
    createBrowserMediaPickerMock.mockReset();
    editorProviderMock.mockReset();
    timelineEditorShellMock.mockReset();
  });

  it('renders the /home route inside MemoryRouter', async () => {
    renderRoute('/home');

    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
  });

  it('redirects / to /tools when a stored session exists', async () => {
    probeStoredSessionTokenMock.mockReturnValue({ ok: true, value: { access_token: 'token' } });

    renderRoute('/');

    expect(await screen.findByTestId('default-tool-redirect')).toBeInTheDocument();
  });

  it('mounts the video editor route through the real host page once auth, project, provider, and timeline prerequisites are satisfied', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({ userId: 'user-1' });
    useProjectSelectionContextMock.mockReturnValue({ selectedProjectId: 'project-1' });
    useToolSettingsMock.mockReturnValue({
      settings: { lastTimelineId: 'timeline-1' },
      update,
    });
    useTimelinesListMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: [{ id: 'timeline-1', name: 'Main timeline' }],
      createTimeline: { isPending: false, mutateAsync: vi.fn() },
      renameTimeline: { mutateAsync: vi.fn() },
      deleteTimeline: { mutateAsync: vi.fn() },
    });

    renderRoute('/tools/video-editor?timeline=timeline-1');

    expect(await screen.findByTestId('editor-provider')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-editor-shell')).toHaveTextContent('mounted');
    expect(supabaseDataProviderCtorMock).toHaveBeenCalledWith({ projectId: 'project-1', userId: 'user-1' });
    expect(createBrowserMediaPickerMock).toHaveBeenCalledTimes(1);
    expect(editorProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      timelineId: 'timeline-1',
      hostContext: expect.objectContaining({
        userId: 'user-1',
        brand: { appName: 'Main timeline' },
      }),
      ports: expect.objectContaining({
        dataProvider: expect.anything(),
      }),
    }));
    expect(timelineEditorShellMock).toHaveBeenCalledWith({});
  });

  it('auto-creates a timeline and mounts the host shell when the editor route has no selected timeline yet', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    let timelinesData: Array<{ id: string; name: string; updated_at: string }> = [];
    const createTimeline = vi.fn().mockImplementation(async () => {
      timelinesData = [{ id: 'timeline-created', name: 'Main timeline', updated_at: '2026-04-19T00:00:00.000Z' }];
      return { id: 'timeline-created' };
    });
    useAuthMock.mockReturnValue({ userId: 'user-1' });
    useProjectSelectionContextMock.mockReturnValue({ selectedProjectId: 'project-1' });
    useToolSettingsMock.mockReturnValue({
      settings: null,
      update,
    });
    useTimelinesListMock.mockImplementation(() => ({
      isLoading: false,
      error: null,
      data: timelinesData,
      createTimeline: { isPending: false, mutateAsync: createTimeline },
      renameTimeline: { mutateAsync: vi.fn() },
      deleteTimeline: { mutateAsync: vi.fn() },
    }));

    renderRoute('/tools/video-editor');

    expect(await screen.findByTestId('editor-provider')).toBeInTheDocument();
    expect(createTimeline).toHaveBeenCalledWith('Main timeline');
    expect(update).toHaveBeenCalledWith('project', { lastTimelineId: 'timeline-created' });
    expect(editorProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      timelineId: 'timeline-created',
      hostContext: expect.objectContaining({
        userId: 'user-1',
        brand: { appName: 'Main timeline' },
      }),
    }));
  });

  it('renders public routes outside the layout tree', async () => {
    renderRoute('/payments/success');

    expect(screen.getByTestId('payment-success-page')).toBeInTheDocument();
  });

  it('renders the catch-all route for unknown paths', async () => {
    renderRoute('/does-not-exist');

    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
  });
});
