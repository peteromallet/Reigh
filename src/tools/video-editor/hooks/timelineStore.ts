// Layer map & invariants: docs/structure_detail/tool_video_editor.md
/**
 * Internal bridge between the app shell and editor state contexts.
 * Not part of the supported public SDK surface.
 */
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type MutableRefObject,
  type PropsWithChildren,
  type RefObject,
} from 'react';
import { shallow } from 'zustand/shallow';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { defaultPreferences, type EditorPreferences } from '@/tools/video-editor/hooks/useEditorPreferences.ts';
import type {
  TimelineChromeContextValue,
  TimelineEditorDataContextValue,
  TimelineEditorOpsContextValue,
  TimelinePlaybackContextValue,
} from '@/tools/video-editor/hooks/useTimelineState.types.ts';
import { createInteractionState } from '@/tools/video-editor/lib/interaction-state.ts';
import {
  createMobileInteractionPolicy,
  resolveInputModalityFromPointerType,
} from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import type { DropPosition } from '@/tools/video-editor/lib/drop-position.ts';
import type { TimelineCanvasHandle } from '@/tools/video-editor/types/timeline-canvas.ts';
import type { PreviewHandle } from '@/tools/video-editor/components/PreviewPanel/RemotionPreview.tsx';
import type { TimelineOps } from '@/sdk/index';
import type { ManagedObjectGuard } from '@/tools/video-editor/lib/managed-object-guard';
import type { ProposalRuntime, ProposalImportDiagnostic } from '@/sdk/index';

export interface TimelineAvailabilityState {
  mounted: boolean;
}

export const UNMOUNTED_TIMELINE_AVAILABILITY: TimelineAvailabilityState = Object.freeze({ mounted: false });
export const MOUNTED_TIMELINE_AVAILABILITY: TimelineAvailabilityState = Object.freeze({ mounted: true });

export function hasMountedTimelineAvailability(
  availability: Pick<TimelineAvailabilityState, 'mounted'> & { hasProvider?: boolean },
): boolean {
  return availability.mounted && availability.hasProvider !== false;
}

function getTimelineAvailabilityState(mounted: boolean): TimelineAvailabilityState {
  return mounted ? MOUNTED_TIMELINE_AVAILABILITY : UNMOUNTED_TIMELINE_AVAILABILITY;
}

export interface TimelineStoreBootstrap {
  data: TimelineEditorDataContextValue;
  ops: TimelineEditorOpsContextValue;
  chrome: TimelineChromeContextValue;
  playback: TimelinePlaybackContextValue;
  timelineOps?: TimelineOps | null;
  managedObjectGuard?: ManagedObjectGuard | null;
  proposalRuntime?: ProposalRuntime | null;
}

export interface TimelineMutableAdapters {
  dataRef: TimelineEditorDataContextValue['dataRef'];
  pendingOpsRef: TimelineEditorDataContextValue['pendingOpsRef'];
  interactionStateRef: TimelineEditorDataContextValue['interactionStateRef'];
  selectedClipIdsRef: TimelineEditorDataContextValue['selectedClipIdsRef'];
  additiveSelectionRef: TimelineEditorDataContextValue['additiveSelectionRef'];
  timelineRef: TimelineEditorDataContextValue['timelineRef'];
  timelineWrapperRef: TimelineEditorDataContextValue['timelineWrapperRef'];
  previewRef: TimelinePlaybackContextValue['previewRef'];
  playerContainerRef: TimelinePlaybackContextValue['playerContainerRef'];
  ops: TimelineEditorOpsContextValue;
}

export interface ProposalImportDiagnosticsState {
  imported: number;
  skipped: number;
  rejected: number;
  diagnostics: readonly ProposalImportDiagnostic[];
  timestamp: number;
}

export interface TimelineStoreState extends TimelineStoreBootstrap {
  availability: TimelineAvailabilityState;
  timelineOps: TimelineOps | null;
  proposalRuntime: ProposalRuntime | null;
  managedObjectGuard: ManagedObjectGuard | null;
  proposalImportDiagnostics: ProposalImportDiagnosticsState | null;
  setMounted: (mounted: boolean) => void;
  syncDataSlice: (data: TimelineEditorDataContextValue) => void;
  syncOpsSlice: (ops: TimelineEditorOpsContextValue) => void;
  syncChromeSlice: (chrome: TimelineChromeContextValue) => void;
  syncPlaybackSlice: (playback: TimelinePlaybackContextValue) => void;
  syncSlices: (bootstrap: Partial<TimelineStoreBootstrap>) => void;
  resetSlices: () => void;
  setProposalImportDiagnostics: (diagnostics: ProposalImportDiagnosticsState | null) => void;
}

