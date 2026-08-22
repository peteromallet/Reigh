// Layer map & invariants: docs/structure_detail/tool_video_editor.md
import React, {
  useContext,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { type DragEndEvent, useSensors } from '@dnd-kit/core';
import { Layers, Sparkles } from 'lucide-react';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { usePortalMousedownGuard } from '@/shared/hooks/usePortalMousedownGuard.ts';
import {
  ExtensionContextMenuItems,
  hasEligibleExtensionContextMenuItems,
} from '@/tools/video-editor/components/TimelineEditor/ExtensionContextMenuItems.tsx';
import {
  ShotGroupBorders,
  ShotGroupLabels,
  type PositionedShotGroup,
} from '@/tools/video-editor/components/TimelineEditor/ShotGroupOverlay.tsx';
import {
  ShotGroupContextMenu,
  type ShotGroupMenuState,
} from '@/tools/video-editor/components/TimelineEditor/ShotGroupContextMenu.tsx';
import {
  buildGridBackground,
  TimelineRulerAndGrid,
} from '@/tools/video-editor/components/TimelineEditor/TimelineRulerAndGrid.tsx';
import { DataLaneList } from '@/tools/video-editor/components/TimelineEditor/DataLaneList.tsx';
import { TrackListRenderer } from '@/tools/video-editor/components/TimelineEditor/TrackListRenderer.tsx';
import { TimelineGhostLayer } from '@/tools/video-editor/components/TimelineEditor/TimelineGhostLayer.tsx';
import { VideoEditorRuntimeContext } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import type { TimelineGhostEntry } from '@/tools/video-editor/types/timeline-canvas.ts';
import { useClipResizeGesture } from '@/tools/video-editor/hooks/useClipResizeGesture.ts';
import type { ShotGroup } from '@/tools/video-editor/hooks/useShotGroups.ts';
import { useTimelineEditorDataSafe, useTimelineMutableAdapters } from '@/tools/video-editor/hooks/timelineStore.ts';
import { useDataLanes } from '@/tools/video-editor/data-kinds/useDataLanes.ts';
import { useTimelineSelectionStore } from '@/shared/state/selectionStore.ts';
import { LABEL_WIDTH } from '@/tools/video-editor/lib/coordinate-utils.ts';
import {
  EDIT_AREA_CLASS,
  TIMELINE_AREA_CONTEXT_MENU_IGNORE_SELECTOR,
  touchGestureModeAttrs,
} from '@/tools/video-editor/lib/timeline-dom.ts';
import {
  resolveTouchGestureMode,
  shouldEnableTimelinePinchZoom,
  shouldExpandTouchTrimHandles,
  shouldTapTimelineToolButtons,
  type TimelineDeviceClass,
  type TimelineGestureOwner,
  type TimelineInputModality,
  type TimelineInteractionMode,
} from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import {
  clampTimelineScaleWidth,
  computeTimelineExtent,
  maxClipEndSeconds,
} from '@/tools/video-editor/lib/timeline-scale.ts';
import { createTimelineOverlayGeometry } from '@reigh/editor-sdk';
import { createTimelineOverlayStores } from '@/tools/video-editor/lib/timeline-overlay-stores.ts';
import {
  type ResizeDir,
} from '@/tools/video-editor/lib/resize-math.ts';
import { useRenderDiagnostic } from '@/tools/video-editor/hooks/usePerfDiagnostics.ts';
import { useTimelineScale } from '@/tools/video-editor/hooks/useTimelineScale.ts';
import { useRenderBudget } from '@/shared/dev/useRenderBudget.ts';
import {
  TIMELINE_CENTER_CLIP_EVENT,
  type TimelineCenterClipEventDetail,
  SOURCE_NAVIGATE_TO_TIMELINE_EVENT,
  type SourceNavigateToTimelineDetail,
} from '@/tools/video-editor/lib/timeline-viewport-events.ts';
import { VIDEO_EDITOR_THEME_VARS } from '@/tools/video-editor/lib/themeTokens.ts';
import type { TimelinePostprocessShaderMetadata, TrackDefinition } from '@/tools/video-editor/types/index.ts';
import type { TimelineAction, TimelineCanvasHandle, TimelineRow } from '@/tools/video-editor/types/timeline-canvas.ts';
import type { DragSession } from '@/tools/video-editor/hooks/useClipDrag.ts';
import type { ClipEdgeResizeEndTarget } from '@/tools/video-editor/hooks/useClipResize.ts';
import type { MarqueeRect } from '@/tools/video-editor/hooks/useMarqueeSelect.ts';
import type { TargetContextPayload } from '@reigh/editor-sdk';
import { TimelineExtensionOverlayHost } from './TimelineExtensionOverlayHost.tsx';
import {
  ACTION_VERTICAL_MARGIN,
  CURSOR_WIDTH,
  EMPTY_RESIZE_PREVIEW_SNAPSHOT,
  MIN_ACTION_WIDTH_PX,
  RESIZE_HANDLE_WIDTH,
  TOUCH_RESIZE_HANDLE_WIDTH,
  type ResizeOverride,
} from './timeline-canvas-constants.ts';

export interface TimelineCanvasProps {
  rows: TimelineRow[];
  tracks: TrackDefinition[];
  deviceClass: TimelineDeviceClass;
  inputModality: TimelineInputModality;
  interactionMode: TimelineInteractionMode;
  gestureOwner: TimelineGestureOwner;
  scale: number;
  scaleWidth: number;
  scaleSplitCount: number;
  startLeft: number;
  rowHeight: number;
  minScaleCount: number;
  maxScaleCount: number;
  selectedTrackId: string | null;
  getActionRender?: (action: TimelineAction, row: TimelineRow, width: number) => ReactNode;
  onSelectTrack: (trackId: string) => void;
  onTrackChange: (trackId: string, patch: Partial<TrackDefinition>) => void;
  onRemoveTrack: (trackId: string) => void;
  onTrackDragEnd: (event: DragEndEvent) => void;
  trackSensors: ReturnType<typeof useSensors>;
  onCursorDrag: (time: number) => void;
  onClickTimeArea: (time: number) => void;
  setInputModalityFromPointerType: (pointerType: string | null | undefined) => TimelineInputModality;
  setGestureOwner: (owner: TimelineGestureOwner) => void;
  onActionResizeStart?: (params: {
    action: TimelineAction;
    row: TimelineRow;
    dir: ResizeDir;
  }) => void;
  onActionResizing?: (params: { action: TimelineAction; row: TimelineRow; start: number; end: number; dir: ResizeDir }) => void;
  onClipEdgeResizeEnd?: (params: ClipEdgeResizeEndTarget) => void;
  shotGroups?: ShotGroup[];
  finalVideoMap?: Map<string, unknown>;
  staleShotGroupIds?: Set<string>;
  activeTaskClipIds?: Set<string>;
  onShotGroupNavigate?: (shotId: string) => void;
  onShotGroupGenerateVideo?: (shotId: string) => void;
  onShotGroupSwitchToFinalVideo?: (group: { shotId: string; clipIds: string[]; rowId: string }) => void;
  onShotGroupSwitchToImages?: (group: { shotId: string; rowId: string }) => void;
  onShotGroupUpdateToLatestVideo?: (group: { shotId: string; rowId: string }) => void;
  onShotGroupUnpin?: (group: { shotId: string; trackId: string }) => void;
  onShotGroupDelete?: (group: { shotId: string; trackId: string; clipIds: string[] }) => void;
  onSelectClips?: (clipIds: string[]) => void;
  dragSessionRef?: MutableRefObject<DragSession | null>;
  interactionStateRef?: import('@/tools/video-editor/lib/interaction-state').InteractionStateRef;
  marqueeRect?: MarqueeRect | null;
  onEditAreaPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onAddTrack?: (kind: 'visual' | 'audio') => void;
  onAddTextAt?: (trackId: string, time: number) => void;
  onAddEffectLayerAt?: (trackId: string, time: number) => void;
  onOpenSequenceCreator?: () => void;
  /** Applies a new timeline zoom (px per `scale` seconds); drives the touch pinch gesture. */
  onScaleWidthChange?: (scaleWidth: number) => void;
  unusedTrackCount?: number;
  onClearUnusedTracks?: () => void;
  newTrackDropLabel?: string | null;
  /** Ghost preview entries for rendering proposal previews over the timeline. */
  ghostEntries?: readonly TimelineGhostEntry[];
  /** Set of clip IDs that have stale source-map entries (for stale badge rendering). */
  sourceMapStaleClipIds?: ReadonlySet<string>;
  /** Active timeline-scoped postprocess shader shown as a selectable timeline badge. */
  postprocessShader?: TimelinePostprocessShaderMetadata;
  /** Selects the timeline-scoped postprocess shader inspector target. */
  onSelectPostprocessShader?: (shader: TimelinePostprocessShaderMetadata) => void;
}

const TOOL_BUTTON_BASE_CLASS = 'pointer-events-auto relative flex items-center justify-center rounded-full ring-1 transition-all duration-150 hover:-translate-y-0.5 hover:scale-105 active:translate-y-0 active:scale-100';
const POINTER_TOOL_BUTTON_SIZE_CLASS = 'h-6 w-6';
const TOUCH_TOOL_BUTTON_SIZE_CLASS = 'h-10 w-10';
/** Pixel twin of `TOUCH_TOOL_BUTTON_SIZE_CLASS` — used to reserve ruler space. */
const TOUCH_TOOL_BUTTON_SIZE_PX = 40;
const TOUCH_TOOL_CLUSTER_GAP_PX = 6;
/** `right-2` on the cluster, plus the same again so a label never abuts a button. */
const TOUCH_TOOL_CLUSTER_MARGIN_PX = 16;
const TEXT_TOOL_TONE_CLASS = 'bg-[var(--video-editor-accent-bg-strong)] text-[color:var(--video-editor-accent-border-strong)] ring-[var(--video-editor-accent-ring)] hover:bg-[var(--video-editor-accent-bg-hover)] hover:shadow-[0_6px_18px_var(--video-editor-accent-shadow-soft)] hover:ring-[var(--video-editor-accent-border)]';
const EFFECT_TOOL_TONE_CLASS = 'bg-[var(--video-editor-effect-bg)] text-[color:var(--video-editor-effect-text)] ring-[var(--video-editor-effect-ring)] hover:bg-[var(--video-editor-effect-bg-hover)] hover:shadow-[0_6px_18px_var(--video-editor-effect-shadow-soft)] hover:ring-[var(--video-editor-effect-ring-strong)]';
const SEQUENCE_TOOL_TONE_CLASS = 'bg-[var(--video-editor-success-bg)] text-[color:var(--video-editor-success-text)] ring-[var(--video-editor-success-ring)] hover:bg-[var(--video-editor-success-bg-hover)] hover:shadow-[0_6px_18px_var(--video-editor-success-shadow-soft)] hover:ring-[var(--video-editor-success-ring-strong)]';
const TOOL_TOOLTIP_CLASS = 'pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/tool:opacity-100';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const MENU_VIEWPORT_MARGIN = 8;

interface TimelineAreaContextMenuState {
  x: number;
  y: number;
  target: TargetContextPayload;
}

function TimelineAreaExtensionContextMenu({
  menu,
  menuRef,
  closeMenu,
}: {
  menu: TimelineAreaContextMenuState;
  menuRef: React.RefObject<HTMLDivElement>;
  closeMenu: () => void;
}) {
  const [adjusted, setAdjusted] = useState<{ x: number; y: number } | null>(null);
  const runtime = useContext(VideoEditorRuntimeContext);
  const commandRegistry = runtime?.commandRegistry;
  const extensions = runtime?.extensionRuntime?.extensions ?? [];
  const items = commandRegistry
    ? commandRegistry.getSnapshot().contextMenuItems.filter((item) => item.target === menu.target.target)
    : [];

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) {
      setAdjusted(null);
      return;
    }

    const recompute = () => {
      const rect = node.getBoundingClientRect();
      setAdjusted({
        x: Math.max(MENU_VIEWPORT_MARGIN, Math.min(menu.x, window.innerWidth - rect.width - MENU_VIEWPORT_MARGIN)),
        y: Math.max(MENU_VIEWPORT_MARGIN, Math.min(menu.y, window.innerHeight - rect.height - MENU_VIEWPORT_MARGIN)),
      });
    };

    recompute();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(recompute);
    observer.observe(node);
    return () => observer.disconnect();
  }, [menu.x, menu.y, menuRef]);

  usePortalMousedownGuard(menuRef);

  const pos = adjusted ?? menu;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: pos.x, top: pos.y, visibility: adjusted ? 'visible' : 'hidden' }}
    >
      <ExtensionContextMenuItems
        items={items}
        target={menu.target}
        extensions={extensions}
        commandRegistry={commandRegistry}
        closeMenu={closeMenu}
        validateTarget={() => null}
      />
    </div>,
    document.body,
  );
}

