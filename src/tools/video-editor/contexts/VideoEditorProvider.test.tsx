import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useAddToVideoEditor } from '@/domains/media-lightbox/hooks/useAddToVideoEditor';
import {
  ADD_GENERATION_QUERY_PARAM,
  readPendingAdds,
} from '@/domains/media-lightbox/hooks/addToVideoEditorConstants';
import { AgentChatProvider, useAgentChatBridge } from '@/shared/contexts/AgentChatContext';
import {
  __getSelectionStateForTests,
  editorReplaceTimelineSelection,
  systemResetSelectionForProjectChange,
  userSelectGalleryItem,
} from '@/shared/state/selectionStore';
import { buildVideoEditorLightboxMedia, VideoEditorProvider } from '@/tools/video-editor/contexts/VideoEditorProvider';
import {
  createTimelineStore,
  TimelineStoreProvider,
  useTimelineAvailabilityState,
  useTimelineChromeContext,
  useTimelineEditorData,
  useTimelineEditorDataSafe,
  useTimelineEditorOps,
  useTimelineEditorOpsSafe,
  useTimelinePlaybackContext,
} from '@/tools/video-editor/hooks/timelineStore';
import {
  shouldAllowTouchClipDrag,
  shouldAllowTouchMarquee,
  shouldExpandTouchTrimHandles,
  shouldPreserveTouchSelectionForMove,
  shouldToggleTouchSelection,
} from '@/tools/video-editor/lib/mobile-interaction-model';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';
import { CORE_TEST_TIMELINE_ID, createCoreTestPorts } from '@/tools/video-editor/testing/coreTestPorts';

const navigateMock = vi.fn();
const timelineMultiSelectMock = vi.fn();
const timelineQueriesMock = vi.fn();
const timelinePlaybackMock = vi.fn();
const editorPreferencesMock = vi.fn();
const timelineSaveMock = vi.fn();
const timelineHistoryMock = vi.fn();
const derivedTimelineMock = vi.fn();
const renderStateMock = vi.fn();
const assetOperationsMock = vi.fn();
const timelineSelectionMock = vi.fn();
const dragCoordinatorMock = vi.fn();
const assetManagementMock = vi.fn();
const clipResizeMock = vi.fn();
const clipEditingMock = vi.fn();
const externalDropMock = vi.fn();
const timelineTrackManagementMock = vi.fn();
const shotFinalVideosMock = vi.fn(() => ({
  finalVideoMap: new Map(),
  isLoading: false,
}));