export type TimelineStoreApi = StoreApi<TimelineStoreState>;

const initialInteractionPolicy = createMobileInteractionPolicy('desktop');
const emptyDropPosition: DropPosition = {
  time: 0,
  rowIndex: 0,
  trackId: undefined,
  trackKind: null,
  trackName: '',
  isNewTrack: false,
  isReject: false,
  newTrackKind: null,
  screenCoords: {
    rowTop: 0,
    rowLeft: 0,
    rowWidth: 0,
    rowHeight: 0,
    clipLeft: 0,
    clipWidth: 0,
    ghostCenter: 0,
  },
};

const noop = (): void => {};
const noopAsync = async (): Promise<void> => {};
const clonePreferences = (): EditorPreferences => ({
  ...defaultPreferences,
  assetPanel: {
    ...defaultPreferences.assetPanel,
    hidden: [...defaultPreferences.assetPanel.hidden],
  },
});

function createMutableRef<T>(value: T): MutableRefObject<T> {
  return { current: value };
}

function createNullableRef<T>(): RefObject<T> {
  return { current: null };
}

function createInitialDataSlice(): TimelineEditorDataContextValue {
  const selectedClipIds = new Set<string>();
  const selectedClipIdsRef = createMutableRef(new Set<string>());
  const additiveSelectionRef = createMutableRef(false);
  const dataRef = createMutableRef<TimelineEditorDataContextValue['data']>(null);
  const pendingOpsRef = createMutableRef(0);
  const interactionStateRef = createMutableRef(createInteractionState());
  const editAreaRef = createMutableRef<HTMLElement | null>(null);

  return {
    data: null,
    resolvedConfig: null,
    deviceClass: initialInteractionPolicy.deviceClass,
    inputModality: initialInteractionPolicy.inputModality,
    interactionMode: initialInteractionPolicy.interactionMode,
    gestureOwner: initialInteractionPolicy.gestureOwner,
    precisionEnabled: initialInteractionPolicy.precisionEnabled,
    contextTarget: initialInteractionPolicy.contextTarget,
    inspectorTarget: initialInteractionPolicy.inspectorTarget,
    interactionPolicy: initialInteractionPolicy,
    selectedClipId: null,
    selectedClipIds,
    selectedClipIdsRef,
    additiveSelectionRef,
    selectedTrackId: null,
    primaryClipId: null,
    selectedClip: null,
    selectedTrack: null,
    selectedClipHasPredecessor: false,
    compositionSize: { width: 0, height: 0 },
    trackScaleMap: {},
    scale: 5,
    scaleWidth: defaultPreferences.scaleWidth,
    isLoading: false,
    dataRef,
    pendingOpsRef,
    interactionStateRef,
    coordinator: {
      update: () => emptyDropPosition,
      showSecondaryGhosts: noop,
      end: noop,
      lastPosition: null,
      editAreaRef,
    },
    indicatorRef: createMutableRef(null),
    editAreaRef,
    preferences: clonePreferences(),
    timelineRef: createNullableRef<TimelineCanvasHandle>(),
    timelineWrapperRef: createNullableRef<HTMLDivElement>(),
  };
}

/**
 * Every op in the pre-sync slice throws, matching `commands.validate/dryRun/apply`.
 *
 * `useTimelineState` seeds the store during render, before descendants mount, so
 * no mounted consumer can reach these. A caller that does reach one is rendering
 * outside the editor — a missing provider, which CLAUDE.md's context-hook rule
 * requires to crash loudly rather than hide behind a no-op setter.
 */
const opsUnavailable = (method: string): (() => never) => () => {
  throw new Error(
    `Timeline ops accessed before store sync (${method}). Either this component rendered outside `
    + `<TimelineStoreProvider> / the editor subtree, or it should use the matching *Safe hook variant `
    + `(e.g. useTimelineOpsSliceSafe) and handle null.`,
  );
};

