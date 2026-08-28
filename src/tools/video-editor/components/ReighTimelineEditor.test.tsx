// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReighTimelineEditor } from '@/tools/video-editor/components/ReighTimelineEditor';
import {
  createTimelineStore,
  TimelineStoreProvider,
} from '@/tools/video-editor/hooks/timelineStore';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data';
import type { Shot } from '@/domains/generation/types/index.ts';
import { EMPTY_SHOT_ANCHOR_APP_KEY } from '@/tools/video-editor/lib/shot-group-commands';
import { VideoEditorRuntimeProvider } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext';

// ---------------------------------------------------------------------------
// Mocks for hooks that require deep context chains or backend access
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  createShot: vi.fn(),
  navigateToShot: vi.fn(),
  pinGroup: vi.fn(),
  shots: [] as Shot[],
  selectedProjectId: 'project-1',
}));

vi.mock('@/tools/video-editor/hooks/usePerfDiagnostics', () => ({
  useRenderDiagnostic: () => undefined,
}));

vi.mock('@/tools/video-editor/hooks/useClipDrag', () => ({
  useClipDrag: () => ({ dragSessionRef: { current: null } }),
}));

vi.mock('@/tools/video-editor/hooks/useMarqueeSelect', () => ({
  useMarqueeSelect: () => ({
    marqueeRect: null,
    onPointerDown: vi.fn(),
  }),
}));

vi.mock('@/tools/video-editor/hooks/useStaleVariants', () => ({
  useStaleVariants: () => ({
    staleAssetKeys: new Set<string>(),
    dismissedAssetKeys: new Set<string>(),
    generationAssetKeys: new Set<string>(),
    dismissAsset: vi.fn(),
    updateAssetToCurrentVariant: vi.fn(),
    applyVariantToAsset: vi.fn(),
  }),
}));

vi.mock('@/tools/video-editor/hooks/useActiveTaskClips', () => ({
  useActiveTaskClips: () => ({ activeTaskAssetKeys: new Set<string>() }),
}));

vi.mock('@/tools/video-editor/hooks/useAddVariantAsGeneration', () => ({
  useAddVariantAsGeneration: () => ({
    addVariantAsGenerationAfterClip: vi.fn(),
    isPending: false,
    isAddingVariantAsGenerationPending: () => false,
  }),
}));

