import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useRef,
  type MutableRefObject,
  type PropsWithChildren,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { AssetRegistryEntry } from '@tbd/engine';
import type { TrackDefinition } from '@tbd/schema';
import { shallow } from 'zustand/shallow';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AssetResolver, EditorPorts, HostContext } from '../data/ports.js';
import type { RenderProgress, RenderStatus, PreviewHandle, TimelineCanvasHandle } from './render-types.js';
import { createInteractionState, type InteractionStateRef } from '../lib/interaction-state.js';
import type { DataProvider, TimelineCheckpoint } from '../data/DataProvider.js';
import type { TimelineData, TimelineDocument } from '../types.js';
import { parseResolution } from '@tbd/engine';

export type ClipTab = 'effects' | 'timing' | 'position' | 'audio' | 'text';

export interface EditorPreferences {
  scaleWidth: number;
  activeClipTab: ClipTab;
  assetPanel: {
    showAll: boolean;
    showHidden: boolean;
    hidden: string[];
  };
}

export const defaultPreferences: EditorPreferences = {
  scaleWidth: 160,
  activeClipTab: 'effects',
  assetPanel: {
    showAll: false,
    showHidden: false,
    hidden: [],
  },
};

export type TimelineDeviceClass = 'desktop' | 'tablet' | 'phone';
export type TimelineInputModality = 'mouse' | 'touch' | 'pen' | 'keyboard' | 'unknown';
export type TimelineInteractionMode = 'browse' | 'select' | 'move' | 'trim' | 'precision';
export type TimelineGestureOwner = 'none' | 'timeline' | 'ruler' | 'clip' | 'trim' | 'preview' | 'inspector' | 'shell';
export type TimelineInteractionTargetKind = 'clip' | 'track' | 'timeline' | 'selection' | 'preview' | 'overlay' | 'shell';

export interface TimelineInteractionTarget {
  kind: TimelineInteractionTargetKind;
  clipId?: string | null;
  trackId?: string | null;
  clipIds?: string[];
}

export type TimelineContextTarget = TimelineInteractionTarget | null;
export type TimelineInspectorTarget = TimelineInteractionTarget | null;

export interface MobileInteractionPolicy {
  deviceClass: TimelineDeviceClass;
  inputModality: TimelineInputModality;
  interactionMode: TimelineInteractionMode;
  gestureOwner: TimelineGestureOwner;
  precisionEnabled: boolean;
  contextTarget: TimelineContextTarget;
  inspectorTarget: TimelineInspectorTarget;
}

export interface DropPosition {
  time: number;
  rowIndex: number;
  trackId: string | undefined;
  trackKind: TrackDefinition['kind'] | null;
  trackName: string;
  isNewTrack: boolean;
  isNewTrackTop?: boolean;
  isReject: boolean;
  newTrackKind: TrackDefinition['kind'] | null;
  screenCoords: {
    rowTop: number;
    rowLeft: number;
    rowWidth: number;
    rowHeight: number;
    clipLeft: number;
    clipWidth: number;
    ghostCenter: number;
  };
}

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';

export interface TimelineDragCoordinator {
  update: () => DropPosition;
  showSecondaryGhosts: () => void;
  end: () => void;
  lastPosition: DropPosition | null;
  editAreaRef: MutableRefObject<HTMLElement | null>;
}

export interface TimelineRenderRequest {
  generationId: string;
  variantType: 'image' | 'video';
  imageUrl: string;
  thumbUrl?: string;
}