function createInitialOpsSlice(): TimelineEditorOpsContextValue {
  const setInputModality: TimelineEditorOpsContextValue['setInputModality'] = opsUnavailable('setInputModality');
  const setInteractionMode: TimelineEditorOpsContextValue['setInteractionMode'] = opsUnavailable('setInteractionMode');
  const setGestureOwner: TimelineEditorOpsContextValue['setGestureOwner'] = opsUnavailable('setGestureOwner');
  const setPrecisionEnabled: TimelineEditorOpsContextValue['setPrecisionEnabled'] = opsUnavailable('setPrecisionEnabled');
  const setContextTarget: TimelineEditorOpsContextValue['setContextTarget'] = opsUnavailable('setContextTarget');
  const setInspectorTarget: TimelineEditorOpsContextValue['setInspectorTarget'] = opsUnavailable('setInspectorTarget');
  const setSelectedTrackId: TimelineEditorOpsContextValue['setSelectedTrackId'] = opsUnavailable('setSelectedTrackId');
  const selectClip: TimelineEditorOpsContextValue['selectClip'] = opsUnavailable('selectClip');
  const selectClips: TimelineEditorOpsContextValue['selectClips'] = opsUnavailable('selectClips');
  const addToSelection: TimelineEditorOpsContextValue['addToSelection'] = opsUnavailable('addToSelection');
  const clearSelection: TimelineEditorOpsContextValue['clearSelection'] = opsUnavailable('clearSelection');
  const setActiveClipTab: TimelineEditorOpsContextValue['setActiveClipTab'] = opsUnavailable('setActiveClipTab');
  const setAssetPanelState: TimelineEditorOpsContextValue['setAssetPanelState'] = opsUnavailable('setAssetPanelState');
  const registerGenerationAsset: TimelineEditorOpsContextValue['registerGenerationAsset'] = opsUnavailable('registerGenerationAsset');
  const onCursorDrag: TimelineEditorOpsContextValue['onCursorDrag'] = opsUnavailable('onCursorDrag');
  const onClickTimeArea: TimelineEditorOpsContextValue['onClickTimeArea'] = opsUnavailable('onClickTimeArea');
  const onActionResizeStart: TimelineEditorOpsContextValue['onActionResizeStart'] = opsUnavailable('onActionResizeStart');
  const onClipEdgeResizeEnd: TimelineEditorOpsContextValue['onClipEdgeResizeEnd'] = opsUnavailable('onClipEdgeResizeEnd');
  const onOverlayChange: TimelineEditorOpsContextValue['onOverlayChange'] = opsUnavailable('onOverlayChange');
  const onTimelineDragOver: TimelineEditorOpsContextValue['onTimelineDragOver'] = opsUnavailable('onTimelineDragOver');
  const onTimelineDragLeave: TimelineEditorOpsContextValue['onTimelineDragLeave'] = opsUnavailable('onTimelineDragLeave');
  const onTimelineDrop: TimelineEditorOpsContextValue['onTimelineDrop'] = opsUnavailable('onTimelineDrop');
  const handleAssetDrop: TimelineEditorOpsContextValue['handleAssetDrop'] = opsUnavailable('handleAssetDrop');
  const handleUpdateClips: TimelineEditorOpsContextValue['handleUpdateClips'] = opsUnavailable('handleUpdateClips');
  const handleUpdateClipsDeep: TimelineEditorOpsContextValue['handleUpdateClipsDeep'] = opsUnavailable('handleUpdateClipsDeep');
  const handleDeleteClips: TimelineEditorOpsContextValue['handleDeleteClips'] = opsUnavailable('handleDeleteClips');
  const handleDeleteClip: TimelineEditorOpsContextValue['handleDeleteClip'] = opsUnavailable('handleDeleteClip');
  const handleSelectedClipChange: TimelineEditorOpsContextValue['handleSelectedClipChange'] = opsUnavailable('handleSelectedClipChange');
  const handleResetClipPosition: TimelineEditorOpsContextValue['handleResetClipPosition'] = opsUnavailable('handleResetClipPosition');
  const handleResetClipsPosition: TimelineEditorOpsContextValue['handleResetClipsPosition'] = opsUnavailable('handleResetClipsPosition');
  const handleSplitSelectedClip: TimelineEditorOpsContextValue['handleSplitSelectedClip'] = opsUnavailable('handleSplitSelectedClip');
  const handleSplitClipAtTime: TimelineEditorOpsContextValue['handleSplitClipAtTime'] = opsUnavailable('handleSplitClipAtTime');
  const handleSplitClipsAtPlayhead: TimelineEditorOpsContextValue['handleSplitClipsAtPlayhead'] = opsUnavailable('handleSplitClipsAtPlayhead');
  const handleToggleMuteClips: TimelineEditorOpsContextValue['handleToggleMuteClips'] = opsUnavailable('handleToggleMuteClips');
  const handleToggleMute: TimelineEditorOpsContextValue['handleToggleMute'] = opsUnavailable('handleToggleMute');
  const handleDetachAudioClip: TimelineEditorOpsContextValue['handleDetachAudioClip'] = opsUnavailable('handleDetachAudioClip');
  const handleTrackPopoverChange: TimelineEditorOpsContextValue['handleTrackPopoverChange'] = opsUnavailable('handleTrackPopoverChange');
  const handleMoveTrack: TimelineEditorOpsContextValue['handleMoveTrack'] = opsUnavailable('handleMoveTrack');
  const handleRemoveTrack: TimelineEditorOpsContextValue['handleRemoveTrack'] = opsUnavailable('handleRemoveTrack');
  const moveSelectedClipToTrack: TimelineEditorOpsContextValue['moveSelectedClipToTrack'] = opsUnavailable('moveSelectedClipToTrack');
  const moveSelectedClipsToTrack: TimelineEditorOpsContextValue['moveSelectedClipsToTrack'] = opsUnavailable('moveSelectedClipsToTrack');
  const moveClipToRow: TimelineEditorOpsContextValue['moveClipToRow'] = opsUnavailable('moveClipToRow');
  const createTrackAndMoveClip: TimelineEditorOpsContextValue['createTrackAndMoveClip'] = opsUnavailable('createTrackAndMoveClip');
  const uploadFiles: TimelineEditorOpsContextValue['uploadFiles'] = opsUnavailable('uploadFiles');
  const applyEdit: TimelineEditorOpsContextValue['applyEdit'] = opsUnavailable('applyEdit');
  const commands: TimelineEditorOpsContextValue['commands'] = {
    buildAddMediaCommand: () => null,
    buildSwapCommand: () => null,
    validate: () => {
      throw new Error('Timeline commands are unavailable before the editor is mounted.');
    },
    dryRun: () => {
      throw new Error('Timeline commands are unavailable before the editor is mounted.');
    },
    apply: () => {
      throw new Error('Timeline commands are unavailable before the editor is mounted.');
    },
  };
  const patchRegistry: TimelineEditorOpsContextValue['patchRegistry'] = opsUnavailable('patchRegistry');
  const unpatchRegistry: TimelineEditorOpsContextValue['unpatchRegistry'] = opsUnavailable('unpatchRegistry');
  const registerAsset: TimelineEditorOpsContextValue['registerAsset'] = opsUnavailable('registerAsset');

  return {
    setInputModality,
    setInputModalityFromPointerType: resolveInputModalityFromPointerType,
    setInteractionMode,
    setGestureOwner,
    setPrecisionEnabled,
    setContextTarget,
    setInspectorTarget,
    isClipSelected: opsUnavailable('isClipSelected'),
    selectClip,
    selectClips,
    addToSelection,
    clearSelection,
    setSelectedTrackId,
    setActiveClipTab,
    setAssetPanelState,
    registerGenerationAsset,
    onCursorDrag,
    onClickTimeArea,
    onActionResizeStart,
    onClipEdgeResizeEnd,
    onOverlayChange,
    onTimelineDragOver,
    onTimelineDragLeave,
    onTimelineDrop,
    handleAssetDrop,
    handleUpdateClips,
    handleUpdateClipsDeep,
    handleDeleteClips,
    handleDeleteClip,
    handleSelectedClipChange,
    handleResetClipPosition,
    handleResetClipsPosition,
    handleSplitSelectedClip,
    handleSplitClipAtTime,
    handleSplitClipsAtPlayhead,
    handleToggleMuteClips,
    handleToggleMute,
    handleDetachAudioClip,
    handleTrackPopoverChange,
    handleMoveTrack,
    handleRemoveTrack,
    moveSelectedClipToTrack,
    moveSelectedClipsToTrack,
    moveClipToRow,
    createTrackAndMoveClip,
    uploadFiles,
    applyEdit,
    commands,
    patchRegistry,
    unpatchRegistry,
    registerAsset,
  };
}

