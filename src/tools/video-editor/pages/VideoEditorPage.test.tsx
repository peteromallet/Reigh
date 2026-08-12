import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoEditorPage from '@/tools/video-editor/pages/VideoEditorPage.tsx';
import { setDevExtensionEnabled } from '@/tools/video-editor/dev/devExtensionEnablement.ts';

const state = vi.hoisted(() => ({
  auth: { userId: 'user-1' as string | null },
  project: {
    selectedProjectId: 'project-1' as string | null,
    setSelectedProjectId: vi.fn((id: string | null) => {
      state.project.selectedProjectId = id;
    }),
  },
  projectCrud: {
    projects: [{ id: 'project-1', name: 'Project One', user_id: 'user-1' }],
    isLoadingProjects: false,
  },
  settings: {
    settings: { lastTimelineId: 'timeline-1' as string | undefined },
    update: vi.fn(async () => undefined),
  },
  timelines: {
    data: [{ id: 'timeline-1', name: 'Main timeline', updated_at: '2026-06-11T10:00:00Z' }],
    isLoading: false,
    error: null as Error | null,
    createTimeline: {
      isPending: false,
      mutateAsync: vi.fn(async () => ({ id: 'created-timeline' })),
    },
    renameTimeline: {
      mutateAsync: vi.fn(async () => undefined),
    },
    deleteTimeline: {
      mutateAsync: vi.fn(async () => undefined),
    },
  },
  discovery: {
    bridgeHealthy: true,
    bridgeDown: false,
    healthLoading: false,
    projectsLoading: false,
    projectsError: null as Error | null,
    projects: [] as { slug: string; name: string }[],
    timelinesLoading: false,
    timelinesError: null as Error | null,
    timelines: [] as {
      timeline_id: string;
      timeline_ulid?: string;
      slug?: string;
      name: string;
      is_default?: boolean;
    }[],
  },
  providerMounts: 0,
  providerUnmounts: 0,
  saveStatusCallback: null as null | ((status: 'saved' | 'saving' | 'dirty' | 'retrying' | 'error') => void),
  confirm: vi.fn(() => true),
  /** Captured extensions prop from the last VideoEditorProvider render (for smoke tests). */
  lastProviderExtensions: null as readonly any[] | null,
  /** Captured timelineOverlaysEnabled prop from the last VideoEditorProvider render. */
  lastTimelineOverlaysEnabled: null as boolean | null,
  /**
   * Dev-local scratchpad array backing the real `devLocalExtensions` module
   * (which is empty on main). Tests push fixture extensions into it.
   */
  devLocalExtensions: [] as any[],
  /**
   * Simulated runtime lifecycle: the mocked provider records one activation
   * entry per extension id when an id enters the extensions prop and one
   * disposal entry when it leaves — mirroring ExtensionLifecycleHost's
   * synchronize() contract (dispose on removal, activate on re-add).
   */
  extensionActivations: [] as string[],
  extensionDisposals: [] as string[],
  supabaseCtor: vi.fn(function MockSupabaseProvider(this: Record<string, unknown>, options: unknown) {
    this.kind = 'supabase';
    this.options = options;
    this.resolveAssetUrl = vi.fn();
    this.loadTimeline = vi.fn();
    this.saveTimeline = vi.fn();
    this.loadAssetRegistry = vi.fn();
  }),
  bridgeCtor: vi.fn(function MockBridgeProvider(this: Record<string, unknown>, options: unknown) {
    this.kind = 'bridge';
    this.options = options;
    this.persistenceEnabled = true;
    this.resolveAssetUrl = vi.fn();
    this.loadTimeline = vi.fn();
    this.saveTimeline = vi.fn();
    this.loadAssetRegistry = vi.fn();
  }),
}));

vi.mock('@/shared/contexts/AuthContext.tsx', () => ({
  useAuth: () => state.auth,
}));

vi.mock('@/shared/contexts/ProjectContext.tsx', () => ({
  useProjectSelectionContext: () => state.project,
  useProjectCrudContext: () => state.projectCrud,
}));

vi.mock('@/shared/hooks/settings/useToolSettings.ts', () => ({
  useToolSettings: () => state.settings,
}));

vi.mock('@/tools/video-editor/hooks/useTimelinesList.ts', () => ({
  useTimelinesList: () => state.timelines,
}));

// The discovery hook is owned by the page; tests drive its result through the
// mutable `state.discovery` object so bridge-down → online refreshes can be
// simulated without a real bridge.
vi.mock('@/tools/video-editor/hooks/useAstridBridgeDiscovery.ts', () => ({
  useAstridBridgeDiscovery: () => ({
    healthQuery: {
      isLoading: state.discovery.healthLoading,
      isError: state.discovery.bridgeDown,
      error: state.discovery.bridgeDown ? new Error('bridge unreachable') : null,
      data: state.discovery.bridgeHealthy ? true : false,
    },
    projectsQuery: {
      isLoading: state.discovery.projectsLoading,
      isError: state.discovery.projectsError !== null,
      error: state.discovery.projectsError,
      data: state.discovery.projects.length > 0 ? { projects: state.discovery.projects } : undefined,
    },
    timelinesQuery: {
      isLoading: state.discovery.timelinesLoading,
      isError: state.discovery.timelinesError !== null,
      error: state.discovery.timelinesError,
      data: state.discovery.timelines.length > 0 ? { timelines: state.discovery.timelines } : undefined,
    },
    bridgeHealthy: state.discovery.bridgeHealthy,
    bridgeDown: state.discovery.bridgeDown,
    projectsEmpty: state.discovery.projects.length === 0,
  }),
}));

