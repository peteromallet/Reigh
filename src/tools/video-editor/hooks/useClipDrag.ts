// Layer map & invariants: docs/structure_detail/tool_video_editor.md
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { shallow } from 'zustand/shallow';
import { userSelectTimelineClip } from '@/shared/state/selectionStore.ts';
import { computeSecondaryGhosts } from '@/tools/video-editor/lib/multi-drag-utils.ts';
import { createAutoScroller } from '@/tools/video-editor/lib/auto-scroll.ts';
import { TIMELINE_START_LEFT } from '@/tools/video-editor/lib/coordinate-utils.ts';
import { notifyInteractionEndIfIdle } from '@/tools/video-editor/lib/interaction-state.ts';
import {
  shouldPreserveTouchSelectionForMove,
  shouldAllowTouchClipDrag,
  shouldToggleTouchSelection,
} from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import {
  CLIP_ACTION_SELECTOR,
  CLIP_ID_DATASET_KEY,
  EDIT_AREA_SELECTOR,
  ROW_ID_DATASET_KEY,
  SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_DATASET_KEY,
  SHOT_GROUP_DRAG_ANCHOR_ROW_ID_DATASET_KEY,
  SHOT_GROUP_DRAG_ANCHOR_SELECTOR,
} from '@/tools/video-editor/lib/timeline-dom.ts';
import { snapDrag } from '@/tools/video-editor/lib/snap-edges.ts';
import { useTimelineScale } from '@/tools/video-editor/hooks/useTimelineScale.ts';
import {
  useTimelineDataSelector,
  useTimelineMutableAdapters,
} from '@/tools/video-editor/hooks/timelineStore.ts';
import type {
  TimelineEditorDataContextValue,
  TimelineEditorOpsContextValue,
} from '@/tools/video-editor/hooks/useTimelineState.types.ts';
import type { ActionDragState, DragMachineState, DragSession, InternalDragSession } from '@/tools/video-editor/hooks/useClipDrag.helpers.ts';
import { buildPendingDragSession, commitDraggingSession, createFloatingGhost, ensureCountBadge, findClipElement, updateFloatingGhostPosition } from '@/tools/video-editor/hooks/useClipDrag.helpers.ts';

const DRAG_THRESHOLD_PX = 4;
/** Snap threshold in pixels — converted to seconds based on current zoom. */
const SNAP_THRESHOLD_PX = 8;
/** Vertical pixel threshold before activating cross-track mode. */
const CROSS_TRACK_THRESHOLD_PX = 10;

interface UseClipDragLatest {
  coordinator: TimelineEditorDataContextValue['coordinator'];
  moveClipToRow: TimelineEditorOpsContextValue['moveClipToRow'];
  createTrackAndMoveClip: TimelineEditorOpsContextValue['createTrackAndMoveClip'];
  selectClip: TimelineEditorOpsContextValue['selectClip'];
  selectClips: TimelineEditorOpsContextValue['selectClips'];
  selectedClipIdsRef: TimelineEditorDataContextValue['selectedClipIdsRef'];
  applyEdit: TimelineEditorOpsContextValue['applyEdit'];
  additiveSelectionRef: TimelineEditorDataContextValue['additiveSelectionRef'];
  deviceClass: TimelineEditorDataContextValue['deviceClass'];
  interactionMode: TimelineEditorDataContextValue['interactionMode'];
  gestureOwner: TimelineEditorDataContextValue['gestureOwner'];
  setGestureOwner: TimelineEditorOpsContextValue['setGestureOwner'];
  setInputModalityFromPointerType: TimelineEditorOpsContextValue['setInputModalityFromPointerType'];
  interactionStateRef: TimelineEditorDataContextValue['interactionStateRef'];
}

export interface UseClipDragResult {
  dragSessionRef: MutableRefObject<DragSession | null>;
}

export type { ActionDragState, DragSession } from '@/tools/video-editor/hooks/useClipDrag.helpers.ts';

/**
 * Document-level clip drag machine. Every input is timeline store state, so it
 * takes no options — a caller cannot hand it a value that disagrees with the
 * store the rest of the editor reads.
 */