function createActualTimelineStateHarness() {
  const bootstrap = createTimelineStore({}).getState();
  const resolvedConfig = {
    clips: [],
    registry: {},
  } as never;
  const eventBus = {
    on: vi.fn(() => () => {}),
  };

  return {
    queries: {
      timelineQuery: {
        isLoading: false,
      },
    },
    playback: {
      currentTime: 0,
      previewRef: { current: null },
      playerContainerRef: { current: null },
      timelineRef: { current: null },
      timelineWrapperRef: { current: null },
      onPreviewTimeUpdate: vi.fn(),
      formatTime: vi.fn((time: number) => `${time}`),
      onCursorDrag: vi.fn(),
      onClickTimeArea: vi.fn(),
    },
    preferences: {
      scale: bootstrap.data.scale,
      scaleWidth: bootstrap.data.scaleWidth,
      preferences: bootstrap.data.preferences,
      setScaleWidth: vi.fn(),
      setActiveClipTab: vi.fn(),
      setAssetPanelState: vi.fn(),
    },
    save: {
      data: null,
      dataRef: { current: null },
      isConflictExhausted: false,
      selectedClipId: 'clip-1',
      selectedTrackId: 'track-1',
      saveStatus: 'saved' as const,
      setSelectedTrackId: vi.fn(),
      applyEdit: vi.fn(),
      patchRegistry: vi.fn(),
      unpatchRegistry: vi.fn(),
      commitData: vi.fn(),
      eventBus,
      reloadFromServer: vi.fn(),
      retrySaveAfterConflict: vi.fn(),
      editSeqRef: { current: 0 },
      pendingOpsRef: { current: 0 },
      savedSeqRef: { current: 0 },
      selectedClipIdRef: { current: 'clip-1' },
      selectedTrackIdRef: { current: 'track-1' },
      isLoading: false,
    },
    history: {
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
      checkpoints: [],
      jumpToCheckpoint: vi.fn(),
      createManualCheckpoint: vi.fn(),
      onBeforeCommit: vi.fn(),
    },
    derived: {
      resolvedConfig,
      renderMetadata: {},
      compositionSize: { width: 1920, height: 1080 },
      trackScaleMap: {},
    },
    render: {
      renderStatus: 'idle' as const,
      renderLog: '',
      renderDirty: false,
      renderProgress: null,
      renderResultUrl: null,
      renderResultFilename: null,
      setRenderDirty: vi.fn(),
      startRender: vi.fn(),
    },
    assetOperations: {
      registerAsset: vi.fn(),
      uploadAsset: vi.fn(),
      uploadFiles: vi.fn(),
      invalidateAssetRegistry: vi.fn(),
    },
    selection: {
      resolvedConfig,
      primaryClipId: 'clip-1',
      selectedClipIds: new Set(['clip-1']),
      selectedClipIdsRef: { current: new Set(['clip-1']) },
      additiveSelectionRef: { current: false },
      selectedClip: null,
      selectedTrack: null,
      selectedClipHasPredecessor: false,
      pruneSelection: vi.fn(),
    },
    multiSelect: {
      isClipSelected: vi.fn(() => true),
      selectClip: vi.fn(),
    },
    dragCoordinator: {
      coordinator: bootstrap.data.coordinator,
      indicatorRef: { current: null },
      editAreaRef: { current: null },
    },
    assetManagement: {
      registerGenerationAsset: vi.fn(() => 'asset-1'),
      handleAssetDrop: vi.fn(),
      uploadImageGeneration: vi.fn(),
      uploadVideoGeneration: vi.fn(),
    },
    clipResize: {
      onActionResizeStart: vi.fn(),
      onClipEdgeResizeEnd: vi.fn(),
    },
    clipEditing: {
      onOverlayChange: vi.fn(),
      handleUpdateClips: vi.fn(),
      handleUpdateClipsDeep: vi.fn(),
      handleDeleteClips: vi.fn(),
      handleDeleteClip: vi.fn(),
      handleSelectedClipChange: vi.fn(),
      handleResetClipPosition: vi.fn(),
      handleResetClipsPosition: vi.fn(),
      handleSplitSelectedClip: vi.fn(),
      handleSplitClipAtTime: vi.fn(),
      handleSplitClipsAtPlayhead: vi.fn(),
      handleToggleMuteClips: vi.fn(),
      handleToggleMute: vi.fn(),
      handleDetachAudioClip: vi.fn(),
      handleAddText: vi.fn(),
      handleAddTextAt: vi.fn(),
    },
    externalDrop: {
      onTimelineDragOver: vi.fn(),
      onTimelineDragLeave: vi.fn(),
      onTimelineDrop: vi.fn(),
    },
    trackManagement: {
      handleTrackPopoverChange: vi.fn(),
      handleMoveTrack: vi.fn(),
      handleRemoveTrack: vi.fn(),
      moveSelectedClipToTrack: vi.fn(),
      moveSelectedClipsToTrack: vi.fn(),
      moveClipToRow: vi.fn(),
      createTrackAndMoveClip: vi.fn(),
      handleAddTrack: vi.fn(),
      handleClearUnusedTracks: vi.fn(),
      unusedTrackCount: 0,
    },
  };
}

let actualTimelineStateHarness = createActualTimelineStateHarness();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/shared/state/selectionStore', async () => {
  const actual = await vi.importActual<typeof import('@/shared/state/selectionStore')>('@/shared/state/selectionStore');
  return {
    ...actual,
    useTimelineMultiSelect: () => timelineMultiSelectMock(),
  };
});

vi.mock('@/shared/hooks/mobile', () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));

vi.mock('@/shared/contexts/ProjectContext', () => ({
  useProjectSelectionContext: () => ({
    selectedProjectId: 'project-1',
  }),
}));

const mocks = {
  setInputModality: vi.fn(),
  setInputModalityFromPointerType: vi.fn(() => 'touch'),
  setInteractionMode: vi.fn(),
  setGestureOwner: vi.fn(),
  setPrecisionEnabled: vi.fn(),
  setContextTarget: vi.fn(),
  setInspectorTarget: vi.fn(),
  selectClip: vi.fn(),
  selectClips: vi.fn(),
};

