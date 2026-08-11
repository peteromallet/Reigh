// Layer map & invariants: docs/structure_detail/tool_video_editor.md
/**
 * Internal Reigh route adapter for the in-app video editor page.
 * Not part of the supported public SDK surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z, ZodType } from 'zod';
import { Clapperboard, Pencil, Plus, Trash2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/shared/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/shared/components/ui/card.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { useIsMobile, useIsTablet } from '@/shared/hooks/mobile';
import { Input } from '@/shared/components/ui/input.tsx';
import { Skeleton } from '@/shared/components/ui/skeleton.tsx';
import { useAuth } from '@/shared/contexts/AuthContext.tsx';
import { hasSupabaseConfig } from '@/integrations/supabase/config/env';
import { useProjectSelectionContext } from '@/shared/contexts/ProjectContext.tsx';
import { useToolSettings } from '@/shared/hooks/settings/useToolSettings.ts';
import { toast } from '@/shared/components/ui/toast.tsx';
import { AstridBridgeDataProvider } from '@/tools/video-editor/data/AstridBridgeDataProvider.ts';
import {
  BRIDGE_REQUEST_TIMEOUT_MS,
  bridgeHealthSchema,
  bridgeTimelinePayloadSchema,
  parseBridgePayload,
} from '@/tools/video-editor/data/bridgeContract.ts';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import { SupabaseDataProvider } from '@/tools/video-editor/data/SupabaseDataProvider.ts';
import { VideoEditorProvider } from '@/tools/video-editor/contexts/VideoEditorProvider.tsx';
import { getExtensionSmokeExtension } from '@/sdk/smoke/extensionSmoke';
import { devLocalExtensions } from '@/tools/video-editor/dev/localExtensions.ts';
import {
  getSnapshot as getDevDisabledSnapshot,
  subscribe as subscribeDevDisabled,
} from '@/tools/video-editor/dev/devExtensionEnablement.ts';
import { useExtensionLoaderWiring } from '@/tools/video-editor/runtime/useExtensionLoaderWiring';
import { ReighVideoEditorShell } from '@/tools/video-editor/components/ReighVideoEditorShell.tsx';
import { useTimelinesList } from '@/tools/video-editor/hooks/useTimelinesList.ts';
import type { SaveStatus } from '@/tools/video-editor/hooks/useTimelinePersistence.ts';
import { videoEditorSettings } from '@/tools/video-editor/settings/videoEditorDefaults.ts';

type VideoEditorMode = 'app' | 'local';

type ProviderSelection = {
  dataProvider: DataProvider;
  projectId: string | null;
  timelineId: string;
  timelineName: string | null;
  userId: string;
  remountKey: string;
};

type AppRouteState = {
  timelineId: string | null;
};

type LocalRouteState = {
  projectSlug: string | null;
  timelineId: string | null;
};

const LOCAL_MODE_STORAGE_KEY = 'dev.videoEditor.localMode';

/**
 * Class for the dev header strip above the editor.
 *
 * The app shell parks a fixed pane-control tab at top-centre of the viewport
 * (`EditorPaneTab` → `PaneControlTab`, `top-0 left-1/2`, ~46px). This page is
 * full-bleed and renders straight underneath it, so on phone and tablet the tab
 * landed on the local-mode timeline selector. Reserve that band here rather than
 * move app-wide chrome that every other page also depends on.
 *
 * Two gates, both deliberate:
 *  - `hasContent`: in production `DevModeToggle` returns null and this strip must
 *    stay a hairline, not 56px of empty space.
 *  - `isTouch`: on desktop the row's controls stop well short of centre, so there
 *    is nothing to clear and the layout stays exactly as it was.
 */
const devHeaderClass = (hasContent: boolean, isTouch: boolean) =>
  cn('border-b border-border px-4', hasContent && isTouch ? 'pb-3 pt-14' : 'py-3');
