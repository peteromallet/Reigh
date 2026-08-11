import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoEditorPage from '@/tools/video-editor/pages/VideoEditorPage.tsx';
import { setDevExtensionEnabled } from '@/tools/video-editor/dev/devExtensionEnablement.ts';

const state = vi.hoisted(() => ({
  auth: { userId: 'user-1' as string | null },
  project: { selectedProjectId: 'project-1' as string | null },
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
  providerMounts: 0,
  providerUnmounts: 0,
  saveStatusCallback: null as null | ((status: 'saved' | 'saving' | 'dirty' | 'error') => void),
  confirm: vi.fn(() => true),
  /** Captured extensions prop from the last VideoEditorProvider render (for smoke tests). */
  lastProviderExtensions: null as readonly any[] | null,
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

// The local-mode bridge-state tests below exercise the no-backend dev fallback
// (flag-driven local mode). With a Supabase URL configured the flag is ignored
// by design, so simulate the no-backend setup for these tests.
vi.mock('@/integrations/supabase/config/env', () => ({
  hasSupabaseConfig: () => false,
}));

vi.mock('@/shared/contexts/ProjectContext.tsx', () => ({
  useProjectSelectionContext: () => state.project,
}));

vi.mock('@/shared/hooks/settings/useToolSettings.ts', () => ({
  useToolSettings: () => state.settings,
}));

vi.mock('@/tools/video-editor/hooks/useTimelinesList.ts', () => ({
  useTimelinesList: () => state.timelines,
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
  ReighVideoEditorShell: ({ timelineId }: { timelineId: string }) => (
    <div data-testid="video-editor-shell">{timelineId}</div>
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
      children,
    }: {
      dataProvider: { kind?: string };
      timelineId: string;
      timelineName?: string | null;
      onSaveStatusChange?: (status: 'saved' | 'saving' | 'dirty' | 'error') => void;
      extensions?: readonly any[];
      children: React.ReactNode;
    }) => {
      const [saveStatus, setSaveStatus] = ReactModule.useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
      state.saveStatusCallback = onSaveStatusChange ?? null;
      state.lastProviderExtensions = extensions ?? null;

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
        >
          <button type="button" onClick={() => setSaveStatus('saving')}>
            status-saving
          </button>
          <button type="button" onClick={() => setSaveStatus('dirty')}>
            status-dirty
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

  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).DEV = true;
    window.localStorage.clear();
    state.auth.userId = 'user-1';
    state.project.selectedProjectId = 'project-1';
    state.settings.settings = { lastTimelineId: 'timeline-1' };
    state.settings.update.mockClear();
    state.timelines.data = [{ id: 'timeline-1', name: 'Main timeline', updated_at: '2026-06-11T10:00:00Z' }];
    state.timelines.isLoading = false;
    state.timelines.error = null;
    state.timelines.createTimeline.isPending = false;
    state.timelines.createTimeline.mutateAsync.mockClear();
    state.timelines.renameTimeline.mutateAsync.mockClear();
    state.timelines.deleteTimeline.mutateAsync.mockClear();
    state.providerMounts = 0;
    state.providerUnmounts = 0;
    state.saveStatusCallback = null;
    state.lastProviderExtensions = null;
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
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true, projects_root: '/tmp/test' }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects')) {
        return new Response(JSON.stringify({
          projects: [{ slug: 'ados-talks', name: 'Ados Talks' }],
        }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines')) {
        return new Response(JSON.stringify({
          timelines: [{
            timeline_id: '11111111-1111-1111-1111-111111111111',
            timeline_ulid: '01JM4K5N7P0000000000000017',
            slug: 'intro-cut',
            name: 'Intro Cut',
            is_default: true,
          }],
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
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    const fetchCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true, projects_root: '/tmp/test' }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects')) {
        return new Response(JSON.stringify({
          projects: [{ slug: 'ados-talks', name: 'Ados Talks' }],
        }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines')) {
        return new Response(JSON.stringify({
          timelines: [{
            timeline_id: '11111111-1111-1111-1111-111111111111',
            timeline_ulid: '01JM4K5N7P0000000000000017',
            slug: 'intro-cut',
            name: 'Intro Cut',
            is_default: true,
          }],
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
    // B5: there is no timeline picker — the URL params ARE the selection, and
    // the remount key derives from them. Changing the param changes the editor.
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true, projects_root: '/tmp/test' }), { status: 200 });
      }
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

  it('shows unavailable state when bridge health check fails', async () => {
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor');

    await screen.findByText('Unable to reach the local bridge');
    expect(screen.queryByTestId('video-editor-provider')).toBeNull();
  });

  it('requires explicit selection in Local mode: no params renders the selection prompt, no list calls', async () => {
    // B5: the bridge serves three routes only. With no URL params there is
    // nothing to discover — the page must prompt for an explicit selection and
    // must not call the removed /projects or /timelines list endpoints.
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    const fetchCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor');

    await screen.findByText('Select a local timeline');
    expect(screen.queryByTestId('video-editor-provider')).toBeNull();
    expect(fetchCalls.some((c) => c.endsWith('/api/astrid/projects'))).toBe(false);
    expect(fetchCalls.some((c) => c.includes('/timelines'))).toBe(false);
  });

  it('a project without a timeline param still renders the explicit selection prompt', async () => {
    // A bare localProject is not a selection — localTimeline is required too.
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor?localProject=ados-talks');

    await screen.findByText('Select a local timeline');
    expect(screen.queryByTestId('video-editor-provider')).toBeNull();
  });

  it('shows the explicit local selection readout while keeping the editor mounted', async () => {
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
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
    expect(screen.queryByText('Read-only')).toBeNull();
    expect(screen.queryByText('Project')).toBeNull();
    expect(screen.queryByText('Timeline')).toBeNull();
    // Explicit readout + the change-selection affordance.
    expect(screen.getByText(/Local:/)).toBeInTheDocument();
    expect(screen.getByText('ados-talks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change selection' })).toBeInTheDocument();
  });

  it('fetches health endpoint before loading projects in Local mode', async () => {
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    const fetchCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects')) {
        return new Response(JSON.stringify({
          projects: [{ slug: 'ados-talks', name: 'Ados Talks' }],
        }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines')) {
        return new Response(JSON.stringify({
          timelines: [{
            timeline_id: '11111111-1111-1111-1111-111111111111',
            timeline_ulid: '01JM4K5N7P0000000000000017',
            slug: 'intro-cut',
            name: 'Intro Cut',
            is_default: true,
          }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    await screen.findByTestId('video-editor-provider');

    // Health should be among the fetch calls
    const healthCalls = fetchCalls.filter(c => c.endsWith('/api/astrid/health'));
    expect(healthCalls.length).toBeGreaterThan(0);
  });

  it('passes a save-status callback into the mounted provider', async () => {
    renderPage('/tools/video-editor?timeline=timeline-1');

    await screen.findByTestId('video-editor-provider');
    expect(state.saveStatusCallback).toBeTypeOf('function');
  });

  it('opens Local mode straight from the URL params, with no storage flag set', async () => {
    // No `dev.videoEditor.localMode` in localStorage: the pasted link is the
    // only signal, and it has to be enough (DEV only).
    setupBridgeFetch();

    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-kind', 'bridge');
    // ...and the flag is persisted, so a reload without params stays in Local mode.
    expect(window.localStorage.getItem('dev.videoEditor.localMode')).toBe('1');
  });

  it('does not self-activate Local mode outside DEV', async () => {
    (import.meta.env as Record<string, unknown>).DEV = false;

    renderPage('/tools/video-editor?timeline=timeline-1&localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-kind', 'supabase');
    expect(state.bridgeCtor).not.toHaveBeenCalled();
  });


  it('switches between App and Local modes while preserving per-mode selections', async () => {
    // The URL carries local params, so the page opens in Local mode (self-activating).
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects')) {
        return new Response(JSON.stringify({
          projects: [{ slug: 'ados-talks', name: 'Ados Talks' }],
        }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines')) {
        return new Response(JSON.stringify({
          timelines: [{
            timeline_id: '11111111-1111-1111-1111-111111111111',
            timeline_ulid: '01JM4K5N7P0000000000000017',
            slug: 'intro-cut',
            name: 'Intro Cut',
            is_default: true,
          }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor?timeline=timeline-1&localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    await screen.findByTestId('video-editor-provider');

    await waitFor(() => {
      expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'bridge');
    });
    expect(state.bridgeCtor).toHaveBeenLastCalledWith({
      projectSlug: 'ados-talks',
      timelineRef: '11111111-1111-1111-1111-111111111111',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    fireEvent.click(screen.getByRole('button', { name: 'App' }));

    await waitFor(() => {
      expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'supabase');
    });
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-timeline-id', 'timeline-1');
  });

  it('confirms error-state local timeline remounts and cancels them when declined', async () => {
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    state.confirm.mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects')) {
        return new Response(JSON.stringify({
          projects: [{ slug: 'ados-talks', name: 'Ados Talks' }],
        }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines')) {
        return new Response(JSON.stringify({
          timelines: [
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
          ],
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');

    await screen.findByTestId('video-editor-provider');
    await waitFor(() => {
      expect(screen.getByTestId('mock-save-status')).toHaveTextContent('saved');
    });
    act(() => {
      state.saveStatusCallback?.('error');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change selection' }));

    expect(state.confirm).toHaveBeenCalledWith('The last timeline save failed. Switch editors anyway?');
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-timeline-id', '11111111-1111-1111-1111-111111111111');
    expect(state.providerMounts).toBe(1);
    expect(state.providerUnmounts).toBe(0);
  });

  function setupBridgeFetch() {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/health')) {
        return new Response(JSON.stringify({ ok: true, projects_root: '/tmp/test' }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects')) {
        return new Response(JSON.stringify({
          projects: [{ slug: 'ados-talks', name: 'Ados Talks' }],
        }), { status: 200 });
      }
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines')) {
        return new Response(JSON.stringify({
          timelines: [
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
          ],
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));
  }

  async function mountLocalEditor() {
    window.localStorage.setItem('dev.videoEditor.localMode', '1');
    setupBridgeFetch();
    renderPage('/tools/video-editor?localProject=ados-talks&localTimeline=11111111-1111-1111-1111-111111111111');
    const provider = await screen.findByTestId('video-editor-provider');
    expect(provider).toHaveAttribute('data-kind', 'bridge');
    await waitFor(() => {
      expect(screen.getByTestId('mock-save-status')).toHaveTextContent('saved');
    });
    return provider;
  }

  it('blocks Local-to-App switching while the editor is saving', async () => {
    await mountLocalEditor();

    act(() => {
      state.saveStatusCallback?.('saving');
    });

    fireEvent.click(screen.getByRole('button', { name: 'App' }));

    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute('data-kind', 'bridge');
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it('disables mode toggle buttons while the editor is saving in local mode', async () => {
    await mountLocalEditor();

    act(() => {
      state.saveStatusCallback?.('saving');
    });

    expect(screen.getByRole('button', { name: 'Local' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'App' })).toBeDisabled();
  });

  it('confirms dirty-state Local-to-App switches when accepted and blocks when declined', async () => {
    await mountLocalEditor();

    // Dirty + denied → switch must be blocked, provider unchanged
    state.confirm.mockReturnValue(false);
    fireEvent.click(screen.getByText('status-dirty'));
    await waitFor(() => {
      expect(screen.getByTestId('mock-save-status')).toHaveTextContent('dirty');
    });

    fireEvent.click(screen.getByRole('button', { name: 'App' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'App' }));

    expect(state.confirm).toHaveBeenCalledWith(
      'You have unsaved timeline changes. Switch editors and discard them?',
    );
  });

  it('confirms error-state Local-to-App switches and blocks when declined', async () => {
    await mountLocalEditor();

    // Error + denied → switch blocked
    state.confirm.mockReturnValue(false);
    act(() => {
      state.saveStatusCallback?.('error');
    });

    fireEvent.click(screen.getByRole('button', { name: 'App' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'App' }));

    expect(state.confirm).toHaveBeenCalledWith(
      'The last timeline save failed. Switch editors anyway?',
    );
  });

  it('blocks changing the explicit local selection while the editor is saving', async () => {
    await mountLocalEditor();

    act(() => {
      state.saveStatusCallback?.('saving');
    });

    expect(screen.getByRole('button', { name: 'Change selection' })).toBeDisabled();

    // Still on the same timeline — switch blocked without confirm
    expect(screen.getByTestId('video-editor-provider')).toHaveAttribute(
      'data-timeline-id',
      '11111111-1111-1111-1111-111111111111',
    );
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it('Change selection with a clean editor clears the params and returns to the prompt', async () => {
    await mountLocalEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Change selection' }));

    await waitFor(() => {
      expect(screen.getByText('Select a local timeline')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('video-editor-provider')).toBeNull();
    expect(state.providerUnmounts).toBe(1);
  });

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