vi.mock('@/tools/video-editor/hooks/useEffects', () => ({
  useEffects: () => ({ data: [] }),
}));

vi.mock('@/tools/video-editor/hooks/useEffectRegistry', () => ({
  useEffectRegistry: vi.fn(),
}));

vi.mock('@/tools/video-editor/hooks/useEffectResources', () => ({
  useEffectResources: () => ({ effects: [] }),
}));

vi.mock('@/tools/video-editor/hooks/useTimelineClipsForAttachments', () => ({
  useTimelineClipsForAttachments: () => [
    {
      clipId: 'clip-1',
      assetKey: 'asset-1',
      url: 'https://example.com/image.png',
      mediaType: 'image',
      isTimelineBacked: true,
    },
  ],
}));

vi.mock('@/shared/contexts/ShotsContext', () => ({
  useShots: () => ({
    shots: [],
    isLoading: false,
    error: null,
    refetchShots: vi.fn(),
    allImagesCount: 0,
    noShotImagesCount: 0,
  }),
}));

vi.mock('@/tools/travel-between-images/hooks/video/useShotFinalVideos', () => ({
  useShotFinalVideos: (...args: unknown[]) => shotFinalVideosMock(...args),
}));

vi.mock('@/shared/hooks/settings/useToolSettings', () => ({
  useToolSettings: () => ({
    settings: {
      lastTimelineId: 'timeline-staged',
    },
  }),
}));

vi.mock('@/tools/video-editor/hooks/useTimelineQueries', () => ({
  useTimelineQueries: () => timelineQueriesMock(),
}));

vi.mock('@/tools/video-editor/hooks/useTimelinePlayback', () => ({
  useTimelinePlayback: () => timelinePlaybackMock(),
}));

vi.mock('@/tools/video-editor/hooks/useEditorPreferences', async () => {
  const actual = await vi.importActual<typeof import('@/tools/video-editor/hooks/useEditorPreferences')>(
    '@/tools/video-editor/hooks/useEditorPreferences',
  );
  return {
    ...actual,
    useEditorPreferences: () => editorPreferencesMock(),
  };
});

vi.mock('@/tools/video-editor/hooks/useTimelineSave', () => ({
  useTimelineSave: () => timelineSaveMock(),
}));

vi.mock('@/tools/video-editor/hooks/useTimelineHistory', () => ({
  useTimelineHistory: () => timelineHistoryMock(),
}));

vi.mock('@/tools/video-editor/hooks/useDerivedTimeline', () => ({
  useDerivedTimeline: () => derivedTimelineMock(),
}));

vi.mock('@/tools/video-editor/hooks/useRenderState', () => ({
  useRenderState: () => renderStateMock(),
}));

vi.mock('@/tools/video-editor/hooks/useAssetOperations', () => ({
  useAssetOperations: () => assetOperationsMock(),
}));

vi.mock('@/tools/video-editor/hooks/useTimelineSelection', () => ({
  useTimelineSelection: () => timelineSelectionMock(),
}));

vi.mock('@/tools/video-editor/hooks/useDragCoordinator', () => ({
  useDragCoordinator: () => dragCoordinatorMock(),
}));

vi.mock('@/tools/video-editor/hooks/useAssetManagement', () => ({
  useAssetManagement: () => assetManagementMock(),
}));

vi.mock('@/tools/video-editor/hooks/useClipResize', () => ({
  useClipResize: () => clipResizeMock(),
}));

vi.mock('@/tools/video-editor/hooks/useClipEditing', () => ({
  useClipEditing: () => clipEditingMock(),
}));

vi.mock('@/tools/video-editor/hooks/useExternalDrop', () => ({
  useExternalDrop: () => externalDropMock(),
}));

vi.mock('@/tools/video-editor/hooks/useTimelineTrackManagement', () => ({
  useTimelineTrackManagement: () => timelineTrackManagementMock(),
}));