vi.mock('@/shared/hooks/shotCreation/useShotCreation', () => ({
  useShotCreation: () => ({
    createShot: mocks.createShot,
    isCreating: false,
    lastCreatedShot: null,
    clearLastCreated: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/shots/useShotNavigation', () => ({
  useShotNavigation: () => ({
    navigateToShot: mocks.navigateToShot,
    navigateToShotEditor: vi.fn(),
    navigateToNextShot: vi.fn(),
    navigateToPreviousShot: vi.fn(),
  }),
}));

vi.mock('@/shared/contexts/ProjectContext', () => ({
  useProjectSelectionContext: () => ({ selectedProjectId: mocks.selectedProjectId }),
}));

vi.mock('@/shared/contexts/ShotsContext', () => ({
  useShots: () => ({ shots: mocks.shots }),
}));

vi.mock('@/tools/video-editor/hooks/useShotGroups', () => ({
  useShotGroups: () => [],
}));

vi.mock('@/tools/video-editor/hooks/usePinnedShotGroups', () => ({
  usePinnedShotGroupViews: () => [],
  usePinnedShotGroups: () => ({
    pinGroup: mocks.pinGroup,
    unpinGroup: vi.fn(),
    updatePinnedGroup: vi.fn(),
  }),
  usePinnedGroupSync: () => undefined,
}));

vi.mock('@/tools/video-editor/hooks/useShotGroupHandlers', () => ({
  useShotGroupHandlers: () => ({
    shotGroupClipIds: new Set<string>(),
    activeTaskClipIds: new Set<string>(),
    staleShotGroupIds: new Set<string>(),
    handleShotGroupNavigate: vi.fn(),
    handleShotGroupGenerateVideo: vi.fn(),
    handleDeleteShotGroup: vi.fn(),
    handleUpdateToLatestVideo: vi.fn(),
    handleShotGroupUnpin: vi.fn(),
    handleShotGroupSwitchToFinalVideo: vi.fn(),
    handleShotGroupSwitchToImages: vi.fn(),
  }),
}));

vi.mock('@/tools/video-editor/hooks/useSwitchToFinalVideo', () => ({
  useSwitchToFinalVideo: () => ({
    switchToFinalVideo: vi.fn(),
    updateToLatestVideo: vi.fn(),
    switchToImages: vi.fn(),
  }),
}));

vi.mock('@/tools/video-editor/hooks/useFinalVideoAvailable', () => ({
  useFinalVideoAvailable: () => ({
    finalVideoMap: new Map(),
    dismissFinalVideo: vi.fn(),
  }),
}));

vi.mock('@/tools/travel-between-images/components/VideoGenerationModal', () => ({
  VideoGenerationModal: () => null,
}));

// ---------------------------------------------------------------------------
// Store data fixture: a minimal but structurally valid TimelineData
// ---------------------------------------------------------------------------

const timelineData: TimelineData = {
  config: {
    output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
    tracks: [
      { id: 'V1', kind: 'visual', label: 'V1' },
    ],
    clips: [],
    pinnedShotGroups: [],
  },
  configVersion: 1,
  registry: { assets: {} },
  resolvedConfig: {
    output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    clips: [],
    registry: { assets: {} },
  },
  rows: [{ id: 'V1', actions: [] }],
  meta: {},
  effects: {},
  assetMap: {},
  output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
  tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
  clipOrder: { V1: [] },
  signature: 'signature',
  stableSignature: 'stable-signature',
};

function createTestStore() {
  const store = createTimelineStore();
  store.getState().syncSlices({
    data: {
      data: timelineData,
      resolvedConfig: timelineData.resolvedConfig,
      deviceClass: 'desktop' as const,
      inputModality: 'mouse' as const,
      interactionMode: 'browse' as const,
      gestureOwner: 'none' as const,
      precisionEnabled: false,
      contextTarget: 'timeline' as const,
      inspectorTarget: 'none' as const,
      interactionPolicy: {
        deviceClass: 'desktop' as const,
        inputModality: 'mouse' as const,
        interactionMode: 'browse' as const,
        gestureOwner: 'none' as const,
        precisionEnabled: false,
        contextTarget: 'timeline' as const,
        inspectorTarget: 'none' as const,
      },
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      selectedClipIdsRef: { current: new Set<string>() },
      additiveSelectionRef: { current: false },
      selectedTrackId: null,
      primaryClipId: null,
      selectedClip: null,
      selectedTrack: null,
      selectedClipHasPredecessor: false,
      compositionSize: { width: 1920, height: 1080 },
      trackScaleMap: {},
      scale: 30,
      scaleWidth: 30,
      isLoading: false,
      dataRef: { current: timelineData },
      pendingOpsRef: { current: 0 },
      interactionStateRef: { current: null },
      coordinator: {
        update: vi.fn(() => null),
        showSecondaryGhosts: vi.fn(),
        end: vi.fn(),
        lastPosition: null,
        editAreaRef: { current: null },
      },
      indicatorRef: { current: null },
      editAreaRef: { current: null },
      preferences: {
        scaleWidth: 30,
        timelineHeight: 400,
        labelWidth: 160,
      },
      timelineRef: { current: null },
      timelineWrapperRef: { current: null },
    },
    playback: {
      currentTime: 5.0,
      previewRef: { current: null },
      playerContainerRef: { current: null },
      onPreviewTimeUpdate: vi.fn(),
      formatTime: (t: number) => `${t.toFixed(1)}s`,
    },
    ops: {
      applyEdit: vi.fn(),
      moveClipToRow: vi.fn(),
      createTrackAndMoveClip: vi.fn(),
      selectClip: vi.fn(),
      selectClips: vi.fn(),
      addToSelection: vi.fn(),
      clearSelection: vi.fn(),
      isClipSelected: () => false,
      setSelectedTrackId: vi.fn(),
      handleTrackPopoverChange: vi.fn(),
      handleMoveTrack: vi.fn(),
      handleRemoveTrack: vi.fn(),
      handleSplitClipAtTime: vi.fn(),
      handleSplitClipsAtPlayhead: vi.fn(),
      handleDeleteClips: vi.fn(),
      handleDeleteClip: vi.fn(),
      handleToggleMuteClips: vi.fn(),
      onCursorDrag: vi.fn(),
      onClickTimeArea: vi.fn(),
      setGestureOwner: vi.fn(),
      setInputModalityFromPointerType: vi.fn(() => 'mouse'),
      setContextTarget: vi.fn(),
      setInspectorTarget: vi.fn(),
      onActionResizeStart: vi.fn(),
      onClipEdgeResizeEnd: vi.fn(),
      onTimelineDragOver: vi.fn(),
      onTimelineDragLeave: vi.fn(),
      onTimelineDrop: vi.fn(),
      onDoubleClickAsset: vi.fn(),
      patchRegistry: vi.fn(),
      registerAsset: vi.fn(),
    },
    chrome: {
      handleAddTrack: vi.fn(),
      handleAddTextAt: vi.fn(),
      handleClearUnusedTracks: vi.fn(),
      unusedTrackCount: 0,
    },
  });
  return store;
}

function renderEditor() {
  const store = createTestStore();
  const result = render(
    <TimelineStoreProvider store={store}>
      <VideoEditorRuntimeProvider value={{
        userId: null,
        timelineId: 'timeline-1',
        project: { projectId: 'project-1' },
        provider: {},
      } as never}>
        <ReighTimelineEditor />
      </VideoEditorRuntimeProvider>
    </TimelineStoreProvider>,
  );
  return { ...result, store };
}

function getTimelineBackground(container: HTMLElement) {
  const background = container.querySelector('.timeline-canvas-edit-area > .relative');
  if (!(background instanceof HTMLElement)) {
    throw new Error('expected timeline background');
  }
  return background;
}

describe('ReighTimelineEditor empty-area shot creation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates an empty shot anchored at the clicked time and applies the anchor edit', async () => {
    mocks.createShot.mockResolvedValue({
      shotId: 'shot-new',
      shotName: 'Shot 1',
      shot: { id: 'shot-new', name: 'Shot 1' },
    });
    const { container, store } = renderEditor();
    const background = getTimelineBackground(container);

    fireEvent.contextMenu(background, { clientX: 100, clientY: 40 });

    expect(screen.getByText('Create Shot')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Create Shot'));

    await vi.waitFor(() => {
      expect(mocks.createShot).toHaveBeenCalledTimes(1);
    });
    expect(mocks.createShot).toHaveBeenCalledWith();
    // The editor stays on the timeline: navigation would unmount it and drop
    // the debounced save before it lands, so the anchor must not depend on it.
    expect(mocks.navigateToShot).not.toHaveBeenCalled();

    const applyEdit = store.getState().ops.applyEdit as ReturnType<typeof vi.fn>;
    expect(applyEdit).toHaveBeenCalledTimes(1);
    const mutation = applyEdit.mock.calls[0][0];
    expect(mutation.type).toBe('rows');
    const anchorClip = mutation.rows[0].actions[0];
    expect(anchorClip).toBeDefined();
    expect(mutation.metaUpdates[anchorClip.id]).toEqual(expect.objectContaining({
      track: 'V1',
      clipType: 'text',
      label: 'Shot 1',
      app: { [EMPTY_SHOT_ANCHOR_APP_KEY]: { shotId: 'shot-new', shotName: 'Shot 1' } },
    }));
    expect(mutation.pinnedShotGroupsOverride).toEqual([{
      shotId: 'shot-new',
      trackId: 'V1',
      clipIds: [anchorClip.id],
      mode: 'images',
    }]);
    expect(applyEdit.mock.calls[0][1]).toEqual(expect.objectContaining({
      selectedClipId: anchorClip.id,
      selectedTrackId: 'V1',
      semantic: true,
    }));
  });

  it('does not edit when shot creation returns no shot', async () => {
    mocks.createShot.mockResolvedValue(null);
    const { container, store } = renderEditor();
    const background = getTimelineBackground(container);

    fireEvent.contextMenu(background, { clientX: 100, clientY: 40 });
    fireEvent.click(screen.getByText('Create Shot'));

    await vi.waitFor(() => {
      expect(mocks.createShot).toHaveBeenCalledTimes(1);
    });
    expect(mocks.navigateToShot).not.toHaveBeenCalled();
    expect(store.getState().ops.applyEdit).not.toHaveBeenCalled();
  });
});