export interface TimelineEditorDataContextValue {
  data: TimelineData | null;
  resolvedConfig: TimelineData['resolvedConfig'] | null;
  deviceClass: MobileInteractionPolicy['deviceClass'];
  inputModality: TimelineInputModality;
  interactionMode: TimelineInteractionMode;
  gestureOwner: TimelineGestureOwner;
  precisionEnabled: boolean;
  contextTarget: TimelineContextTarget;
  inspectorTarget: TimelineInspectorTarget;
  interactionPolicy: MobileInteractionPolicy;
  selectedClipId: string | null;
  selectedClipIds: Set<string>;
  selectedClipIdsRef: MutableRefObject<Set<string>>;
  additiveSelectionRef: MutableRefObject<boolean>;
  selectedTrackId: string | null;
  primaryClipId: string | null;
  selectedClip: TimelineData['resolvedConfig']['clips'][number] | null;
  selectedTrack: TrackDefinition | null;
  selectedClipHasPredecessor: boolean;
  compositionSize: { width: number; height: number };
  trackScaleMap: Record<string, number>;
  scale: number;
  scaleWidth: number;
  isLoading: boolean;
  dataRef: MutableRefObject<TimelineData | null>;
  pendingOpsRef: MutableRefObject<number>;
  interactionStateRef: InteractionStateRef;
  coordinator: TimelineDragCoordinator;
  indicatorRef: MutableRefObject<unknown>;
  editAreaRef: MutableRefObject<HTMLElement | null>;
  preferences: EditorPreferences;
  timelineRef: RefObject<TimelineCanvasHandle | null>;
  timelineWrapperRef: RefObject<HTMLDivElement | null>;
}

export interface TimelineEditorOpsContextValue {
  setInputModality: (inputModality: TimelineInputModality) => void;
  setInputModalityFromPointerType: (pointerType: string | null | undefined) => TimelineInputModality;
  setInteractionMode: (mode: TimelineInteractionMode) => void;
  setGestureOwner: (owner: TimelineGestureOwner) => void;
  setPrecisionEnabled: (enabled: boolean) => void;
  setContextTarget: (target: TimelineContextTarget) => void;
  setInspectorTarget: (target: TimelineInspectorTarget) => void;
  setSelectedClipId: (value: SetStateAction<string | null>) => void;
  isClipSelected: (clipId: string) => boolean;
  selectClip: (clipId: string | null) => void;
  selectClips: (clipIds: Iterable<string>) => void;
  replaceTimelineSelection: (clipIds: Iterable<string>) => void;
  addToSelection: (clipId: string) => void;
  clearSelection: () => void;
  setSelectedTrackId: (value: SetStateAction<string | null>) => void;
  setActiveClipTab: (tab: ClipTab) => void;
  setAssetPanelState: (patch: Partial<EditorPreferences['assetPanel']>) => void;
  registerGenerationAsset: (request: TimelineRenderRequest) => string | null;
  onCursorDrag: (time: number) => void;
  onClickTimeArea: (time: number) => void;
  onActionResizeStart: () => void;
  onClipEdgeResizeEnd: () => void;
  onOverlayChange: () => void;
  onTimelineDragOver: () => void;
  onTimelineDragLeave: () => void;
  onTimelineDrop: () => Promise<void>;
  handleAssetDrop: (
    assetKey: string,
    trackId?: string,
    time?: number,
    selectInsertedClip?: boolean,
    commitImmediately?: boolean,
  ) => void;
  handleUpdateClips: () => void;
  handleUpdateClipsDeep: () => void;
  handleDeleteClips: () => void;
  handleDeleteClip: () => void;
  handleSelectedClipChange: () => void;
  handleResetClipPosition: () => void;
  handleResetClipsPosition: () => void;
  handleSplitSelectedClip: () => void;
  handleSplitClipAtTime: () => void;
  handleSplitClipsAtPlayhead: () => void;
  handleToggleMuteClips: () => void;
  handleToggleMute: () => void;
  handleDetachAudioClip: () => void;
  handleTrackPopoverChange: () => void;
  handleMoveTrack: () => void;
  handleRemoveTrack: () => void;
  moveSelectedClipToTrack: () => void;
  moveSelectedClipsToTrack: () => void;
  moveClipToRow: () => void;
  createTrackAndMoveClip: () => void;
  uploadFiles: (files: File[] | FileList) => Promise<void>;
  applyEdit: () => void;
  patchRegistry: (assetId: string, entry: AssetRegistryEntry) => void;
  unpatchRegistry: (assetId: string) => void;
  registerAsset: (assetId: string, entry: AssetRegistryEntry) => Promise<void>;
  onDoubleClickAsset?: (assetKey: string, clipId?: string) => void;
  setLightboxAssetKey?: (assetKey: string | null) => void;
}

