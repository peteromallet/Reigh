/**
 * Internal host-only provider wiring for the Reigh app shell.
 * Not part of the supported public SDK surface.
 *
 * Runtime assembly (registries, extension lifecycle, proposal runtime,
 * process manager, diagnostics) is shared with EditorRuntimeProvider via
 * contexts/editorRuntimeAssembly.tsx; this file owns only the app-shell
 * specifics: real host ports (shots, media lightbox, agent chat, toasts),
 * the staged add-to-editor drain, the lightbox overlay, and the editor-ops
 * store sync.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from '@/shared/components/ui/runtime/sonner.tsx';
import { MediaLightbox } from '@/domains/media-lightbox/MediaLightbox.tsx';
import type { GenerationRow } from '@/domains/generation/types/index.ts';
import { VideoEditorLightboxOverlay } from '@/tools/video-editor/components/VideoEditorLightboxOverlay.tsx';
import { useReighShotsHost } from '@/tools/video-editor/adapters/reigh/useReighShotsHost.ts';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import {
  VideoEditorRuntimeProvider,
  useVideoEditorRuntime,
} from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import {
  EditorRuntimeScaffold,
  useEditorRuntimeAssembly,
  useEditorRuntimeSync,
  type EditorRuntimeAssembly,
} from '@/tools/video-editor/contexts/editorRuntimeAssembly.tsx';
import type { ReighExtension } from '@reigh/editor-sdk';
import { useAgentChatRegistry } from '@/shared/contexts/AgentChatContext.tsx';
import { clearTimelineClipData, setTimelineClipData } from '@/shared/state/selectionStore.ts';
import { type VideoEditorEffectCatalog } from '@/tools/video-editor/hooks/useEffectResources.ts';
import { type VideoEditorSequenceComponentCatalog } from '@/tools/video-editor/hooks/useSequenceResources.ts';
import { useTimelineClipsForAttachments } from '@/tools/video-editor/hooks/useTimelineClipsForAttachments.ts';
import type {
  TimelineActionResizeStart,
  TimelineClipEdgeResizeEnd,
  TimelineEditorOpsContextValue,
} from '@/tools/video-editor/hooks/useTimelineState.types.ts';
import { useVideoEditorLightboxNavigation } from '@/tools/video-editor/hooks/useVideoEditorLightboxNavigation.ts';
import { isOpenableAssetType } from '@/tools/video-editor/lib/editor-utils.ts';
import { loadGenerationForLightbox } from '@/tools/video-editor/lib/generation-utils.ts';
import { getClipTimelineDuration } from '@/tools/video-editor/lib/config-utils.ts';
import {
  ADD_GENERATION_QUERY_PARAM,
  readPendingAdds,
  writePendingAdds,
} from '@/domains/media-lightbox/hooks/addToVideoEditorConstants.ts';
import {
  executeGenerationAssetRegistrationPlan,
  planGenerationAssetRegistration,
} from '@/tools/video-editor/lib/timeline-asset-plans.ts';
import { useRenderDiagnostic } from '@/tools/video-editor/hooks/usePerfDiagnostics.ts';
import { createProposalPersistenceBridge, type ProposalPersistenceProvider } from '@/tools/video-editor/lib/proposal-runtime.ts';
import type { ProcessManager } from '@/tools/video-editor/runtime/processes/ProcessManager.ts';
import type { SaveStatus } from '@/tools/video-editor/hooks/useTimelinePersistence.ts';
import type { ResolvedAssetRegistryEntry } from '@/tools/video-editor/types/index.ts';

const log = import.meta.env.DEV ? (...args: Parameters<typeof console.log>) => console.log(...args) : () => {};

export function buildVideoEditorLightboxMedia(
  assetKey: string | null,
  asset: ResolvedAssetRegistryEntry | undefined,
): GenerationRow | null {
  if (!assetKey || !asset) {
    return null;
  }

  const src = asset.src || asset.file;
  if (!src || !isOpenableAssetType(asset.type, src)) {
    return null;
  }

  const isVideo = asset.type?.startsWith('video/')
    || /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(src);

  return {
    id: assetKey,
    generation_id: asset.generationId || assetKey,
    location: src,
    imageUrl: src,
    thumbUrl: asset.thumbnailUrl || src,
    type: isVideo ? 'video' : 'image',
    primary_variant_id: asset.variantId || null,
    name: asset.file,
  };
}

/** Registers video-editor state into the app-level AgentChatContext and keeps
 *  timeline attachment metadata synchronized in the selection store. */