const LOCAL_BRIDGE_BASE_URL = '/api/astrid';

function readStoredLocalMode(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredLocalMode(enabled: boolean): void {
  try {
    window.localStorage.setItem(LOCAL_MODE_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

/**
 * @param urlRequestsLocalMode whether the entry URL carried `?localProject` /
 *   `?localTimeline`. A pasted local-mode link should open local mode without
 *   the developer first discovering the localStorage flag behind `DevModeToggle`
 *   (which only renders *after* the auth gate). Initial state only — the mode
 *   toggle must still be able to switch to App with those params in the URL.
 */
function useVideoEditorModePreference(urlRequestsLocalMode: boolean) {
  const localModeAvailable = import.meta.env.DEV;
  const { isAuthenticated } = useAuth();
  // Local mode is the no-Supabase dev fallback. When a Supabase URL is
  // configured (remote or local backend), the persisted `dev.videoEditor.localMode`
  // flag must never auto-enter it: the flag is a leftover from a no-backend
  // session and would hijack app-mode visits into the local bridge, whose
  // `/api/astrid` proxy 500s when the stub is not running. The flag only
  // applies with no configured backend AND no session.
  const usePersistedLocalMode = !hasSupabaseConfig() && !isAuthenticated && readStoredLocalMode();
  const [mode, setMode] = useState<VideoEditorMode>(() => (
    localModeAvailable && (urlRequestsLocalMode || usePersistedLocalMode) ? 'local' : 'app'
  ));

  useEffect(() => {
    if (!localModeAvailable && mode !== 'app') {
      setMode('app');
      return;
    }
    if (localModeAvailable) {
      writeStoredLocalMode(mode === 'local');
    }
  }, [localModeAvailable, mode]);

  return {
    localModeAvailable,
    mode: localModeAvailable ? mode : 'app',
    setMode,
  };
}

/**
 * Every page-level bridge read goes through the shared wire contract
 * (`bridgeContract.ts`) rather than a bare `as T` assertion, and every one of
 * them is bounded by the same transport deadline as the provider's requests —
 * a hung `astrid serve` must not park the entry screen forever.
 */
async function fetchBridgeJson<Schema extends ZodType>(
  path: string,
  schema: Schema,
  what: string,
): Promise<z.infer<Schema>> {
  const response = await fetch(`${LOCAL_BRIDGE_BASE_URL}${path}`, {
    signal: AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Astrid bridge request failed: ${response.status} ${response.statusText}`);
  }
  return parseBridgePayload(schema, await response.json(), what);
}

/**
 * B5: discovery is explicit. The bridge no longer serves project/timeline
 * lists — the URL params (localProject / localTimeline) ARE the selection.
 * The only remaining list-shaped need is the timeline *name* for the header,
 * which comes from the timeline GET itself (one of the three routes).
 */
function useBridgeTimelineName(projectSlug: string | null, timelineRef: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['astrid-bridge', projectSlug, timelineRef, 'name'],
    enabled: enabled && Boolean(projectSlug) && Boolean(timelineRef),
    queryFn: async () => {
      const payload = await fetchBridgeJson(
        `/projects/${encodeURIComponent(projectSlug!)}/timelines/${encodeURIComponent(timelineRef!)}`,
        bridgeTimelinePayloadSchema,
        'timeline read',
      );
      return typeof payload.name === 'string' ? payload.name : null;
    },
  });
}

function useBridgeHealth(enabled: boolean) {
  return useQuery({
    queryKey: ['astrid-bridge', 'health'],
    enabled,
    queryFn: async () => {
      const payload = await fetchBridgeJson('/health', bridgeHealthSchema, 'health response');
      return payload.ok === true;
    },
    retry: 0,
  });
}

function useVideoEditorProviderSelection({
  mode,
  selectedProjectId,
  userId,
  appTimelineId,
  appTimelineName,
  localProjectSlug,
  localTimelineId,
  localTimelineName,
}: {
  mode: VideoEditorMode;
  selectedProjectId: string | null;
  userId: string | null;
  appTimelineId: string | null;
  appTimelineName: string | null;
  localProjectSlug: string | null;
  localTimelineId: string | null;
  localTimelineName: string | null;
}): ProviderSelection | null {
  return useMemo(() => {
    if (mode === 'local') {
      if (!localProjectSlug || !localTimelineId) {
        return null;
      }

      return {
        dataProvider: new AstridBridgeDataProvider({
          projectSlug: localProjectSlug,
          timelineRef: localTimelineId,
          timelineId: localTimelineId,
        }),
        projectId: localProjectSlug,
        timelineId: localTimelineId,
        timelineName: localTimelineName,
        // No user in local mode: a fabricated id would be truthy and enable
        // the auth-gated catalog queries (effects, resources) against a
        // backend that local mode must never touch. `null` keeps them off.
        userId: null,
        remountKey: `local:${localProjectSlug}:${localTimelineId}`,
      };
    }

    if (!selectedProjectId || !userId || !appTimelineId) {
      return null;
    }

    return {
      dataProvider: new SupabaseDataProvider({ projectId: selectedProjectId, userId }),
      projectId: selectedProjectId,
      timelineId: appTimelineId,
      timelineName: appTimelineName,
      userId,
      remountKey: `app:${selectedProjectId}:${appTimelineId}`,
    };
  }, [
    appTimelineId,
    appTimelineName,
    localProjectSlug,
    localTimelineId,
    localTimelineName,
    mode,
    selectedProjectId,
    userId,
  ]);
}

function DevModeToggle({
  localModeAvailable,
  mode,
  setMode,
  disabled,
}: {
  localModeAvailable: boolean;
  mode: VideoEditorMode;
  setMode: (nextMode: VideoEditorMode) => void;
  disabled?: boolean;
}) {
  if (!localModeAvailable) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/80 p-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Mode
      </span>
      <Button
        type="button"
        size="sm"
        variant={mode === 'app' ? 'default' : 'outline'}
        onClick={() => setMode('app')}
        disabled={disabled}
      >
        App
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === 'local' ? 'default' : 'outline'}
        onClick={() => setMode('local')}
        disabled={disabled}
      >
        Local
      </Button>
    </div>
  );
}

function TimelineList({ onSelect }: { onSelect: (timelineId: string) => void }) {
  const { selectedProjectId } = useProjectSelectionContext();
  const { userId } = useAuth();
  const { settings, update } = useToolSettings(videoEditorSettings.id, {
    projectId: selectedProjectId ?? undefined,
    enabled: Boolean(selectedProjectId),
  });
  const timelines = useTimelinesList(selectedProjectId, userId);
  const [newName, setNewName] = useState('Main timeline');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [autoCreating, setAutoCreating] = useState(false);

  // Auto-create a default timeline if the project has none
  useEffect(() => {
    if (
      !timelines.isLoading &&
      timelines.data &&
      timelines.data.length === 0 &&
      selectedProjectId &&
      userId &&
      !autoCreating &&
      !timelines.createTimeline.isPending
    ) {
      setAutoCreating(true);
      timelines.createTimeline
        .mutateAsync('Main timeline')
        .then(async (created) => {
          await update('project', { lastTimelineId: created.id });
          onSelect(created.id);
        })
        .catch(() => {
          setAutoCreating(false);
        });
    }
  }, [timelines.isLoading, timelines.data, selectedProjectId, userId, autoCreating, timelines.createTimeline, update, onSelect]);

  if (!selectedProjectId) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>No project selected</CardTitle>
          <CardDescription>Select a project in the header to manage timelines.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Video editor timelines</CardTitle>
          <CardDescription>Pick a timeline or create a new one for this project.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Timeline name" />
            <Button
              type="button"
              onClick={async () => {
                const created = await timelines.createTimeline.mutateAsync(newName || 'Untitled timeline');
                await update('project', { lastTimelineId: created.id });
                onSelect(created.id);
              }}
              disabled={timelines.createTimeline.isPending}
            >
              <Plus className="mr-1 h-4 w-4" />
              Create timeline
            </Button>
          </div>

          <div className="grid gap-3">
            {timelines.isLoading && Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
            {(timelines.data ?? []).map((timeline: { id: string; name: string; updated_at: string }) => {
              const isEditing = editingId === timeline.id;
              const isActive = settings?.lastTimelineId === timeline.id;

              return (
                <div key={timeline.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/70 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Clapperboard className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                    ) : (
                      <div className="truncate text-sm font-medium text-foreground">{timeline.name}</div>
                    )}
                    <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      Updated {new Date(timeline.updated_at).toLocaleString()}
                      {isActive ? ' · Last opened' : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {isEditing ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={async () => {
                          await timelines.renameTimeline.mutateAsync({ timelineId: timeline.id, name: editingName || timeline.name });
                          setEditingId(null);
                        }}
                      >
                        Save
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(timeline.id);
                          setEditingName(timeline.name);
                        }}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Rename
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await update('project', { lastTimelineId: timeline.id });
                        onSelect(timeline.id);
                      }}
                    >
                      Open
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={async () => {
                        await timelines.deleteTimeline.mutateAsync(timeline.id);
                        if (settings?.lastTimelineId === timeline.id) {
                          await update('project', { lastTimelineId: undefined });
                        }
                        toast.success('Timeline deleted');
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {!timelines.isLoading && (timelines.data?.length ?? 0) === 0 && (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <div className="text-sm font-medium text-foreground">No timelines yet</div>
                <div className="mt-1 text-xs text-muted-foreground">Create the first timeline to open the standalone editor.</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function VideoEditorPage() {
  const { selectedProjectId } = useProjectSelectionContext();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- Smoke extension wiring (prepend when ?extensionSmoke=1) -------------
  // `devLocalExtensions` is the author's local scratchpad (empty on main); the
  // DEV guard is a literal so production builds drop it. See dev/localExtensions.ts.
  //
  // Dev-local enablement is an external store (`devExtensionEnablement.ts`):
  // subscribing via useSyncExternalStore makes the disabled-ID snapshot part of
  // this component's render inputs, so a toggle in the ExtensionManager updates
  // the direct-extension memo below without a searchParams change or a loader
  // refresh key. The snapshot is a stable cached Set — unchanged reads never
  // re-render the page, and disabling an extension drops it from the list, which
  // tears its runtime lifecycle down (the lifecycle host disposes on removal).
  const devDisabledIds = useSyncExternalStore(
    subscribeDevDisabled,
    getDevDisabledSnapshot,
    getDevDisabledSnapshot,
  );

  const smokeDirectExtensions = useMemo(() => {
    const smokeExt = getExtensionSmokeExtension(searchParams);
    const disabled = import.meta.env.DEV ? devDisabledIds : new Set<string>();
    const direct = [
      ...(smokeExt ? [smokeExt] : []),
      ...(import.meta.env.DEV
        ? devLocalExtensions.filter((ext) => !disabled.has(ext.manifest.id as string))
        : []),
    ];
    return direct.length > 0 ? direct : undefined;
  }, [searchParams, devDisabledIds]);

  // ---- M14: extension loader wiring (host-owned) --------------------------
  // Resolves direct-local extensions + optional repository state through the
  // ExtensionLoader pipeline.  When no repository is provided, direct-local
  // extensions pass through unchanged (backward compatible).
  const {
    resolvedExtensions,
    diagnostics: loaderDiagnostics,
    isResolving: loaderIsResolving,
  } = useExtensionLoaderWiring({
    directExtensions: smokeDirectExtensions,
    repository: null,
    bundleStore: null,
  });
  const { userId } = useAuth();
  const navigate = useNavigate();
  const { localModeAvailable, mode, setMode } = useVideoEditorModePreference(
    searchParams.has('localProject') || searchParams.has('localTimeline'),
  );
  const isMobileViewport = useIsMobile();
  const isTabletViewport = useIsTablet();
  /** Touch viewports are where the app's fixed top-centre pane tab collides
   *  with this header — see `devHeaderClass`. */
  const reservesTopPaneTabGutter = isMobileViewport || isTabletViewport;
  const [mountedSaveStatus, setMountedSaveStatus] = useState<SaveStatus>('saved');
  const creatingRef = useRef(false);
  const appTimelineId = searchParams.get('timeline');
  const localProjectSlug = searchParams.get('localProject');
  const localTimelineId = searchParams.get('localTimeline');
  const appRouteRef = useRef<AppRouteState>({ timelineId: appTimelineId });
  const localRouteRef = useRef<LocalRouteState>({
    projectSlug: localProjectSlug,
    timelineId: localTimelineId,
  });
  const timelines = useTimelinesList(
    mode === 'local' ? null : selectedProjectId,
    mode === 'local' ? null : userId,
  );
  const bridgeHealth = useBridgeHealth(mode === 'local');
  const bridgeTimelineName = useBridgeTimelineName(localProjectSlug, localTimelineId, mode === 'local');
  const { settings, update } = useToolSettings(videoEditorSettings.id, {
    projectId: mode === 'local' ? undefined : (selectedProjectId ?? undefined),
    enabled: mode !== 'local' && Boolean(selectedProjectId),
  });
  const appTimelineName = timelines.data?.find(
    (timeline: { id: string; name: string }) => timeline.id === appTimelineId,
  )?.name ?? null;
  const localTimelineName = bridgeTimelineName.data ?? null;
  const providerSelection = useVideoEditorProviderSelection({
    mode,
    selectedProjectId,
    userId,
    appTimelineId,
    appTimelineName,
    localProjectSlug,
    localTimelineId,
    localTimelineName,
  });

  useEffect(() => {
    if (appTimelineId !== null || mode === 'app') {
      appRouteRef.current = { timelineId: appTimelineId };
    }
  }, [appTimelineId, mode]);

  useEffect(() => {
    if (localProjectSlug !== null || localTimelineId !== null || mode === 'local') {
      localRouteRef.current = {
        projectSlug: localProjectSlug,
        timelineId: localTimelineId,
      };
    }
  }, [localProjectSlug, localTimelineId, mode]);

  useEffect(() => {
    setMountedSaveStatus('saved');
  }, [providerSelection?.remountKey]);

  const isSwitchBlockedBySave = mountedSaveStatus === 'saving';
  const confirmEditorRemount = useCallback(() => {
    if (!providerSelection) {
      return true;
    }
    if (mountedSaveStatus === 'saving') {
      return false;
    }
    if (mountedSaveStatus === 'dirty') {
      return window.confirm('You have unsaved timeline changes. Switch editors and discard them?');
    }
    if (mountedSaveStatus === 'error') {
      return window.confirm('The last timeline save failed. Switch editors anyway?');
    }
    return true;
  }, [mountedSaveStatus, providerSelection]);

  const setModeRoute = useCallback((nextMode: VideoEditorMode) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('timeline');
      next.delete('localProject');
      next.delete('localTimeline');
      if (nextMode === 'app') {
        if (appRouteRef.current.timelineId) {
          next.set('timeline', appRouteRef.current.timelineId);
        }
      } else {
        if (localRouteRef.current.projectSlug) {
          next.set('localProject', localRouteRef.current.projectSlug);
        }
        if (localRouteRef.current.timelineId) {
          next.set('localTimeline', localRouteRef.current.timelineId);
        }
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleModeChange = useCallback((nextMode: VideoEditorMode) => {
    if (nextMode === mode) {
      return;
    }
    if (!confirmEditorRemount()) {
      return;
    }
    setMode(nextMode);
    setModeRoute(nextMode);
  }, [confirmEditorRemount, mode, setMode, setModeRoute]);

  // Reconcile the URL timelineId against the live list:
  // - if it exists in the list, persist it as lastTimelineId
  // - if the list has loaded and it's not there, clear the URL + setting so
  //   the auto-select effect below picks a valid timeline
  useEffect(() => {
    if (mode !== 'app' || !appTimelineId || !selectedProjectId || !timelines.data) {
      return;
    }

    if (timelines.data.some((timeline: { id: string }) => timeline.id === appTimelineId)) {
      void update('project', { lastTimelineId: appTimelineId });
      return;
    }

    // Invalid id — just clear the URL. We can't clear settings.lastTimelineId
    // here because deepMerge drops `undefined` patches; the restore effect
    // below is responsible for validating the persisted id against the list.
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('timeline');
      return next;
    }, { replace: true });
  }, [appTimelineId, mode, selectedProjectId, setSearchParams, timelines.data, update]);

  useEffect(() => {
    if (mode !== 'app' || appTimelineId || !selectedProjectId || !userId) {
      return;
    }

    // Wait for the list before restoring or auto-picking — otherwise we'd
    // restore a stale lastTimelineId that no longer exists (which the strip
    // effect above would immediately delete, causing an infinite URL loop)
    // or create a duplicate "Main timeline".
    if (timelines.isLoading || timelines.error || !timelines.data) {
      return;
    }

    const persistedId = settings?.lastTimelineId;
    const persistedIsValid = persistedId
      && timelines.data.some((timeline: { id: string }) => timeline.id === persistedId);

    if (persistedIsValid) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('timeline', persistedId);
        return next;
      }, { replace: true });
      return;
    }

    const nextTimelineId = timelines.data[0]?.id;
    if (nextTimelineId) {
      void update('project', { lastTimelineId: nextTimelineId });
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('timeline', nextTimelineId);
        return next;
      }, { replace: true });
      return;
    }

    if (creatingRef.current || timelines.createTimeline.isPending) {
      return;
    }

    creatingRef.current = true;
    void timelines.createTimeline
      .mutateAsync('Main timeline')
      .then(async (created) => {
        await update('project', { lastTimelineId: created.id });
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set('timeline', created.id);
          return next;
        }, { replace: true });
      })
      .catch((error) => {
        creatingRef.current = false;
        console.error('[video-editor] Failed to auto-create timeline', error);
        toast.error('Failed to create the default timeline');
      });
  }, [
    appTimelineId,
    mode,
    settings?.lastTimelineId,
    selectedProjectId,
    setSearchParams,
    timelines.createTimeline,
    timelines.data,
    timelines.error,
    timelines.isLoading,
    update,
    userId,
  ]);

  if (mode === 'local') {
    const hasExplicitSelection = Boolean(localProjectSlug && localTimelineId);

    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className={devHeaderClass(true, reservesTopPaneTabGutter)}>
          <div className="flex flex-wrap items-center gap-3">
            <DevModeToggle
              localModeAvailable={localModeAvailable}
              mode={mode}
              setMode={handleModeChange}
              disabled={isSwitchBlockedBySave}
            />
            <span className="text-xs font-medium text-muted-foreground">
              Local: <span className="font-mono text-foreground">{localProjectSlug}</span> /{' '}
              <span className="font-mono text-foreground">{localTimelineName ?? localTimelineId ?? '—'}</span>
            </span>
            {localProjectSlug && localTimelineId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isSwitchBlockedBySave}
                onClick={() => {
                  if (!confirmEditorRemount()) {
                    return;
                  }
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.delete('localProject');
                    next.delete('localTimeline');
                    return next;
                  }, { replace: true });
                }}
              >
                Change selection
              </Button>
            )}
          </div>
        </div>

        {bridgeHealth.isLoading ? (
          <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : bridgeHealth.error ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Unable to reach the local bridge</CardTitle>
                <CardDescription>{bridgeHealth.error.message}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Make sure Astrid is running locally:
                </p>
                <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs">
                  cd ../Astrid && astrid serve --port 17333
                </code>
                <p className="mt-3 text-sm text-muted-foreground">
                  No Astrid checkout? This repo ships a demo bridge that serves
                  demo-project/demo-timeline:
                </p>
                <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs">
                  npm run dev:editor:bridge
                </code>
              </CardContent>
            </Card>
          </div>
        ) : !hasExplicitSelection ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Select a local timeline</CardTitle>
                <CardDescription>
                  Local mode needs an explicit project and timeline (B5: the bridge no longer
                  auto-discovers project/timeline lists). Set them in the URL:
                </CardDescription>
                <CardContent>
                  <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs">
                    ?localProject=&lt;project-slug&gt;&amp;localTimeline=&lt;timeline-id&gt;
                  </code>
                  <p className="mt-3 text-sm text-muted-foreground">
                    The Astrid bridge serves exactly one projects root (`astrid serve --projects-root
                    …`); timeline ids are the canonical UUIDs under that root&apos;s `timelines/` dirs.
                  </p>
                </CardContent>
              </CardHeader>
            </Card>
          </div>
        ) : !providerSelection ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Timeline not found</CardTitle>
                <CardDescription>No such project/timeline under the bridge projects root.</CardDescription>
              </CardHeader>
            </Card>
          </div>
        ) : (
          <div className={cn('min-h-0 flex-1 overflow-hidden bg-background')}>
            <VideoEditorProvider
              key={providerSelection.remountKey}
              dataProvider={providerSelection.dataProvider}
              projectId={providerSelection.projectId}
              timelineId={providerSelection.timelineId}
              timelineName={providerSelection.timelineName}
              userId={providerSelection.userId}
              onSaveStatusChange={setMountedSaveStatus}
              extensions={resolvedExtensions}
            >
              <ReighVideoEditorShell
                mode="full"
                timelineId={providerSelection.timelineId}
                onCreateTimeline={() => navigate('/')}
              />
            </VideoEditorProvider>
          </div>
        )}
      </div>
    );
  }

  if (!selectedProjectId) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <div className={devHeaderClass(localModeAvailable, reservesTopPaneTabGutter)}>
          <DevModeToggle
            localModeAvailable={localModeAvailable}
            mode={mode}
            setMode={handleModeChange}
            disabled={isSwitchBlockedBySave}
          />
        </div>
        <TimelineList
          onSelect={(nextTimelineId) => {
            setSearchParams({ timeline: nextTimelineId });
          }}
        />
      </div>
    );
  }

  if (!userId || !providerSelection || !appTimelineId) {
    if (timelines.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-background px-6">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Unable to open video editor</CardTitle>
              <CardDescription>{timelines.error.message}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      );
    }

    return null;
  }

  return (
    <div className={cn('flex h-full w-full flex-col overflow-hidden bg-background')}>
      <div className={devHeaderClass(localModeAvailable, reservesTopPaneTabGutter)}>
        <DevModeToggle localModeAvailable={localModeAvailable} mode={mode} setMode={setMode} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <VideoEditorProvider
          key={providerSelection.remountKey}
          dataProvider={providerSelection.dataProvider}
          projectId={providerSelection.projectId}
          timelineId={providerSelection.timelineId}
          timelineName={providerSelection.timelineName}
          userId={providerSelection.userId}
          onSaveStatusChange={setMountedSaveStatus}
          extensions={resolvedExtensions}
        >
          <ReighVideoEditorShell
            mode="full"
            timelineId={providerSelection.timelineId}
            onCreateTimeline={() => navigate('/')}
          />
        </VideoEditorProvider>
      </div>
    </div>
  );
}
