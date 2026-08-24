import type { DragEvent as ReactDragEvent, MutableRefObject } from 'react';
import { getDragType } from '@/shared/lib/dnd/dragDrop.ts';
import { rawRowIndexFromY } from '@/tools/video-editor/lib/coordinate-utils.ts';
import { planClipDrag, type ClipDragPlan } from '@/tools/video-editor/lib/clip-drag-planner.ts';
import { createTimelineScale } from '@/tools/video-editor/lib/timeline-scale.ts';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data.ts';
import type { TrackKind } from '@/tools/video-editor/types/index.ts';
import type { TimelineEditability } from '@/tools/video-editor/lib/timeline-editability.ts';

const EDGE_SNAP_THRESHOLD_PX = 8;

interface TimelineDomNodes {
  wrapper: HTMLDivElement;
  editArea: HTMLElement | null;
  grid: HTMLElement | null;
}

interface DropScreenCoords {
  rowTop: number;
  rowLeft: number;
  rowWidth: number;
  rowHeight: number;
  clipLeft: number;
  clipWidth: number;
  ghostCenter: number;
}

export interface DropPosition {
  time: number;
  rowIndex: number;
  trackId: string | undefined;
  trackKind: TrackKind | null;
  trackName: string;
  isNewTrack: boolean;
  /** Whether the new track should be inserted at the top (true) or bottom (false/undefined). */
  isNewTrackTop?: boolean;
  isReject: boolean;
  /** When non-null, dropping here will create a new track of this kind. */
  newTrackKind: TrackKind | null;
  screenCoords: DropScreenCoords;
  /**
   * The underlying planner result that `computeDropPosition` resolved.
   * Carries snap threshold, collision resolution, and other plan-level
   * details so downstream commit paths can consume the same `ClipDragPlan`
   * used by the preview without recomputing snap or track resolution.
   */
  plan?: ClipDragPlan;
}

export interface ComputeDropPositionParams {
  clientX: number;
  clientY: number;
  wrapper: HTMLDivElement;
  dataRef: MutableRefObject<TimelineData | null>;
  scale: number;
  scaleWidth: number;
  startLeft: number;
  rowHeight: number;
  sourceKind?: TrackKind | null;
  clipDuration?: number;
  clipOffsetX?: number;
  excludeClipIds?: Set<string>;
  editability?: TimelineEditability;
  clipId?: string;
}

const timelineDomNodeCache = new WeakMap<HTMLDivElement, Omit<TimelineDomNodes, 'wrapper'>>();
const isValidNode = (wrapper: HTMLDivElement, node: HTMLElement | null): boolean => {
  return node === null || (node.isConnected && wrapper.contains(node));
};
export const getTimelineDomNodes = (wrapper: HTMLDivElement): TimelineDomNodes => {
  const cached = timelineDomNodeCache.get(wrapper);
  if (
    cached
    && isValidNode(wrapper, cached.editArea)
    && isValidNode(wrapper, cached.grid)
  ) {
    return { wrapper, ...cached };
  }

  const editArea = wrapper.querySelector<HTMLElement>('.timeline-canvas-edit-area');
  // In TimelineCanvas the edit area IS the scroll container (grid).
  const grid = editArea;
  const nextNodes = { editArea, grid };
  timelineDomNodeCache.set(wrapper, nextNodes);
  return { wrapper, ...nextNodes };
};