vi.mock('@/tools/video-editor/data/SupabaseDataProvider.ts', () => ({
  SupabaseDataProvider: state.supabaseCtor,
}));

vi.mock('@/tools/video-editor/data/AstridBridgeDataProvider.ts', () => ({
  AstridBridgeDataProvider: state.bridgeCtor,
}));

// The dev-local scratchpad is empty on main; tests push fixtures into the
// shared hoisted array so the page's `devLocalExtensions` filter sees them.
vi.mock('@/tools/video-editor/dev/localExtensions.ts', () => ({
  devLocalExtensions: state.devLocalExtensions,
}));

vi.mock('@/tools/video-editor/components/ReighVideoEditorShell.tsx', () => ({
  ReighVideoEditorShell: ({ timelineId, navigationControls }: { timelineId: string; navigationControls?: React.ReactNode }) => (
    <div data-testid="video-editor-shell">
      {timelineId}
      {navigationControls}
    </div>
  ),
}));

vi.mock('@/tools/video-editor/contexts/VideoEditorProvider.tsx', async () => {
  const ReactModule = await import('react');

  return {
    VideoEditorProvider: ({
      dataProvider,
      timelineId,
      timelineName,
      onSaveStatusChange,
      extensions,
      timelineOverlaysEnabled,
      children,
    }: {
      dataProvider: { kind?: string };
      timelineId: string;
      timelineName?: string | null;
      onSaveStatusChange?: (status: 'saved' | 'saving' | 'dirty' | 'retrying' | 'error') => void;
      extensions?: readonly any[];
      timelineOverlaysEnabled?: boolean;
      children: React.ReactNode;
    }) => {
      const [saveStatus, setSaveStatus] = ReactModule.useState<'saved' | 'saving' | 'dirty' | 'retrying' | 'error'>('saved');
      state.saveStatusCallback = onSaveStatusChange ?? null;
      state.lastProviderExtensions = extensions ?? null;
      state.lastTimelineOverlaysEnabled = timelineOverlaysEnabled ?? false;

      ReactModule.useEffect(() => {
        state.providerMounts += 1;
        return () => {
          state.providerUnmounts += 1;
          if (state.saveStatusCallback === onSaveStatusChange) {
            state.saveStatusCallback = null;
          }
        };
      }, []);

      // Simulate the runtime lifecycle (mirrors ExtensionLifecycleHost's
      // synchronize): an id entering the extensions prop is activated once,
      // an id leaving it is disposed once. The direct-extension fast path
      // delivers a fresh list whenever the page's external-store memo changes.
      const prevExtensionIdsRef = ReactModule.useRef<string[]>([]);
      ReactModule.useEffect(() => {
        const ids = (extensions ?? [])
          .map((ext: { manifest?: { id?: unknown } }) =>
            typeof ext?.manifest?.id === 'string' ? ext.manifest.id : '',
          )
          .filter((id: string) => id.length > 0);
        const prev = prevExtensionIdsRef.current;
        for (const id of ids) {
          if (!prev.includes(id)) state.extensionActivations.push(id);
        }
        for (const id of prev) {
          if (!ids.includes(id)) state.extensionDisposals.push(id);
        }
        prevExtensionIdsRef.current = ids;
      }, [extensions]);

      ReactModule.useEffect(() => {
        onSaveStatusChange?.(saveStatus);
      }, [onSaveStatusChange, saveStatus]);

      return (
        <div
          data-testid="video-editor-provider"
          data-kind={dataProvider.kind ?? 'unknown'}
          data-timeline-id={timelineId}
          data-timeline-name={timelineName ?? ''}
          data-timeline-overlays-enabled={String(timelineOverlaysEnabled ?? false)}
        >
          <button type="button" onClick={() => setSaveStatus('saving')}>
            status-saving
          </button>
          <button type="button" onClick={() => setSaveStatus('dirty')}>
            status-dirty
          </button>
          <button type="button" onClick={() => setSaveStatus('retrying')}>
            status-retrying
          </button>
          <button type="button" onClick={() => setSaveStatus('error')}>
            status-error
          </button>
          <button type="button" onClick={() => setSaveStatus('saved')}>
            status-saved
          </button>
          <span data-testid="mock-save-status">{saveStatus}</span>
          {children}
        </div>
      );
    },
  };
});

