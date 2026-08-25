import React, { type ReactNode } from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { useRenderBudget } from '@/shared/dev/useRenderBudget.ts';
import { TrackLabelContent } from '@/tools/video-editor/components/TimelineEditor/TrackLabel.tsx';
import { LABEL_WIDTH } from '@/tools/video-editor/lib/coordinate-utils.ts';
import { actionSlotAttrs, resizeHandleAttrs, rowAttrs } from '@/tools/video-editor/lib/timeline-dom.ts';
import type { TimelineDeviceClass } from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import type { TrackDefinition } from '@/tools/video-editor/types/index.ts';
import type {
  TimelineAction,
  TimelineRow,
} from '@/tools/video-editor/types/timeline-canvas.ts';
import {
  ACTION_VERTICAL_MARGIN,
  EMPTY_RESIZE_PREVIEW_SNAPSHOT,
  type ResizeOverride,
} from './timeline-canvas-constants.ts';

export interface ActionVerticalPlacement {
  readonly lane: number;
  readonly laneCount: number;
}

interface ActionVerticalPlacementOptions {
  readonly actions: readonly TimelineAction[];
  readonly pixelsPerSecond: number;
  readonly resizeHandleWidth: number;
  readonly shouldStack?: (action: TimelineAction, row: TimelineRow) => boolean;
  readonly row: TimelineRow;
}

/**
 * Partition only the caller-designated action kinds whose rendered minimum
 * width would otherwise make their DOM hit targets overlap. The horizontal
 * interval and width remain untouched; this helper changes only vertical
 * placement, and therefore leaves ordinary clips on their existing geometry.
 */
export function computeActionVerticalPlacements({
  actions,
  pixelsPerSecond,
  resizeHandleWidth,
  shouldStack,
  row,
}: ActionVerticalPlacementOptions): ReadonlyMap<string, ActionVerticalPlacement> {
  const placements = new Map<string, ActionVerticalPlacement>();
  const candidates = actions
    .map((action, sourceIndex) => ({ action, sourceIndex }))
    .filter(({ action }) => shouldStack?.(action, row) ?? false)
    .sort((left, right) => (
      left.action.start - right.action.start
      || left.action.id.localeCompare(right.action.id)
      || left.sourceIndex - right.sourceIndex
    ));
  const minWidthSeconds = resizeHandleWidth * 3 / Math.max(pixelsPerSecond, Number.EPSILON);
  let group: Array<{ id: string; lane: number }> = [];
  let laneEnds: number[] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;

  const finishGroup = () => {
    if (group.length === 0) return;
    const laneCount = Math.max(...group.map(({ lane }) => lane)) + 1;
    for (const { id, lane } of group) placements.set(id, { lane, laneCount });
    group = [];
    laneEnds = [];
    groupEnd = Number.NEGATIVE_INFINITY;
  };

  for (const { action } of candidates) {
    const start = action.start;
    const end = Math.max(action.end, start + minWidthSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      placements.set(action.id, { lane: 0, laneCount: 1 });
      continue;
    }
    if (group.length > 0 && start >= groupEnd) finishGroup();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    group.push({ id: action.id, lane });
    groupEnd = Math.max(groupEnd, end);
  }
  finishGroup();

  for (const action of actions) {
    if (!placements.has(action.id)) placements.set(action.id, { lane: 0, laneCount: 1 });
  }
  return placements;
}

interface SortableRowProps {
  row: TimelineRow;
  track: TrackDefinition;
  rowHeight: number;
  startLeft: number;
  pixelsPerSecond: number;
  isSelected: boolean;
  deviceClass: TimelineDeviceClass;
  clampedActionId: string | null;
  resizePreviewSnapshot: Readonly<Record<string, ResizeOverride>>;
  resizeHandleWidth: number;
  getActionRender?: (action: TimelineAction, row: TimelineRow, width: number) => ReactNode;
  shouldStackOverlappingActions?: (action: TimelineAction, row: TimelineRow) => boolean;
  onSelectTrack: (trackId: string) => void;
  onTrackChange: (trackId: string, patch: Partial<TrackDefinition>) => void;
  onRemoveTrack: (trackId: string) => void;
}

interface RowActionLayerProps {
  row: TimelineRow;
  rowHeight: number;
  startLeft: number;
  pixelsPerSecond: number;
  clampedActionId: string | null;
  resizePreviewSnapshot: Readonly<Record<string, ResizeOverride>>;
  resizeHandleWidth: number;
  getActionRender?: (action: TimelineAction, row: TimelineRow, width: number) => ReactNode;
  shouldStackOverlappingActions?: (action: TimelineAction, row: TimelineRow) => boolean;
}