export const computeDropPosition = ({
  clientX,
  clientY,
  wrapper,
  dataRef,
  scale,
  scaleWidth,
  startLeft,
  rowHeight,
  sourceKind = null,
  clipDuration = 5,
  clipOffsetX,
    excludeClipIds,
  editability,
  clipId = '__drop-preview__',
}: ComputeDropPositionParams): DropPosition => {
  const current = dataRef.current;
  const { editArea, grid } = getTimelineDomNodes(wrapper);
  const wrapperRect = wrapper.getBoundingClientRect();
  const editRect = (editArea ?? wrapper).getBoundingClientRect();
  const scrollLeft = grid?.scrollLeft ?? 0;
  const scrollTop = grid?.scrollTop ?? 0;
  const { pixelsPerSecond, pixelToTime, timeToPixel } = createTimelineScale({ scale, scaleWidth, startLeft });
  const effectiveOffsetX = clipOffsetX ?? (clipDuration * pixelsPerSecond) / 2;
  const leftInGrid = clientX - editRect.left + scrollLeft - effectiveOffsetX;
  const time = Math.max(0, pixelToTime(leftInGrid));

  const rowCount = current?.rows.length ?? 0;
  const rawRowIndex = rawRowIndexFromY(clientY, editRect.top, scrollTop, rowHeight);
  const isNewTrackBottom = rowCount === 0 || rawRowIndex >= rowCount;
  // Only show top drop zone when fully scrolled up — otherwise auto-scroll handles it
  const isNewTrackTop = rawRowIndex < 0 && rowCount > 0 && scrollTop < 2;
  const requestedNewTrackPlacement = isNewTrackTop ? 'top' : isNewTrackBottom ? 'bottom' : null;
  const plan = planClipDrag({
    pointerTime: time,
    clipDuration,
    clipId,
    excludeClipIds,
    sourceKind: sourceKind ?? 'visual',
    tracks: current?.tracks ?? [],
    rows: current?.rows ?? [],
    pointerRowIndex: rawRowIndex,
    pixelSnapThreshold: EDGE_SNAP_THRESHOLD_PX,
    pixelsPerSecond,
    requestedNewTrackPlacement,
    editability,
  });
  const rowIndex = plan.targetRowIndex;
  const visualRowIndex = rowCount > 0 ? Math.min(rowIndex, rowCount - 1) : -1;
  const targetTrack = rowIndex >= 0 && rowIndex < (current?.tracks.length ?? 0)
    ? current?.tracks[rowIndex]
    : undefined;
  const rowTop = visualRowIndex >= 0
    ? editRect.top + visualRowIndex * rowHeight - scrollTop
    : editRect.top;
  // Viewport-aware long-clip ghost clipping using true rectangle math.
  // trueLeft / trueRight = the full clip extent in screen pixels (may extend
  // beyond the visible viewport). The ghost visual is clamped to the visible
  // viewport; the line/label anchors to trueLeft so the time label stays
  // accurate when the ghost rectangle is clipped offscreen.
  const trueLeft = editRect.left + timeToPixel(plan.resolvedStart) - scrollLeft;
  const trueRight = trueLeft + clipDuration * pixelsPerSecond;
  const visibleLeft = editRect.left;
  const visibleRight = editRect.right;
  const intersects = trueLeft < visibleRight && trueRight > visibleLeft;

  let ghostLeft: number;
  let ghostWidth: number;
  if (intersects) {
    ghostLeft = Math.max(trueLeft, visibleLeft);
    ghostWidth = Math.min(trueRight, visibleRight) - ghostLeft;
  } else {
    ghostLeft = visibleLeft;
    ghostWidth = 0;
  }

  // Line/label anchors to the planned start (trueLeft), not the ghost center.
  const clipLeft = ghostLeft;
  const clipWidth = ghostWidth;
  const ghostCenter = trueLeft;

  const resolvedTrack = plan.targetTrackId
    ? current?.tracks.find((track) => track.id === plan.targetTrackId) ?? targetTrack
    : undefined;
  const resolvedTrackName = resolvedTrack?.label ?? resolvedTrack?.id ?? '';
  const finalRowTop = rowIndex >= 0 && rowIndex < rowCount
    ? editRect.top + rowIndex * rowHeight - scrollTop
    : rowTop;
  const finalClipLeft = clipLeft;
  const finalClipWidth = clipWidth;
  const finalGhostCenter = ghostCenter;

  return {
    time: plan.resolvedStart,
    rowIndex,
    trackId: plan.targetTrackId ?? undefined,
    trackKind: plan.needsNewTrack ? (sourceKind ?? plan.trackKind) : plan.trackKind,
    trackName: resolvedTrackName,
    isNewTrack: plan.needsNewTrack,
    isNewTrackTop: plan.needsNewTrack && plan.newTrackPlacement === 'top',
    isReject: plan.rejectReason !== null,
    newTrackKind: plan.needsNewTrack ? plan.trackKind : null,
    screenCoords: {
      rowTop: finalRowTop,
      rowLeft: wrapperRect.left,
      rowWidth: wrapperRect.width,
      rowHeight,
      clipLeft: finalClipLeft,
      clipWidth: finalClipWidth,
      ghostCenter: finalGhostCenter,
    },
    plan,
  };
};

export const inferDragKind = (event: ReactDragEvent<HTMLDivElement>): TrackKind | null => {
  const types = Array.from(event.dataTransfer.types);
  if (types.includes('asset-kind:audio')) return 'audio';
  if (types.includes('asset-kind:visual')) return 'visual';
  if (types.includes('asset-key')) return null;
  if (getDragType(event) === 'generation') return 'visual';
  if (event.dataTransfer.items.length > 0) {
    for (const item of Array.from(event.dataTransfer.items)) {
      if (item.type.startsWith('audio/')) {
        return 'audio';
      }
    }
    return 'visual';
  }
  return null;
};