function createInitialChromeSlice(): TimelineChromeContextValue {
  return {
    timelineName: null,
    saveStatus: 'saved',
    isConflictExhausted: false,
    renderStatus: 'idle',
    renderLog: '',
    renderDirty: false,
    renderProgress: null,
    queuedRender: null,
    renderResultUrl: null,
    renderResultFilename: null,
    renderRequest: {
      timelineId: '',
      assetRegistry: null,
      resolvedConfig: null,
      renderMetadata: null,
      renderRuntime: {
        projectId: '',
        orchestratorBaseUrl: '',
        getSupabaseSession: async () => null,
        getWorkerJwt: async () => null,
      },
    },
    undo: noop,
    redo: noop,
    canUndo: false,
    canRedo: false,
    checkpoints: [],
    jumpToCheckpoint: noop,
    createManualCheckpoint: noopAsync,
    setScaleWidth: noop,
    handleAddTrack: noop,
    handleClearUnusedTracks: noop,
    unusedTrackCount: 0,
    handleAddText: noop,
    handleAddTextAt: noop,
    reloadFromServer: noopAsync,
    retrySaveAfterConflict: noopAsync,
    startRender: noopAsync,
    loadError: null,
    retryLoad: noop,
  };
}

function createInitialPlaybackSlice(): TimelinePlaybackContextValue {
  return {
    currentTime: 0,
    previewRef: createNullableRef<PreviewHandle>(),
    playerContainerRef: createNullableRef<HTMLDivElement>(),
    onPreviewTimeUpdate: noop,
    formatTime: (time) => `${time}`,
  };
}

