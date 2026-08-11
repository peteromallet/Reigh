// Layer map & invariants: docs/structure_detail/tool_video_editor.md
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette } from '@/tools/video-editor/components/CommandPalette/CommandPalette.tsx';
import { Eye, Maximize2, Settings, SlidersHorizontal } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/components/ui/alert-dialog.tsx';
import { Button } from '@/shared/components/ui/button.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { Slider } from '@/shared/components/ui/slider.tsx';
import { editorReplaceTimelineSelection } from '@/shared/state/selectionStore.ts';
import { PreviewPanel } from '@/tools/video-editor/components/PreviewPanel/PreviewPanel.tsx';
import { useVideoEditorPreviewSurface } from '@/tools/video-editor/components/PreviewPanel/useVideoEditorPreviewSurface.tsx';
import {
  LiveSourcesPanel,
  removeLiveBindingsFromResolvedConfig,
} from '@/tools/video-editor/components/LiveSourcesPanel/LiveSourcesPanel.tsx';
import { PropertiesPanel } from '@/tools/video-editor/components/PropertiesPanel/PropertiesPanel.tsx';
import { SequenceCreatorPanel } from '@/tools/video-editor/components/SequenceCreator/SequenceCreatorPanel.tsx';
import { ThemeChip } from '@/tools/video-editor/components/ThemeChip.tsx';
import {
  TimelineModeSwitcher,
  type TimelineSwitchableMode,
} from '@/tools/video-editor/components/TimelineModeSwitcher.tsx';
import { TimelineEditor } from '@/tools/video-editor/components/TimelineEditor/TimelineEditor.tsx';
import { TimelineErrorBoundary } from '@/tools/video-editor/components/TimelineEditor/TimelineErrorBoundary.tsx';
import {
  useTimelineChromeContext,
  useTimelineEditorData,
  useTimelineEditorOps,
  useTimelinePlaybackContext,
  useProposalRuntimeFromStoreSafe,
  useProposalImportDiagnosticsFromStoreSafe,
} from '@/tools/video-editor/hooks/timelineStore.ts';
import { useKeyboardShortcuts } from '@/tools/video-editor/hooks/useKeyboardShortcuts.ts';
import { useTimelineRealtime } from '@/tools/video-editor/hooks/useTimelineRealtime.ts';
import { getTimelineDurationInFrames, parseResolution } from '@/tools/video-editor/lib/config-utils.ts';
import { buildKeyboardDeleteMutation } from '@/tools/video-editor/lib/keyboard-delete.ts';
import { buildKeyboardTimeNudgeMutation } from '@/tools/video-editor/lib/keyboard-nudge.ts';
import {
  APP_PANE_RAIL_GUTTER_PX,
  areTimelineInteractionTargetsEqual,
  resolveTimelineModeSwitcherVariant,
  shouldReserveAppPaneRailGutter,
  type TimelineInspectorTarget,
} from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import { bootDiagnostics, MemoryPressureDetector } from '@/tools/video-editor/lib/perf-diagnostics.ts';
import { shellRegionAttrs } from '@/tools/video-editor/lib/timeline-dom.ts';
import { useRenderDiagnostic } from '@/tools/video-editor/hooks/usePerfDiagnostics.ts';
import { dispatchAppEvent } from '@/shared/lib/typedEvents.ts'
import { ExtensionActivityRegion, type ExtensionStatusEvent } from '@/tools/video-editor/components/ExtensionActivityRegion';
import { ProposalPanel } from '@/tools/video-editor/components/ProposalPanel/ProposalPanel.tsx';
import { TimelineEditorShellToolbar } from './TimelineEditorShellToolbar.tsx';
import { TimelineExportMenu } from './TimelineExportMenu.tsx';
import { TimelineLoadErrorCard } from './TimelineLoadErrorCard.tsx';
import { TimelineMobileInspectorDialog } from './TimelineMobileInspectorDialog.tsx';
import { TimelineRenderControls } from './TimelineRenderControls.tsx';
import { TimelineSyncDivergenceDialog } from './TimelineSyncDivergenceDialog.tsx';
import { useEditorSyncFeedback } from './useEditorSyncFeedback.ts';
import {
  CHROME_OVERHEAD,
  MIN_PREVIEW_HEIGHT,
  useTimelineShellDividerDrag,
} from './useTimelineShellDividerDrag.ts';
import { useVideoEditorShellSlots } from './useVideoEditorShellSlots.tsx';