export interface TimelineChromeContextValue {
  timelineName: string | null;
  saveStatus: SaveStatus;
  isConflictExhausted: boolean;
  renderStatus: RenderStatus;
  renderLog: string;
  renderDirty: boolean;
  renderProgress: RenderProgress;
  renderResultUrl: string | null;
  renderResultFilename: string | null;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  checkpoints: TimelineCheckpoint[];
  jumpToCheckpoint: (checkpointId: string) => void;
  createManualCheckpoint: (label?: string) => Promise<string | null>;
  setScaleWidth: (value: number | ((value: number) => number)) => void;
  handleAddTrack: () => void;
  handleClearUnusedTracks: () => void;
  unusedTrackCount: number;
  handleAddText: () => void;
  handleAddTextAt: () => void;
  reloadFromServer: () => Promise<void>;
  retrySaveAfterConflict: () => Promise<void>;
  startRender: () => Promise<void>;
}

export interface TimelinePlaybackContextValue {
  currentTime: number;
  previewRef: RefObject<PreviewHandle | null>;
  playerContainerRef: RefObject<HTMLDivElement | null>;
  onPreviewTimeUpdate: (time: number) => void;
  formatTime: (time: number) => string;
}

export interface TimelineAvailabilityState {
  mounted: boolean;
}

export interface TimelineStoreBootstrap {
  data: TimelineEditorDataContextValue;
  ops: TimelineEditorOpsContextValue;
  chrome: TimelineChromeContextValue;
  playback: TimelinePlaybackContextValue;
}