export const useClipDrag = (): UseClipDragResult => {
  const {
    dataRef,
    interactionStateRef,
    selectedClipIdsRef,
    additiveSelectionRef,
    timelineWrapperRef,
    ops,
  } = useTimelineMutableAdapters();
  const {
    deviceClass,
    interactionMode,
    gestureOwner,
    coordinator,
    scale,
    scaleWidth,
  } = useTimelineDataSelector((data) => ({
    deviceClass: data.deviceClass,
    interactionMode: data.interactionMode,
    gestureOwner: data.gestureOwner,
    coordinator: data.coordinator,
    scale: data.scale,
    scaleWidth: data.scaleWidth,
  }), shallow);
  const dragSessionRef = useRef<DragSession | null>(null);
  const stateRef = useRef<DragMachineState>({ phase: 'idle' });
  const actionDragStateRef = useRef<ActionDragState | null>(null);
  const crossTrackActiveRef = useRef(false);
  const autoScrollerRef = useRef<ReturnType<typeof createAutoScroller> | null>(null);
  const { pixelsPerSecondRef } = useTimelineScale({
    scale,
    scaleWidth,
    startLeft: TIMELINE_START_LEFT,
  });

  // Keep volatile values in refs so the effect doesn't re-run mid-drag
  // when zoom/scale or any other store slice changes.
  const latest: UseClipDragLatest = {
    coordinator,
    moveClipToRow: ops.moveClipToRow,
    createTrackAndMoveClip: ops.createTrackAndMoveClip,
    selectClip: ops.selectClip,
    selectClips: ops.selectClips,
    selectedClipIdsRef,
    applyEdit: ops.applyEdit,
    additiveSelectionRef,
    deviceClass,
    interactionMode,
    gestureOwner,
    setGestureOwner: ops.setGestureOwner,
    setInputModalityFromPointerType: ops.setInputModalityFromPointerType,
    interactionStateRef,
  };
  const latestRef = useRef<UseClipDragLatest>(latest);
  latestRef.current = latest;

  useEffect(() => {
    const setCompatSession = (session: DragSession | null) => {
      dragSessionRef.current = session;
    };

    const setState = (nextState: DragMachineState) => {
      stateRef.current = nextState;
      setCompatSession(nextState.phase === 'idle' ? null : nextState.session);
    };

    const getActiveState = (): Extract<DragMachineState, { phase: 'pending' | 'dragging' }> | null => {
      const currentState = stateRef.current;
      return currentState.phase === 'idle' ? null : currentState;
    };

    const endSession = ({ deferDeactivate = false }: { deferDeactivate?: boolean } = {}) => {
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = null;
      latestRef.current.coordinator.end();

      const currentState = getActiveState();
      if (!currentState) {
        actionDragStateRef.current = null;
        if (!deferDeactivate) {
          crossTrackActiveRef.current = false;
        }
        return;
      }

      currentState.controller.abort();
      currentState.session.floatingGhostEl?.remove();
      currentState.session.countBadgeEl?.remove();
      latestRef.current.interactionStateRef.current.drag = false;
      notifyInteractionEndIfIdle(latestRef.current.interactionStateRef);
      if (currentState.session.claimedGestureOwner) {
        latestRef.current.setGestureOwner('none');
      }

      actionDragStateRef.current = null;
      setState({ phase: 'idle' });
      if (deferDeactivate) {
        window.requestAnimationFrame(() => {
          if (stateRef.current.phase === 'idle') {
            crossTrackActiveRef.current = false;
          }
        });
      } else {
        crossTrackActiveRef.current = false;
      }
    };

    const updateDragState = (session: InternalDragSession, clientX: number, clientY: number) => {
      const adjustedClientY = clientY + session.pointerCoordinateYOffset;
      const nextPosition = latestRef.current.coordinator.update({
        clientX,
        clientY: adjustedClientY,
        sourceKind: session.sourceKind,
        clipDuration: session.clipDuration,
        clipOffsetX: session.pointerOffsetX,
        excludeClipIds: new Set(session.draggedClipIds),
      });

      const pixelsPerSecond = pixelsPerSecondRef.current;
      const snapThresholdS = SNAP_THRESHOLD_PX / pixelsPerSecond;
      const targetRowId = nextPosition.trackId ?? session.sourceRowId;
      const targetRow = dataRef.current?.rows.find((row) => row.id === targetRowId);
      const siblings = targetRow?.actions ?? [];
      const { start: snappedStart } = snapDrag(
        nextPosition.time,
        session.clipDuration,
        siblings,
        session.clipId,
        snapThresholdS,
        session.draggedClipIds,
      );

      const dragState = actionDragStateRef.current;
      if (dragState) {
        const duration = dragState.initialEnd - dragState.initialStart;
        dragState.latestStart = snappedStart;
        dragState.latestEnd = snappedStart + duration;
      }

      const dy = adjustedClientY - session.startClientY;
      if (!crossTrackActiveRef.current && Math.abs(dy) >= CROSS_TRACK_THRESHOLD_PX) {
        crossTrackActiveRef.current = true;
        session.floatingGhostEl = createFloatingGhost(session.clipEl);
        updateFloatingGhostPosition(session, clientX, clientY);
      }

      if (crossTrackActiveRef.current) {
        updateFloatingGhostPosition(session, clientX, clientY);
      }

      if (session.floatingGhostEl) {
        session.floatingGhostEl.style.cursor = nextPosition.isReject ? 'not-allowed' : '';
      }

      if (session.draggedClipIds.length > 1) {
        const latestData = dataRef.current;
        if (latestData) {
          const anchorTargetRowId = nextPosition.trackId ?? session.sourceRowId;
          const ghosts = computeSecondaryGhosts(
            session.clipOffsets,
            session.clipId,
            session.sourceRowId,
            anchorTargetRowId,
            nextPosition.screenCoords.clipLeft,
            nextPosition.screenCoords.rowTop,
            nextPosition.screenCoords.rowHeight,
            pixelsPerSecond,
            latestData.rows.map((row) => row.id),
          );
          latestRef.current.coordinator.showSecondaryGhosts(ghosts);
        }
      }
    };

    const enterDragging = (pendingState: Extract<DragMachineState, { phase: 'pending' }>) => {
      const session = pendingState.session;
      if (session.hasMoved) {
        return;
      }

      session.hasMoved = true;
      session.claimedGestureOwner = true;
      latestRef.current.interactionStateRef.current.drag = true;
      latestRef.current.setGestureOwner('clip');
      ensureCountBadge(session);
      setState({
        ...pendingState,
        phase: 'dragging',
      });
    };

    // ── Pointer handlers ─────────────────────────────────────────────

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;

      const wrapper = timelineWrapperRef.current;
      if (!wrapper || !wrapper.contains(event.target as Node)) return;

      const eventTarget = event.target instanceof HTMLElement ? event.target : null;
      const labelTarget = eventTarget?.closest<HTMLElement>(SHOT_GROUP_DRAG_ANCHOR_SELECTOR) ?? null;
      if (labelTarget && eventTarget?.closest('button')) {
        return;
      }

      const anchorClipId = labelTarget?.dataset[SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_DATASET_KEY];
      const anchorRowId = labelTarget?.dataset[SHOT_GROUP_DRAG_ANCHOR_ROW_ID_DATASET_KEY];
      const clipTarget = eventTarget?.closest<HTMLElement>(CLIP_ACTION_SELECTOR)
        ?? (
          anchorClipId && anchorRowId
            ? findClipElement(wrapper, anchorClipId, anchorRowId)
            : null
        );
      if (
        !clipTarget
        || (eventTarget && eventTarget.closest("[data-delete-clip='true'], [data-no-clip-drag]"))
      ) return;

      const clipId = clipTarget.dataset[CLIP_ID_DATASET_KEY];
      const rowId = clipTarget.dataset[ROW_ID_DATASET_KEY];
      if (!clipId || !rowId) return;
      if (latestRef.current.gestureOwner !== 'none' && latestRef.current.gestureOwner !== 'clip') return;

      const inputModality = latestRef.current.setInputModalityFromPointerType(event.pointerType);
      const dragAllowed = shouldAllowTouchClipDrag(
        latestRef.current.deviceClass,
        inputModality,
        latestRef.current.interactionMode,
      );

      const current = dataRef.current;
      const sourceTrack = current?.tracks.find((track) => track.id === rowId);
      const sourceRow = current?.rows.find((row) => row.id === rowId);
      const sourceAction = sourceRow?.actions.find((action) => action.id === clipId);
      if (!current || !sourceTrack || !sourceAction) return;

      endSession();
      const editArea = wrapper.querySelector<HTMLElement>(EDIT_AREA_SELECTOR);
      const { actionDragState, intent, session } = buildPendingDragSession({
        clipId,
        rowId,
        sourceKind: sourceTrack.kind,
        sourceAction,
        current,
        clipTarget,
        labelTarget,
        event,
        selectedClipIds: latestRef.current.selectedClipIdsRef.current,
        additiveSelection: latestRef.current.additiveSelectionRef.current,
        dragAllowed,
        inputModality,
        pixelsPerSecond: pixelsPerSecondRef.current,
      });
      actionDragStateRef.current = actionDragState;

      const controller = new AbortController();
      const signal = controller.signal;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const currentState = getActiveState();
        if (!currentState || moveEvent.pointerId !== currentState.session.pointerId) {
          return;
        }

        const session = currentState.session;
        if (currentState.phase === 'pending') {
          const dx = moveEvent.clientX - session.startClientX;
          const dy = moveEvent.clientY - session.startClientY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < DRAG_THRESHOLD_PX) {
            return;
          }
          if (!session.dragAllowed) {
            return;
          }
          enterDragging(currentState);
        }

        const draggingState = getActiveState();
        if (!draggingState || draggingState.phase !== 'dragging' || moveEvent.pointerId !== draggingState.session.pointerId) {
          return;
        }

        moveEvent.preventDefault();
        autoScrollerRef.current?.update(moveEvent.clientX, moveEvent.clientY);
        updateDragState(draggingState.session, moveEvent.clientX, moveEvent.clientY);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        const currentState = getActiveState();
        if (!currentState || upEvent.pointerId !== currentState.session.pointerId) {
          return;
        }

        const session = currentState.session;
        if (currentState.phase === 'dragging') {
          const dropPosition = latestRef.current.coordinator.lastPosition;
          const nextStart = actionDragStateRef.current?.latestStart
            ?? currentState.intent.clipOffsets.find((clip) => clip.clipId === session.clipId)?.initialStart
            ?? 0;
          if (!session.groupDragEntry && crossTrackActiveRef.current && session.draggedClipIds.length === 1) {
            upEvent.preventDefault();
          }
          const { deferDeactivate } = commitDraggingSession({
            session,
            nextStart,
            dropPosition,
            crossTrackActive: crossTrackActiveRef.current,
            liveData: dataRef.current,
            callbacks: {
              moveClipToRow: latestRef.current.moveClipToRow,
              createTrackAndMoveClip: latestRef.current.createTrackAndMoveClip,
              selectClip: latestRef.current.selectClip,
              selectClips: latestRef.current.selectClips,
              applyEdit: latestRef.current.applyEdit,
            },
          });
          endSession({ deferDeactivate });
          return;
        }

        if (shouldToggleTouchSelection(
          latestRef.current.deviceClass,
          session.inputModality,
          latestRef.current.interactionMode,
        )) {
          userSelectTimelineClip(session.clipId, { additive: true });
        } else if (
          shouldPreserveTouchSelectionForMove(
            latestRef.current.deviceClass,
            session.inputModality,
            latestRef.current.interactionMode,
          )
          && session.wasSelectedOnPointerDown
          && latestRef.current.selectedClipIdsRef.current.size > 1
        ) {
          userSelectTimelineClip(session.clipId, { additive: false, preserveIfSelected: true });
        } else if (session.metaKey || session.ctrlKey) {
          userSelectTimelineClip(session.clipId, { additive: true });
        } else {
          userSelectTimelineClip(session.clipId, { additive: false });
        }
        endSession();
      };

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        const currentState = getActiveState();
        if (!currentState || cancelEvent.pointerId !== currentState.session.pointerId) {
          return;
        }
        endSession();
      };

      autoScrollerRef.current = editArea
        ? createAutoScroller(editArea, (clientX, clientY) => {
            const currentState = getActiveState();
            if (!currentState || currentState.phase !== 'dragging') {
              return;
            }
            updateDragState(currentState.session, clientX, clientY);
          })
        : null;

      setState({
        phase: 'pending',
        controller,
        intent,
        session,
      });

      window.addEventListener('pointermove', handlePointerMove, { signal });
      window.addEventListener('pointerup', handlePointerUp, { signal });
      window.addEventListener('pointercancel', handlePointerCancel, { signal });
    };

    const handleBlur = () => {
      endSession();
    };

    const effectController = new AbortController();
    document.addEventListener('pointerdown', handlePointerDown, { signal: effectController.signal });
    window.addEventListener('blur', handleBlur, { signal: effectController.signal });
    return () => {
      endSession();
      effectController.abort();
    };
  // Stable refs only — volatile values (scale, coordinator, etc.) are read via refs
  // so the effect never re-runs mid-drag.
  }, [dataRef, timelineWrapperRef, pixelsPerSecondRef]);

  return {
    dragSessionRef,
  };
};