export interface TimelineEditorShellCoreProps {
  timelineId: string;
  forceCondensed?: boolean;
  isOnEditorPage?: boolean;
  isEditorPaneLocked?: boolean;
  isGenerationsPaneLocked?: boolean;
  onSetGenerationsPaneLocked?: (locked: boolean) => void;
  onNavigateHome?: () => void;
  onOpenEditorRoute?: (timelineId: string) => void;
}

function getInspectorTargetForSelection(
  selectedClipIds: string[],
  selectedTrackId: string | null,
): TimelineInspectorTarget {
  if (selectedClipIds.length > 1) {
    return { kind: 'selection', clipIds: selectedClipIds };
  }

  if (selectedClipIds.length === 1) {
    return { kind: 'clip', clipId: selectedClipIds[0] };
  }

  if (selectedTrackId) {
    return { kind: 'track', trackId: selectedTrackId };
  }

  return { kind: 'timeline' };
}

function TimelineEditorShellCoreComponent({
  timelineId,
  forceCondensed = false,
  isOnEditorPage = false,
  isEditorPaneLocked = false,
  isGenerationsPaneLocked = false,
  onSetGenerationsPaneLocked,
  onNavigateHome,
  onOpenEditorRoute,
}: TimelineEditorShellCoreProps) {
  useRenderDiagnostic('TimelineEditorShellCore');
  const editorData = useTimelineEditorData();
  const editorOps = useTimelineEditorOps();
  const chrome = useTimelineChromeContext();
  const playback = useTimelinePlaybackContext();
  const isPhone = editorData.deviceClass === 'phone';
  const isTablet = editorData.deviceClass === 'tablet';
  const {
    containerRef,
    dividerRef,
    isTimelineMaximized,
    setIsTimelineMaximized,
    onDividerMouseDown,
    gridTemplateRows,
  } = useTimelineShellDividerDrag();
  const [condensedRightPanel, setCondensedRightPanel] = useState<'preview' | 'properties'>('preview');
  const [isMobilePropertiesOpen, setIsMobilePropertiesOpen] = useState(false);
  const [isSequenceCreatorOpen, setIsSequenceCreatorOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  /** M1: Extension activity region status events (placeholder state). */
  const [activityEvents, setActivityEvents] = useState<readonly ExtensionStatusEvent[]>([]);
  const handleActivityDismiss = useCallback((eventId: string) => {
    setActivityEvents((prev) => prev.filter((e) => e.id !== eventId));
  }, []);

  /** M2: Proposal runtime and import diagnostics from timelineStore. */
  const proposalRuntime = useProposalRuntimeFromStoreSafe();
  const proposalImportDiagnostics = useProposalImportDiagnosticsFromStoreSafe();
  const timelineFps = Math.max(1, editorData.resolvedConfig?.output?.fps ?? 30);
  const conflict = useTimelineRealtime({
    timelineId,
    conflictExhausted: chrome.isConflictExhausted,
    onKeepLocalChanges: chrome.retrySaveAfterConflict,
    onDiscardRemoteChanges: chrome.reloadFromServer,
  });
  const { sync, syncDialogOpen, setSyncDialogOpen, syncResultMessage } = useEditorSyncFeedback();

  useEffect(() => {
    bootDiagnostics();
    MemoryPressureDetector.start();
    return MemoryPressureDetector.stop;
  }, []);

  // M4: Host-reserved command palette keyboard shortcut (CtrlOrCmd+Shift+P).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Don't trigger when the palette is already open — the cmdk dialog
      // owns keyboard handling in that case.
      if (isCommandPaletteOpen) return;

      const isModifierPressed = event.metaKey || event.ctrlKey;
      if (isModifierPressed && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        event.stopPropagation();
        setIsCommandPaletteOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [isCommandPaletteOpen]);

  const handleKeyboardDelete = useCallback(() => {
    const mutation = buildKeyboardDeleteMutation(editorData.dataRef.current, editorData.selectedClipIds);
    if (mutation) {
      editorOps.applyEdit(mutation, { semantic: true });
      return;
    }

    editorOps.handleDeleteClips([...editorData.selectedClipIds]);
  }, [editorData.dataRef, editorData.selectedClipIds, editorOps]);

  const handleKeyboardTimeNudge = useCallback((deltaSeconds: number) => {
    const mutation = buildKeyboardTimeNudgeMutation(
      editorData.dataRef.current,
      editorData.selectedClipIds,
      deltaSeconds,
    );
    if (mutation) {
      editorOps.applyEdit(mutation, { semantic: true });
    }
  }, [editorData.dataRef, editorData.selectedClipIds, editorOps]);

  useKeyboardShortcuts({
    hasSelectedClip: editorData.selectedClipIds.size > 0,
    canMoveSelectedClipToTrack: editorData.selectedClipIds.size >= 1,
    precisionEnabled: editorData.precisionEnabled,
    selectedClipIds: editorData.selectedClipIds,
    timelineFps,
    moveSelectedClipsToTrack: editorOps.moveSelectedClipsToTrack,
    nudgeSelectedClipsInTime: handleKeyboardTimeNudge,
    undo: chrome.undo,
    redo: chrome.redo,
    selectAllClips: () => editorReplaceTimelineSelection(Object.keys(editorData.data?.meta ?? {})),
    togglePlayPause: () => playback.previewRef.current?.togglePlayPause(),
    seekRelative: (deltaSeconds) => playback.previewRef.current?.seek(Math.max(0, playback.currentTime + deltaSeconds)),
    toggleMute: () => editorOps.handleToggleMuteClips([...editorData.selectedClipIds]),
    splitSelectedClip: editorOps.handleSplitSelectedClip,
    deleteSelectedClip: handleKeyboardDelete,
    clearSelection: editorOps.clearSelection,
  });

  const outputResolution = editorData.resolvedConfig?.output?.resolution;
  const aspectRatio = useMemo(() => {
    if (!outputResolution) {
      return 16 / 9;
    }

    const { width, height } = parseResolution(outputResolution);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return 16 / 9;
    }

    return width / height;
  }, [outputResolution]);
  const [tooSmall, setTooSmall] = useState(false);
  const outerRef = useRef<HTMLDivElement>(null);
  const selectedClipIdsList = useMemo(() => [...editorData.selectedClipIds], [editorData.selectedClipIds]);
  const inspectorTarget = useMemo(
    () => getInspectorTargetForSelection(selectedClipIdsList, editorData.selectedTrackId),
    [editorData.selectedTrackId, selectedClipIdsList],
  );

  useEffect(() => {
    const el = outerRef.current;
    if (!el || forceCondensed) return;

    const observer = new ResizeObserver(([entry]) => {
      const minPreviewHeight = isTimelineMaximized
        ? MIN_PREVIEW_HEIGHT
        : Math.max(MIN_PREVIEW_HEIGHT, Math.min(360, entry.contentRect.width * 0.35) / aspectRatio);
      setTooSmall(entry.contentRect.height < minPreviewHeight + CHROME_OVERHEAD);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [forceCondensed, aspectRatio, isTimelineMaximized]);

  const mobileSinglePane = isPhone && !forceCondensed;
  const condensed = forceCondensed || tooSmall || mobileSinglePane || (isOnEditorPage && isEditorPaneLocked);
  const hasClipSelection = selectedClipIdsList.length > 0;
  const mobilePropertiesTitle = hasClipSelection
    ? selectedClipIdsList.length > 1
      ? `Selected clips (${selectedClipIdsList.length})`
      : 'Selected clip'
    : 'Inspector';
  const mobilePropertiesDescription = hasClipSelection
    ? 'Use inspector-first controls for trim, move, track changes, split, mute, and delete without relying on direct manipulation.'
    : 'Use the inspector for timeline controls and mode changes when you need more precision.';
  const inspectorButtonLabel = hasClipSelection
    ? selectedClipIdsList.length > 1
      ? `Selection (${selectedClipIdsList.length})`
      : 'Clip'
    : 'Inspector';
  const touchChrome = isPhone || isTablet;
  const previewActionButtonClass = touchChrome ? 'h-11 min-w-11 px-3 text-[11px]' : 'h-7 px-3 text-[11px]';
  const interactionStatusLabel = [
    `Timeline mode ${editorData.interactionMode}.`,
    `Precision ${editorData.precisionEnabled ? 'enabled' : 'disabled'}.`,
    editorData.gestureOwner === 'preview'
      ? 'Preview transform active.'
      : (touchChrome ? 'Touch controls are available for shell, timeline, and preview actions.' : 'Desktop pointer controls are active.'),
  ].join(' ');

  useEffect(() => {
    if (!areTimelineInteractionTargetsEqual(editorData.inspectorTarget, inspectorTarget)) {
      editorOps.setInspectorTarget(inspectorTarget);
    }
  }, [editorData.inspectorTarget, editorOps, inspectorTarget]);

  useEffect(() => {
    if (isTablet && condensed && hasClipSelection && condensedRightPanel !== 'properties') {
      setCondensedRightPanel('properties');
    }
  }, [condensed, condensedRightPanel, hasClipSelection, isTablet]);

  const previewSurface = useVideoEditorPreviewSurface({ compact: condensed, touchChrome });

  const {
    compileOnlyExportFormats,
    renderDependentExportFormats,
    hasAnyExportFormat,
    headerSlot,
    toolbarSlot,
    assetPanelSlot,
    inspectorPanelSlot,
    timelineFooterSlot,
    statusBarSlot,
    leftPanelSlot,
    rightPanelSlot,
    codePanelSlot,
    writingPanelSlot,
    stagePanelSlot,
    dialogsSlot,
  } = useVideoEditorShellSlots();

  const totalSeconds = useMemo(() => {
    if (!editorData.resolvedConfig) return 1;
    return getTimelineDurationInFrames(editorData.resolvedConfig, editorData.resolvedConfig.output.fps) / editorData.resolvedConfig.output.fps;
  }, [editorData.resolvedConfig]);

  const handleRemoveLiveSourceBindings = useCallback((sourceId: string) => {
    const currentData = editorData.dataRef.current;
    if (!currentData?.resolvedConfig) return;
    const nextConfig = removeLiveBindingsFromResolvedConfig(currentData.resolvedConfig, sourceId);
    if (!nextConfig) return;
    editorOps.applyEdit(
      { type: 'config', resolvedConfig: nextConfig },
      { semantic: true },
    );
  }, [editorData.dataRef, editorOps]);

  const openInspector = useCallback(() => {
    editorOps.setInspectorTarget(inspectorTarget);
    editorOps.setContextTarget(inspectorTarget);

    if (mobileSinglePane) {
      setIsMobilePropertiesOpen(true);
      return;
    }

    setCondensedRightPanel('properties');
  }, [editorOps, inspectorTarget, mobileSinglePane]);

  const handleInteractionModeChange = useCallback((mode: TimelineSwitchableMode) => {
    editorOps.setInteractionMode(mode);
    editorOps.setContextTarget({ kind: 'timeline' });
    editorOps.setInspectorTarget(inspectorTarget);
  }, [editorOps, inspectorTarget]);

  const toggleInteractionPrecision = useCallback(() => {
    editorOps.setPrecisionEnabled(!editorData.precisionEnabled);
    editorOps.setContextTarget({ kind: 'timeline' });
    editorOps.setInspectorTarget(inspectorTarget);
  }, [editorData.precisionEnabled, editorOps, inspectorTarget]);

  /** Desktop is modeless and gets nothing; the phone's stacked layout gets the
   *  full-width bar; every other touch layout (tablet, force-condensed phone)
   *  gets the compact segmented control in the toolbar row. */
  /** Keeps editor chrome out of the band the host app's fixed pane-control tabs
   *  occupy at the left/right viewport edges. */
  const mainPaddingInline = shouldReserveAppPaneRailGutter(editorData.deviceClass)
    ? APP_PANE_RAIL_GUTTER_PX
    : undefined;

  const modeSwitcherVariant = resolveTimelineModeSwitcherVariant(
    editorData.deviceClass,
    mobileSinglePane ? 'single-pane' : 'split',
  );

  const modeSwitcher = modeSwitcherVariant ? (
    <TimelineModeSwitcher
      variant={modeSwitcherVariant}
      interactionMode={editorData.interactionMode}
      precisionEnabled={editorData.precisionEnabled}
      onModeChange={handleInteractionModeChange}
      onTogglePrecision={toggleInteractionPrecision}
      hintSuffix={hasClipSelection ? ` ${inspectorButtonLabel} actions are in the inspector.` : undefined}
    />
  ) : null;

  const phoneModeBar = modeSwitcherVariant === 'bar' ? modeSwitcher : null;
  const toolbarModeSwitcher = modeSwitcherVariant === 'compact' ? modeSwitcher : null;

  const toolbar = (
    <TimelineEditorShellToolbar
      sync={sync}
      syncResultMessage={syncResultMessage}
      touchChrome={touchChrome}
      condensed={condensed}
      forceCondensed={forceCondensed}
      onNavigateHome={onNavigateHome}
      toolbarModeSwitcher={toolbarModeSwitcher}
      onDividerMouseDown={onDividerMouseDown}
      isTimelineMaximized={isTimelineMaximized}
      setIsTimelineMaximized={setIsTimelineMaximized}
    />
  );

  /** M2: Determine whether to show the ProposalPanel inside the activity region.
   * The panel is shown when a proposalRuntime is available and either proposals
   * or import diagnostics exist.  The runtime list() call is synchronous and
   * cheap — the panel itself subscribes via useSyncExternalStore for updates. */
  const hasProposals = proposalRuntime !== null && proposalRuntime.list().length > 0;
  const hasDiagnostics = proposalImportDiagnostics !== null && (
    proposalImportDiagnostics.diagnostics.length > 0 ||
    proposalImportDiagnostics.imported > 0 ||
    proposalImportDiagnostics.skipped > 0 ||
    proposalImportDiagnostics.rejected > 0
  );
  const showProposalPanel = proposalRuntime !== null && (hasProposals || hasDiagnostics);

  /** M1: Extension activity region — shallow placeholder mounted between toolbar and timeline.
   * M1-LOCKED: This mount point is intentional across all three layout variants
   * (desktop, condensed, mobile).  M2 wires the ProposalPanel into the region
   * when a runtime and proposals/diagnostics exist.  See docs/extensions/extension-layer-foundation-assessment.md §2.5. */
  const activityRegion = (
    <ExtensionActivityRegion
      statusEvents={activityEvents}
      onDismiss={handleActivityDismiss}
      isExpanded={false}
    >
      {showProposalPanel && proposalRuntime && (
        <ProposalPanel
          proposalRuntime={proposalRuntime}
          proposalImportDiagnostics={proposalImportDiagnostics}
        />
      )}
    </ExtensionActivityRegion>
  );

  const previewOverlay = (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3 py-3',
        // Phone is too narrow for the full `APP_PANE_RAIL_GUTTER_PX` inset on the
        // whole layout, but the app's right-hand pane tab lands exactly on this
        // chip row there and was covering the Render button. Inset the row alone.
        mobileSinglePane && 'pr-14',
      )}
      data-shell-interaction="true"
    >
      <span className="pointer-events-auto shrink-0 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px] tracking-[0.08em] text-muted-foreground backdrop-blur-sm">{playback.formatTime(playback.currentTime)}</span>
      <div className="pointer-events-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
        <ThemeChip timeline={editorData.data?.config} />
        {mobileSinglePane && (
          <TimelineMobileInspectorDialog
            isMobilePropertiesOpen={isMobilePropertiesOpen}
            setIsMobilePropertiesOpen={setIsMobilePropertiesOpen}
            inspectorTarget={inspectorTarget}
            hasClipSelection={hasClipSelection}
            inspectorButtonLabel={inspectorButtonLabel}
            previewActionButtonClass={previewActionButtonClass}
            mobilePropertiesTitle={mobilePropertiesTitle}
            mobilePropertiesDescription={mobilePropertiesDescription}
          />
        )}
        {condensed && !mobileSinglePane && (
          <Button
            type="button"
            size="sm"
            variant={condensedRightPanel === 'properties' ? 'secondary' : hasClipSelection ? 'outline' : 'ghost'}
            className={cn(
              `gap-1.5 ${previewActionButtonClass}`,
              hasClipSelection && condensedRightPanel !== 'properties' && 'border-sky-400/60 text-sky-100 hover:bg-sky-500/10',
            )}
            onClick={openInspector}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {inspectorButtonLabel}
          </Button>
        )}
        {condensed && !mobileSinglePane && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={`gap-1.5 ${previewActionButtonClass}`}
            onClick={() => {
              if (isOnEditorPage && isGenerationsPaneLocked && onSetGenerationsPaneLocked) {
                onSetGenerationsPaneLocked(false);
              } else {
                onOpenEditorRoute?.(timelineId);
              }
            }}
          >
            <Maximize2 className="h-3 w-3" />
            Editor
          </Button>
        )}
        <LiveSourcesPanel
          timelineConfig={editorData.resolvedConfig}
          onRemoveSourceBindings={handleRemoveLiveSourceBindings}
          compact={condensed}
          collapsible
        />
        {hasAnyExportFormat && (
          <TimelineExportMenu
            compileOnlyExportFormats={compileOnlyExportFormats}
            renderDependentExportFormats={renderDependentExportFormats}
            previewActionButtonClass={previewActionButtonClass}
          />
        )}
        <TimelineRenderControls
          previewActionButtonClass={previewActionButtonClass}
          touchChrome={touchChrome}
        />
      </div>
    </div>
  );

  /** Write-ack watchdog banner: an edit went unacknowledged (or was dropped on
   *  the null-data path). Persistent and actionable — never a silent badge. */
  const watchdogBanner = chrome.watchdogTripped ? (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <span>
        {chrome.watchdogReason === 'lost-edit'
          ? 'Your edits could not be applied — the timeline is not loaded yet. Reload the timeline before editing.'
          : 'Your changes have not been saved: the save never got a confirmation.'}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={chrome.retryWatchdog}>
        {chrome.watchdogReason === 'lost-edit' ? 'Dismiss' : 'Retry save'}
      </Button>
    </div>
  ) : null;

  /** Diverged banner (B4): a 409 means the document changed elsewhere. No
   *  silent overwrite — explicit Reload or Save as copy. */
  const conflictBanner = chrome.isConflictExhausted ? (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <span>This timeline changed elsewhere. Reload, or save your work as a copy.</span>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={chrome.reloadFromServer}>
          Reload
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={chrome.retrySaveAfterConflict}>
          Save as copy
        </Button>
      </div>
    </div>
  ) : null;

  /** Recovery draft banner (B9): a previous session left unsaved work in the
   *  one-slot draft. Offer Retry (re-POST the draft) or Discard. */
  const recoveryBanner = chrome.recoveryDraft ? (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <span>
        We recovered unsaved changes from a previous session (draft from{' '}
        {new Date(chrome.recoveryDraft.updatedAt).toLocaleString()}).
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void chrome.retryRecoveredDraft()}>
          Retry
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void chrome.discardRecoveredDraft()}>
          Discard
        </Button>
      </div>
    </div>
  ) : null;

  /** The timeline region, contained so a render throw under it cannot take the
   *  toolbar (and therefore undo) down with it. Shared by all three layout
   *  branches — the boundary is per-branch instance, which is what we want: a
   *  layout switch re-mounts the timeline anyway.
   *
   *  A *load* failure cannot reach that boundary (it happens before the first
   *  render, so nothing throws during rendering); it takes the explicit branch
   *  below, which is the only thing standing between a malformed backend
   *  payload and a blank editor whose badge claims `saved`. */
  const timelineRegion = (
    <>
      {conflictBanner}
      {watchdogBanner}
      {recoveryBanner}
      {chrome.loadError ? (
        <TimelineLoadErrorCard message={chrome.loadError.message} onRetry={chrome.retryLoad} />
      ) : (
        <TimelineErrorBoundary>
          <TimelineEditor onOpenSequenceCreator={() => setIsSequenceCreatorOpen(true)} />
        </TimelineErrorBoundary>
      )}
    </>
  );

  const previewPortal = previewSurface.portal;

  return (
    <>
      <div ref={outerRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {interactionStatusLabel}
        </div>
        {headerSlot}
        {!condensed && !headerSlot && (
          <div className="flex h-10 items-center gap-3 border-b border-border bg-background px-3 text-sm text-muted-foreground">
            {onNavigateHome && (
              <button
                type="button"
                className={cn('shrink-0 transition-colors hover:text-foreground motion-reduce:transition-none', touchChrome && 'min-h-11 px-2')}
                onClick={onNavigateHome}
              >
                ← Back
              </button>
            )}
            <div className="truncate text-foreground">{chrome.timelineName ?? 'Untitled timeline'}</div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn('ml-auto text-muted-foreground', touchChrome ? 'h-11 w-11' : 'h-7 w-7')}
              onClick={() => dispatchAppEvent('openSettings', {})}
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {mobileSinglePane ? (
          <main
            className="grid h-full min-h-0 flex-1 animate-in fade-in duration-200 motion-reduce:animate-none motion-reduce:transition-none grid-rows-[auto_auto_auto_minmax(200px,42dvh)_minmax(140px,1fr)] gap-3 p-3 transition-opacity"
            style={{ paddingInline: mainPaddingInline }}
          >
            <div>
              {toolbar}
            </div>

            {phoneModeBar}

            {/* M1: Extension activity region — between toolbar and timeline.
                Kept in its own wrapper so the row count stays constant whether
                or not the region has anything to show. */}
            <div>
              {activityRegion}
            </div>

            <div className="flex min-h-0 flex-col gap-3">
              <div className="relative min-h-0 flex-1">
                {previewOverlay}
                <PreviewPanel surface={previewSurface} />
              </div>
              <div className="rounded-xl border border-border bg-card/80 px-3 py-2">
                <Slider
                  value={[playback.currentTime]}
                  min={0}
                  max={Math.max(1, totalSeconds)}
                  step={0.05}
                  onValueChange={(value) => playback.previewRef.current?.seek(value)}
                />
              </div>
            </div>

            <div className="relative min-h-0 overflow-hidden">
              {timelineRegion}
            </div>

          </main>
        ) : condensed ? (
          <main
            className="grid h-full min-h-0 flex-1 animate-in fade-in duration-200 motion-reduce:animate-none motion-reduce:transition-none grid-cols-[minmax(0,1fr)_320px] grid-rows-[auto_auto_minmax(0,1fr)] gap-3 p-3 transition-opacity"
            style={{ paddingInline: mainPaddingInline }}
          >
            <div className="col-span-1">
              {toolbar}
            </div>

            {/* M1: Extension activity region — between toolbar and timeline */}
            <div className="col-span-1">
              {activityRegion}
            </div>

            <div className="row-span-3 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card/80">
              <div className="flex items-center border-b border-border">
                <button
                  type="button"
                  className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors motion-reduce:transition-none ${condensedRightPanel === 'preview' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setCondensedRightPanel('preview')}
                >
                  <Eye className="h-3 w-3" />
                  Preview
                </button>
                <button
                  type="button"
                  className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 border px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors motion-reduce:transition-none ${condensedRightPanel === 'properties' ? 'border-transparent bg-accent text-foreground' : editorData.selectedClipIds.size > 0 ? 'border-sky-400 text-muted-foreground hover:text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                  onClick={openInspector}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  {inspectorButtonLabel}
                </button>
              </div>

              <div
                className={cn('relative flex min-h-0 flex-1 flex-col', condensedRightPanel !== 'preview' && 'hidden')}
                aria-hidden={condensedRightPanel !== 'preview'}
              >
                {previewOverlay}
                <div className="min-h-0 flex-1">
                  <div ref={previewSurface.slotRef} className="flex h-full w-full min-h-0 items-center justify-center" />
                </div>
                <div className="border-t border-border px-3 py-2">
                  <Slider
                    value={[playback.currentTime]}
                    min={0}
                    max={Math.max(1, totalSeconds)}
                    step={0.05}
                    onValueChange={(value) => playback.previewRef.current?.seek(value)}
                  />
                </div>
              </div>
              <div
                className={cn('min-h-0 flex-1 overflow-auto p-3', condensedRightPanel !== 'properties' && 'hidden')}
                aria-hidden={condensedRightPanel !== 'properties'}
              >
                <PropertiesPanel />
              </div>
            </div>

            <div className="relative col-span-1 min-h-0 overflow-hidden">
              {timelineRegion}
            </div>

          </main>
        ) : (
          <main
            ref={containerRef}
            className="grid h-full min-h-0 flex-1 animate-in fade-in duration-200 motion-reduce:animate-none motion-reduce:transition-none gap-3 p-3 transition-[grid-template-rows,opacity] duration-300 ease-smooth"
            style={{
              gridTemplateRows,
              gridTemplateColumns: leftPanelSlot
                ? 'auto minmax(0,1fr) 360px'
                : 'minmax(0,1fr) 360px',
              paddingInline: mainPaddingInline,
            }}
          >
            {/* Left panel surface slot — host-owned placement */}
            {leftPanelSlot && (
              <div
                className="row-span-2 min-h-0 w-14 overflow-hidden"
                {...shellRegionAttrs('leftPanel')}
              >
                {leftPanelSlot}
              </div>
            )}

            <div className="relative min-h-0">
              {previewOverlay}
              <PreviewPanel surface={previewSurface} />
            </div>

            <div className="row-span-2 min-h-0 overflow-hidden" {...shellRegionAttrs('rightPanel')}>
              {rightPanelSlot ?? (
                <>
                  {assetPanelSlot}
                  {inspectorPanelSlot ?? <PropertiesPanel />}
                </>
              )}
            </div>

            <div ref={dividerRef} className="col-span-1">
              {toolbarSlot ?? toolbar}
            </div>

            {/* M1: Extension activity region — between toolbar and timeline */}
            <div className="col-span-1" style={{ gridColumn: leftPanelSlot ? '2 / span 2' : '1 / span 2' }}>
              {activityRegion}
            </div>

            <div className="relative min-h-0 overflow-hidden" style={{ gridColumn: leftPanelSlot ? '2 / span 2' : '1 / span 2' }}>
              {timelineRegion}
              {timelineFooterSlot}
            </div>

          </main>
        )}
        {statusBarSlot}

        {/* Reserved surface slots rendered as inert placeholders (host-owned footer region).
            Height-capped and independently scrollable: the placeholders stay small,
            and as an unbounded flex item this footer took height out of the editor
            above it — collapsing the preview and clipping the timeline. */}
        <div
          className="flex max-h-32 shrink-0 flex-wrap items-start gap-2 overflow-y-auto border-t border-border/40 px-3 py-2"
          {...shellRegionAttrs('reservedSlots')}
        >
          {codePanelSlot}
          {writingPanelSlot}
          {stagePanelSlot}
        </div>
      </div>
      {/* Render the shared preview portal here only when the rendered layout
          hosts it on a bare `previewSurface.slotRef` — that is the condensed
          branch alone. `condensed` is also true for single-pane phone, but
          that branch renders <PreviewPanel>, which mounts this same portal
          itself, so it has to be excluded or the phone layout mounts a second
          <RemotionPreview> beside the first. */}
      {condensed && !mobileSinglePane && previewPortal}
      {/* Extension-contributed dialog slot */}
      {dialogsSlot}
      {isSequenceCreatorOpen && (
        <SequenceCreatorPanel
          open={isSequenceCreatorOpen}
          onOpenChange={setIsSequenceCreatorOpen}
        />
      )}

      {/* M4: Host command palette overlay — only mount when open to avoid
          unnecessary context lookups that break in tests without providers. */}
      {isCommandPaletteOpen && (
        <CommandPalette
          open={isCommandPaletteOpen}
          onOpenChange={setIsCommandPaletteOpen}
        />
      )}

      <TimelineSyncDivergenceDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        lastSyncResult={sync.lastSyncResult}
        onLoadLatestFromDb={() => {
          setSyncDialogOpen(false);
          void chrome.reloadFromServer();
        }}
      />

      <AlertDialog open={conflict.isOpen} onOpenChange={conflict.setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remote timeline changes detected</AlertDialogTitle>
            <AlertDialogDescription>
              Another tab updated this timeline while you still have unsaved local edits. Keep your local draft or discard it and reload the latest server version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => void conflict.keepLocalChanges()}>Keep local draft</AlertDialogCancel>
            <AlertDialogAction onClick={() => void conflict.discardAndReload()}>Discard and reload</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const TimelineEditorShellCore = memo(TimelineEditorShellCoreComponent);