export const TimelineCanvas = forwardRef<TimelineCanvasHandle, TimelineCanvasProps>(function TimelineCanvas({
  rows,
  tracks,
  deviceClass,
  inputModality,
  interactionMode,
  gestureOwner,
  scale,
  scaleWidth,
  scaleSplitCount,
  startLeft,
  rowHeight,
  minScaleCount,
  maxScaleCount,
  selectedTrackId,
  getActionRender,
  onSelectTrack,
  onTrackChange,
  onRemoveTrack,
  onTrackDragEnd,
  trackSensors,
  onCursorDrag,
  onClickTimeArea,
  setInputModalityFromPointerType,
  setGestureOwner,
  onActionResizeStart,
  onActionResizing,
  onClipEdgeResizeEnd,
  shotGroups = [],
  finalVideoMap,
  staleShotGroupIds,
  activeTaskClipIds,
  onShotGroupNavigate,
  onShotGroupGenerateVideo,
  onShotGroupSwitchToFinalVideo,
  onShotGroupSwitchToImages,
  onShotGroupUpdateToLatestVideo,
  onShotGroupUnpin,
  onShotGroupDelete,
  onSelectClips,
  dragSessionRef,
  interactionStateRef,
  marqueeRect,
  onEditAreaPointerDown,
  onAddTrack,
  onAddTextAt,
  onAddEffectLayerAt,
  onOpenSequenceCreator,
  onScaleWidthChange,
  unusedTrackCount = 0,
  onClearUnusedTracks,
  newTrackDropLabel,
  ghostEntries,
  sourceMapStaleClipIds,
  postprocessShader,
  onSelectPostprocessShader,
}: TimelineCanvasProps, ref) {
  useRenderBudget('TimelineCanvas', 3);
  // dataKind V1: reactive base TimelineData → assembled duration-neutral
  // lanes (render-side merge via useDataLanes; the store's data is never
  // written, so lanes stay inert to duration/rows/export).
  const mountedEditorData = useTimelineEditorDataSafe();
  const laneData = useDataLanes({ base: mountedEditorData?.data ?? null });
  const { dataRef, selectedClipIdsRef, ops, previewRef } = useTimelineMutableAdapters();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [overlayScrollContainer, setOverlayScrollContainer] = useState<HTMLDivElement | null>(null);
  const [contentOverlayRoot, setContentOverlayRoot] = useState<HTMLDivElement | null>(null);
  const [rulerOverlayRoot, setRulerOverlayRoot] = useState<HTMLDivElement | null>(null);
  const [rulerOverlayStrip, setRulerOverlayStrip] = useState<HTMLDivElement | null>(null);
  const [overlayStores] = useState(createTimelineOverlayStores);
  const cursorRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const playRateRef = useRef(1);
  const pendingCenterClipIdRef = useRef<string | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [shotGroupMenu, setShotGroupMenu] = useState<ShotGroupMenuState>(null);
  const [timelineAreaMenu, setTimelineAreaMenu] = useState<TimelineAreaContextMenuState | null>(null);
  const shotGroupMenuRef = useRef<HTMLDivElement>(null);
  const timelineAreaMenuRef = useRef<HTMLDivElement>(null);
  const runtime = useContext(VideoEditorRuntimeContext);
  const commandRegistry = runtime?.commandRegistry;
  const extensions = runtime?.extensionRuntime?.extensions ?? [];
  useRenderDiagnostic('TimelineCanvas');

  const setScrollContainer = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setOverlayScrollContainer(node);
  }, []);

  useEffect(() => () => {
    overlayStores.viewport.dispose();
    overlayStores.playhead.dispose();
    // The timeline surface is gone: extensions reading the provider-owned
    // store must observe surfaceMounted=false instead of stale layout.
    runtime?.timelineViewStore?.publish({
      surfaceMounted: false,
      viewport: null,
      geometry: null,
    });
  }, [overlayStores, runtime]);

  usePortalMousedownGuard(shotGroupMenuRef, Boolean(shotGroupMenu));

  useEffect(() => {
    if (!shotGroupMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (shotGroupMenuRef.current && !shotGroupMenuRef.current.contains(e.target as Node)) {
        setShotGroupMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShotGroupMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [shotGroupMenu]);

  useEffect(() => {
    if (!timelineAreaMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (timelineAreaMenuRef.current && !timelineAreaMenuRef.current.contains(e.target as Node)) {
        setTimelineAreaMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTimelineAreaMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [timelineAreaMenu]);

  const { pixelsPerSecond, pixelToTime, timeToPixel } = useTimelineScale({ scale, scaleWidth, startLeft });
  const resizeHandleWidth = shouldExpandTouchTrimHandles(deviceClass, inputModality, interactionMode)
    ? TOUCH_RESIZE_HANDLE_WIDTH
    : RESIZE_HANDLE_WIDTH;
  const touchGestureMode = resolveTouchGestureMode(deviceClass, interactionMode);
  const minDuration = MIN_ACTION_WIDTH_PX / pixelsPerSecond;
  const { resizePreviewSnapshot, resizeClampedActionId } = useClipResizeGesture({
    timelineWrapperRef: scrollContainerRef,
    dataRef,
    rows,
    shotGroups,
    gestureOwner,
    setGestureOwner,
    onActionResizeStart,
    onActionResizing,
    onClipEdgeResizeEnd,
    interactionStateRef,
    setInputModalityFromPointerType,
    timeToPixel,
    pixelToTime,
    pixelsPerSecond,
    minDuration,
  });
  const actionHeight = Math.max(12, rowHeight - ACTION_VERTICAL_MARGIN * 2);
  // dataKind V1: lane rows extend the scrollable content; their heights join
  // the playhead/viewport height math only — width/scale math is untouched.
  const dataLanesHeight = laneData?.dataLanes.reduce((sum, lane) => sum + lane.height, 0) ?? 0;
  const scrollContentHeight = (rows.length + 1) * rowHeight + dataLanesHeight;
  const maxEnd = useMemo(() => maxClipEndSeconds(rows), [rows]);
  // Content-only derivation: the trailing runway is the owner's call and reaches
  // us as minScaleCount/maxScaleCount (TimelineEditorCore pins both to one value).
  const { totalWidth } = computeTimelineExtent({
    maxEndSeconds: maxEnd,
    scale,
    scaleWidth,
    startLeft,
    trailingRunwaySeconds: 0,
    minScaleCount,
    maxScaleCount,
  });
  const overlayGeometry = useMemo(() => createTimelineOverlayGeometry({
    scale,
    scaleWidth,
    startLeft,
    extentStart: 0,
    extentEnd: Math.max(0, pixelToTime(totalWidth)),
  }), [pixelToTime, scale, scaleWidth, startLeft, totalWidth]);
  // Reactive selection from the module-level selection store (the adapter's
  // selectedClipIdsRef is a render-lagging mirror updated in a layout effect;
  // reading it during render would publish stale selection).
  const timelineSelection = useTimelineSelectionStore();
  const overlaySelectedClipIds = selectedClipIdsRef.current;
  const overlaySelection = useMemo(() => Object.freeze({
    selectedClipIds: overlaySelectedClipIds,
    hasSelection: overlaySelectedClipIds.size > 0,
  }), [overlaySelectedClipIds]);
  const overlayFps = dataRef.current?.output?.fps ?? 24;

  // Publish selection changes into the provider-owned TimelineViewStore so
  // `ctx.creative.timelineView` reflects live selection for commands. Keyed
  // on the reactive store value, not the ref, so it cannot lag.
  useEffect(() => {
    const ids = timelineSelection.selectedClipIds;
    runtime?.timelineViewStore?.publish({
      selection: Object.freeze({
        selectedClipIds: ids,
        hasSelection: ids.size > 0,
      }),
    });
  }, [runtime, timelineSelection.selectedClipIds]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const viewportSnapshot = {
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      viewportWidth: container.clientWidth,
      viewportHeight: container.clientHeight,
      totalWidth,
      totalHeight: scrollContentHeight,
    };
    overlayStores.viewport.update(viewportSnapshot);
    overlayStores.frameTime.publish({
      timestamp: typeof performance === 'undefined' ? Date.now() : performance.now(),
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    });
    // Provider-owned TimelineViewStore: publish layout regardless of the
    // overlay flag so `ctx.creative.timelineView` stays live for commands.
    runtime?.timelineViewStore?.publish({
      viewport: viewportSnapshot,
      geometry: overlayGeometry,
      surfaceMounted: true,
    });
  }, [overlayScrollContainer, overlayStores, runtime, scrollContentHeight, totalWidth, overlayGeometry]);
  const rowResizePreview = useMemo(
    () => rows.map<Readonly<Record<string, ResizeOverride>>>((row) => {
      let previewForRow: Record<string, ResizeOverride> | null = null;
      for (const action of row.actions) {
        const override = resizePreviewSnapshot[action.id];
        if (!override) {
          continue;
        }

        if (!previewForRow) {
          previewForRow = {};
        }
        previewForRow[action.id] = override;
      }

      return previewForRow ?? EMPTY_RESIZE_PREVIEW_SNAPSHOT;
    }),
    [resizePreviewSnapshot, rows],
  );
  const positionedShotGroups = useMemo(() => {
    return shotGroups.flatMap<PositionedShotGroup>((group) => {
      const row = rows[group.rowIndex];
      if (!row || row.id !== group.rowId) {
        return [];
      }

      const lastChild = group.children[group.children.length - 1];
      if (!lastChild) {
        return [];
      }

      const groupKey = `${group.shotId}:${group.rowId}`;
      const preview = resizePreviewSnapshot[groupKey];
      const start = preview?.start ?? group.start;
      const end = preview?.end ?? (group.start + lastChild.offset + lastChild.duration);

      return [{
        key: `${group.shotId}:${group.rowId}:${group.clipIds.join(',')}`,
        shotId: group.shotId,
        shotName: group.shotName,
        clipIds: group.clipIds,
        start,
        end,
        rowId: group.rowId,
        color: group.color,
        mode: group.mode,
        hasFinalVideo: finalVideoMap?.has(group.shotId) ?? false,
        hasStaleVideo: staleShotGroupIds?.has(`${group.shotId}:${group.rowId}`) ?? false,
        hasActiveTask: activeTaskClipIds ? group.clipIds.some((id) => activeTaskClipIds.has(id)) : false,
        left: timeToPixel(start),
        top: group.rowIndex * rowHeight + ACTION_VERTICAL_MARGIN,
        width: Math.max((end - start) * pixelsPerSecond, 1),
        height: actionHeight,
      }];
    });
  }, [actionHeight, activeTaskClipIds, finalVideoMap, pixelsPerSecond, resizePreviewSnapshot, rowHeight, rows, shotGroups, staleShotGroupIds, timeToPixel]);

  const centerClipInViewport = useCallback((clipId: string): boolean => {
    const container = scrollContainerRef.current;
    if (!container) {
      return false;
    }

    // Plain loop, not rows.some(): assignments inside a callback are invisible
    // to control-flow narrowing, which collapsed targetAction to `never` below.
    let targetAction: TimelineAction | null = null;
    let targetRowIndex = -1;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const found = rows[rowIndex].actions.find((candidate) => candidate.id === clipId);
      if (found) {
        targetAction = found;
        targetRowIndex = rowIndex;
        break;
      }
    }
    if (!targetAction || targetRowIndex < 0) {
      return false;
    }

    const viewportWidth = container.clientWidth || container.getBoundingClientRect().width;
    const viewportHeight = container.clientHeight || container.getBoundingClientRect().height;
    const clipCenterX = startLeft + ((targetAction.start + targetAction.end) / 2) * pixelsPerSecond;
    const clipCenterY = targetRowIndex * rowHeight + rowHeight / 2;
    const maxScrollLeft = Math.max(0, totalWidth - viewportWidth);
    const maxScrollTop = Math.max(0, scrollContentHeight - viewportHeight);
    const nextScrollLeft = clamp(clipCenterX - viewportWidth / 2, 0, maxScrollLeft);
    const nextScrollTop = clamp(clipCenterY - viewportHeight / 2, 0, maxScrollTop);

    container.scrollTo({
      left: nextScrollLeft,
      top: nextScrollTop,
      behavior: 'smooth',
    });
    return true;
  }, [pixelsPerSecond, rowHeight, rows, scrollContentHeight, startLeft, totalWidth]);

  const scheduleCenterClipInViewport = useCallback((clipId: string) => {
    pendingCenterClipIdRef.current = clipId;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (pendingCenterClipIdRef.current !== clipId) {
          return;
        }
        if (centerClipInViewport(clipId)) {
          pendingCenterClipIdRef.current = null;
        }
      });
    });
  }, [centerClipInViewport]);

  useEffect(() => {
    const handleCenterClip = (event: Event) => {
      const detail = (event as CustomEvent<TimelineCenterClipEventDetail>).detail;
      if (!detail?.clipId) {
        return;
      }
      scheduleCenterClipInViewport(detail.clipId);
    };
    window.addEventListener(TIMELINE_CENTER_CLIP_EVENT, handleCenterClip);
    return () => window.removeEventListener(TIMELINE_CENTER_CLIP_EVENT, handleCenterClip);
  }, [scheduleCenterClipInViewport]);

  // ── Source → Timeline navigation ───────────────────────────────────
  useEffect(() => {
    const handleSourceNavigate = (event: Event) => {
      const detail = (event as CustomEvent<SourceNavigateToTimelineDetail>).detail;
      if (!detail?.extensionId) return;

      // If a specific target is requested, center on it
      if (detail.targetId) {
        scheduleCenterClipInViewport(detail.targetId);
      }
      // Dispatch event for source-panel listeners
      window.dispatchEvent(
        new CustomEvent('reigh:source-navigate-to-timeline-handled', {
          detail: { ...detail, handled: true },
        }),
      );
    };
    window.addEventListener(SOURCE_NAVIGATE_TO_TIMELINE_EVENT, handleSourceNavigate);
    return () => window.removeEventListener(SOURCE_NAVIGATE_TO_TIMELINE_EVENT, handleSourceNavigate);
  }, [scheduleCenterClipInViewport]);

  useEffect(() => {
    const pendingClipId = pendingCenterClipIdRef.current;
    if (pendingClipId) {
      scheduleCenterClipInViewport(pendingClipId);
    }
  }, [rows, scheduleCenterClipInViewport]);
  const hideShotGroups = dragSessionRef?.current !== null;
  const showTouchShotGroupActions = deviceClass !== 'desktop';
  const openShotGroupMenu = useCallback((
    x: number,
    y: number,
    group: Pick<PositionedShotGroup, 'shotId' | 'shotName' | 'clipIds' | 'rowId' | 'hasFinalVideo' | 'hasStaleVideo' | 'mode'>,
  ) => {
    setShotGroupMenu({ x, y, ...group, trackId: group.rowId });
  }, []);

  const handleTimelineAreaContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (eventTarget?.closest(TIMELINE_AREA_CONTEXT_MENU_IGNORE_SELECTOR)) {
      return;
    }

    const target: TargetContextPayload = { target: 'timeline-area' };
    if (!hasEligibleExtensionContextMenuItems(commandRegistry, extensions, target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setTimelineAreaMenu({
      x: event.clientX,
      y: event.clientY,
      target,
    });
  }, [commandRegistry, extensions]);

  const handlePostprocessShaderBadgeClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!postprocessShader) {
      return;
    }
    onSelectPostprocessShader?.(postprocessShader);
  }, [onSelectPostprocessShader, postprocessShader]);

  const syncCursor = useCallback((time = timeRef.current) => {
    const cursor = cursorRef.current;
    if (!cursor) {
      return;
    }

    const left = timeToPixel(time);
    cursor.style.transform = `translateX(${left}px)`;
  }, [timeToPixel]);

  const handleSetTime = useCallback((time: number) => {
    timeRef.current = Math.max(0, time);
    syncCursor(timeRef.current);
    overlayStores.playhead.set(timeRef.current, false);
    // Provider-owned TimelineViewStore: keep `ctx.creative.timelineView`
    // playhead fresh for renderer-independent commands (B key etc.). The
    // playback flag comes from the live player handle, not a hardcode.
    const isPlaying = previewRef.current?.isPlaying ?? false;
    runtime?.timelineViewStore?.publish({
      playhead: { time: timeRef.current, isPlaying },
    });
  }, [overlayStores.playhead, previewRef, runtime, syncCursor]);

  useEffect(() => {
    syncCursor();
  }, [syncCursor]);

  useImperativeHandle(ref, () => ({
    get target() {
      return scrollContainerRef.current;
    },
    listener: null,
    isPlaying: false,
    isPaused: true,
    setTime: handleSetTime,
    getTime: () => timeRef.current,
    setPlayRate: (rate: number) => {
      playRateRef.current = rate;
    },
    getPlayRate: () => playRateRef.current,
    reRender: () => syncCursor(),
    play: ({ toTime }) => {
      if (typeof toTime === 'number') {
        handleSetTime(toTime);
      }
      return false;
    },
    pause: () => {},
    setScrollLeft: (value: number) => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft = Math.max(0, value);
      }
    },
  }), [handleSetTime, syncCursor]);

  // ── Touch: tool buttons act on tap, anchored at the playhead ───────────
  const tapToolButtons = shouldTapTimelineToolButtons(deviceClass);
  /** On touch the tool cluster docks over the ruler's right end; tell the ruler
   *  how much of its right edge is covered so it stops drawing labels there. */
  const touchToolButtonCount = tapToolButtons
    ? (onAddTextAt ? 2 : 0) + (onOpenSequenceCreator ? 1 : 0)
    : 0;
  const rulerLabelRightInsetPx = touchToolButtonCount === 0
    ? 0
    : touchToolButtonCount * TOUCH_TOOL_BUTTON_SIZE_PX
      + (touchToolButtonCount - 1) * TOUCH_TOOL_CLUSTER_GAP_PX
      + TOUCH_TOOL_CLUSTER_MARGIN_PX;
  // `handleAddTextAt` / the effect-layer insert both fall back to the first visual
  // track when the id does not resolve, so an empty id is a safe "pick for me".
  const firstVisualTrackId = useMemo(
    () => tracks.find((track) => track.kind === 'visual')?.id ?? '',
    [tracks],
  );
  const handleTapAddText = useCallback(() => {
    onAddTextAt?.(firstVisualTrackId, timeRef.current);
  }, [firstVisualTrackId, onAddTextAt]);
  const handleTapAddEffectLayer = useCallback(() => {
    onAddEffectLayerAt?.(firstVisualTrackId, timeRef.current);
  }, [firstVisualTrackId, onAddEffectLayerAt]);

  // ── Touch: two-finger pinch zoom ───────────────────────────────────────
  const pinchSessionRef = useRef<{ startDistance: number; startScaleWidth: number; time: number; offsetX: number } | null>(null);
  const pinchAnchorRef = useRef<{ time: number; offsetX: number } | null>(null);
  const pinchInputsRef = useRef({ scaleWidth, pixelsPerSecond, startLeft, onScaleWidthChange });
  pinchInputsRef.current = { scaleWidth, pixelsPerSecond, startLeft, onScaleWidthChange };
  const pinchGestureOwnerRef = useRef(gestureOwner);
  pinchGestureOwnerRef.current = gestureOwner;
  const pinchEnabled = shouldEnableTimelinePinchZoom(deviceClass) && Boolean(onScaleWidthChange);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!pinchEnabled || !container) {
      return;
    }

    const spread = (touches: TouchList) => Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );

    const handleTouchStart = (event: TouchEvent) => {
      if (pinchGestureOwnerRef.current === 'overlay') {
        pinchSessionRef.current = null;
        return;
      }
      if (event.touches.length !== 2) {
        pinchSessionRef.current = null;
        return;
      }

      const { pixelsPerSecond: currentPps, scaleWidth: currentScaleWidth, startLeft: currentStartLeft } = pinchInputsRef.current;
      const offsetX = (event.touches[0].clientX + event.touches[1].clientX) / 2
        - container.getBoundingClientRect().left;
      pinchSessionRef.current = {
        startDistance: Math.max(1, spread(event.touches)),
        startScaleWidth: currentScaleWidth,
        time: (container.scrollLeft + offsetX - currentStartLeft) / currentPps,
        offsetX,
      };
      // Claims the gesture from native pan/pinch-zoom for its whole lifetime.
      event.preventDefault();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (pinchGestureOwnerRef.current === 'overlay') {
        pinchSessionRef.current = null;
        return;
      }
      const session = pinchSessionRef.current;
      if (!session || event.touches.length !== 2) {
        return;
      }

      event.preventDefault();
      const nextScaleWidth = clampTimelineScaleWidth(
        session.startScaleWidth * (Math.max(1, spread(event.touches)) / session.startDistance),
      );
      if (nextScaleWidth === pinchInputsRef.current.scaleWidth) {
        return;
      }

      pinchAnchorRef.current = { time: session.time, offsetX: session.offsetX };
      pinchInputsRef.current.onScaleWidthChange?.(nextScaleWidth);
    };

    const endPinch = () => {
      pinchSessionRef.current = null;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', endPinch);
    container.addEventListener('touchcancel', endPinch);
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', endPinch);
      container.removeEventListener('touchcancel', endPinch);
    };
  }, [pinchEnabled]);

  // Keeps the pinched-at time under the gesture midpoint once the new zoom lands.
  useLayoutEffect(() => {
    const anchor = pinchAnchorRef.current;
    const container = scrollContainerRef.current;
    if (!anchor || !container) {
      return;
    }

    pinchAnchorRef.current = null;
    container.scrollLeft = Math.max(0, startLeft + anchor.time * pixelsPerSecond - anchor.offsetX);
  }, [pixelsPerSecond, startLeft]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const nextMetrics = {
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    };

    if (nextMetrics.scrollLeft !== scrollLeft) {
      setScrollLeft(nextMetrics.scrollLeft);
    }
    if (nextMetrics.scrollTop !== scrollTop) {
      setScrollTop(nextMetrics.scrollTop);
    }
    overlayStores.viewport.update({
      ...nextMetrics,
      viewportWidth: event.currentTarget.clientWidth,
      viewportHeight: event.currentTarget.clientHeight,
      totalWidth,
      totalHeight: scrollContentHeight,
    });
    overlayStores.frameTime.publish({
      timestamp: typeof performance === 'undefined' ? Date.now() : performance.now(),
      ...nextMetrics,
    });
    // Keep the provider-owned TimelineViewStore viewport live on scroll
    // (the layout effect only publishes initial/zoom layout).
    runtime?.timelineViewStore?.publish({
      viewport: {
        ...nextMetrics,
        viewportWidth: event.currentTarget.clientWidth,
        viewportHeight: event.currentTarget.clientHeight,
        totalWidth,
        totalHeight: scrollContentHeight,
      },
    });
    syncCursor();
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background/70" style={VIDEO_EDITOR_THEME_VARS}>
      <TimelineRulerAndGrid
        scale={scale}
        scaleWidth={scaleWidth}
        scaleSplitCount={scaleSplitCount}
        startLeft={startLeft}
        scrollLeft={scrollLeft}
        totalWidth={totalWidth}
        gestureOwner={gestureOwner}
        onClickTimeArea={onClickTimeArea}
        onCursorDrag={onCursorDrag}
        setGestureOwner={setGestureOwner}
        setInputModalityFromPointerType={setInputModalityFromPointerType}
        unusedTrackCount={unusedTrackCount}
        onClearUnusedTracks={onClearUnusedTracks}
        labelRightInsetPx={rulerLabelRightInsetPx}
      />
      <div
        ref={setRulerOverlayRoot}
        data-testid="timeline-extension-ruler-overlay-root"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[30px] overflow-hidden"
      >
        <div
          ref={setRulerOverlayStrip}
          data-testid="timeline-extension-ruler-overlay-strip"
          className="pointer-events-none absolute left-0 top-0 h-full"
          style={{ width: totalWidth }}
        />
      </div>
      {postprocessShader && onSelectPostprocessShader && (
        <button
          type="button"
          className="absolute top-1 z-30 flex max-w-[min(24rem,calc(100%-12rem))] items-center gap-1.5 rounded-md border border-emerald-400/50 bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-100 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-500/25"
          style={{ left: LABEL_WIDTH + 8 }}
          data-postprocess-shader-badge="true"
          data-shader-scope="postprocess"
          data-shader-id={postprocessShader.shaderId}
          data-extension-id={postprocessShader.extensionId}
          aria-label={`Open postprocess shader controls for ${postprocessShader.label ?? postprocessShader.shaderId}`}
          title={`Postprocess shader: ${postprocessShader.label ?? postprocessShader.shaderId}`}
          onClick={handlePostprocessShaderBadgeClick}
        >
          <Sparkles className="h-3 w-3 shrink-0" />
          <span className="shrink-0 uppercase tracking-[0.12em]">Postprocess</span>
          <span className="truncate text-foreground/90">{postprocessShader.label ?? postprocessShader.shaderId}</span>
        </button>
      )}
      <ShotGroupLabels
        positionedShotGroups={positionedShotGroups}
        hidden={hideShotGroups}
        showTouchActions={showTouchShotGroupActions}
        scrollLeft={scrollLeft}
        scrollTop={scrollTop}
        openShotGroupMenu={openShotGroupMenu}
        onSelectClips={onSelectClips}
        onShotGroupNavigate={onShotGroupNavigate}
      />
      <div
        ref={setScrollContainer}
        className={`${EDIT_AREA_CLASS} timeline-scroll relative min-h-0 flex-1 overflow-auto overscroll-contain bg-background/70`}
        {...touchGestureModeAttrs(touchGestureMode)}
        style={{ '--label-width': `${LABEL_WIDTH}px` } as React.CSSProperties}
        onPointerDown={onEditAreaPointerDown}
        onScroll={handleScroll}
      >
        <div
          className="relative"
          onContextMenu={handleTimelineAreaContextMenu}
          style={{
            width: totalWidth,
            backgroundImage: buildGridBackground(startLeft, scaleWidth, scaleSplitCount),
            backgroundPosition: `${startLeft}px 0, ${startLeft}px 0`,
          }}
        >
          {marqueeRect && (
            <div
              className="pointer-events-none absolute z-30 border border-[color:var(--video-editor-accent-border-strong)] bg-[var(--video-editor-accent-bg)]"
              style={{
                left: marqueeRect.x,
                top: marqueeRect.y,
                width: marqueeRect.width,
                height: marqueeRect.height,
              }}
            />
          )}
          {newTrackDropLabel?.includes('at top') && (
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-1 bg-[var(--video-editor-accent-text-soft)]" style={{ marginLeft: LABEL_WIDTH }} />
          )}
          <ShotGroupBorders
            positionedShotGroups={positionedShotGroups}
            hidden={hideShotGroups}
          />
          <ShotGroupContextMenu
            menu={shotGroupMenu}
            menuRef={shotGroupMenuRef}
            closeMenu={() => setShotGroupMenu(null)}
            onNavigate={onShotGroupNavigate}
            onGenerateVideo={onShotGroupGenerateVideo}
            onSwitchToFinalVideo={onShotGroupSwitchToFinalVideo}
            onSwitchToImages={onShotGroupSwitchToImages}
            onUpdateToLatestVideo={onShotGroupUpdateToLatestVideo}
            onUnpinGroup={onShotGroupUnpin}
            onDeleteShot={onShotGroupDelete}
          />
          {timelineAreaMenu && (
            <TimelineAreaExtensionContextMenu
              menu={timelineAreaMenu}
              menuRef={timelineAreaMenuRef}
              closeMenu={() => setTimelineAreaMenu(null)}
            />
          )}
          <TimelineGhostLayer
            ghosts={ghostEntries ?? []}
            rows={rows}
            rowHeight={rowHeight}
            startLeft={startLeft}
            pixelsPerSecond={pixelsPerSecond}
          />
          <TrackListRenderer
            rows={rows}
            tracks={tracks}
            rowHeight={rowHeight}
            startLeft={startLeft}
            pixelsPerSecond={pixelsPerSecond}
            selectedTrackId={selectedTrackId}
            deviceClass={deviceClass}
            resizeClampedActionId={resizeClampedActionId}
            rowResizePreview={rowResizePreview}
            resizeHandleWidth={resizeHandleWidth}
            getActionRender={getActionRender}
            onSelectTrack={onSelectTrack}
            onTrackChange={onTrackChange}
            onRemoveTrack={onRemoveTrack}
            onTrackDragEnd={onTrackDragEnd}
            trackSensors={trackSensors}
          />
          {/* dataKind V1: duration-neutral lane rows below the track rows —
              same scroller and startLeft/pixelsPerSecond mapping, outside the
              overlay host, never gated by timelineOverlaysEnabled. */}
          <DataLaneList data={laneData} startLeft={startLeft} pixelsPerSecond={pixelsPerSecond} />
          <div
            ref={setContentOverlayRoot}
            data-testid="timeline-extension-content-overlay-root"
            className="pointer-events-none absolute inset-0 z-20"
          />
        </div>
        {/* Footer: + Video / + Audio split buttons and draggable text tool — outside the grid background div */}
        <div className="relative flex border-t border-border bg-background/70" style={{ height: rowHeight, width: totalWidth }}>
          <div
            className="z-20 flex bg-card"
            style={{ width: LABEL_WIDTH, position: 'sticky', left: 0 }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {onAddTrack && (
              <>
                <button
                  type="button"
                  className="flex flex-1 items-center justify-center gap-0.5 border-r border-border/50 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => onAddTrack('visual')}
                >
                  + Video
                </button>
                <button
                  type="button"
                  className="flex flex-1 items-center justify-center gap-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => onAddTrack('audio')}
                >
                  + Audio
                </button>
              </>
            )}
          </div>
          <div className="flex flex-1 items-center gap-2 px-2" style={{ position: 'sticky', left: LABEL_WIDTH }}>
            {newTrackDropLabel && newTrackDropLabel.includes('at bottom') ? (
              <div className="pointer-events-none h-1 flex-1 rounded-full bg-[var(--video-editor-accent-text-soft)]" />
            ) : null}
          </div>
        </div>
        <div
          ref={cursorRef}
          data-testid="timeline-playhead"
          className="pointer-events-none absolute left-0 top-0 z-[5] bg-[var(--video-editor-accent-border-strong)] shadow-[0_0_10px_var(--video-editor-accent-shadow)]"
          style={{
            width: CURSOR_WIDTH,
            height: scrollContentHeight,
            transform: `translateX(${startLeft}px)`,
          }}
        />
      </div>
      {runtime?.timelineOverlaysEnabled === true && ops && (
        <TimelineExtensionOverlayHost
          contentPortalRoot={contentOverlayRoot}
          rulerPortalRoot={rulerOverlayRoot}
          rulerStripRoot={rulerOverlayStrip}
          scrollContainer={overlayScrollContainer}
          geometry={overlayGeometry}
          stores={overlayStores}
          selection={overlaySelection}
          fps={overlayFps}
          gestureOwner={gestureOwner}
          setGestureOwner={setGestureOwner}
          setContextTarget={ops.setContextTarget}
          setInspectorTarget={ops.setInspectorTarget}
        />
      )}
      {/* Floating tool buttons — bottom-left of timeline viewport. Touch-sized
          buttons would blank out a whole 36px track row down there, so on touch
          the cluster docks to the ruler strip at top-right instead. */}
      {(onAddTextAt || onOpenSequenceCreator) && (
        <div
          className={cn(
            'pointer-events-none absolute z-30 flex gap-1.5',
            tapToolButtons ? 'right-2 top-1' : 'bottom-4',
          )}
          style={tapToolButtons ? undefined : { left: LABEL_WIDTH + 8 }}
        >
          {onAddTextAt && (tapToolButtons ? (
            <>
              <button
                type="button"
                className={`${TOOL_BUTTON_BASE_CLASS} ${TOUCH_TOOL_BUTTON_SIZE_CLASS} ${TEXT_TOOL_TONE_CLASS}`}
                title="New text"
                aria-label="New text at playhead"
                onClick={handleTapAddText}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
              </button>
              <button
                type="button"
                className={`${TOOL_BUTTON_BASE_CLASS} ${TOUCH_TOOL_BUTTON_SIZE_CLASS} ${EFFECT_TOOL_TONE_CLASS}`}
                title="New effect"
                aria-label="New effect layer at playhead"
                onClick={handleTapAddEffectLayer}
              >
                <Layers className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text-tool', 'true');
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                className={`group/tool ${TOOL_BUTTON_BASE_CLASS} ${POINTER_TOOL_BUTTON_SIZE_CLASS} cursor-grab active:cursor-grabbing ${TEXT_TOOL_TONE_CLASS}`}
                title="Drag onto timeline to add text"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                <span aria-hidden="true" className={TOOL_TOOLTIP_CLASS}>
                  New text
                </span>
              </div>
              <div
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('effect-layer', 'true');
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                className={`group/tool ${TOOL_BUTTON_BASE_CLASS} ${POINTER_TOOL_BUTTON_SIZE_CLASS} cursor-grab active:cursor-grabbing ${EFFECT_TOOL_TONE_CLASS}`}
                title="Drag onto timeline to add an effect layer"
              >
                <Layers className="h-3 w-3" />
                <span aria-hidden="true" className={TOOL_TOOLTIP_CLASS}>
                  New effect
                </span>
              </div>
            </>
          ))}
          {onOpenSequenceCreator && (
            <button
              type="button"
              className={`group/tool ${TOOL_BUTTON_BASE_CLASS} ${tapToolButtons ? TOUCH_TOOL_BUTTON_SIZE_CLASS : POINTER_TOOL_BUTTON_SIZE_CLASS} ${SEQUENCE_TOOL_TONE_CLASS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--video-editor-success-focus-ring)]`}
              title="Create animation sequence"
              aria-label="Create animation sequence"
              onClick={onOpenSequenceCreator}
            >
              <Sparkles className={tapToolButtons ? 'h-4 w-4' : 'h-3 w-3'} />
              {!tapToolButtons && (
                <span aria-hidden="true" className={`${TOOL_TOOLTIP_CLASS} group-focus-visible/tool:opacity-100`}>
                  Create animation sequence
                </span>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
