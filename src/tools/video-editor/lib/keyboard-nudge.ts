import { categorizeSelection } from '@/tools/video-editor/lib/pinned-group-projection.ts';
import {
  applyMultiDragMoves,
  planMultiDragMoves,
  type ClipOffset,
} from '@/tools/video-editor/lib/multi-drag-utils.ts';
import type { TimelineEditMutation } from '@/tools/video-editor/hooks/useTimelineCommit.ts';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data.ts';

/**
 * Time-axis step for a keyboard nudge without precision. Coarse on purpose: the
 * frame-accurate step is what `precision` buys, and 0.5s is one arrow press worth
 * of visible movement at the default zoom.
 */
export const COARSE_TIME_NUDGE_SECONDS = 0.5;

/**
 * One frame with precision on, `COARSE_TIME_NUDGE_SECONDS` without — the same
 * precision distinction the playhead seek in `useKeyboardShortcuts` already makes
 * (`Alt+Arrow` seeks `1 / fps` when precision is on).
 */
export function resolveKeyboardNudgeSeconds(
  precisionEnabled: boolean,
  timelineFps: number,
): number {
  if (precisionEnabled && Number.isFinite(timelineFps) && timelineFps > 0) {
    return 1 / timelineFps;
  }

  return COARSE_TIME_NUDGE_SECONDS;
}

/**
 * Translate every selected clip along the time axis by `requestedDeltaSeconds`.
 *
 * Routes through the multi-drag planner/applier so a keyboard nudge lands exactly
 * where the equivalent pointer drag would: same overlap resolution, same clip
 * ordering, same meta updates. Returns `null` when there is nothing to move.
 *
 * Frame accuracy: this builds a `'rows'` mutation, so the commit funnel
 * (`rowsToConfig`) snaps the RESULT of every nudge to the frame grid
 * (`lib/time-grid.ts`). N presses of `1/fps` therefore land on exact frame
 * instants instead of accumulating binary float dust — `1/24` is inexact in
 * binary, and pre-snap the dust walked times across rounding boundaries.
 *
 * Two group behaviours, both borrowed rather than reinvented:
 * - Selecting one member of a pinned shot group moves the whole group, because
 *   `categorizeSelection` expands a member into its group (as the delete path does).
 * - A leftward nudge is clamped **once, for the whole selection**, so the earliest
 *   clip lands on `t=0` and every relative offset survives. Clamping per clip would
 *   collapse the front of the selection onto a single point.
 */
export function buildKeyboardTimeNudgeMutation(
  currentData: TimelineData | null,
  selectedClipIds: Iterable<string>,
  requestedDeltaSeconds: number,
): TimelineEditMutation | null {
  if (!currentData || !Number.isFinite(requestedDeltaSeconds) || requestedDeltaSeconds === 0) {
    return null;
  }

  const selection = categorizeSelection([...selectedClipIds], currentData.config);
  const movedClipIds = new Set([
    ...selection.freeClipIds,
    ...selection.groups.flatMap((group) => group.clipIds),
  ]);
  if (movedClipIds.size === 0) {
    return null;
  }

  const clipOffsets: ClipOffset[] = [];
  let earliestStart = Number.POSITIVE_INFINITY;
  for (const row of currentData.rows) {
    for (const action of row.actions) {
      if (!movedClipIds.has(action.id)) {
        continue;
      }

      earliestStart = Math.min(earliestStart, action.start);
      clipOffsets.push({
        clipId: action.id,
        rowId: row.id,
        deltaTime: 0,
        initialStart: action.start,
        initialEnd: action.end,
      });
    }
  }

  const anchor = clipOffsets[0];
  if (!anchor) {
    return null;
  }

  const deltaSeconds = requestedDeltaSeconds < 0
    ? Math.min(0, Math.max(requestedDeltaSeconds, -earliestStart))
    : requestedDeltaSeconds;
  if (deltaSeconds === 0) {
    return null;
  }

  // Anchor on the first clip in row order and target its own row: this is a
  // time-only move, so the planner's track delta must be zero.
  const { canMove, moves } = planMultiDragMoves(
    currentData,
    clipOffsets,
    anchor.clipId,
    anchor.rowId,
    anchor.rowId,
    deltaSeconds,
  );
  if (!canMove || moves.length === 0) {
    return null;
  }

  const { nextRows, metaUpdates, nextClipOrder } = applyMultiDragMoves(currentData, moves);

  return {
    type: 'rows',
    rows: nextRows,
    metaUpdates,
    clipOrderOverride: nextClipOrder,
  };
}