export interface TimelineStoreState extends TimelineStoreBootstrap {
  availability: TimelineAvailabilityState;
  timelineId: string;
  hostContext: HostContext;
  ports: EditorPorts;
  assetResolver: AssetResolver;
  document: TimelineDocument | null;
  loading: boolean;
  error: string | null;
  setMounted: (mounted: boolean) => void;
  syncDataSlice: (data: TimelineEditorDataContextValue) => void;
  syncOpsSlice: (ops: TimelineEditorOpsContextValue) => void;
  syncChromeSlice: (chrome: TimelineChromeContextValue) => void;
  syncPlaybackSlice: (playback: TimelinePlaybackContextValue) => void;
  syncSlices: (bootstrap: Partial<TimelineStoreBootstrap>) => void;
  resetSlices: () => void;
  setDocument: (document: TimelineDocument) => void;
  setData: (data: TimelineData | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedClipIds: (clipIds: string[]) => void;
  setCurrentTime: (time: number) => void;
}

export type TimelineStoreApi = StoreApi<TimelineStoreState>;
export type EditorStoreApi = TimelineStoreApi;

export interface LegacyEditorStoreView {
  timelineId: string;
  hostContext: HostContext;
  ports: EditorPorts;
  assetResolver: AssetResolver;
  document: TimelineDocument | null;
  data: TimelineData | null;
  loading: boolean;
  error: string | null;
  selectedClipIds: string[];
  currentTime: number;
  setDocument: (document: TimelineDocument) => void;
  setData: (data: TimelineData | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedClipIds: (clipIds: string[]) => void;
  setCurrentTime: (time: number) => void;
}

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
const noopSetState = <T,>(_value: SetStateAction<T>): void => {};

function clonePreferences(): EditorPreferences {
  return {
    ...defaultPreferences,
    assetPanel: {
      ...defaultPreferences.assetPanel,
      hidden: [...defaultPreferences.assetPanel.hidden],
    },
  };
}

function createMutableRef<T>(value: T): MutableRefObject<T> {
  return { current: value };
}

function createNullableRef<T>(): RefObject<T | null> {
  return { current: null };
}

function resolveInputModalityFromPointerType(pointerType: string | null | undefined): TimelineInputModality {
  switch (pointerType) {
    case 'mouse':
      return 'mouse';
    case 'touch':
      return 'touch';
    case 'pen':
      return 'pen';
    default:
      return 'unknown';
  }
}

function createMobileInteractionPolicy(deviceClass: TimelineDeviceClass): MobileInteractionPolicy {
  return {
    deviceClass,
    inputModality: 'unknown',
    interactionMode: deviceClass === 'phone' ? 'browse' : 'select',
    gestureOwner: 'none',
    precisionEnabled: false,
    contextTarget: null,
    inspectorTarget: null,
  };
}

function deriveSelectedValues(
  data: TimelineData | null,
  selectedClipId: string | null,
  selectedClipIds: Set<string>,
  selectedTrackId: string | null,
) {
  const selectedClip = selectedClipId ? data?.resolvedConfig.clips.find((clip) => clip.id === selectedClipId) ?? null : null;
  const selectedTrack = selectedTrackId ? data?.tracks.find((track) => track.id === selectedTrackId) ?? null : null;
  let selectedClipHasPredecessor = false;

  if (selectedClipId && data) {
    const trackId = data.meta[selectedClipId]?.track ?? selectedClip?.track ?? null;
    const clipOrder = trackId ? data.clipOrder[trackId] ?? [] : [];
    selectedClipHasPredecessor = clipOrder.indexOf(selectedClipId) > 0;
  }

  return {
    selectedClip,
    selectedTrack,
    selectedClipHasPredecessor,
    primaryClipId: selectedClipId ?? [...selectedClipIds][0] ?? null,
  };
}

function createInitialDataSlice(): TimelineEditorDataContextValue {
  const selectedClipIds = new Set<string>();
  const selectedClipIdsRef = createMutableRef(new Set<string>());
  const additiveSelectionRef = createMutableRef(false);
  const dataRef = createMutableRef<TimelineData | null>(null);
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

function createInitialOpsSlice(set: TimelineStoreApi['setState'], get: TimelineStoreApi['getState']): TimelineEditorOpsContextValue {
  const setSelection = (nextIds: Set<string>, nextSelectedClipId: string | null) => {
    set((state) => {
      const nextSelectedTrackId =
        nextSelectedClipId
          ? state.data.data?.meta[nextSelectedClipId]?.track ?? state.data.selectedTrackId
          : state.data.selectedTrackId;
      const derived = deriveSelectedValues(state.data.data, nextSelectedClipId, nextIds, nextSelectedTrackId);
      state.data.selectedClipIdsRef.current = new Set(nextIds);
      return {
        data: {
          ...state.data,
          selectedClipId: nextSelectedClipId,
          selectedClipIds: nextIds,
          selectedClipIdsRef: state.data.selectedClipIdsRef,
          selectedTrackId: nextSelectedTrackId,
          ...derived,
        },
      };
    });
  };

  return {
    setInputModality: (inputModality) => {
      set((state) => ({
        data: {
          ...state.data,
          inputModality,
          interactionPolicy: { ...state.data.interactionPolicy, inputModality },
        },
      }));
    },
    setInputModalityFromPointerType: resolveInputModalityFromPointerType,
    setInteractionMode: (interactionMode) => {
      set((state) => ({
        data: {
          ...state.data,
          interactionMode,
          interactionPolicy: { ...state.data.interactionPolicy, interactionMode },
        },
      }));
    },
    setGestureOwner: (gestureOwner) => {
      set((state) => ({
        data: {
          ...state.data,
          gestureOwner,
          interactionPolicy: { ...state.data.interactionPolicy, gestureOwner },
        },
      }));
    },
    setPrecisionEnabled: (precisionEnabled) => {
      set((state) => ({
        data: {
          ...state.data,
          precisionEnabled,
          interactionPolicy: { ...state.data.interactionPolicy, precisionEnabled },
        },
      }));
    },
    setContextTarget: (contextTarget) => {
      set((state) => ({
        data: {
          ...state.data,
          contextTarget,
          interactionPolicy: { ...state.data.interactionPolicy, contextTarget },
        },
      }));
    },
    setInspectorTarget: (inspectorTarget) => {
      set((state) => ({
        data: {
          ...state.data,
          inspectorTarget,
          interactionPolicy: { ...state.data.interactionPolicy, inspectorTarget },
        },
      }));
    },
    setSelectedClipId: (value) => {
      const current = get().data.selectedClipId;
      const nextSelectedClipId = typeof value === 'function' ? value(current) : value;
      setSelection(nextSelectedClipId ? new Set([nextSelectedClipId]) : new Set(), nextSelectedClipId);
    },
    isClipSelected: (clipId) => get().data.selectedClipIds.has(clipId),
    selectClip: (clipId) => setSelection(clipId ? new Set([clipId]) : new Set(), clipId),
    selectClips: (clipIds) => {
      const nextIds = new Set(clipIds);
      setSelection(nextIds, [...nextIds][0] ?? null);
    },
    replaceTimelineSelection: (clipIds) => {
      const nextIds = new Set(clipIds);
      setSelection(nextIds, [...nextIds][0] ?? null);
    },
    addToSelection: (clipId) => {
      const nextIds = new Set(get().data.selectedClipIds);
      nextIds.add(clipId);
      setSelection(nextIds, get().data.selectedClipId ?? clipId);
    },
    clearSelection: () => setSelection(new Set(), null),
    setSelectedTrackId: (value) => {
      set((state) => {
        const nextSelectedTrackId =
          typeof value === 'function' ? value(state.data.selectedTrackId) : value;
        const derived = deriveSelectedValues(
          state.data.data,
          state.data.selectedClipId,
          state.data.selectedClipIds,
          nextSelectedTrackId,
        );
        return {
          data: {
            ...state.data,
            selectedTrackId: nextSelectedTrackId,
            ...derived,
          },
        };
      });
    },
    setActiveClipTab: (tab) => {
      set((state) => ({
        data: {
          ...state.data,
          preferences: {
            ...state.data.preferences,
            activeClipTab: tab,
          },
        },
      }));
    },
    setAssetPanelState: (patch) => {
      set((state) => ({
        data: {
          ...state.data,
          preferences: {
            ...state.data.preferences,
            assetPanel: {
              ...state.data.preferences.assetPanel,
              ...patch,
            },
          },
        },
      }));
    },
    registerGenerationAsset: () => null,
    onCursorDrag: noop,
    onClickTimeArea: noop,
    onActionResizeStart: noop,
    onClipEdgeResizeEnd: noop,
    onOverlayChange: noop,
    onTimelineDragOver: noop,
    onTimelineDragLeave: noop,
    onTimelineDrop: noopAsync,
    handleAssetDrop: noop,
    handleUpdateClips: noop,
    handleUpdateClipsDeep: noop,
    handleDeleteClips: noop,
    handleDeleteClip: noop,
    handleSelectedClipChange: noop,
    handleResetClipPosition: noop,
    handleResetClipsPosition: noop,
    handleSplitSelectedClip: noop,
    handleSplitClipAtTime: noop,
    handleSplitClipsAtPlayhead: noop,
    handleToggleMuteClips: noop,
    handleToggleMute: noop,
    handleDetachAudioClip: noop,
    handleTrackPopoverChange: noop,
    handleMoveTrack: noop,
    handleRemoveTrack: noop,
    moveSelectedClipToTrack: noop,
    moveSelectedClipsToTrack: noop,
    moveClipToRow: noop,
    createTrackAndMoveClip: noop,
    uploadFiles: noopAsync,
    applyEdit: noop,
    patchRegistry: noop,
    unpatchRegistry: noop,
    registerAsset: noopAsync,
  };
}

function createInitialChromeSlice(set: TimelineStoreApi['setState']): TimelineChromeContextValue {
  return {
    timelineName: null,
    saveStatus: 'saved',
    isConflictExhausted: false,
    renderStatus: 'idle',
    renderLog: '',
    renderDirty: false,
    renderProgress: null,
    renderResultUrl: null,
    renderResultFilename: null,
    undo: noop,
    redo: noop,
    canUndo: false,
    canRedo: false,
    checkpoints: [],
    jumpToCheckpoint: noop,
    createManualCheckpoint: async () => null,
    setScaleWidth: (value) => {
      set((state) => {
        const nextScaleWidth = typeof value === 'function' ? value(state.data.scaleWidth) : value;
        return {
          data: {
            ...state.data,
            scaleWidth: nextScaleWidth,
            preferences: {
              ...state.data.preferences,
              scaleWidth: nextScaleWidth,
            },
          },
        };
      });
    },
    handleAddTrack: noop,
    handleClearUnusedTracks: noop,
    unusedTrackCount: 0,
    handleAddText: noop,
    handleAddTextAt: noop,
    reloadFromServer: noopAsync,
    retrySaveAfterConflict: noopAsync,
    startRender: noopAsync,
  };
}

function createInitialPlaybackSlice(set: TimelineStoreApi['setState']): TimelinePlaybackContextValue {
  return {
    currentTime: 0,
    previewRef: createNullableRef<PreviewHandle>(),
    playerContainerRef: createNullableRef<HTMLDivElement>(),
    onPreviewTimeUpdate: (currentTime) => {
      set((state) => ({
        playback: {
          ...state.playback,
          currentTime,
        },
      }));
    },
    formatTime: (time) => `${time}`,
  };
}

function createLegacyEditorStoreView(state: TimelineStoreState): LegacyEditorStoreView {
  return {
    timelineId: state.timelineId,
    hostContext: state.hostContext,
    ports: state.ports,
    assetResolver: state.assetResolver,
    document: state.document,
    data: state.data.data,
    loading: state.loading,
    error: state.error,
    selectedClipIds: [...state.data.selectedClipIds],
    currentTime: state.playback.currentTime,
    setDocument: state.setDocument,
    setData: state.setData,
    setLoading: state.setLoading,
    setError: state.setError,
    setSelectedClipIds: state.setSelectedClipIds,
    setCurrentTime: state.setCurrentTime,
  };
}

export function createTimelineStore(input: {
  timelineId: string;
  ports: EditorPorts;
  hostContext: HostContext;
  assetResolver: AssetResolver;
}): TimelineStoreApi {
  const store = createStore<TimelineStoreState>((set, get) => {
    const initialData = createInitialDataSlice();
    const initialOps = createInitialOpsSlice(set, get);
    const initialChrome = createInitialChromeSlice(set);
    const initialPlayback = createInitialPlaybackSlice(set);

    return {
      availability: { mounted: false },
      timelineId: input.timelineId,
      hostContext: input.hostContext,
      ports: input.ports,
      assetResolver: input.assetResolver,
      document: null,
      loading: false,
      error: null,
      data: initialData,
      ops: initialOps,
      chrome: initialChrome,
      playback: initialPlayback,
      setMounted: (mounted) => {
        set((state) => (
          state.availability.mounted === mounted
            ? state
            : { availability: { mounted } }
        ));
      },
      syncDataSlice: (data) => {
        set((state) => (
          state.data === data && state.availability.mounted
            ? state
            : {
                availability: state.availability.mounted ? state.availability : { mounted: true },
                data,
              }
        ));
      },
      syncOpsSlice: (ops) => {
        set((state) => (
          state.ops === ops && state.availability.mounted
            ? state
            : {
                availability: state.availability.mounted ? state.availability : { mounted: true },
                ops,
              }
        ));
      },
      syncChromeSlice: (chrome) => {
        set((state) => (
          state.chrome === chrome && state.availability.mounted
            ? state
            : {
                availability: state.availability.mounted ? state.availability : { mounted: true },
                chrome,
              }
        ));
      },
      syncPlaybackSlice: (playback) => {
        set((state) => (
          state.playback === playback && state.availability.mounted
            ? state
            : {
                availability: state.availability.mounted ? state.availability : { mounted: true },
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

          if (
            state.data === nextData
            && state.ops === nextOps
            && state.chrome === nextChrome
            && state.playback === nextPlayback
            && state.availability.mounted
          ) {
            return state;
          }

          return {
            availability: { mounted: true },
            data: nextData,
            ops: nextOps,
            chrome: nextChrome,
            playback: nextPlayback,
          };
        });
      },
      resetSlices: () => {
        const nextData = createInitialDataSlice();
        set((state) => ({
          availability: { mounted: false },
          data: nextData,
          ops: createInitialOpsSlice(set, get),
          chrome: createInitialChromeSlice(set),
          playback: createInitialPlaybackSlice(set),
          loading: false,
          error: null,
          document: state.document,
        }));
      },
      setDocument: (document) => {
        set((state) => ({
          document,
          chrome: {
            ...state.chrome,
            timelineName: document.name ?? state.chrome.timelineName,
          },
        }));
      },
      setData: (data) => {
        set((state) => {
          state.data.dataRef.current = data;
          const derived = deriveSelectedValues(
            data,
            state.data.selectedClipId,
            state.data.selectedClipIds,
            state.data.selectedTrackId,
          );
          return {
            data: {
              ...state.data,
              data,
              resolvedConfig: data?.resolvedConfig ?? null,
              dataRef: state.data.dataRef,
              compositionSize: data
                ? parseResolution(data.output.resolution)
                : { width: 0, height: 0 },
              ...derived,
            },
          };
        });
      },
      setLoading: (loading) => {
        set((state) => ({
          loading,
          data: {
            ...state.data,
            isLoading: loading,
          },
        }));
      },
      setError: (error) => {
        set({ error });
      },
      setSelectedClipIds: (clipIds) => {
        const nextIds = new Set(clipIds);
        set((state) => {
          state.data.selectedClipIdsRef.current = new Set(nextIds);
          const nextSelectedClipId = clipIds[0] ?? null;
          const nextSelectedTrackId =
            nextSelectedClipId
              ? state.data.data?.meta[nextSelectedClipId]?.track ?? state.data.selectedTrackId
              : state.data.selectedTrackId;
          const derived = deriveSelectedValues(state.data.data, nextSelectedClipId, nextIds, nextSelectedTrackId);
          return {
            data: {
              ...state.data,
              selectedClipIds: nextIds,
              selectedClipIdsRef: state.data.selectedClipIdsRef,
              selectedClipId: nextSelectedClipId,
              selectedTrackId: nextSelectedTrackId,
              ...derived,
            },
          };
        });
      },
      setCurrentTime: (currentTime) => {
        set((state) => ({
          playback: {
            ...state.playback,
            currentTime,
          },
        }));
      },
    };
  });

  return store;
}

export const createEditorStore = createTimelineStore;

const TimelineStoreContext = createContext<TimelineStoreApi | null>(null);
const inertDataProvider: DataProvider = {
  async loadTimeline() {
    return { config: { output: { resolution: '1280x720', fps: 30, file: 'output.mp4' }, clips: [], tracks: [] }, configVersion: 1 };
  },
  async saveTimeline() {
    return 1;
  },
  async loadAssetRegistry() {
    return { assets: {} };
  },
  resolveAssetUrl() {
    return '';
  },
};
const fallbackTimelineStore = createTimelineStore({
  timelineId: 'timeline',
  ports: { dataProvider: inertDataProvider },
  hostContext: {},
  assetResolver: { resolveAssetUrl: () => '' },
});

export function TimelineStoreProvider({
  store,
  children,
}: PropsWithChildren<{ store: TimelineStoreApi }>) {
  return createElement(TimelineStoreContext.Provider, { value: store }, children);
}

export const EditorStoreProvider = TimelineStoreProvider;

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

export function useTimelineDataSlice(): TimelineEditorDataContextValue {
  return useBoundTimelineStore((state) => state.data, shallow);
}

export function useTimelineDataSelector<T>(
  selector: (data: TimelineEditorDataContextValue) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  return useBoundTimelineStore((state) => selector(state.data), equalityFn);
}

export function useTimelineDataSliceSafe(): TimelineEditorDataContextValue | null {
  return useSafeTimelineStoreValue((state) => state.data, shallow);
}

export function useTimelineOpsSlice(): TimelineEditorOpsContextValue {
  return useBoundTimelineStore((state) => state.ops, shallow);
}

export function useTimelineOpsSelector<T>(
  selector: (ops: TimelineEditorOpsContextValue) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  return useBoundTimelineStore((state) => selector(state.ops), equalityFn);
}

export function useTimelineOpsSliceSafe(): TimelineEditorOpsContextValue | null {
  return useSafeTimelineStoreValue((state) => state.ops, shallow);
}

export function useTimelineChromeSlice(): TimelineChromeContextValue {
  return useBoundTimelineStore((state) => state.chrome, shallow);
}

export function useTimelineChromeSelector<T>(
  selector: (chrome: TimelineChromeContextValue) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  return useBoundTimelineStore((state) => selector(state.chrome), equalityFn);
}

export function useTimelineChromeSliceSafe(): TimelineChromeContextValue | null {
  return useSafeTimelineStoreValue((state) => state.chrome, shallow);
}

export function useTimelinePlaybackSlice(): TimelinePlaybackContextValue {
  return useBoundTimelineStore((state) => state.playback, shallow);
}

export function useTimelinePlaybackSelector<T>(
  selector: (playback: TimelinePlaybackContextValue) => T,
  equalityFn?: (left: T, right: T) => boolean,
): T {
  return useBoundTimelineStore((state) => selector(state.playback), equalityFn);
}

export function useTimelinePlaybackSliceSafe(): TimelinePlaybackContextValue | null {
  return useSafeTimelineStoreValue((state) => state.playback, shallow);
}

export function useTimelineMutableAdapters() {
  return useBoundTimelineStore((state) => ({
    dataRef: state.data.dataRef,
    pendingOpsRef: state.data.pendingOpsRef,
    interactionStateRef: state.data.interactionStateRef,
    selectedClipIdsRef: state.data.selectedClipIdsRef,
    additiveSelectionRef: state.data.additiveSelectionRef,
  }), shallow);
}

export function useTimelineMutableAdaptersSafe() {
  return useSafeTimelineStoreValue((state) => ({
    dataRef: state.data.dataRef,
    pendingOpsRef: state.data.pendingOpsRef,
    interactionStateRef: state.data.interactionStateRef,
    selectedClipIdsRef: state.data.selectedClipIdsRef,
    additiveSelectionRef: state.data.additiveSelectionRef,
  }), shallow);
}

export function useTimelineEditorData() {
  return useTimelineDataSlice();
}

export function useTimelineEditorDataSafe() {
  return useTimelineDataSliceSafe();
}

export function useTimelineEditorOps() {
  return useTimelineOpsSlice();
}

export function useTimelineEditorOpsSafe() {
  return useTimelineOpsSliceSafe();
}

export function useTimelineChromeContext() {
  return useTimelineChromeSlice();
}

export function useTimelineChromeContextSafe() {
  return useTimelineChromeSliceSafe();
}

export function useTimelinePlaybackContext() {
  return useTimelinePlaybackSlice();
}

export function useTimelinePlaybackContextSafe() {
  return useTimelinePlaybackSliceSafe();
}

export function useEditorStore<T>(selector: (state: LegacyEditorStoreView) => T): T {
  return useBoundTimelineStore((state) => selector(createLegacyEditorStoreView(state)));
}

export function useCreateEditorStore(input: {
  timelineId: string;
  ports: EditorPorts;
  hostContext: HostContext;
  assetResolver: AssetResolver;
}): EditorStoreApi {
  const ref = useRef<EditorStoreApi | null>(null);
  if (!ref.current) {
    ref.current = createEditorStore(input);
  }
  return ref.current;
}
