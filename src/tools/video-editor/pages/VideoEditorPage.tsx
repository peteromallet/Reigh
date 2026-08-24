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
import { useHomeNavigation } from '@/shared/hooks/useHomeNavigation.ts';
import { Button } from '@/shared/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/shared/components/ui/card.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { Input } from '@/shared/components/ui/input.tsx';
import { Skeleton } from '@/shared/components/ui/skeleton.tsx';
import { useAuth } from '@/shared/contexts/AuthContext.tsx';
import {
  useProjectCrudContext,
  useProjectSelectionContext,
} from '@/shared/contexts/ProjectContext.tsx';
import { useToolSettings } from '@/shared/hooks/settings/useToolSettings.ts';
import { toast } from '@/shared/components/ui/toast.tsx';
import {
  AstridBridgeDataProvider,
  type AstridBridgeRequestObservation,
} from '@/tools/video-editor/data/AstridBridgeDataProvider.ts';
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
  TRANSCRIPT_LANE_FIXTURE_PARAM,
  withTranscriptFixture,
} from '@/tools/video-editor/dev/transcript-lane/fixtureProvider.ts';
import {
  getSnapshot as getDevDisabledSnapshot,
  subscribe as subscribeDevDisabled,
} from '@/tools/video-editor/dev/devExtensionEnablement.ts';
import { useExtensionLoaderWiring } from '@/tools/video-editor/runtime/useExtensionLoaderWiring';
import { ReighVideoEditorShell } from '@/tools/video-editor/components/ReighVideoEditorShell.tsx';
import { EditorProjectTimelineSelectors } from '@/tools/video-editor/components/EditorProjectTimelineSelectors.tsx';
import {
  LOCAL_BRIDGE_BASE_URL,
  useAstridBridgeDiscovery,
} from '@/tools/video-editor/hooks/useAstridBridgeDiscovery.ts';
import { useTimelinesList } from '@/tools/video-editor/hooks/useTimelinesList.ts';
import type { SaveStatus } from '@/tools/video-editor/hooks/useTimelinePersistence.ts';
import { videoEditorSettings } from '@/tools/video-editor/settings/videoEditorDefaults.ts';
import { publishLocalTestExtensionDiagnostics } from '@/app/localTestRuntime.ts';
import {
  createHostOwnedExtensionOperationalEmitter,
  dispatchExtensionOperationalEvent,
  getExtensionReleaseFlags,
  selectReleaseEnabledExtensions,
} from '@/tools/video-editor/runtime/extensionReleaseControls.ts';

type VideoEditorMode = 'app' | 'local';

type ProviderSelection = {
  dataProvider: DataProvider;
  projectId: string | null;
  timelineId: string;
  timelineName: string | null;
  userId: string | null;
  remountKey: string;
};

/**
 * Dev canary gate for the `timelineOverlay` family (plan step 22).
 *
 * The overlay host is a rollout-qualification canary: it mounts only when
 * BOTH the dev build AND the explicit `?timelineOverlayCanary=1` query are
 * present. The literal `import.meta.env.DEV` guard means production builds
 * drop the branch entirely, so the query is never honored outside DEV and
 * the default (no param) stays dark even in DEV.
 */
const TIMELINE_OVERLAY_CANARY_PARAM = 'timelineOverlayCanary';

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
 * The local timeline *name* for the header/dropdown label comes from the
 * timeline GET itself (one of the three bridge routes). Selection itself is
 * URL-param driven — see `useAstridBridgeDiscovery` for the list routes.
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

export function timelineFreshnessLabel(updatedAt: string | null | undefined): string {
  if (!updatedAt) return 'Managed by Astrid';
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) return 'Managed by Astrid';
  return `Updated ${new Date(timestamp).toLocaleString()}`;
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
  onBridgeRequest,
}: {
  mode: VideoEditorMode;
  selectedProjectId: string | null;
  userId: string | null;
  appTimelineId: string | null;
  appTimelineName: string | null;
  localProjectSlug: string | null;
  localTimelineId: string | null;
  localTimelineName: string | null;
  onBridgeRequest?: (event: AstridBridgeRequestObservation) => void;
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
          onBridgeRequest,
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
    onBridgeRequest,
    selectedProjectId,
    userId,
  ]);
}