function createInitialSlices(): TimelineStoreBootstrap {
  return {
    data: createInitialDataSlice(),
    ops: createInitialOpsSlice(),
    chrome: createInitialChromeSlice(),
    playback: createInitialPlaybackSlice(),
    timelineOps: null,
    proposalRuntime: null,
    managedObjectGuard: null,
  };
}

export function createTimelineStore(bootstrap?: Partial<TimelineStoreBootstrap>): TimelineStoreApi {
  const initialSlices = createInitialSlices();
  const seededSlices = {
    data: bootstrap?.data ?? initialSlices.data,
    ops: bootstrap?.ops ?? initialSlices.ops,
    chrome: bootstrap?.chrome ?? initialSlices.chrome,
    playback: bootstrap?.playback ?? initialSlices.playback,
    timelineOps: bootstrap?.timelineOps ?? initialSlices.timelineOps ?? null,
    proposalRuntime: bootstrap?.proposalRuntime ?? initialSlices.proposalRuntime ?? null,
    managedObjectGuard: bootstrap?.managedObjectGuard ?? initialSlices.managedObjectGuard ?? null,
  };
  const initialMounted = bootstrap !== undefined;

  return createStore<TimelineStoreState>((set) => ({
    availability: getTimelineAvailabilityState(initialMounted),
    ...seededSlices,
    proposalImportDiagnostics: null,
    setMounted: (mounted) => {
      set((state) => (
        state.availability.mounted === mounted
          ? state
          : { availability: getTimelineAvailabilityState(mounted) }
      ));
    },
    syncDataSlice: (data) => {
      set((state) => (
        state.data === data && state.availability.mounted
          ? state
          : {
              availability: state.availability.mounted ? state.availability : MOUNTED_TIMELINE_AVAILABILITY,
              data,
            }
      ));
    },
    syncOpsSlice: (ops) => {
      set((state) => (
        state.ops === ops && state.availability.mounted
          ? state
          : {
              availability: state.availability.mounted ? state.availability : MOUNTED_TIMELINE_AVAILABILITY,
              ops,
            }
      ));
    },
    syncChromeSlice: (chrome) => {
      set((state) => (
        state.chrome === chrome && state.availability.mounted
          ? state
          : {
              availability: state.availability.mounted ? state.availability : MOUNTED_TIMELINE_AVAILABILITY,
              chrome,
            }
      ));
    },
    syncPlaybackSlice: (playback) => {
      set((state) => (
        state.playback === playback && state.availability.mounted
          ? state
          : {
              availability: state.availability.mounted ? state.availability : MOUNTED_TIMELINE_AVAILABILITY,
              playback,
            }
      ));
    },
    syncSlices: (bootstrap) => {
      set((state) => {
        const nextData = bootstrap.data ?? state.data;
        const nextOps = bootstrap.ops ?? state.ops;
        const nextChrome = bootstrap.chrome ?? state.chrome;
        const nextPlayback = bootstrap.playback ?? state.playback;
        const nextTimelineOps = 'timelineOps' in bootstrap
          ? (bootstrap.timelineOps ?? null)
          : state.timelineOps;
        const nextProposalRuntime = 'proposalRuntime' in bootstrap
          ? (bootstrap.proposalRuntime ?? null)
          : state.proposalRuntime;
        const nextManagedObjectGuard = 'managedObjectGuard' in bootstrap
          ? (bootstrap.managedObjectGuard ?? null)
          : state.managedObjectGuard;
        const nextMounted = true;

        if (
          state.data === nextData
          && state.ops === nextOps
          && state.chrome === nextChrome
          && state.playback === nextPlayback
          && state.timelineOps === nextTimelineOps
          && state.proposalRuntime === nextProposalRuntime
          && state.managedObjectGuard === nextManagedObjectGuard
          && state.availability.mounted === nextMounted
        ) {
          return state;
        }

        return {
          availability: MOUNTED_TIMELINE_AVAILABILITY,
          data: nextData,
          ops: nextOps,
          chrome: nextChrome,
          playback: nextPlayback,
          timelineOps: nextTimelineOps,
          proposalRuntime: nextProposalRuntime,
          managedObjectGuard: nextManagedObjectGuard,
        };
      });
    },
    setProposalImportDiagnostics: (diagnostics) => {
      set({ proposalImportDiagnostics: diagnostics });
    },
    resetSlices: () => {
      set(() => ({
        availability: UNMOUNTED_TIMELINE_AVAILABILITY,
        ...createInitialSlices(),
        proposalImportDiagnostics: null,
      }));
    },
  }));
}