vi.mock('@/tools/video-editor/hooks/useTimelineState', () => ({
  useTimelineState: () => {
    const editor = {
      data: null,
      resolvedConfig: { registry: {} },
      deviceClass: 'tablet',
      inputModality: 'mouse',
      interactionMode: 'select',
      gestureOwner: 'timeline',
      precisionEnabled: false,
      contextTarget: { kind: 'timeline' },
      inspectorTarget: { kind: 'clip', clipId: 'clip-1' },
      interactionPolicy: {
        deviceClass: 'tablet',
        inputModality: 'mouse',
        interactionMode: 'select',
        gestureOwner: 'timeline',
        precisionEnabled: false,
        contextTarget: { kind: 'timeline' },
        inspectorTarget: { kind: 'clip', clipId: 'clip-1' },
      },
      selectedClipId: 'clip-1',
      selectedClipIds: ['clip-1'],
      selectedClipIdsRef: { current: ['clip-1'] },
      additiveSelectionRef: { current: false },
      selectedTrackId: 'track-1',
      primaryClipId: 'clip-1',
      selectedClip: null,
      selectedTrack: null,
      selectedClipHasPredecessor: false,
      compositionSize: { width: 1920, height: 1080 },
      trackScaleMap: {},
      scale: 1,
      scaleWidth: 1,
      isLoading: false,
      dataRef: { current: null },
      pendingOpsRef: { current: [] },
      interactionStateRef: { current: { drag: false, resize: false, listeners: new Set() } },
      coordinator: null,
      indicatorRef: { current: null },
      editAreaRef: { current: null },
      preferences: {
        activeClipTab: 'style',
        assetPanel: { isOpen: true },
      },
      timelineRef: { current: null },
      timelineWrapperRef: { current: null },
      setInputModality: mocks.setInputModality,
      setInputModalityFromPointerType: mocks.setInputModalityFromPointerType,
      setInteractionMode: mocks.setInteractionMode,
      setGestureOwner: mocks.setGestureOwner,
      setPrecisionEnabled: mocks.setPrecisionEnabled,
      setContextTarget: mocks.setContextTarget,
      setInspectorTarget: mocks.setInspectorTarget,
      isClipSelected: vi.fn(() => true),
      selectClip: mocks.selectClip,
      selectClips: mocks.selectClips,
      addToSelection: vi.fn(),
      clearSelection: vi.fn(),
      setSelectedTrackId: vi.fn(),
      setActiveClipTab: vi.fn(),
      setAssetPanelState: vi.fn(),
      registerGenerationAsset: vi.fn(),
      onCursorDrag: vi.fn(),
      onClickTimeArea: vi.fn(),
      onActionResizeStart: vi.fn(),
      onClipEdgeResizeEnd: vi.fn(),
      onOverlayChange: vi.fn(),
      onTimelineDragOver: vi.fn(),
      onTimelineDragLeave: vi.fn(),
      onTimelineDrop: vi.fn(),
      handleAssetDrop: vi.fn(),
      handleUpdateClips: vi.fn(),
      handleUpdateClipsDeep: vi.fn(),
      handleDeleteClips: vi.fn(),
      handleDeleteClip: vi.fn(),
      handleSelectedClipChange: vi.fn(),
      handleResetClipPosition: vi.fn(),
      handleResetClipsPosition: vi.fn(),
      handleSplitSelectedClip: vi.fn(),
      handleSplitClipAtTime: vi.fn(),
      handleSplitClipsAtPlayhead: vi.fn(),
      handleToggleMuteClips: vi.fn(),
      handleToggleMute: vi.fn(),
      handleDetachAudioClip: vi.fn(),
      handleTrackPopoverChange: vi.fn(),
      handleMoveTrack: vi.fn(),
      handleRemoveTrack: vi.fn(),
      moveSelectedClipToTrack: vi.fn(),
      moveSelectedClipsToTrack: vi.fn(),
      moveClipToRow: vi.fn(),
      createTrackAndMoveClip: vi.fn(),
      uploadFiles: vi.fn(),
      applyEdit: vi.fn(),
      patchRegistry: vi.fn(),
      unpatchRegistry: vi.fn(),
      registerAsset: vi.fn(),
    };
    const chrome = {
      timelineName: 'Timeline',
      saveStatus: 'saved' as const,
      isConflictExhausted: false,
      renderStatus: 'idle' as const,
      renderLog: '',
      renderDirty: false,
      renderProgress: null,
      renderResultUrl: null,
      renderResultFilename: null,
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
      checkpoints: [],
      jumpToCheckpoint: vi.fn(),
      createManualCheckpoint: vi.fn(),
      setScaleWidth: vi.fn(),
      handleAddTrack: vi.fn(),
      handleClearUnusedTracks: vi.fn(),
      unusedTrackCount: 0,
      handleAddText: vi.fn(),
      handleAddTextAt: vi.fn(),
      reloadFromServer: vi.fn(),
      retrySaveAfterConflict: vi.fn(),
      startRender: vi.fn(),
    };
    const playback = {
      currentTime: 12.5,
      previewRef: { current: null },
      playerContainerRef: { current: null },
      onPreviewTimeUpdate: vi.fn(),
      formatTime: vi.fn(() => '0:12'),
    };

    return {
      store: createTimelineStore({
        data: editor,
        ops: editor,
        chrome,
        playback,
      }),
      editor,
      editorData: editor,
      editorOps: editor,
      chrome,
      playback,
    };
  },
}));