export function TimelineList({ onSelect }: { onSelect: (timelineId: string) => void }) {
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
  const timelineMutationsAvailable = timelines.timelineMutationsAvailable === true;

  // Auto-create a default timeline if the project has none
  useEffect(() => {
    if (
      !timelines.isLoading &&
      timelineMutationsAvailable &&
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
  }, [timelines.isLoading, timelines.data, selectedProjectId, userId, autoCreating, timelines.createTimeline, timelineMutationsAvailable, update, onSelect]);

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
          <CardDescription>
            {timelineMutationsAvailable
              ? 'Pick a timeline or create a new one for this project.'
              : 'Pick an Astrid timeline for this project.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {timelineMutationsAvailable ? (
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
          ) : (
            <div role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3">
              <div className="text-sm font-medium text-foreground">Timeline changes are managed in Astrid</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Create, rename, or remove timelines in Astrid, then refresh this page.
              </div>
            </div>
          )}

          <div className="grid gap-3">
            {timelines.isLoading && Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
            {(timelines.data ?? []).map((timeline: { id: string; name: string; updated_at?: string | null }) => {
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
                      {timelineFreshnessLabel(timeline.updated_at)}
                      {isActive ? ' · Last opened' : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {timelineMutationsAvailable && (isEditing ? (
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
                    ))}
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
                    {timelineMutationsAvailable && <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${timeline.name}`}
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
                    </Button>}
                  </div>
                </div>
              );
            })}
            {!timelines.isLoading && (timelines.data?.length ?? 0) === 0 && (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <div className="text-sm font-medium text-foreground">No timelines yet</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {timelineMutationsAvailable
                    ? 'Create the first timeline to open the standalone editor.'
                    : 'Create a timeline in Astrid, then refresh this page.'}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function VideoEditorPage() {
  const { selectedProjectId, setSelectedProjectId } = useProjectSelectionContext();
  const { projects: appProjects, isLoadingProjects: appProjectsLoading } = useProjectCrudContext();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- Reviewed extension bundle + smoke wiring ----------------------------
  // Production defaults closed and can only be enabled by the deployment-owned
  // runtime document loaded before React mounts. DEV defaults open for authoring. URL or browser
  // storage cannot override the production rollout contract.
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

  const extensionReleaseFlags = getExtensionReleaseFlags({ development: import.meta.env.DEV });
  const bridgeOperationalEmitter = useMemo(
    () => createHostOwnedExtensionOperationalEmitter({
      releaseRevision: extensionReleaseFlags.configurationRevision,
      extensionVersions: new Map(),
    }, dispatchExtensionOperationalEvent),
    [extensionReleaseFlags.configurationRevision],
  );
  const onBridgeRequest = useCallback((observation: AstridBridgeRequestObservation) => {
    if (!extensionReleaseFlags.extensionHostEnabled) return;
    bridgeOperationalEmitter.emit({
      event: 'bridge.request',
      outcome: observation.outcome,
      durationMs: observation.durationMs,
      ...(observation.errorClass ? { errorClass: observation.errorClass } : {}),
    });
  }, [bridgeOperationalEmitter, extensionReleaseFlags.extensionHostEnabled]);

  const smokeDirectExtensions = useMemo(() => {
    const smokeExt = import.meta.env.DEV ? getExtensionSmokeExtension(searchParams) : null;
    const disabled = import.meta.env.DEV ? devDisabledIds : new Set<string>();
    // Arbitrary scratchpad manifests remain usable in DEV. Production alone
    // applies the frozen reviewed inventory in addition to the runtime flags.
    const releaseEnabledExtensions = (
      import.meta.env.DEV
        ? devLocalExtensions
        : selectReleaseEnabledExtensions(devLocalExtensions, extensionReleaseFlags)
    ).filter((extension) => !disabled.has(extension.manifest.id as string));
    const direct = [
      ...(extensionReleaseFlags.extensionHostEnabled && smokeExt ? [smokeExt] : []),
      ...releaseEnabledExtensions,
    ];
    return direct.length > 0 ? direct : undefined;
  }, [
    searchParams,
    devDisabledIds,
    extensionReleaseFlags.extensionHostEnabled,
    extensionReleaseFlags.transcriptCaptionFoundryEnabled,
    extensionReleaseFlags.runawayTypedTimelineEnabled,
  ]);

  // ---- Timeline-overlay host gate -----------------------------------------
  // An enabled, reviewed overlay contribution turns on the host in every
  // environment. The URL canary remains DEV-only and cannot bypass the parent
  // deployment kill switch.
  const timelineOverlaysEnabled = extensionReleaseFlags.extensionHostEnabled && (
    (import.meta.env.DEV && searchParams.get(TIMELINE_OVERLAY_CANARY_PARAM) === '1')
    || (smokeDirectExtensions ?? []).some((ext) => (
      ext.manifest.contributions?.some((contribution) => contribution.kind === 'timelineOverlay')
    ))
  );

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
  useEffect(() => {
    publishLocalTestExtensionDiagnostics('loader', loaderDiagnostics);
  }, [loaderDiagnostics]);
  const { userId } = useAuth();
  const navigate = useNavigate();
  const { navigateHome } = useHomeNavigation();

  // Local mode is derived solely from the URL params — the legacy
  // `dev.videoEditor.localMode` storage flag has been retired.
  const localProjectSlug = searchParams.get('localProject');
  const localTimelineId = searchParams.get('localTimeline');
  const mode: VideoEditorMode = searchParams.has('localProject') || searchParams.has('localTimeline')
    ? 'local'
    : 'app';
  const appTimelineId = searchParams.get('timeline');

  // Selector dropdown open state drives discovery refetch-on-open + polling.
  const [selectorsOpen, setSelectorsOpen] = useState(false);
  const discovery = useAstridBridgeDiscovery({
    open: selectorsOpen,
    currentLocal: mode === 'local',
    selectedProjectSlug: localProjectSlug,
    onBridgeRequest,
  });

  const [mountedSaveStatus, setMountedSaveStatus] = useState<SaveStatus>('saved');
  const creatingRef = useRef(false);
  const timelines = useTimelinesList(
    mode === 'local' ? null : selectedProjectId,
    mode === 'local' ? null : userId,
  );
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
    onBridgeRequest,
  });

  // dataKind V1 golden path (groken round 4): DEV-only fixture provider so the
  // transcript-lane example paints on any project with a media clip. Opt-in
  // via `?transcriptLaneFixture=1`; production builds drop the branch.
  const pageDataProvider = useMemo(() => {
    if (!providerSelection) return null;
    if (!import.meta.env.DEV) return providerSelection.dataProvider;
    const fixtureMode = new URLSearchParams(window.location.search).get(TRANSCRIPT_LANE_FIXTURE_PARAM);
    return fixtureMode !== null
      ? withTranscriptFixture(providerSelection.dataProvider, {
          dense: fixtureMode === 'dense',
          renderMatrix: fixtureMode === 'render-matrix',
        })
      : providerSelection.dataProvider;
  }, [providerSelection]);

  useEffect(() => {
    setMountedSaveStatus('saved');
  }, [providerSelection?.remountKey]);

  const isSwitchBlockedBySave = mountedSaveStatus === 'saving' || mountedSaveStatus === 'retrying';
  const confirmEditorRemount = useCallback(() => {
    if (!providerSelection) {
      return true;
    }
    // A save round-trip is in flight or a transport retry is scheduled —
    // switching would abandon it and lose the edit. Block like `saving`.
    if (mountedSaveStatus === 'saving' || mountedSaveStatus === 'retrying') {
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

  /**
   * Selector → route. Values are namespaced: `app:<id>` switches to the app
   * (Supabase) provider for that project (clearing the local params and letting
   * the existing restore/first/create flow choose the timeline), `local:<slug>`
   * switches to the Astrid bridge for that project (clearing any local timeline
   * so the auto-pick effect below chooses one).
   */
  const handleSelectProject = useCallback((value: string) => {
    if (value.startsWith('app:')) {
      const appProjectId = value.slice('app:'.length);
      if (!appProjectId || (mode === 'app' && appProjectId === selectedProjectId)) {
        return;
      }
      if (!confirmEditorRemount()) {
        return;
      }
      setSelectedProjectId(appProjectId);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('localProject');
        next.delete('localTimeline');
        // Never carry a timeline id from another project across the switch.
        next.delete('timeline');
        return next;
      }, { replace: true });
      return;
    }

    const slug = value.slice('local:'.length);
    if (!slug || (mode === 'local' && slug === localProjectSlug)) {
      return;
    }
    if (!confirmEditorRemount()) {
      return;
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('localProject', slug);
      next.delete('localTimeline');
      next.delete('timeline');
      return next;
    }, { replace: true });
  }, [confirmEditorRemount, localProjectSlug, mode, selectedProjectId, setSearchParams, setSelectedProjectId]);

  const handleSelectTimeline = useCallback((timelineId: string) => {
    if (!timelineId || (mode === 'local' && timelineId === localTimelineId)) {
      return;
    }
    if (!confirmEditorRemount()) {
      return;
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('localTimeline', timelineId);
      return next;
    }, { replace: true });
  }, [confirmEditorRemount, localTimelineId, mode, setSearchParams]);

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

    // Astrid exposes timeline list/read/save, but not create. An empty project
    // is an actionable managed state, not a reason to retry a retired mutation.
    if (timelines.timelineMutationsAvailable !== true) {
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
    timelines.timelineMutationsAvailable,
    update,
    userId,
  ]);

  // Local timeline auto-pick: when a local project is selected without a
  // timeline (or the current one no longer exists under that project), retain
  // the current id if it is still valid, otherwise pick `is_default` then the
  // first timeline from the bridge discovery list.
  useEffect(() => {
    if (mode !== 'local' || !localProjectSlug) {
      return;
    }
    const localTimelines = discovery.timelinesQuery.data?.timelines;
    if (discovery.timelinesQuery.isLoading || discovery.timelinesQuery.error || !localTimelines) {
      return;
    }
    if (localTimelines.length === 0) {
      return;
    }
    // The URL may carry either the canonical id or its ULID alias (the
    // dropdown selects `timeline_ulid ?? timeline_id`), so validate against both.
    if (localTimelineId && localTimelines.some((timeline) => (
      timeline.timeline_id === localTimelineId || timeline.timeline_ulid === localTimelineId
    ))) {
      return;
    }
    const nextTimeline = localTimelines.find((timeline) => timeline.is_default) ?? localTimelines[0];
    if (!nextTimeline) {
      return;
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('localProject', localProjectSlug);
      // Prefer the ULID: it is the routable address for bridge requests,
      // while the canonical timeline_id is identity only.
      next.set('localTimeline', nextTimeline.timeline_ulid ?? nextTimeline.timeline_id);
      return next;
    }, { replace: true });
  }, [
    discovery.timelinesQuery.data,
    discovery.timelinesQuery.error,
    discovery.timelinesQuery.isLoading,
    localProjectSlug,
    localTimelineId,
    mode,
    setSearchParams,
  ]);

  const selectors = (
    <EditorProjectTimelineSelectors
      mode={mode}
      appProjects={appProjects}
      appProjectsLoading={appProjectsLoading}
      selectedAppProjectId={mode === 'local' ? null : selectedProjectId}
      localProjectSlug={localProjectSlug}
      localTimelineId={localTimelineId}
      localTimelineName={localTimelineName}
      discovery={discovery}
      onSelectProject={handleSelectProject}
      onSelectTimeline={handleSelectTimeline}
      disabled={isSwitchBlockedBySave}
      onOpenChange={setSelectorsOpen}
    />
  );

  // Page-level header for the branches where the editor shell (which hosts the
  // selectors beside its Back button via `navigationControls`) is not shown.
  const selectorsHeader = (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <button
        type="button"
        className="shrink-0 text-sm transition-colors hover:text-foreground"
        onClick={navigateHome}
      >
        ← Back
      </button>
      <div className="min-w-0 flex-1">{selectors}</div>
    </div>
  );

  if (mode === 'local') {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-background">
        {providerSelection ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <VideoEditorProvider
              key={providerSelection.remountKey}
              dataProvider={pageDataProvider ?? providerSelection.dataProvider}
              projectId={providerSelection.projectId}
              timelineId={providerSelection.timelineId}
              timelineName={providerSelection.timelineName}
              userId={providerSelection.userId}
              onSaveStatusChange={setMountedSaveStatus}
              extensions={resolvedExtensions}
              timelineOverlaysEnabled={timelineOverlaysEnabled}
              extensionHostEnabled={extensionReleaseFlags.extensionHostEnabled}
              extensionReleaseRevision={extensionReleaseFlags.configurationRevision}
            >
              <ReighVideoEditorShell
                mode="full"
                timelineId={providerSelection.timelineId}
                onCreateTimeline={() => navigate('/')}
                navigationControls={selectors}
              />
            </VideoEditorProvider>
          </div>
        ) : (
          <>
            {selectorsHeader}
            <div className="flex flex-1 items-center justify-center px-6">
              {discovery.healthQuery.isLoading ? (
                <div className="w-full max-w-4xl space-y-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : discovery.bridgeDown ? (
                <Card className="w-full max-w-md">
                  <CardHeader>
                    <CardTitle>Unable to reach the local bridge</CardTitle>
                    <CardDescription>
                      {discovery.healthQuery.error?.message ?? 'The Astrid bridge did not report healthy.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Make sure Astrid is running locally:
                    </p>
                    <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs">
                      cd ../Astrid &amp;&amp; astrid serve --port 17333
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
              ) : !localProjectSlug || !localTimelineId ? (
                <Card className="w-full max-w-md">
                  <CardHeader>
                    <CardTitle>Select a project and timeline</CardTitle>
                    <CardDescription>
                      Use the selectors above to open a timeline from the local Astrid bridge.
                    </CardDescription>
                  </CardHeader>
                </Card>
              ) : (
                <Card className="w-full max-w-md">
                  <CardHeader>
                    <CardTitle>Timeline not found</CardTitle>
                    <CardDescription>No such project/timeline under the bridge projects root.</CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  if (!selectedProjectId) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        {selectorsHeader}
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
        <div className="flex h-full w-full flex-col bg-background">
          {selectorsHeader}
          <div className="flex flex-1 items-center justify-center bg-background px-6">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Unable to open video editor</CardTitle>
                <CardDescription>{timelines.error.message}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      );
    }

    if (userId && selectedProjectId && !appTimelineId && !timelines.isLoading && timelines.data) {
      return (
        <div className="flex h-full w-full flex-col bg-background">
          {selectorsHeader}
          <TimelineList
            onSelect={(nextTimelineId) => {
              setSearchParams({ timeline: nextTimelineId });
            }}
          />
        </div>
      );
    }

    return (
      <div className="flex h-full w-full flex-col bg-background">
        {selectorsHeader}
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="w-full max-w-4xl space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full w-full flex-col overflow-hidden bg-background')}>
      <div className="min-h-0 flex-1 overflow-hidden">
        <VideoEditorProvider
          key={providerSelection.remountKey}
          dataProvider={pageDataProvider ?? providerSelection.dataProvider}
          projectId={providerSelection.projectId}
          timelineId={providerSelection.timelineId}
          timelineName={providerSelection.timelineName}
          userId={providerSelection.userId}
          onSaveStatusChange={setMountedSaveStatus}
          extensions={resolvedExtensions}
          timelineOverlaysEnabled={timelineOverlaysEnabled}
          extensionHostEnabled={extensionReleaseFlags.extensionHostEnabled}
          extensionReleaseRevision={extensionReleaseFlags.configurationRevision}
        >
          <ReighVideoEditorShell
            mode="full"
            timelineId={providerSelection.timelineId}
            onCreateTimeline={() => navigate('/')}
            navigationControls={selectors}
          />
        </VideoEditorProvider>
      </div>
    </div>
  );
}