export function seedTimelineStoreBeforeRender(
  store: TimelineStoreApi,
  bootstrap: TimelineStoreBootstrap,
) {
  const state = store.getState();
  if (state.availability.mounted) {
    return;
  }

  store.getState().syncSlices(bootstrap);
}

const TimelineStoreContext = createContext<TimelineStoreApi | null>(null);
const fallbackTimelineStore = createTimelineStore();

export function TimelineStoreProvider({
  store,
  children,
}: PropsWithChildren<{ store: TimelineStoreApi }>) {
  return createElement(TimelineStoreContext.Provider, { value: store }, children);
}

export function useTimelineStoreApi(): TimelineStoreApi {
  const store = useContext(TimelineStoreContext);
  if (!store) {
    throw new Error('useTimelineStoreApi must be used within TimelineStoreProvider');
  }

  return store;
}

export function useTimelineStoreApiSafe(): TimelineStoreApi | null {
  return useContext(TimelineStoreContext);
}

function useBoundTimelineStore<T>(
  selector: (state: TimelineStoreState) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  return useStoreWithEqualityFn(useTimelineStoreApi(), selector, equalityFn);
}

function useSafeTimelineStoreValue<T>(
  selector: (state: TimelineStoreState) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T | null {
  const providedStore = useTimelineStoreApiSafe();
  const store = providedStore ?? fallbackTimelineStore;
  const mounted = useStoreWithEqualityFn(store, (state) => state.availability.mounted);
  const value = useStoreWithEqualityFn(store, selector, equalityFn);
  // Preserve the mounted-only safe-hook contract: a provider without a mounted
  // editor still behaves like "no editor" for staged add-to-editor callers.
  return providedStore && mounted ? value : null;
}

export function useTimelineAvailabilityState() {
  const providedStore = useTimelineStoreApiSafe();
  const store = providedStore ?? fallbackTimelineStore;
  const mounted = useStoreWithEqualityFn(store, (state) => state.availability.mounted);

  return useMemo(() => ({
    hasProvider: providedStore !== null,
    mounted: providedStore !== null && mounted,
  }), [mounted, providedStore]);
}

export function useTimelineStoreLifecycle() {
  return useBoundTimelineStore((state) => ({
    mounted: state.availability.mounted,
    setMounted: state.setMounted,
    syncDataSlice: state.syncDataSlice,
    syncOpsSlice: state.syncOpsSlice,
    syncChromeSlice: state.syncChromeSlice,
    syncPlaybackSlice: state.syncPlaybackSlice,
    syncSlices: state.syncSlices,
    resetSlices: state.resetSlices,
  }), shallow);
}

// ── Slice hooks ────────────────────────────────────────────────────────────
// `useTimelineState` composes ~15 sub-hooks into four slices and pushes them
// into this store each render; the hooks below are how consumers read them.
// Layer map and the per-slice contents table: docs/structure_detail/tool_video_editor.md §2.
//
// **Safe vs non-Safe.** Non-`Safe` hooks throw when no `TimelineStoreProvider` is
// above them — use them inside the mounted editor subtree. `Safe` variants
// return `null` when there is no provider *or* the editor is not mounted; use
// them only for consumers that legitimately run with no editor open (e.g. an
// "add to editor" affordance elsewhere in the app) and handle the `null`. Per
// CLAUDE.md's context-hook rule, a missing provider is a crash, not a no-op.

/** Read the whole `data` slice: resolved config, clips, refs, zoom, device class, interaction mode. */
export function useTimelineDataSlice(): TimelineEditorDataContextValue {
  return useBoundTimelineStore((state) => state.data, shallow);
}

/** Read one derived value out of the `data` slice; re-renders only when that value changes. */
export function useTimelineDataSelector<T>(
  selector: (data: TimelineEditorDataContextValue) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  return useBoundTimelineStore((state) => selector(state.data), equalityFn);
}

/** `useTimelineDataSlice` for consumers that may render with no editor mounted — returns `null` instead of throwing. */
export function useTimelineDataSliceSafe(): TimelineEditorDataContextValue | null {
  return useSafeTimelineStoreValue((state) => state.data, shallow);
}

/** Read the whole `ops` slice: mutations (`applyEdit`, `moveClipToRow`, …), selection setters, `commands`. */
export function useTimelineOpsSlice(): TimelineEditorOpsContextValue {
  return useBoundTimelineStore((state) => state.ops, shallow);
}

/** Read one op (or derived value) out of the `ops` slice without subscribing to the rest. */
export function useTimelineOpsSelector<T>(
  selector: (ops: TimelineEditorOpsContextValue) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  return useBoundTimelineStore((state) => selector(state.ops), equalityFn);
}

/** `useTimelineOpsSlice` for consumers that may render with no editor mounted — returns `null` instead of throwing. */
export function useTimelineOpsSliceSafe(): TimelineEditorOpsContextValue | null {
  return useSafeTimelineStoreValue((state) => state.ops, shallow);
}

/**
 * The command registry carried on the `ops` slice — this is the *store selector*.
 *
 * A same-named hook lives in `hooks/useTimelineCommands.ts`; that one *builds*
 * the `TimelineCommands` facade from the store. Components rendering inside the
 * editor want **this** one: it is a plain selector with no construction cost.
 * Auto-import picks the wrong one easily — check the import path.
 */
export function useTimelineCommands() {
  return useTimelineOpsSelector((ops) => ops.commands);
}

/** `useTimelineCommands` (store selector) for consumers that may render with no editor mounted. */
export function useTimelineCommandsSafe() {
  return useSafeTimelineStoreValue((state) => state.ops.commands, shallow);
}

/** Read the whole `chrome` slice: panels, zoom setters, shell UI state. */
export function useTimelineChromeSlice(): TimelineChromeContextValue {
  return useBoundTimelineStore((state) => state.chrome, shallow);
}

/** Read one value out of the `chrome` slice without subscribing to the rest. */
export function useTimelineChromeSelector<T>(
  selector: (chrome: TimelineChromeContextValue) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  return useBoundTimelineStore((state) => selector(state.chrome), equalityFn);
}

/** `useTimelineChromeSlice` for consumers that may render with no editor mounted — returns `null` instead of throwing. */
export function useTimelineChromeSliceSafe(): TimelineChromeContextValue | null {
  return useSafeTimelineStoreValue((state) => state.chrome, shallow);
}

/** Read the whole `playback` slice: preview refs and transport. */
export function useTimelinePlaybackSlice(): TimelinePlaybackContextValue {
  return useBoundTimelineStore((state) => state.playback, shallow);
}

/** Read one value out of the `playback` slice without subscribing to the rest. */
export function useTimelinePlaybackSelector<T>(
  selector: (playback: TimelinePlaybackContextValue) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  return useBoundTimelineStore((state) => selector(state.playback), equalityFn);
}

/** `useTimelinePlaybackSlice` for consumers that may render with no editor mounted — returns `null` instead of throwing. */
export function useTimelinePlaybackSliceSafe(): TimelinePlaybackContextValue | null {
  return useSafeTimelineStoreValue((state) => state.playback, shallow);
}

/**
 * Live refs plus the ops object, for gesture code only.
 *
 * The document-level pointer machines (`useClipDrag`, `useClipResizeGesture`,
 * `useMarqueeSelect`) must read *current* values inside listeners that were
 * attached once and must not be re-attached on every state change. That is what
 * these refs are for.
 *
 * **Do not read these during render.** A ref's `.current` is not tracked by
 * React, so a render that depends on it will not re-run when it changes and will
 * paint stale UI. Render from `useTimelineDataSlice` / the selectors instead.
 */
export function useTimelineMutableAdapters() {
  return useBoundTimelineStore<TimelineMutableAdapters>((state) => ({
    dataRef: state.data.dataRef,
    pendingOpsRef: state.data.pendingOpsRef,
    interactionStateRef: state.data.interactionStateRef,
    selectedClipIdsRef: state.data.selectedClipIdsRef,
    additiveSelectionRef: state.data.additiveSelectionRef,
    timelineRef: state.data.timelineRef,
    timelineWrapperRef: state.data.timelineWrapperRef,
    previewRef: state.playback.previewRef,
    playerContainerRef: state.playback.playerContainerRef,
    ops: state.ops,
  }), shallow);
}

/** `useTimelineMutableAdapters` for gesture code that may mount with no editor — returns `null` instead of throwing. */
export function useTimelineMutableAdaptersSafe() {
  return useSafeTimelineStoreValue<TimelineMutableAdapters>((state) => ({
    dataRef: state.data.dataRef,
    pendingOpsRef: state.data.pendingOpsRef,
    interactionStateRef: state.data.interactionStateRef,
    selectedClipIdsRef: state.data.selectedClipIdsRef,
    additiveSelectionRef: state.data.additiveSelectionRef,
    timelineRef: state.data.timelineRef,
    timelineWrapperRef: state.data.timelineWrapperRef,
    previewRef: state.playback.previewRef,
    playerContainerRef: state.playback.playerContainerRef,
    ops: state.ops,
  }), shallow);
}

// ── Aliases ────────────────────────────────────────────────────────────────
// Historical spellings from the pre-store context era, still the majority at
// call sites. Each is the *same function object* as its `*Slice` counterpart —
// identical behavior, so an IDE hover is the only place the pairing is visible.

/** Alias of {@link useTimelineDataSlice}. */
export const useTimelineEditorData = useTimelineDataSlice;
/** Alias of {@link useTimelineDataSliceSafe}. */
export const useTimelineEditorDataSafe = useTimelineDataSliceSafe;
/** Alias of {@link useTimelineOpsSlice}. */
export const useTimelineEditorOps = useTimelineOpsSlice;
/** Alias of {@link useTimelineOpsSliceSafe}. */
export const useTimelineEditorOpsSafe = useTimelineOpsSliceSafe;
/** Alias of {@link useTimelineCommands} (the store selector, not the builder in hooks/useTimelineCommands.ts). */
export const useTimelineCommandsContext = useTimelineCommands;
/** Alias of {@link useTimelineCommandsSafe}. */
export const useTimelineCommandsContextSafe = useTimelineCommandsSafe;
/** Alias of {@link useTimelineChromeSlice}. */
export const useTimelineChromeContext = useTimelineChromeSlice;
/** Alias of {@link useTimelineChromeSliceSafe}. */
export const useTimelineChromeContextSafe = useTimelineChromeSliceSafe;
/** Alias of {@link useTimelinePlaybackSlice}. */
export const useTimelinePlaybackContext = useTimelinePlaybackSlice;
/** Alias of {@link useTimelinePlaybackSliceSafe}. */
export const useTimelinePlaybackContextSafe = useTimelinePlaybackSliceSafe;

export function useTimelineOpsFromStore(): TimelineOps | null {
  return useBoundTimelineStore((state) => state.timelineOps);
}

export function useTimelineOpsFromStoreSafe(): TimelineOps | null {
  return useSafeTimelineStoreValue((state) => state.timelineOps);
}


export function useProposalRuntimeFromStore(): ProposalRuntime | null {
  return useBoundTimelineStore((state) => state.proposalRuntime);
}

export function useProposalRuntimeFromStoreSafe(): ProposalRuntime | null {
  return useSafeTimelineStoreValue((state) => state.proposalRuntime);
}

export function useProposalImportDiagnosticsFromStore(): ProposalImportDiagnosticsState | null {
  return useBoundTimelineStore((state) => state.proposalImportDiagnostics, shallow);
}

export function useProposalImportDiagnosticsFromStoreSafe(): ProposalImportDiagnosticsState | null {
  return useSafeTimelineStoreValue((state) => state.proposalImportDiagnostics, shallow);
}