function Consumer() {
  const editorData = useTimelineEditorData();
  const editorOps = useTimelineEditorOps();
  const chrome = useTimelineChromeContext();
  const playback = useTimelinePlaybackContext();
  const agentChatBridge = useAgentChatBridge();

  return (
    <div>
      <span>{editorData.selectedClipId}</span>
      <span>{editorData.deviceClass}</span>
      <span>{editorData.inputModality}</span>
      <span>{editorData.interactionMode}</span>
      <span>{editorData.gestureOwner}</span>
      <span>{editorData.contextTarget?.kind}</span>
      <span>{editorData.inspectorTarget?.kind}</span>
      <span>{editorData.interactionPolicy.deviceClass}</span>
      <span data-testid="interaction-policy">{JSON.stringify(editorData.interactionPolicy)}</span>
      <span>{String(editorData.interactionStateRef.current.drag)}</span>
      <span>{typeof editorData.additiveSelectionRef?.current}</span>
      <span>{typeof editorOps.selectClip}</span>
      <span>{typeof editorOps.selectClips}</span>
      <span>{chrome.saveStatus}</span>
      <span>{playback.currentTime}</span>
      <span data-testid="agent-chat-timeline-id">{agentChatBridge.timelineId}</span>
      <button
        type="button"
        onClick={() => {
          editorOps.setInputModality('touch');
          editorOps.setInputModalityFromPointerType('touch');
          editorOps.setInteractionMode('trim');
          editorOps.setGestureOwner('trim');
          editorOps.setPrecisionEnabled(true);
          editorOps.setContextTarget({ kind: 'clip', clipId: 'clip-1' });
          editorOps.setInspectorTarget({ kind: 'selection', clipIds: ['clip-1'] });
        }}
      >
        update interaction
      </button>
    </div>
  );
}

const media = {
  id: 'generation-1',
  generation_id: 'generation-1',
  location: 'https://example.com/image.png',
  imageUrl: 'https://example.com/image.png',
  thumbUrl: 'https://example.com/image-thumb.png',
  type: 'image',
} as const;

function AddToVideoEditorConsumer() {
  const { onClick, phase } = useAddToVideoEditor(media);
  const availability = useTimelineAvailabilityState();

  return (
    <div>
      <span data-testid="add-phase">{phase}</span>
      <span data-testid="timeline-mounted">{String(availability.mounted)}</span>
      <button type="button" onClick={onClick}>
        add to video editor
      </button>
    </div>
  );
}

function TimelineStoreSafeHooksConsumer() {
  const data = useTimelineEditorDataSafe();
  const ops = useTimelineEditorOpsSafe();
  const availability = useTimelineAvailabilityState();

  return (
    <div>
      <span data-testid="timeline-has-provider">{String(availability.hasProvider)}</span>
      <span data-testid="timeline-mounted">{String(availability.mounted)}</span>
      <span data-testid="safe-data-present">{String(data !== null)}</span>
      <span data-testid="safe-ops-present">{String(ops !== null)}</span>
    </div>
  );
}

