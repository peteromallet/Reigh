// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataProviderWrapper } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import { createVideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { VideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { VideoEditorRuntimeContextValue } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import type { VideoEditorSlotRenderer } from '@/tools/video-editor/runtime/extensionSurface.ts';
import { TimelineEditorShellCore } from '@/tools/video-editor/components/TimelineEditorShellCore.tsx';

// ---------------------------------------------------------------------------
// Mock hooks used by TimelineEditorShellCore
// ---------------------------------------------------------------------------

const useTimelineEditorDataMock = vi.fn();
const useTimelineEditorOpsMock = vi.fn();
const useTimelineChromeContextMock = vi.fn();
const useTimelinePlaybackContextMock = vi.fn();

vi.mock('@/tools/video-editor/hooks/timelineStore', () => ({
  useTimelineEditorData: () => useTimelineEditorDataMock(),
  useTimelineEditorOps: () => useTimelineEditorOpsMock(),
  useTimelineChromeContext: () => useTimelineChromeContextMock(),
  useTimelinePlaybackContext: () => useTimelinePlaybackContextMock(),
  useTimelineDataSlice: () => useTimelineEditorDataMock(),
  useTimelineOpsSlice: () => useTimelineEditorOpsMock(),
  useTimelineChromeSlice: () => useTimelineChromeContextMock(),
  useTimelinePlaybackSlice: () => useTimelinePlaybackContextMock(),
}));

const useVideoEditorSlotRenderersMock = vi.fn();
const useVideoEditorRenderContextMock = vi.fn();
const useVideoEditorAssetPanelsMock = vi.fn();

vi.mock('@/tools/video-editor/runtime/useVideoEditorRenderContext', () => ({
  useVideoEditorSlotRenderers: () => useVideoEditorSlotRenderersMock(),
  useVideoEditorRenderContext: () => useVideoEditorRenderContextMock(),
  useVideoEditorAssetPanels: () => useVideoEditorAssetPanelsMock(),
}));

vi.mock('@/tools/video-editor/hooks/usePerfDiagnostics', () => ({
  useRenderDiagnostic: vi.fn(),
}));

vi.mock('@/tools/video-editor/hooks/useTimelineRealtime', () => ({
  useTimelineRealtime: () => ({
    isOpen: false,
    setOpen: vi.fn(),
    keepLocalChanges: vi.fn(),
    discardAndReload: vi.fn(),
  }),
}));

vi.mock('@/tools/video-editor/hooks/useEditorSync', () => ({
  useEditorSync: () => ({
    isSyncAvailable: false,
    syncState: 'idle' as const,
    syncError: null,
    performSync: vi.fn(),
    lastSyncResult: null,
  }),
}));

vi.mock('@/tools/video-editor/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/tools/video-editor/hooks/useEditorKeybindings', () => ({
  useEditorKeybindings: vi.fn(),
}));

vi.mock('@/tools/video-editor/hooks/useEditorCommandRegistry', () => ({
  useEditorCommandRegistry: () => ({
    registry: {
      commands: [],
      queryCommands: () => [],
      executeCommand: () => null,
      getCommand: () => undefined,
      registerExecutor: vi.fn(),
      unregisterExecutor: vi.fn(),
    },
    buildContext: () => ({
      data: {} as any,
      timelineId: 'test-timeline',
      userId: 'test-user',
      selectedClipIds: [],
      source: 'keybinding' as const,
    }),
    execute: () => null,
    queryCommands: () => [],
    commands: [],
  }),
}));