function AgentChatBridgeRegistration() {
  const { timelineId, agentChat } = useVideoEditorRuntime();
  const allClips = useTimelineClipsForAttachments();

  useEffect(() => {
    setTimelineClipData(allClips);
    return () => clearTimelineClipData();
  }, [allClips]);

  useEffect(() => {
    agentChat.registerTimeline({ timelineId });
    return agentChat.unregisterTimeline;
  }, [agentChat, timelineId]);

  return null;
}

function InnerProvider({
  children,
  effectCatalog,
  sequenceComponentCatalog,
  onSaveStatusChange,
  assembly,
}: {
  children: React.ReactNode;
  effectCatalog?: VideoEditorEffectCatalog | null;
  sequenceComponentCatalog?: VideoEditorSequenceComponentCatalog | null;
  onSaveStatusChange?: (status: SaveStatus) => void;
  assembly: EditorRuntimeAssembly;
}) {
  useRenderDiagnostic('VideoEditorProvider');
  const runtime = useVideoEditorRuntime();

  // ── M3: Provider-backed proposal persistence bridge ─────────────────────
  // App-shell strategy: resolved synchronously on first render, without the
  // embed host's async initialize() gate.
  const proposalPersistenceRef = useRef<ProposalPersistenceProvider | null | undefined>(undefined);
  if (proposalPersistenceRef.current === undefined) {
    const svc = runtime.provider.createExtensionPersistenceService?.({
      userId: runtime.auth.userId,
      timelineId: runtime.timelineId,
    }, []);
    proposalPersistenceRef.current = svc?.capabilities.proposals
      ? createProposalPersistenceBridge(svc)
      : null;
  }

  const sync = useEditorRuntimeSync({
    assembly,
    projectId: runtime.project.projectId,
    catalogUserId: runtime.auth.userId,
    effectsQueryEnabled: !effectCatalog,
    effectCatalog,
    sequenceComponentCatalog,
    proposalPersistenceProvider: proposalPersistenceRef.current,
    eagerProposalRetry: true,
  });
  const { store, editor, chrome } = sync;

  useEffect(() => {
    onSaveStatusChange?.(chrome.saveStatus);
  }, [chrome.saveStatus, onSaveStatusChange]);

  const [searchParams, setSearchParams] = useSearchParams();
  const pendingAddGenerationId = searchParams.get(ADD_GENERATION_QUERY_PARAM);
  const consumedAddGenerationRef = useRef<string | null>(null);

  const drainedStagedRef = useRef(false);
  const drainInFlightRef = useRef(false);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (editor.isLoading) return;
    if (drainInFlightRef.current) return;

    const queue: string[] = [];
    if (pendingAddGenerationId && consumedAddGenerationRef.current !== pendingAddGenerationId) {
      consumedAddGenerationRef.current = pendingAddGenerationId;
      queue.push(pendingAddGenerationId);
    }
    if (!drainedStagedRef.current) {
      drainedStagedRef.current = true;
      for (const id of readPendingAdds()) {
        if (!queue.includes(id)) queue.push(id);
      }
    }
    if (queue.length === 0) return;

    drainInFlightRef.current = true;

    void (async () => {
      const processed: string[] = [];
      try {
        for (const generationId of queue) {
          const generation = await runtime.mediaLightbox.loadGenerationForLightbox(generationId);
          if (!generation) {
            runtime.toast.error('Could not load asset');
            processed.push(generationId);
            continue;
          }
          const registrationPlan = planGenerationAssetRegistration({
            generationId: generation.id,
            variantType: generation.type === 'video' ? 'video' : 'image',
            imageUrl: generation.location ?? generation.imageUrl ?? '',
            thumbUrl: generation.thumbUrl ?? generation.imageUrl ?? generation.location ?? '',
          });
          if (!registrationPlan.ok) {
            runtime.toast.error('Could not register asset');
            processed.push(generationId);
            continue;
          }
          const currentOps = store.getState().ops;
          const { assetKey, persistPromise } = executeGenerationAssetRegistrationPlan({
            plan: registrationPlan,
            patchRegistry: currentOps.patchRegistry,
            registerAsset: currentOps.registerAsset,
          });
          void persistPromise.catch((error) => {
            console.error('[video-editor] Failed to persist staged add asset:', error);
            store.getState().ops.unpatchRegistry(assetKey);
            runtime.toast.error('Failed to save asset');
          });
          // Let registry patch settle before reading resolvedConfig.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const editorForDrop = editorRef.current;
          const clips = editorForDrop.resolvedConfig?.clips ?? [];
          const timelineEnd = clips.reduce(
            (max, clip) => Math.max(max, clip.at + getClipTimelineDuration(clip)),
            0,
          );
          editorForDrop.handleAssetDrop(assetKey, undefined, timelineEnd, false, false);
          processed.push(generationId);
          // Allow React to commit the clip before the next iteration reads clips.
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        const remaining = readPendingAdds().filter((id) => !processed.includes(id));
        writePendingAdds(remaining);
        if (pendingAddGenerationId && processed.includes(pendingAddGenerationId)) {
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete(ADD_GENERATION_QUERY_PARAM);
            return next;
          }, { replace: true });
        }
        drainInFlightRef.current = false;
      }
    })();
  }, [editor.isLoading, pendingAddGenerationId, runtime.mediaLightbox, runtime.toast, setSearchParams, store]);

  const [lightboxAssetKey, setLightboxAssetKey] = useState<string | null>(null);
  const [lightboxClipId, setLightboxClipId] = useState<string | null>(null);
  const lightboxAsset = lightboxAssetKey ? editor.resolvedConfig?.registry[lightboxAssetKey] : undefined;
  const lightboxFallbackMedia = useMemo(
    () => buildVideoEditorLightboxMedia(lightboxAssetKey, lightboxAsset),
    [lightboxAsset, lightboxAssetKey],
  );
  const lightboxGenerationId = lightboxAsset?.generationId ?? null;
  const lightboxQuery = useQuery({
    queryKey: ['video-editor', 'lightbox', lightboxGenerationId],
    queryFn: () => runtime.mediaLightbox.loadGenerationForLightbox(lightboxGenerationId as string),
    enabled: Boolean(lightboxGenerationId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (
      !lightboxAssetKey
      || !lightboxGenerationId
      || lightboxQuery.isLoading
      || lightboxQuery.data
      || lightboxFallbackMedia
    ) {
      return;
    }

    log('[video-editor] lightbox query returned no data; clearing asset key', {
      assetKey: lightboxAssetKey,
      clipId: lightboxClipId,
      generationId: lightboxGenerationId,
    });
    setLightboxAssetKey(null);
    setLightboxClipId(null);
  }, [lightboxAssetKey, lightboxClipId, lightboxFallbackMedia, lightboxGenerationId, lightboxQuery.data, lightboxQuery.isLoading]);

  const navResult = useVideoEditorLightboxNavigation({
    lightboxAssetKey,
    lightboxClipId,
    data: editor.data,
    shots: runtime.shots.shots,
    setLightboxAssetKey,
    setLightboxClipId,
  });

  const onDoubleClickAsset = useCallback((assetKey: string, clipId?: string) => {
    const asset = editor.resolvedConfig?.registry[assetKey];
    log('[video-editor] onDoubleClickAsset', {
      assetKey,
      clipId: clipId ?? null,
      hasAsset: Boolean(asset),
      generationId: asset?.generationId ?? null,
      file: asset?.file ?? null,
      type: asset?.type ?? null,
    });
    if (!buildVideoEditorLightboxMedia(assetKey, asset)) {
      return;
    }

    setLightboxClipId(clipId ?? null);
    setLightboxAssetKey(assetKey);
  }, [editor.resolvedConfig]);

  useEffect(() => {
    if (!lightboxAssetKey) {
      return;
    }

    log('[video-editor] lightbox state', {
      assetKey: lightboxAssetKey,
      clipId: lightboxClipId,
      generationId: lightboxGenerationId,
      isLoading: lightboxQuery.isLoading,
      hasData: Boolean(lightboxQuery.data),
      hasFallbackMedia: Boolean(lightboxFallbackMedia),
      mediaId: lightboxQuery.data?.id ?? null,
      mediaType: lightboxQuery.data?.type ?? null,
      mediaLocation: lightboxQuery.data?.location ?? null,
    });
  }, [lightboxAssetKey, lightboxClipId, lightboxFallbackMedia, lightboxGenerationId, lightboxQuery.data, lightboxQuery.isLoading]);

  const onActionResizeStart: TimelineActionResizeStart = editor.onActionResizeStart;
  const onClipEdgeResizeEnd: TimelineClipEdgeResizeEnd = editor.onClipEdgeResizeEnd;

  const editorOps = useMemo<TimelineEditorOpsContextValue>(() => ({
    setInputModality: editor.setInputModality,
    setInputModalityFromPointerType: editor.setInputModalityFromPointerType,
    setInteractionMode: editor.setInteractionMode,
    setGestureOwner: editor.setGestureOwner,
    setPrecisionEnabled: editor.setPrecisionEnabled,
    setContextTarget: editor.setContextTarget,
    setInspectorTarget: editor.setInspectorTarget,
    isClipSelected: editor.isClipSelected,
    selectClip: editor.selectClip,
    selectClips: editor.selectClips,
    addToSelection: editor.addToSelection,
    clearSelection: editor.clearSelection,
    setSelectedTrackId: editor.setSelectedTrackId,
    setActiveClipTab: editor.setActiveClipTab,
    setAssetPanelState: editor.setAssetPanelState,
    registerGenerationAsset: editor.registerGenerationAsset,
    onCursorDrag: editor.onCursorDrag,
    onClickTimeArea: editor.onClickTimeArea,
    onActionResizeStart,
    onClipEdgeResizeEnd,
    onOverlayChange: editor.onOverlayChange,
    onTimelineDragOver: editor.onTimelineDragOver,
    onTimelineDragLeave: editor.onTimelineDragLeave,
    onTimelineDrop: editor.onTimelineDrop,
    handleAssetDrop: editor.handleAssetDrop,
    handleUpdateClips: editor.handleUpdateClips,
    handleUpdateClipsDeep: editor.handleUpdateClipsDeep,
    handleDeleteClips: editor.handleDeleteClips,
    handleDeleteClip: editor.handleDeleteClip,
    handleSelectedClipChange: editor.handleSelectedClipChange,
    handleResetClipPosition: editor.handleResetClipPosition,
    handleResetClipsPosition: editor.handleResetClipsPosition,
    handleSplitSelectedClip: editor.handleSplitSelectedClip,
    handleSplitClipAtTime: editor.handleSplitClipAtTime,
    handleSplitClipsAtPlayhead: editor.handleSplitClipsAtPlayhead,
    handleToggleMuteClips: editor.handleToggleMuteClips,
    handleToggleMute: editor.handleToggleMute,
    handleDetachAudioClip: editor.handleDetachAudioClip,
    handleTrackPopoverChange: editor.handleTrackPopoverChange,
    handleMoveTrack: editor.handleMoveTrack,
    handleRemoveTrack: editor.handleRemoveTrack,
    moveSelectedClipToTrack: editor.moveSelectedClipToTrack,
    moveSelectedClipsToTrack: editor.moveSelectedClipsToTrack,
    moveClipToRow: editor.moveClipToRow,
    createTrackAndMoveClip: editor.createTrackAndMoveClip,
    uploadFiles: editor.uploadFiles,
    applyEdit: editor.applyEdit,
    patchRegistry: editor.patchRegistry,
    unpatchRegistry: editor.unpatchRegistry,
    registerAsset: editor.registerAsset,
    onDoubleClickAsset,
    setLightboxAssetKey,
  }), [editor, onActionResizeStart, onClipEdgeResizeEnd, onDoubleClickAsset, setLightboxAssetKey]);

  useLayoutEffect(() => {
    store.getState().syncOpsSlice(editorOps);
  }, [editorOps, store]);

  const resolvedLightboxMedia = lightboxQuery.data ?? lightboxFallbackMedia;
  const lightboxOnClose = useCallback(() => {
    setLightboxAssetKey(null);
    setLightboxClipId(null);
  }, []);
  const lightboxInitialVariantId =
    lightboxAsset?.variantId ?? resolvedLightboxMedia?.primary_variant_id ?? undefined;
  const lightboxFeatures = useMemo(
    () => ({ showDownload: true, showTaskDetails: true }),
    [],
  );

  return (
    <EditorRuntimeScaffold assembly={assembly} sync={sync}>
      <AgentChatBridgeRegistration />
      {children}
      {lightboxAssetKey && resolvedLightboxMedia && (
        <>
          <runtime.mediaLightbox.Lightbox
            media={resolvedLightboxMedia}
            navigation={navResult.navigation}
            initialVariantId={lightboxInitialVariantId}
            onClose={lightboxOnClose}
            features={lightboxFeatures}
          />
          {navResult.indicator ? <VideoEditorLightboxOverlay indicator={navResult.indicator} /> : null}
        </>
      )}
    </EditorRuntimeScaffold>
  );
}