describe('VideoEditorProvider', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    [
      timelineMultiSelectMock,
      timelineQueriesMock,
      timelinePlaybackMock,
      editorPreferencesMock,
      timelineSaveMock,
      timelineHistoryMock,
      derivedTimelineMock,
      renderStateMock,
      assetOperationsMock,
      timelineSelectionMock,
      dragCoordinatorMock,
      assetManagementMock,
      clipResizeMock,
      clipEditingMock,
      externalDropMock,
      timelineTrackManagementMock,
      shotFinalVideosMock,
    ].forEach((mock) => mock.mockReset());
    systemResetSelectionForProjectChange();
    localStorage.clear();
    Object.values(mocks).forEach((mock) => mock.mockClear());
    actualTimelineStateHarness = createActualTimelineStateHarness();
    timelineMultiSelectMock.mockImplementation(() => actualTimelineStateHarness.multiSelect);
    timelineQueriesMock.mockImplementation(() => actualTimelineStateHarness.queries);
    timelinePlaybackMock.mockImplementation(() => actualTimelineStateHarness.playback);
    editorPreferencesMock.mockImplementation(() => actualTimelineStateHarness.preferences);
    timelineSaveMock.mockImplementation(() => actualTimelineStateHarness.save);
    timelineHistoryMock.mockImplementation(() => actualTimelineStateHarness.history);
    derivedTimelineMock.mockImplementation(() => actualTimelineStateHarness.derived);
    renderStateMock.mockImplementation(() => actualTimelineStateHarness.render);
    assetOperationsMock.mockImplementation(() => actualTimelineStateHarness.assetOperations);
    timelineSelectionMock.mockImplementation(() => actualTimelineStateHarness.selection);
    dragCoordinatorMock.mockImplementation(() => actualTimelineStateHarness.dragCoordinator);
    assetManagementMock.mockImplementation(() => actualTimelineStateHarness.assetManagement);
    clipResizeMock.mockImplementation(() => actualTimelineStateHarness.clipResize);
    clipEditingMock.mockImplementation(() => actualTimelineStateHarness.clipEditing);
    externalDropMock.mockImplementation(() => actualTimelineStateHarness.externalDrop);
    timelineTrackManagementMock.mockImplementation(() => actualTimelineStateHarness.trackManagement);
    shotFinalVideosMock.mockReturnValue({
      finalVideoMap: new Map(),
      isLoading: false,
    });
  });

  it('builds fallback lightbox media for raw video assets without a generation id', () => {
    expect(buildVideoEditorLightboxMedia('asset-1', {
      file: 'folder/video.mp4',
      src: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/video.jpg',
      type: 'video/mp4',
    })).toEqual(expect.objectContaining({
      id: 'asset-1',
      generation_id: 'asset-1',
      location: 'https://example.com/video.mp4',
      thumbUrl: 'https://example.com/video.jpg',
      type: 'video',
    }));
  });

  it('provides editor data, editor ops, chrome, and playback contexts together', () => {
    const provider: DataProvider = {
      loadTimeline: vi.fn(),
      saveTimeline: vi.fn(),
      loadAssetRegistry: vi.fn(),
      resolveAssetUrl: vi.fn(),
    };
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AgentChatProvider>
            <VideoEditorProvider dataProvider={provider} timelineId="timeline-1" userId="user-1">
              <Consumer />
            </VideoEditorProvider>
          </AgentChatProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('clip-1')).toBeInTheDocument();
    expect(screen.getAllByText('tablet')).toHaveLength(2);
    expect(screen.getByText('mouse')).toBeInTheDocument();
    expect(screen.getByText('select')).toBeInTheDocument();
    expect(screen.getAllByText('timeline')).toHaveLength(2);
    expect(screen.getByTestId('interaction-policy')).toHaveTextContent(JSON.stringify({
      deviceClass: 'tablet',
      inputModality: 'mouse',
      interactionMode: 'select',
      gestureOwner: 'timeline',
      precisionEnabled: false,
      contextTarget: { kind: 'timeline' },
      inspectorTarget: { kind: 'clip', clipId: 'clip-1' },
    }));
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('boolean')).toBeInTheDocument();
    expect(screen.getAllByText('function')).toHaveLength(2);
    expect(screen.getByText('saved')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByTestId('agent-chat-timeline-id')).toHaveTextContent('timeline-1');

    fireEvent.click(screen.getByRole('button', { name: 'update interaction' }));

    expect(mocks.setInputModality).toHaveBeenCalledWith('touch');
    expect(mocks.setInputModalityFromPointerType).toHaveBeenCalledWith('touch');
    expect(mocks.setInteractionMode).toHaveBeenCalledWith('trim');
    expect(mocks.setGestureOwner).toHaveBeenCalledWith('trim');
    expect(mocks.setPrecisionEnabled).toHaveBeenCalledWith(true);
    expect(mocks.setContextTarget).toHaveBeenCalledWith({ kind: 'clip', clipId: 'clip-1' });
    expect(mocks.setInspectorTarget).toHaveBeenCalledWith({ kind: 'selection', clipIds: ['clip-1'] });
    expect(__getSelectionStateForTests().clipDataById.get('clip-1')).toEqual(expect.objectContaining({
      clipId: 'clip-1',
      url: 'https://example.com/image.png',
    }));
  });

  it('lets editor timeline replacement update selection while preserving gallery attachments', () => {
    userSelectGalleryItem({
      id: 'gallery-1',
      url: 'https://example.com/gallery.png',
      type: 'image/png',
      generationId: 'gen-gallery',
    }, { additive: false });

    editorReplaceTimelineSelection(['clip-1']);

    const selectionState = __getSelectionStateForTests();
    expect(selectionState.timeline.selectedClipIds).toEqual(new Set(['clip-1']));
    expect(selectionState.clipDataById.get('clip-1')).toBeUndefined();
    expect(selectionState.gallery.selectedGalleryIds).toEqual(new Set(['gallery-1']));
  });

  it('matches the touch interaction decision table for drag, marquee, trim, and selection routing', () => {
    expect({
      phoneTouchDragInSelect: shouldAllowTouchClipDrag('phone', 'touch', 'select'),
      phoneTouchDragInMove: shouldAllowTouchClipDrag('phone', 'touch', 'move'),
      tabletTouchMarqueeInSelect: shouldAllowTouchMarquee('tablet', 'touch', 'select'),
      tabletTouchMarqueeInMove: shouldAllowTouchMarquee('tablet', 'touch', 'move'),
      tabletMouseMarqueeInSelect: shouldAllowTouchMarquee('tablet', 'mouse', 'select'),
      phoneTouchTrimHandlesInTrim: shouldExpandTouchTrimHandles('phone', 'touch', 'trim'),
      phoneTouchTrimHandlesInSelect: shouldExpandTouchTrimHandles('phone', 'touch', 'select'),
      phoneTouchToggleSelectionInSelect: shouldToggleTouchSelection('phone', 'touch', 'select'),
      tabletTouchPreserveSelectionInMove: shouldPreserveTouchSelectionForMove('tablet', 'touch', 'move'),
      tabletMousePreserveSelectionInMove: shouldPreserveTouchSelectionForMove('tablet', 'mouse', 'move'),
    }).toEqual({
      phoneTouchDragInSelect: false,
      phoneTouchDragInMove: true,
      tabletTouchMarqueeInSelect: true,
      tabletTouchMarqueeInMove: false,
      tabletMouseMarqueeInSelect: true,
      phoneTouchTrimHandlesInTrim: true,
      phoneTouchTrimHandlesInSelect: false,
      phoneTouchToggleSelectionInSelect: true,
      tabletTouchPreserveSelectionInMove: true,
      tabletMousePreserveSelectionInMove: false,
    });
  });

  it('keeps the mounted-vs-staged add boundary when a store provider exists but the editor is not mounted', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TimelineStoreProvider store={createTimelineStore()}>
            <AddToVideoEditorConsumer />
          </TimelineStoreProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('timeline-mounted')).toHaveTextContent('false');

    fireEvent.click(screen.getByRole('button', { name: 'add to video editor' }));

    expect(screen.getByTestId('add-phase')).toHaveTextContent('staged');
    expect(readPendingAdds()).toEqual(['generation-1']);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('keeps safe hooks nullable until the editor store is mounted, even when a store provider exists', () => {
    const bootstrap = createTimelineStore({}).getState();
    const store = createTimelineStore();

    const { rerender } = render(<TimelineStoreSafeHooksConsumer />);

    expect(screen.getByTestId('timeline-has-provider')).toHaveTextContent('false');
    expect(screen.getByTestId('timeline-mounted')).toHaveTextContent('false');
    expect(screen.getByTestId('safe-data-present')).toHaveTextContent('false');
    expect(screen.getByTestId('safe-ops-present')).toHaveTextContent('false');

    rerender(
      <TimelineStoreProvider store={store}>
        <TimelineStoreSafeHooksConsumer />
      </TimelineStoreProvider>,
    );

    expect(screen.getByTestId('timeline-has-provider')).toHaveTextContent('true');
    expect(screen.getByTestId('timeline-mounted')).toHaveTextContent('false');
    expect(screen.getByTestId('safe-data-present')).toHaveTextContent('false');
    expect(screen.getByTestId('safe-ops-present')).toHaveTextContent('false');

    act(() => {
      store.getState().syncSlices({
        data: bootstrap.data,
        ops: bootstrap.ops,
        chrome: bootstrap.chrome,
        playback: bootstrap.playback,
      });
    });

    expect(screen.getByTestId('timeline-mounted')).toHaveTextContent('true');
    expect(screen.getByTestId('safe-data-present')).toHaveTextContent('true');
    expect(screen.getByTestId('safe-ops-present')).toHaveTextContent('true');

    act(() => {
      store.getState().resetSlices();
    });

    expect(screen.getByTestId('timeline-has-provider')).toHaveTextContent('true');
    expect(screen.getByTestId('timeline-mounted')).toHaveTextContent('false');
    expect(screen.getByTestId('safe-data-present')).toHaveTextContent('false');
    expect(screen.getByTestId('safe-ops-present')).toHaveTextContent('false');
  });

  it('drops immediately when the mounted timeline store is available', () => {
    const registerGenerationAsset = vi.fn(() => 'asset-1');
    const handleAssetDrop = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const store = createTimelineStore({
      data: {
        ...createTimelineStore().getState().data,
        resolvedConfig: {
          clips: [
            { id: 'clip-1', at: 3, from: 0, to: 2 },
          ],
        } as never,
      },
      ops: {
        ...createTimelineStore().getState().ops,
        registerGenerationAsset,
        handleAssetDrop,
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TimelineStoreProvider store={store}>
            <AddToVideoEditorConsumer />
          </TimelineStoreProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('timeline-mounted')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('button', { name: 'add to video editor' }));

    expect(registerGenerationAsset).toHaveBeenCalledWith({
      generationId: 'generation-1',
      variantType: 'image',
      imageUrl: 'https://example.com/image.png',
      thumbUrl: 'https://example.com/image-thumb.png',
    });
    expect(handleAssetDrop).toHaveBeenCalledWith('asset-1', undefined, 5, false, false);
    expect(readPendingAdds()).toEqual([]);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('mounts the headless core with test ports and seeds the store before descendants render', async () => {
    const { CoreProvider } = await vi.importActual<typeof import('@/tools/video-editor/core/CoreProvider')>(
      '@/tools/video-editor/core/CoreProvider',
    );

    const snapshots: Array<{
      hasData: boolean;
      hasOps: boolean;
      mounted: boolean;
      selectedClipId: string | null;
    }> = [];

    function BootstrapReader({
      entries,
    }: {
      entries: typeof snapshots;
    }) {
      const data = useTimelineEditorDataSafe();
      const ops = useTimelineEditorOpsSafe();
      const availability = useTimelineAvailabilityState();

      entries.push({
        hasData: data !== null,
        hasOps: ops !== null,
        mounted: availability.mounted,
        selectedClipId: data?.selectedClipId ?? null,
      });

      return <span data-testid="bootstrap-selected-clip">{data?.selectedClipId ?? 'none'}</span>;
    }

    const { ports } = createCoreTestPorts({
      selectedProjectId: undefined,
      shots: undefined,
      finalVideoMap: undefined,
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CoreProvider
          ports={ports}
          timelineId={CORE_TEST_TIMELINE_ID}
          timelineName="Bootstrap Timeline"
          userId="user-1"
        >
          <BootstrapReader entries={snapshots} />
        </CoreProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('bootstrap-selected-clip')).toHaveTextContent('clip-1');
    expect(snapshots).toEqual([
      {
        hasData: true,
        hasOps: true,
        mounted: true,
        selectedClipId: 'clip-1',
      },
    ]);
  });

  it('navigates on the second staged click when the editor is not mounted', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AddToVideoEditorConsumer />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'add to video editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'add to video editor' }));

    expect(readPendingAdds()).toEqual(['generation-1']);
    expect(navigateMock).toHaveBeenCalledWith(
      `/tools/video-editor?timeline=timeline-staged&${ADD_GENERATION_QUERY_PARAM}=generation-1`,
    );
  });
});