interface TrackListRendererProps {
  rows: TimelineRow[];
  tracks: TrackDefinition[];
  rowHeight: number;
  startLeft: number;
  pixelsPerSecond: number;
  selectedTrackId: string | null;
  deviceClass: TimelineDeviceClass;
  resizeClampedActionId: string | null;
  rowResizePreview: Readonly<Record<string, ResizeOverride>>[];
  resizeHandleWidth: number;
  getActionRender?: (action: TimelineAction, row: TimelineRow, width: number) => ReactNode;
  shouldStackOverlappingActions?: (action: TimelineAction, row: TimelineRow) => boolean;
  onSelectTrack: (trackId: string) => void;
  onTrackChange: (trackId: string, patch: Partial<TrackDefinition>) => void;
  onRemoveTrack: (trackId: string) => void;
  onTrackDragEnd: (event: DragEndEvent) => void;
  trackSensors: ReturnType<typeof useSensors>;
}

function SortableRow({
  row,
  track,
  rowHeight,
  startLeft,
  pixelsPerSecond,
  isSelected,
  deviceClass,
  clampedActionId,
  resizePreviewSnapshot,
  resizeHandleWidth,
  getActionRender,
  shouldStackOverlappingActions,
  onSelectTrack,
  onTrackChange,
  onRemoveTrack,
}: SortableRowProps) {
  useRenderBudget('SortableRow', 4);
  const sortable = useSortable({ id: `track-${track.id}` });
  const style = {
    height: rowHeight,
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 20 : undefined,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      className="relative border-b border-border/30"
      {...rowAttrs(row.id)}
      style={style}
    >
      <div
        className="absolute left-0 top-0 z-20 h-full border-r border-border bg-card"
        style={{ width: LABEL_WIDTH, position: 'sticky', left: 0 }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <TrackLabelContent
          track={track}
          isSelected={isSelected}
          hasClips={row.actions.length > 0}
          deviceClass={deviceClass}
          onSelect={onSelectTrack}
          onChange={onTrackChange}
          onRemove={onRemoveTrack}
          dragListeners={sortable.listeners}
          dragAttributes={sortable.attributes}
        />
      </div>
      <MemoizedRowActionLayer
        row={row}
        rowHeight={rowHeight}
        startLeft={startLeft}
        pixelsPerSecond={pixelsPerSecond}
        clampedActionId={clampedActionId}
        resizePreviewSnapshot={resizePreviewSnapshot}
        resizeHandleWidth={resizeHandleWidth}
        getActionRender={getActionRender}
        shouldStackOverlappingActions={shouldStackOverlappingActions}
      />
    </div>
  );
}

function RowActionLayer({
  row,
  rowHeight,
  startLeft,
  pixelsPerSecond,
  clampedActionId,
  resizePreviewSnapshot,
  resizeHandleWidth,
  getActionRender,
  shouldStackOverlappingActions,
}: RowActionLayerProps) {
  const actionHeight = Math.max(12, rowHeight - ACTION_VERTICAL_MARGIN * 2);
  const renderedActions = row.actions.map((action) => {
    const override = resizePreviewSnapshot[action.id];
    return override ? { ...action, ...override } : action;
  });
  const placements = computeActionVerticalPlacements({
    actions: renderedActions,
    pixelsPerSecond,
    resizeHandleWidth,
    shouldStack: shouldStackOverlappingActions,
    row,
  });

  return renderedActions.map((renderedAction) => {
    // Render both handles on every clip — including grouped children.
    // The document-level resize gesture hook resolves whether a handle
    // starts a free or group resize session.
    const left = startLeft + renderedAction.start * pixelsPerSecond;
    // Keep one handle-width of selectable clip body between the two trim
    // handles. A two-handle minimum left short captions completely covered by
    // the sibling handles, so a normal click could only begin a resize and the
    // text clip could not be opened in the inspector at low zoom.
    const width = Math.max(
      (renderedAction.end - renderedAction.start) * pixelsPerSecond,
      resizeHandleWidth * 3,
    );
    const placement = placements.get(renderedAction.id) ?? { lane: 0, laneCount: 1 };
    const laneHeight = actionHeight / placement.laneCount;

    return (
      <div
        key={renderedAction.id}
        className={cn(
          'group absolute',
          clampedActionId === renderedAction.id && 'rounded-md ring-2 ring-[var(--video-editor-warning-ring)] ring-offset-1 ring-offset-background',
        )}
        {...actionSlotAttrs(renderedAction.id, row.id)}
        style={{
          left,
          top: ACTION_VERTICAL_MARGIN + placement.lane * laneHeight,
          width,
          height: laneHeight,
          ...(placement.laneCount > 1 ? { zIndex: placement.lane + 1 } : {}),
        }}
      >
        {getActionRender?.(renderedAction, row, width)}
        <div
          className="absolute inset-y-0 left-0 z-10 cursor-ew-resize rounded-l-sm border-l border-[color:var(--video-editor-accent-ring)] bg-transparent transition-colors group-hover:bg-[var(--video-editor-accent-bg)]"
          style={{ width: resizeHandleWidth }}
          {...resizeHandleAttrs('left', renderedAction.id, row.id)}
        />
        <div
          className="absolute inset-y-0 right-0 z-10 cursor-ew-resize rounded-r-sm border-r border-[color:var(--video-editor-accent-ring)] bg-transparent transition-colors group-hover:bg-[var(--video-editor-accent-bg)]"
          style={{ width: resizeHandleWidth }}
          {...resizeHandleAttrs('right', renderedAction.id, row.id)}
        />
      </div>
    );
  });
}

function areRowActionLayerPropsEqual(left: RowActionLayerProps, right: RowActionLayerProps) {
  return (
    left.row === right.row
    && left.rowHeight === right.rowHeight
    && left.startLeft === right.startLeft
    && left.pixelsPerSecond === right.pixelsPerSecond
    && left.clampedActionId === right.clampedActionId
    && left.resizePreviewSnapshot === right.resizePreviewSnapshot
    && left.resizeHandleWidth === right.resizeHandleWidth
    && left.getActionRender === right.getActionRender
    && left.shouldStackOverlappingActions === right.shouldStackOverlappingActions
  );
}

const MemoizedRowActionLayer = React.memo(RowActionLayer, areRowActionLayerPropsEqual);

function areSortableRowPropsEqual(left: SortableRowProps, right: SortableRowProps) {
  return (
    left.row === right.row
    && left.track === right.track
    && left.rowHeight === right.rowHeight
    && left.startLeft === right.startLeft
    && left.pixelsPerSecond === right.pixelsPerSecond
    && left.isSelected === right.isSelected
    && left.deviceClass === right.deviceClass
    && left.clampedActionId === right.clampedActionId
    && left.resizePreviewSnapshot === right.resizePreviewSnapshot
    && left.resizeHandleWidth === right.resizeHandleWidth
    && left.getActionRender === right.getActionRender
    && left.shouldStackOverlappingActions === right.shouldStackOverlappingActions
    && left.onSelectTrack === right.onSelectTrack
    && left.onTrackChange === right.onTrackChange
    && left.onRemoveTrack === right.onRemoveTrack
  );
}

const MemoizedSortableRow = React.memo(SortableRow, areSortableRowPropsEqual);

MemoizedSortableRow.displayName = 'SortableRow';

export function TrackListRenderer({
  rows,
  tracks,
  rowHeight,
  startLeft,
  pixelsPerSecond,
  selectedTrackId,
  deviceClass,
  resizeClampedActionId,
  rowResizePreview,
  resizeHandleWidth,
  getActionRender,
  shouldStackOverlappingActions,
  onSelectTrack,
  onTrackChange,
  onRemoveTrack,
  onTrackDragEnd,
  trackSensors,
}: TrackListRendererProps) {
  const sortableTrackItems = React.useMemo(
    () => tracks.map((track) => `track-${track.id}`),
    [tracks],
  );

  return (
    <DndContext
      sensors={trackSensors}
      collisionDetection={closestCenter}
      onDragEnd={onTrackDragEnd}
    >
      <SortableContext
        items={sortableTrackItems}
        strategy={verticalListSortingStrategy}
      >
        {tracks.map((track, index) => {
          const row = rows[index];
          if (!row) {
            return null;
          }

          const rowClampedActionId = row.actions.some((action) => action.id === resizeClampedActionId)
            ? resizeClampedActionId
            : null;

          return (
            <MemoizedSortableRow
              key={track.id}
              row={row}
              track={track}
              rowHeight={rowHeight}
              startLeft={startLeft}
              pixelsPerSecond={pixelsPerSecond}
              isSelected={selectedTrackId === track.id}
              deviceClass={deviceClass}
              clampedActionId={rowClampedActionId}
              resizePreviewSnapshot={rowResizePreview[index] ?? EMPTY_RESIZE_PREVIEW_SNAPSHOT}
              resizeHandleWidth={resizeHandleWidth}
              getActionRender={getActionRender}
              shouldStackOverlappingActions={shouldStackOverlappingActions}
              onSelectTrack={onSelectTrack}
              onTrackChange={onTrackChange}
              onRemoveTrack={onRemoveTrack}
            />
          );
        })}
      </SortableContext>
    </DndContext>
  );
}