function renderPage(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <VideoEditorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VideoEditorPage', () => {
  const originalDEV = import.meta.env.DEV;

  beforeAll(() => {
    // jsdom does not provide scrollIntoView, which cmdk calls internally.
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).DEV = true;
    window.localStorage.clear();
    state.auth.userId = 'user-1';
    state.project.selectedProjectId = 'project-1';
    state.project.setSelectedProjectId.mockClear();
    state.projectCrud.projects = [{ id: 'project-1', name: 'Project One', user_id: 'user-1' }];
    state.projectCrud.isLoadingProjects = false;
    state.settings.settings = { lastTimelineId: 'timeline-1' };
    state.settings.update.mockClear();
    state.timelines.data = [{ id: 'timeline-1', name: 'Main timeline', updated_at: '2026-06-11T10:00:00Z' }];
    state.timelines.isLoading = false;
    state.timelines.error = null;
    state.timelines.createTimeline.isPending = false;
    state.timelines.createTimeline.mutateAsync.mockClear();
    state.timelines.renameTimeline.mutateAsync.mockClear();
    state.timelines.deleteTimeline.mutateAsync.mockClear();
    state.discovery.bridgeHealthy = true;
    state.discovery.bridgeDown = false;
    state.discovery.healthLoading = false;
    state.discovery.projectsLoading = false;
    state.discovery.projectsError = null;
    state.discovery.projects = [{ slug: 'ados-talks', name: 'Ados Talks' }];
    state.discovery.timelinesLoading = false;
    state.discovery.timelinesError = null;
    state.discovery.timelines = [
      {
        timeline_id: '11111111-1111-1111-1111-111111111111',
        timeline_ulid: '01JM4K5N7P0000000000000017',
        slug: 'intro-cut',
        name: 'Intro Cut',
        is_default: true,
      },
      {
        timeline_id: '22222222-2222-2222-2222-222222222222',
        timeline_ulid: '01JM4K5N7P0000000000000018',
        slug: 'alt-cut',
        name: 'Alt Cut',
        is_default: false,
      },
    ];
    state.providerMounts = 0;
    state.providerUnmounts = 0;
    state.saveStatusCallback = null;
    state.lastProviderExtensions = null;
    state.lastTimelineOverlaysEnabled = null;
    state.devLocalExtensions.length = 0;
    state.extensionActivations.length = 0;
    state.extensionDisposals.length = 0;
    state.confirm.mockReset();
    state.confirm.mockReturnValue(true);
    state.supabaseCtor.mockClear();
    state.bridgeCtor.mockClear();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('confirm', state.confirm);
    window.confirm = state.confirm;
  });

  afterEach(() => {
    (import.meta.env as Record<string, unknown>).DEV = originalDEV;
  });

  it('uses SupabaseDataProvider in App mode without bridge requests', async () => {
    renderPage('/tools/video-editor?timeline=timeline-1');

    const provider = await screen.findByTestId('video-editor-provider');

    expect(provider).toHaveAttribute('data-kind', 'supabase');
    expect(state.supabaseCtor).toHaveBeenCalledWith({ projectId: 'project-1', userId: 'user-1' });
    expect(state.bridgeCtor).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('uses AstridBridgeDataProvider in Local mode with bridge persistence enabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')) {
        return new Response(JSON.stringify({
          timeline_id: '11111111-1111-1111-1111-111111111111',
          name: 'Intro Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    const provider = await screen.findByTestId('video-editor-provider');

    expect(provider).toHaveAttribute('data-kind', 'bridge');
    expect(state.bridgeCtor).toHaveBeenCalledWith({
      projectSlug: 'ados-talks',
      timelineRef: '11111111-1111-1111-1111-111111111111',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });
    expect(state.supabaseCtor).not.toHaveBeenCalled();
  });

  it('does not advertise a local render action when the Astrid render bridge is descoped', async () => {
    const fetchCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.includes('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')) {
        return new Response(JSON.stringify({
          timeline_id: '11111111-1111-1111-1111-111111111111',
          name: 'Intro Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    await screen.findByTestId('video-editor-provider');

    expect(screen.queryByRole('button', { name: /render locally/i })).toBeNull();
    expect(fetchCalls.every((url) => !url.includes('/render'))).toBe(true);
  });

  it('remounts the editor when the Local timeline selection changes (explicit URL params)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')) {
        return new Response(JSON.stringify({
          timeline_id: '11111111-1111-1111-1111-111111111111',
          name: 'Intro Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      if (url.includes('/api/astrid/projects/ados-talks/timelines/22222222-2222-2222-2222-222222222222')) {
        return new Response(JSON.stringify({
          timeline_id: '22222222-2222-2222-2222-222222222222',
          name: 'Alt Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    const first = renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-timeline-id', '11111111-1111-1111-1111-111111111111');
    expect(state.providerMounts).toBe(1);

    // A new explicit selection (different URL) mounts a fresh editor.
    first.unmount();
    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=22222222-2222-2222-2222-222222222222');

    await waitFor(() => {
      expect(screen.getByTestId('video-editor-provider')).toHaveAttribute(
        'data-timeline-id',
        '22222222-2222-2222-2222-222222222222',
      );
    });
    expect(state.providerMounts).toBe(2);
  });

  it('renders grouped Reigh and Local projects in the selector dropdown', async () => {
    renderPage('/tools/video-editor?timeline=timeline-1');

    await screen.findByTestId('video-editor-provider');

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));

    expect(await screen.findByText('Reigh projects')).toBeInTheDocument();
    expect(screen.getByText('Local (Astrid)')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /Project One/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ados Talks/ })).toBeInTheDocument();
  });

  it('shows the bridge-down card with the selectors visible when the bridge is down', async () => {
    state.discovery.bridgeDown = true;
    state.discovery.bridgeHealthy = false;
    state.discovery.timelines = [];
    renderPage('/tools/video-editor?localProject=ados-talks');

    await screen.findByText('Unable to reach the local bridge');
    // The selectors stay mounted (and openable) so the launch hint is reachable.
    expect(screen.getByRole('combobox', { name: 'Select project' })).toBeInTheDocument();
  });

  it('shows the projects-root hint when the bridge is reachable but has no projects', async () => {
    state.discovery.projects = [];
    state.discovery.timelines = [];
    renderPage('/tools/video-editor?localProject=ados-talks');

    await screen.findByText('Select a project and timeline');

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));

    expect(await screen.findByText(/Start astrid serve with a projects root/)).toBeInTheDocument();
  });

  it('auto-picks the default timeline when a local project has no timeline param', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url.includes('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')
        || url.includes('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017')
      ) {
        return new Response(JSON.stringify({
          timeline_id: '11111111-1111-1111-1111-111111111111',
          timeline_ulid: '01JM4K5N7P0000000000000017',
          name: 'Intro Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor?localProject=ados-talks');

    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-kind', 'bridge');
    // Auto-pick selects the ULID as the routable ref.
    expect(provider).toHaveAttribute('data-timeline-id', '01JM4K5N7P0000000000000017');
  });

  it('auto-picks the first timeline when no default exists', async () => {
    state.discovery.timelines = [
      {
        timeline_id: '22222222-2222-2222-2222-222222222222',
        timeline_ulid: '01JM4K5N7P0000000000000018',
        slug: 'alt-cut',
        name: 'Alt Cut',
        is_default: false,
      },
    ];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url.includes('/api/astrid/projects/ados-talks/timelines/22222222-2222-2222-2222-222222222222')
        || url.includes('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000018')
      ) {
        return new Response(JSON.stringify({
          timeline_id: '22222222-2222-2222-2222-222222222222',
          timeline_ulid: '01JM4K5N7P0000000000000018',
          name: 'Alt Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor?localProject=ados-talks');

    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-kind', 'bridge');
    // Auto-pick selects the ULID as the routable ref.
    expect(provider).toHaveAttribute('data-timeline-id', '01JM4K5N7P0000000000000018');
  });

  it('renders the selectors with the current local selection while keeping the editor mounted', async () => {
    setupBridgeFetch();

    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    await screen.findByTestId('video-editor-provider');

    expect(screen.getByRole('combobox', { name: 'Select project' })).toHaveTextContent('ados-talks');
    // Timeline label = bridge timeline name once the name GET resolves,
    // falling back to the timeline id while it loads.
    expect(screen.getByRole('combobox', { name: 'Select timeline' })).toHaveTextContent('11111111-1111-1111-1111-111111111111');
  });

  it('opens Local mode straight from the URL params and never writes a storage flag', async () => {
    // The legacy `dev.videoEditor.localMode` flag is retired — the pasted link
    // is the only signal, and it has to be enough (any environment).
    setupBridgeFetch();

    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-kind', 'bridge');
    // ...and no storage flag is written (existing stored values stay inert).
    expect(window.localStorage.getItem('dev.videoEditor.localMode')).toBeNull();
  });

  it('ignores local-mode URL params when DEV is off (production cannot reach the bridge proxy)', async () => {
    (import.meta.env as Record<string, unknown>).DEV = false;

    renderPage('/tools/video-editor?timeline=timeline-1&localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    const provider = await screen.findByTestId('video-editor-provider');
    // `/api/astrid` is a development proxy: production must never enter local
    // mode from a URL, or users would be stranded on a dead bridge.
    expect(provider).toHaveAttribute('data-kind', 'supabase');
    expect(state.bridgeCtor).not.toHaveBeenCalled();
  });

  it('switches Local→App via the selectors, preserving the app timeline', async () => {
    setupBridgeFetch();

    renderPage('/tools/video-editor?timeline=timeline-1&localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    const provider = await screen.findByTestId('video-editor-provider');
    await waitFor(() => {
      expect(provider).toHaveAttribute('data-kind', 'bridge');
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(await screen.findByText('Project One'));

    await waitFor(() => {
      expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'supabase');
    });
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-timeline-id', 'timeline-1');
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it('switches App→Local via the selectors, auto-picking a timeline', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url.includes('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')
        || url.includes('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017')
      ) {
        return new Response(JSON.stringify({
          timeline_id: '11111111-1111-1111-1111-111111111111',
          timeline_ulid: '01JM4K5N7P0000000000000017',
          name: 'Intro Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor?timeline=timeline-1');

    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-kind', 'supabase');

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(await screen.findByText('Ados Talks'));

    await waitFor(() => {
      expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'bridge');
    });
    // Auto-pick selects the ULID as the routable ref.
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute(
      'data-timeline-id',
      '01JM4K5N7P0000000000000017',
    );
  });

  it('bridge-down → online: the selectors refresh and the editor mounts', async () => {
    state.discovery.bridgeDown = true;
    state.discovery.bridgeHealthy = false;
    state.discovery.projects = [];
    state.discovery.timelines = [];

    renderPage('/tools/video-editor?localProject=ados-talks');

    await screen.findByText('Unable to reach the local bridge');

    const user = userEvent.setup();
    const projectTrigger = screen.getByRole('combobox', { name: 'Select project' });
    await user.click(projectTrigger);
    expect(await screen.findByText('No local Astrid projects found')).toBeInTheDocument();
    await user.click(projectTrigger);

    // The bridge comes up with a projects root (but no timelines yet): the
    // reopened dropdown must now show the discovered project.
    state.discovery.bridgeDown = false;
    state.discovery.bridgeHealthy = true;
    state.discovery.projects = [{ slug: 'ados-talks', name: 'Ados Talks' }];
    state.discovery.timelines = [];

    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    expect(await screen.findByRole('option', { name: /Ados Talks/ })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));

    // Timelines appear → the auto-pick effect mounts the bridge editor.
    state.discovery.timelines = [
      {
        timeline_id: '11111111-1111-1111-1111-111111111111',
        timeline_ulid: '01JM4K5N7P0000000000000017',
        slug: 'intro-cut',
        name: 'Intro Cut',
        is_default: true,
      },
    ];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url.includes('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')
        || url.includes('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017')
      ) {
        return new Response(JSON.stringify({
          timeline_id: '11111111-1111-1111-1111-111111111111',
          timeline_ulid: '01JM4K5N7P0000000000000017',
          name: 'Intro Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    // Reopening the dropdown re-renders the page, which re-reads the mocked
    // discovery state and lets the auto-pick effect run.
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));

    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-kind', 'bridge');
  });

  it('passes a save-status callback into the mounted provider', async () => {
    renderPage('/tools/video-editor?timeline=timeline-1');

    await screen.findByTestId('video-editor-provider');
    expect(state.saveStatusCallback).toBeTypeOf('function');
  });

  it('switching local projects with a clean editor auto-picks a timeline and remounts', async () => {
    state.discovery.projects = [
      { slug: 'ados-talks', name: 'Ados Talks' },
      { slug: 'other-project', name: 'Other Project' },
    ];
    setupBridgeFetch();

    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    const provider = await screen.findByTestId('video-editor-provider');
    await waitFor(() => {
      expect(screen.getByTestId('mock-save-status')).toHaveTextContent('saved');
    });
    expect(state.providerMounts).toBe(1);

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(await screen.findByText('Other Project'));

    await waitFor(() => {
      expect(state.providerMounts).toBe(2);
    });
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'bridge');
    // Auto-pick selects the ULID as the routable ref.
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute(
      'data-timeline-id',
      '01JM4K5N7P0000000000000017',
    );
  });

  it('blocks switching while the editor is saving', async () => {
    await mountLocalEditor();

    act(() => {
      state.saveStatusCallback?.('saving');
    });

    expect(screen.getByRole('combobox', { name: 'Select project' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Select timeline' })).toBeDisabled();

    // Still on the same timeline — switch blocked without confirm
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute(
      'data-timeline-id',
      '11111111-1111-1111-1111-111111111111',
    );
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it('blocks switching while the editor is retrying a transport failure', async () => {
    await mountLocalEditor();

    act(() => {
      state.saveStatusCallback?.('retrying');
    });

    // A retry is scheduled (a save WILL happen) — switching would abandon it,
    // so both selectors are disabled and no confirm dialog is offered.
    expect(screen.getByRole('combobox', { name: 'Select project' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Select timeline' })).toBeDisabled();
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute(
      'data-timeline-id',
      '11111111-1111-1111-1111-111111111111',
    );
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it('confirms dirty-state switches when accepted and blocks when declined', async () => {
    await mountLocalEditor();

    // Dirty + denied → switch must be blocked, provider unchanged
    state.confirm.mockReturnValue(false);
    fireEvent.click(screen.getByText('status-dirty'));
    await waitFor(() => {
      expect(screen.getByTestId('mock-save-status')).toHaveTextContent('dirty');
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(await screen.findByText('Project One'));

    expect(state.confirm).toHaveBeenCalledWith(
      'You have unsaved timeline changes. Switch editors and discard them?',
    );
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'bridge');

    // Reset to saved, then dirty + confirmed → confirm is called
    state.confirm.mockReset();
    state.confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText('status-saved'));
    await waitFor(() => {
      expect(screen.getByTestId('mock-save-status')).toHaveTextContent('saved');
    });
    fireEvent.click(screen.getByText('status-dirty'));
    await waitFor(() => {
      expect(screen.getByTestId('mock-save-status')).toHaveTextContent('dirty');
    });

    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(await screen.findByText('Project One'));

    expect(state.confirm).toHaveBeenCalledWith(
      'You have unsaved timeline changes. Switch editors and discard them?',
    );
    await waitFor(() => {
      expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'supabase');
    });
  });

  it('confirms error-state switches and blocks when declined', async () => {
    await mountLocalEditor();

    // Error + denied → switch blocked
    state.confirm.mockReturnValue(false);
    act(() => {
      state.saveStatusCallback?.('error');
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(await screen.findByText('Project One'));

    expect(state.confirm).toHaveBeenCalledWith(
      'The last timeline save failed. Switch editors anyway?',
    );
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'bridge');

    // Error + confirmed → confirm was honored
    state.confirm.mockReset();
    state.confirm.mockReturnValue(true);
    act(() => {
      state.saveStatusCallback?.('saved');
      state.saveStatusCallback?.('error');
    });

    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(await screen.findByText('Project One'));

    expect(state.confirm).toHaveBeenCalledWith(
      'The last timeline save failed. Switch editors anyway?',
    );
    await waitFor(() => {
      expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'supabase');
    });
  });

  it('confirms error-state local timeline switches and cancels them when declined', async () => {
    setupBridgeFetch();
    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    const provider = await screen.findByTestId('video-editor-provider');
    await waitFor(() => {
      expect(screen.getByTestId('mock-save-status')).toHaveTextContent('saved');
    });
    act(() => {
      state.saveStatusCallback?.('error');
    });
    state.confirm.mockReturnValue(false);

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select timeline' }));
    await user.click(await screen.findByText('Alt Cut'));

    expect(state.confirm).toHaveBeenCalledWith('The last timeline save failed. Switch editors anyway?');
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-timeline-id', '11111111-1111-1111-1111-111111111111');
    expect(state.providerMounts).toBe(1);
    expect(state.providerUnmounts).toBe(0);
  });

  function setupBridgeFetch() {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url.includes('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')
        || url.includes('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017')
      ) {
        return new Response(JSON.stringify({
          timeline_id: '11111111-1111-1111-1111-111111111111',
          timeline_ulid: '01JM4K5N7P0000000000000017',
          name: 'Intro Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      if (
        url.includes('/api/astrid/projects/ados-talks/timelines/22222222-2222-2222-2222-222222222222')
        || url.includes('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000018')
      ) {
        return new Response(JSON.stringify({
          timeline_id: '22222222-2222-2222-2222-222222222222',
          timeline_ulid: '01JM4K5N7P0000000000000018',
          name: 'Alt Cut',
          config: { clips: [], tracks: [] },
          config_version: 0,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));
  }

  async function mountLocalEditor() {
    setupBridgeFetch();
    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');
    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-kind', 'bridge');
    await waitFor(() => {
      expect(screen.getByTestId('mock-save-status')).toHaveTextContent('saved');
    });
    return provider;
  }

  // ---------------------------------------------------------------------------
  // ?extensionSmoke=1 in the stock app path
  // ---------------------------------------------------------------------------

  describe('?extensionSmoke=1 page integration', () => {
    it('passes the smoke extension into VideoEditorProvider when ?extensionSmoke=1 is present', async () => {
      renderPage('/tools/video-editor?timeline=timeline-1&extensionSmoke=1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');

      // The smoke extension should have been resolved and passed to the provider
      expect(state.lastProviderExtensions).not.toBeNull();
      expect(state.lastProviderExtensions).toHaveLength(1);
      expect(state.lastProviderExtensions![0].manifest.id).toBe('com.reigh.smoke.extension-smoke');
      expect(state.lastProviderExtensions![0].manifest.contributions).toHaveLength(1);
      expect(state.lastProviderExtensions![0].manifest.contributions[0].id).toBe('extension-smoke-status');
    });

    it('does NOT pass the smoke extension when ?extensionSmoke is absent', async () => {
      renderPage('/tools/video-editor?timeline=timeline-1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');

      // No smoke extension — provider receives empty or no extensions
      expect(state.lastProviderExtensions ?? []).toHaveLength(0);
    });

    it('does NOT pass the smoke extension when extensionSmoke=0 (not exactly 1)', async () => {
      renderPage('/tools/video-editor?timeline=timeline-1&extensionSmoke=0');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');

      expect(state.lastProviderExtensions ?? []).toHaveLength(0);
    });

    it('does NOT pass the smoke extension when extensionSmoke is empty', async () => {
      renderPage('/tools/video-editor?timeline=timeline-1&extensionSmoke');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');

      expect(state.lastProviderExtensions ?? []).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // ?timelineOverlayCanary=1 — DEV-only canary gate for the timelineOverlay family
  // ---------------------------------------------------------------------------

  describe('?timelineOverlayCanary=1 (DEV canary gate)', () => {
    it('enables timeline overlays in DEV only when the canary query is exactly 1', async () => {
      renderPage('/tools/video-editor?timeline=timeline-1&timelineOverlayCanary=1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');
      expect(state.lastTimelineOverlaysEnabled).toBe(true);
      expect(provider).toHaveAttribute('data-timeline-overlays-enabled', 'true');
    });

    it('keeps the overlay dark in DEV when the canary query is absent', async () => {
      renderPage('/tools/video-editor?timeline=timeline-1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');
      expect(state.lastTimelineOverlaysEnabled).toBe(false);
      expect(provider).toHaveAttribute('data-timeline-overlays-enabled', 'false');
    });

    it('ignores a non-1 canary value in DEV (only exactly 1 enables)', async () => {
      renderPage('/tools/video-editor?timeline=timeline-1&timelineOverlayCanary=0');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(state.lastTimelineOverlaysEnabled).toBe(false);
      expect(provider).toHaveAttribute('data-timeline-overlays-enabled', 'false');
    });

    it('ignores the canary query in production (DEV off) — the query must never be honored outside DEV', async () => {
      (import.meta.env as Record<string, unknown>).DEV = false;
      renderPage('/tools/video-editor?timeline=timeline-1&timelineOverlayCanary=1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');
      expect(state.lastTimelineOverlaysEnabled).toBe(false);
      expect(provider).toHaveAttribute('data-timeline-overlays-enabled', 'false');
    });

    it('passes the flag into the local-mode provider mount too (canary + localProject)', async () => {
      setupBridgeFetch();
      renderPage(
        '/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111&timelineOverlayCanary=1',
      );

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'bridge');
      expect(state.lastTimelineOverlaysEnabled).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Extension-driven overlay gate — an enabled dev-local extension that
  // declares a `timelineOverlay` contribution mounts the host without the
  // canary query (DEV only; production drops devLocalExtensions entirely).
  // ---------------------------------------------------------------------------

  describe('timelineOverlay host gate via enabled dev-local extension (DEV)', () => {
    const OVERLAY_EXT_ID = 'com.reigh.dev.overlay-fixture';

    function makeOverlayDevLocalExtension() {
      return {
        manifest: {
          id: OVERLAY_EXT_ID,
          version: '0.1.0',
          label: 'Local Overlay Fixture',
          description: 'A dev-local overlay extension for host-gate tests.',
          apiVersion: 1,
          contributions: [
            {
              id: `${OVERLAY_EXT_ID}-overlay`,
              kind: 'timelineOverlay',
              render: `${OVERLAY_EXT_ID}-overlay`,
              order: 5,
              label: 'Local Overlay Fixture',
            },
          ],
        },
        activate: vi.fn(() => ({ dispose: vi.fn() })),
      };
    }

    it('mounts the overlay host when an overlay-capable dev-local extension is enabled (no URL param)', async () => {
      state.devLocalExtensions.push(makeOverlayDevLocalExtension());
      renderPage('/tools/video-editor?timeline=timeline-1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');
      expect(state.lastTimelineOverlaysEnabled).toBe(true);
      expect(provider).toHaveAttribute('data-timeline-overlays-enabled', 'true');
    });

    it('keeps the host dark when the enabled dev-local extension has no timelineOverlay contribution', async () => {
      state.devLocalExtensions.push({
        manifest: {
          id: 'com.reigh.dev.slot-only-fixture',
          version: '0.1.0',
          label: 'Local Slot Fixture',
          description: 'A dev-local slot-only extension for host-gate tests.',
          apiVersion: 1,
          contributions: [
            {
              id: 'com.reigh.dev.slot-only-fixture-status',
              kind: 'slot',
              slot: 'statusBar',
              render: 'com.reigh.dev.slot-only-fixture-status',
              label: 'Local Slot Fixture Status',
            },
          ],
        },
        activate: vi.fn(() => ({ dispose: vi.fn() })),
      });
      renderPage('/tools/video-editor?timeline=timeline-1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(state.lastTimelineOverlaysEnabled).toBe(false);
      expect(provider).toHaveAttribute('data-timeline-overlays-enabled', 'false');
    });

    it('drops the overlay gate when the overlay extension is disabled through the external store', async () => {
      state.devLocalExtensions.push(makeOverlayDevLocalExtension());
      renderPage('/tools/video-editor?timeline=timeline-1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(state.lastTimelineOverlaysEnabled).toBe(true);

      act(() => {
        setDevExtensionEnabled(OVERLAY_EXT_ID, false);
      });

      await waitFor(() => {
        expect(state.lastTimelineOverlaysEnabled).toBe(false);
      });
    });

    it('ignores the extension-driven gate in production (DEV off)', async () => {
      (import.meta.env as Record<string, unknown>).DEV = false;
      state.devLocalExtensions.push(makeOverlayDevLocalExtension());
      renderPage('/tools/video-editor?timeline=timeline-1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');
      expect(state.lastTimelineOverlaysEnabled).toBe(false);
      expect(provider).toHaveAttribute('data-timeline-overlays-enabled', 'false');
    });
  });

  describe('dev-local extension enablement (external store)', () => {
    const DEV_LOCAL_ID = 'com.reigh.dev.local-fixture';

    function makeDevLocalExtension() {
      return {
        manifest: {
          id: DEV_LOCAL_ID,
          version: '0.1.0',
          label: 'Local Fixture Extension',
          description: 'A dev-local scratchpad extension for enablement tests.',
          apiVersion: 1,
          contributions: [
            {
              id: `${DEV_LOCAL_ID}-status`,
              kind: 'slot',
              slot: 'statusBar',
              render: `${DEV_LOCAL_ID}-status`,
              label: 'Local Fixture Status',
            },
          ],
        },
        activate: vi.fn(() => ({ dispose: vi.fn() })),
      };
    }

    it('passes an enabled dev-local extension into the provider (activated once)', async () => {
      state.devLocalExtensions.push(makeDevLocalExtension());
      renderPage('/tools/video-editor?timeline=timeline-1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');
      expect(state.lastProviderExtensions).toHaveLength(1);
      expect(state.lastProviderExtensions![0].manifest.id).toBe(DEV_LOCAL_ID);
      expect(state.extensionActivations).toEqual([DEV_LOCAL_ID]);
      expect(state.extensionDisposals).toEqual([]);
    });

    it('drops the dev-local extension when disabled through the external store (no searchParams change, no refresh key)', async () => {
      state.devLocalExtensions.push(makeDevLocalExtension());
      renderPage('/tools/video-editor?timeline=timeline-1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(state.lastProviderExtensions).toHaveLength(1);

      // Toggling the store notifies the page's useSyncExternalStore
      // subscription; the smokeDirectExtensions memo must update from the
      // snapshot without any URL or loader-refresh change.
      act(() => {
        setDevExtensionEnabled(DEV_LOCAL_ID, false);
      });

      await waitFor(() => {
        expect(state.lastProviderExtensions ?? []).toHaveLength(0);
      });
      // Runtime teardown: the extension left the provider's extension list.
      expect(state.extensionDisposals).toEqual([DEV_LOCAL_ID]);
    });

    it('does not mount a dev-local extension that is disabled before the page renders', async () => {
      act(() => {
        setDevExtensionEnabled(DEV_LOCAL_ID, false);
      });
      state.devLocalExtensions.push(makeDevLocalExtension());
      renderPage('/tools/video-editor?timeline=timeline-1');

      await screen.findByTestId('video-editor-provider');

      expect(state.lastProviderExtensions ?? []).toHaveLength(0);
      expect(state.extensionActivations).toEqual([]);
    });

    it('re-enables a disabled dev-local extension and activates it exactly once', async () => {
      state.devLocalExtensions.push(makeDevLocalExtension());
      renderPage('/tools/video-editor?timeline=timeline-1');

      await screen.findByTestId('video-editor-provider');
      expect(state.lastProviderExtensions).toHaveLength(1);
      expect(state.extensionActivations).toEqual([DEV_LOCAL_ID]);

      // Disable → teardown (exactly one disposal).
      act(() => {
        setDevExtensionEnabled(DEV_LOCAL_ID, false);
      });
      await waitFor(() => {
        expect(state.lastProviderExtensions ?? []).toHaveLength(0);
      });
      expect(state.extensionDisposals).toEqual([DEV_LOCAL_ID]);

      // Re-enable → the extension comes back, and only one new activation is
      // recorded for the re-add (1 initial + 1 re-enable), with no extra
      // disposal from the re-add itself.
      act(() => {
        setDevExtensionEnabled(DEV_LOCAL_ID, true);
      });

      await waitFor(() => {
        expect(state.lastProviderExtensions).toHaveLength(1);
        expect(state.lastProviderExtensions![0].manifest.id).toBe(DEV_LOCAL_ID);
      });
      expect(state.extensionActivations.filter((id) => id === DEV_LOCAL_ID)).toHaveLength(2);
      expect(state.extensionDisposals.filter((id) => id === DEV_LOCAL_ID)).toHaveLength(1);
    });

    it('does not mount dev-local extensions when DEV is off', async () => {
      state.devLocalExtensions.push(makeDevLocalExtension());
      (import.meta.env as Record<string, unknown>).DEV = false;

      renderPage('/tools/video-editor?timeline=timeline-1');

      const provider = await screen.findByTestId('video-editor-provider');
      expect(provider).toHaveAttribute('data-kind', 'supabase');
      expect(state.lastProviderExtensions ?? []).toHaveLength(0);
      expect(state.extensionActivations).toEqual([]);
    });
  });
});