export interface VideoEditorProviderProps {
  dataProvider: DataProvider;
  projectId: string | null;
  timelineId: string;
  timelineName?: string | null;
  userId: string;
  effectCatalog?: VideoEditorEffectCatalog | null;
  sequenceComponentCatalog?: VideoEditorSequenceComponentCatalog | null;
  onSaveStatusChange?: (status: SaveStatus) => void;
  extensions?: readonly ReighExtension[];
  /** Package-state inventory entries propagated from the loader (M5). */
  packageStateEntries?: readonly import('@/tools/video-editor/runtime/extensionSurface').PackageStateInventoryEntry[];
  /** M6b: Host-provided process manager override. When absent, a default
   *  ProcessManager is created from the extension runtime's declared process
   *  specs. */
  processManager?: ProcessManager;
  children: React.ReactNode;
}

export function VideoEditorProvider({
  dataProvider,
  projectId,
  timelineId,
  timelineName,
  userId,
  effectCatalog,
  sequenceComponentCatalog,
  onSaveStatusChange,
  extensions,
  packageStateEntries,
  processManager: hostProcessManager,
  children,
}: VideoEditorProviderProps) {
  const shotsHost = useReighShotsHost(projectId);
  const agentChatRegistry = useAgentChatRegistry();

  const assembly = useEditorRuntimeAssembly({
    extensions,
    packageStateEntries,
    hostProcessManager,
    // App-shell feedback channel: registry violations surface as toasts.
    commandRegistryCallbacks: {
      onCommandFailure: (commandId, error, extensionId) => {
        const msg = `Command "${commandId}" failed (${extensionId}): ${error.message}`;
        toast.error(msg);
      },
      onReservedCommand: (commandId, extensionId) => {
        toast.warning(`Reserved command "${commandId}" rejected for extension "${extensionId}".`);
      },
      onReservedKeybinding: (key, extensionId, commandId) => {
        toast.warning(`Reserved keybinding "${key}" for "${commandId}" rejected for extension "${extensionId}".`);
      },
      onDuplicateCommand: (commandId, originalExtension, conflictingExtension) => {
        toast.warning(`Command "${commandId}" already registered by "${originalExtension}". Extension "${conflictingExtension}" cannot override it.`);
      },
      onKeybindingConflict: (key, originalExtension, conflictingExtension) => {
        toast.warning(`Keybinding "${key}" already bound by "${originalExtension}". Extension "${conflictingExtension}" cannot override it.`);
      },
      onContextMenuStaleTarget: (commandId, extensionId, reason) => {
        toast.warning(`Command "${commandId}" was not run for extension "${extensionId}".`, { description: reason });
      },
    },
  });

  const runtimeValue = useMemo(() => ({
    provider: dataProvider,
    assetResolver: {
      resolveAssetUrl: dataProvider.resolveAssetUrl.bind(dataProvider),
    },
    auth: {
      userId,
    },
    project: {
      projectId,
    },
    shots: shotsHost,
    mediaLightbox: {
      Lightbox: MediaLightbox,
      loadGenerationForLightbox,
    },
    agentChat: {
      registerTimeline: agentChatRegistry.register,
      unregisterTimeline: agentChatRegistry.unregister,
    },
    toast: {
      error: toast.error,
      success: toast.success,
      warning: toast.warning,
      info: toast.info,
    },
    telemetry: {
      log: (...args: unknown[]) => console.log(...args),
      warn: (...args: unknown[]) => console.warn(...args),
      error: (...args: unknown[]) => console.error(...args),
    },
    timelineId,
    timelineName,
    userId,
    extensions: assembly.resolvedExtensionsConfig,
    extensionRuntime: assembly.extensionRuntime,
    commandRegistry: assembly.commandRegistryRef.current ?? undefined,
    agentToolRegistry: assembly.agentToolRegistryRef.current ?? undefined,
    diagnosticCollection: assembly.diagnosticCollectionRef.current ?? undefined,
    getRecoveryKey: assembly.getRecoveryKey,
    incrementRecoveryKey: assembly.incrementRecoveryKey,
    processManager: assembly.processManagerRef.current ?? undefined,
    processStatuses: assembly.processStatuses,
    processResultAttachRecords: assembly.processResultAttachRecords.length > 0
      ? assembly.processResultAttachRecords
      : undefined,
    recordProcessResultAttach: assembly.recordProcessResultAttach,
  }), [agentChatRegistry.register, agentChatRegistry.unregister, dataProvider, projectId, shotsHost, timelineId, timelineName, userId, assembly.resolvedExtensionsConfig, assembly.extensionRuntime, assembly.processResultAttachRecords, assembly.processStatuses, assembly.recordProcessResultAttach, assembly.getRecoveryKey, assembly.incrementRecoveryKey]);

  return (
    <VideoEditorRuntimeProvider value={runtimeValue}>
      <InnerProvider
        effectCatalog={effectCatalog}
        sequenceComponentCatalog={sequenceComponentCatalog}
        onSaveStatusChange={onSaveStatusChange}
        assembly={assembly}
      >
        {children}
      </InnerProvider>
    </VideoEditorRuntimeProvider>
  );
}