vi.mock('@/tools/video-editor/lib/perf-diagnostics', () => ({
  bootDiagnostics: vi.fn(),
  MemoryPressureDetector: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('@/shared/lib/typedEvents', () => ({
  dispatchAppEvent: vi.fn(),
}));

vi.mock('@/tools/video-editor/components/PreviewPanel/PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="mock-preview-panel">Preview Panel</div>,
}));

vi.mock('@/tools/video-editor/components/PreviewPanel/useVideoEditorPreviewSurface', () => ({
  useVideoEditorPreviewSurface: () => ({
    slotRef: { current: null },
    portal: null,
  }),
}));

vi.mock('@/tools/video-editor/components/PropertiesPanel/PropertiesPanel', () => ({
  PropertiesPanel: () => <div data-testid="mock-properties-panel">Properties Panel</div>,
}));

vi.mock(
  '@/tools/video-editor/components/PropertiesPanel/VideoEditorAssetPanelSurface',
  () => ({
    VideoEditorAssetPanelSurface: () => (
      <div data-testid="mock-asset-panel-surface">Asset Panel Surface</div>
    ),
  }),
);

vi.mock('@/tools/video-editor/components/SequenceCreator/SequenceCreatorPanel', () => ({
  SequenceCreatorPanel: () => <div data-testid="mock-sequence-creator">Sequence Creator</div>,
}));

vi.mock('@/tools/video-editor/components/ThemeChip', () => ({
  ThemeChip: () => <span data-testid="mock-theme-chip">Theme</span>,
}));

vi.mock('@/tools/video-editor/components/TimelineEditor/TimelineEditor', () => ({
  TimelineEditor: () => <div data-testid="mock-timeline-editor">Timeline Editor</div>,
}));

vi.mock('@/tools/video-editor/lib/config-utils', () => ({
  getTimelineDurationInFrames: () => 300,
  parseResolution: () => ({ width: 1920, height: 1080 }),
}));

vi.mock('@/tools/video-editor/lib/keyboard-delete', () => ({
  buildKeyboardDeleteMutation: () => null,
}));

vi.mock('@/tools/video-editor/lib/mobile-interaction-model', () => ({
  areTimelineInteractionTargetsEqual: () => true,
}));

vi.mock('@/shared/state/selectionStore', () => ({
  editorReplaceTimelineSelection: vi.fn(),
}));

// Mock shared UI components
vi.mock('@/shared/components/ui/button.tsx', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/shared/components/ui/badge.tsx', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

vi.mock('@/shared/components/ui/slider.tsx', () => ({
  Slider: () => <div data-testid="mock-slider" />,
}));

vi.mock('@/shared/components/ui/dialog.tsx', () => ({
  Dialog: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/shared/components/ui/alert-dialog.tsx', () => ({
  AlertDialog: ({ children }: any) => <>{children}</>,
  AlertDialogAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock('@/shared/components/ui/dropdown-menu.tsx', () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  DropdownMenuLabel: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/shared/components/ui/contracts/cn.ts', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBaseEditorData() {
  return {
    data: null,
    resolvedConfig: {
      output: { fps: 30, resolution: '1920x1080' },
      tracks: [],
      clips: [],
    },
    deviceClass: 'desktop' as const,
    inputModality: 'pointer' as const,
    interactionMode: 'browse' as const,
    gestureOwner: null as any,
    precisionEnabled: false,
    contextTarget: { kind: 'timeline' as const },
    inspectorTarget: { kind: 'timeline' as const },
    interactionPolicy: {} as any,
    selectedClipId: null,
    selectedClipIds: new Set<string>(),
    selectedTrackId: null,
    dataRef: { current: { meta: {} } },
    pendingOpsRef: { current: null },
    interactionStateRef: { current: null },
    selectedClipIdsRef: { current: new Set<string>() },
    additiveSelectionRef: { current: false },
    timelineRef: { current: null },
    timelineWrapperRef: { current: null },
    activeTab: 'effects' as const,
    assetPanelState: {},
  };
}

function createBaseChrome() {
  return {
    saveStatus: 'saved' as const,
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    checkpoints: [],
    jumpToCheckpoint: vi.fn(),
    createManualCheckpoint: vi.fn(),
    scaleWidth: null,
    setScaleWidth: vi.fn(),
    startRender: vi.fn(),
    renderStatus: 'idle' as const,
    renderProgress: null,
    renderResultUrl: null,
    renderResultFilename: null,
    renderDirty: false,
    timelineName: 'Test Timeline',
    isConflictExhausted: false,
    retrySaveAfterConflict: vi.fn(),
    reloadFromServer: vi.fn(),
  };
}

function createBaseOps() {
  return {
    applyEdit: vi.fn(),
    handleDeleteClips: vi.fn(),
    moveSelectedClipsToTrack: vi.fn(),
    handleToggleMuteClips: vi.fn(),
    handleSplitSelectedClip: vi.fn(),
    clearSelection: vi.fn(),
    setInspectorTarget: vi.fn(),
    setContextTarget: vi.fn(),
    setInteractionMode: vi.fn(),
    setPrecisionEnabled: vi.fn(),
  };
}

function createBasePlayback() {
  return {
    currentTime: 0,
    formatTime: (_t: number) => '00:00',
    previewRef: { current: null },
    playerContainerRef: { current: null },
  };
}

function createRuntimeContext(
  store: VideoEditorDiagnosticsStore,
  overrides: Partial<VideoEditorRuntimeContextValue> = {},
): VideoEditorRuntimeContextValue {
  const { extensions: extOverride, ...rest } = overrides;
  const baseExtensions = {
    slots: {} as Record<string, any>,
    dialogHost: { dialogs: [] as any[] },
    registry: { panels: [] as any[], inspectorSections: [] as any[] },
    packages: {} as Record<string, any>,
    settings: {} as Record<string, any>,
    commands: [] as any[],
  };
  return {
    provider: {} as any,
    assetResolver: {} as any,
    auth: {} as any,
    project: {} as any,
    shots: {} as any,
    mediaLightbox: {} as any,
    agentChat: {} as any,
    toast: {} as any,
    telemetry: {} as any,
    timelineId: 'test-timeline',
    userId: 'test-user',
    timelineName: 'Test Timeline',
    extensions: extOverride
      ? { ...baseExtensions, ...extOverride }
      : baseExtensions,
    diagnosticsStore: store,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimelineEditorShellCore extension fallback', () => {
  it('renders default toolbar when extension toolbar slot throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = createVideoEditorDiagnosticsStore();

    // Register an extension toolbar slot that throws
    const throwingToolbar: VideoEditorSlotRenderer = () => {
      throw new Error('Toolbar extension render failure');
    };

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({ toolbar: throwingToolbar });
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store, {
      extensions: {
        slots: { toolbar: throwingToolbar },
        dialogHost: { dialogs: [] },
        registry: { panels: [], inspectorSections: [] },
      },
    });

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    // The shell should still be rendered (not crashed)
    expect(screen.getByTestId('mock-timeline-editor')).toBeInTheDocument();

    // The default toolbar (which contains save badge showing "saved")
    // should be rendered as the fallback, not "Extension content unavailable"
    expect(screen.getByText('saved')).toBeInTheDocument();

    // The generic fallback message should NOT appear
    expect(screen.queryByTestId('extension-render-fallback')).not.toBeInTheDocument();

    // Diagnostics should be emitted
    const snapshot = store.getSnapshot();
    expect(snapshot.length).toBeGreaterThanOrEqual(1);
    const toolbarDiag = snapshot.find((d) => d.code === 'extension_render_exception');
    expect(toolbarDiag).toBeDefined();
    expect(toolbarDiag!.source).toBe('extension-render');
    expect(toolbarDiag!.severity).toBe('error');
    expect(toolbarDiag!.detail).toMatchObject({
      descriptorId: 'toolbar',
      descriptorType: 'slot',
      slotName: 'toolbar',
      errorMessage: 'Toolbar extension render failure',
    });

    spy.mockRestore();
  });

  it('renders default header when extension header slot throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = createVideoEditorDiagnosticsStore();

    const throwingHeader: VideoEditorSlotRenderer = () => {
      throw new Error('Header extension render failure');
    };

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue({
      ...createBaseChrome(),
      timelineName: 'My Custom Timeline',
    });
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({ header: throwingHeader });
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store, {
      extensions: {
        slots: { header: throwingHeader },
        dialogHost: { dialogs: [] },
        registry: { panels: [], inspectorSections: [] },
      },
    });

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    // The shell should still render
    expect(screen.getByTestId('mock-timeline-editor')).toBeInTheDocument();

    // The default header should appear (showing timeline name) as fallback
    expect(screen.getByText('My Custom Timeline')).toBeInTheDocument();

    // The generic fallback should NOT appear
    expect(screen.queryByTestId('extension-render-fallback')).not.toBeInTheDocument();

    // Diagnostics should be emitted
    const snapshot = store.getSnapshot();
    const headerDiag = snapshot.find(
      (d) => d.code === 'extension_render_exception' && d.detail?.descriptorId === 'header',
    );
    expect(headerDiag).toBeDefined();
    expect(headerDiag!.source).toBe('extension-render');
    expect(headerDiag!.severity).toBe('error');
    expect(headerDiag!.detail).toMatchObject({
      descriptorId: 'header',
      descriptorType: 'slot',
      slotName: 'header',
      errorMessage: 'Header extension render failure',
    });

    spy.mockRestore();
  });

  it('renders default toolbar normally when no extension slot is registered', () => {
    const store = createVideoEditorDiagnosticsStore();

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({});
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    // Default toolbar shows save badge
    expect(screen.getByText('saved')).toBeInTheDocument();

    // No diagnostics should be emitted
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('renders extension toolbar when slot renders successfully', () => {
    const store = createVideoEditorDiagnosticsStore();

    const healthyToolbar: VideoEditorSlotRenderer = () => (
      <div data-testid="ext-toolbar">Extension Toolbar Content</div>
    );

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({ toolbar: healthyToolbar });
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store, {
      extensions: {
        slots: { toolbar: healthyToolbar },
        dialogHost: { dialogs: [] },
        registry: { panels: [], inspectorSections: [] },
      },
    });

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    // The extension toolbar content should render
    expect(screen.getByTestId('ext-toolbar')).toBeInTheDocument();
    expect(screen.getByText('Extension Toolbar Content')).toBeInTheDocument();

    // The default toolbar save badge should NOT be visible
    expect(screen.queryByText('saved')).not.toBeInTheDocument();

    // No diagnostics
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('shell remains usable when extension slot throws — editor and preview still render', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = createVideoEditorDiagnosticsStore();

    const throwingToolbar: VideoEditorSlotRenderer = () => {
      throw new Error('boom');
    };
    const throwingHeader: VideoEditorSlotRenderer = () => {
      throw new Error('header boom');
    };

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({
      toolbar: throwingToolbar,
      header: throwingHeader,
    });
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store, {
      extensions: {
        slots: { toolbar: throwingToolbar, header: throwingHeader },
        dialogHost: { dialogs: [] },
        registry: { panels: [], inspectorSections: [] },
      },
    });

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    // Core shell components still render
    expect(screen.getByTestId('mock-timeline-editor')).toBeInTheDocument();
    expect(screen.getByTestId('mock-preview-panel')).toBeInTheDocument();
    expect(screen.getByTestId('mock-properties-panel')).toBeInTheDocument();

    // Default toolbar/header fallbacks appear
    expect(screen.getByText('saved')).toBeInTheDocument();
    expect(screen.getByText('Test Timeline')).toBeInTheDocument();

    // Diagnostics are emitted (at least one, exact count depends on dedup behavior
    // when both slots share the same source+code without distinct extensionId)
    const snapshot = store.getSnapshot();
    expect(snapshot.length).toBeGreaterThanOrEqual(1);
    const renderDiags = snapshot.filter((d) => d.code === 'extension_render_exception');
    expect(renderDiags.length).toBeGreaterThanOrEqual(1);
    expect(renderDiags[0].source).toBe('extension-render');

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Diagnostics button integration
// ---------------------------------------------------------------------------

describe('TimelineEditorShellCore diagnostics button', () => {
  it('renders diagnostics button with stable selector', () => {
    const store = createVideoEditorDiagnosticsStore();

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({});
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    // The diagnostics button should be present with the stable selector
    expect(screen.getByTestId('video-editor-diagnostics-button')).toBeInTheDocument();
  });

  it('does not show count badge when no diagnostics are present', () => {
    const store = createVideoEditorDiagnosticsStore();

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({});
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    const button = screen.getByTestId('video-editor-diagnostics-button');
    // No badge element when count is 0
    const badgeEl = button.querySelector('[class*="rounded-full"]');
    expect(badgeEl).toBeNull();
  });

  it('shows error count badge when errors are present', () => {
    const store = createVideoEditorDiagnosticsStore();

    // Add 2 errors and 1 warning
    store.report({
      severity: 'error',
      source: 'extension-loader',
      code: 'E001',
      message: 'Error 1',
    });
    store.report({
      severity: 'error',
      source: 'extension-loader',
      code: 'E002',
      message: 'Error 2',
    });
    store.report({
      severity: 'warning',
      source: 'provider',
      code: 'W001',
      message: 'Warning 1',
    });

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({});
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    const button = screen.getByTestId('video-editor-diagnostics-button');
    // Badge should show "3" (total count)
    expect(button.textContent).toContain('3');

    // Button should be in error state (red-400 class when errors > 0)
    expect(button.className).toContain('text-red-400');
  });

  it('shows warning state when only warnings are present', () => {
    const store = createVideoEditorDiagnosticsStore();

    store.report({
      severity: 'warning',
      source: 'provider',
      code: 'W001',
      message: 'Warning 1',
    });

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({});
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    const button = screen.getByTestId('video-editor-diagnostics-button');
    // Badge should show "1"
    expect(button.textContent).toContain('1');

    // Button should be in warning state (amber-400 class when warnings > 0, errors === 0)
    expect(button.className).toContain('text-amber-400');
  });

  it('renders diagnostics panel when store has diagnostics', () => {
    const store = createVideoEditorDiagnosticsStore();

    store.report({
      severity: 'error',
      source: 'extension-loader',
      code: 'E001',
      message: 'Test error',
    });

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({});
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    // The diagnostics panel should be rendered (dialog mock renders children unconditionally)
    expect(screen.getByTestId('video-editor-diagnostics-panel')).toBeInTheDocument();

    // The diagnostic message should appear
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('shows title with error and warning counts', () => {
    const store = createVideoEditorDiagnosticsStore();

    store.report({
      severity: 'error',
      source: 'extension-loader',
      code: 'E001',
      message: 'Error 1',
    });
    store.report({
      severity: 'warning',
      source: 'provider',
      code: 'W001',
      message: 'Warning 1',
    });

    useTimelineEditorDataMock.mockReturnValue(createBaseEditorData());
    useTimelineEditorOpsMock.mockReturnValue(createBaseOps());
    useTimelineChromeContextMock.mockReturnValue(createBaseChrome());
    useTimelinePlaybackContextMock.mockReturnValue(createBasePlayback());
    useVideoEditorSlotRenderersMock.mockReturnValue({});
    useVideoEditorRenderContextMock.mockReturnValue({});
    useVideoEditorAssetPanelsMock.mockReturnValue([]);

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <TimelineEditorShellCore timelineId="test-timeline" />
      </DataProviderWrapper>,
    );

    // Button title should reflect counts
    const button = screen.getByTestId('video-editor-diagnostics-button');
    expect(button.getAttribute('title')).toContain('1 error');
    expect(button.getAttribute('title')).toContain('1 warning');
  });
});
