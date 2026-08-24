import type { TrackDefinition, TrackKind } from '@/tools/video-editor/types/index.ts';
import type { TimelineAction, TimelineRow } from '@/tools/video-editor/types/timeline-canvas.ts';
import type { TimelineEditability } from '@/tools/video-editor/lib/timeline-editability.ts';

/**
 * ── Engineering Note: Shared ClipDragPlan Architecture ─────────────────────
 *
 * Preview and commit now share one `ClipDragPlan`, computed once by
 * `planClipDrag()` and cached as `lastPlan` on the `DragCoordinator`.
 * Pointer-up commit consumes `lastPlan` directly (via
 * `applyResolvedClipMove()`) instead of re-running snap/collision resolution,
 * eliminating the long-clip preview/commit divergence bug.
 *
 * All drag snapping uses `snapThresholdS = pixelSnapThreshold / pixelsPerSecond`
 * — an explicit pixel-derived threshold.  No drag code path falls back to clip
 * duration as a snap window, which was the root-cause mechanism of the bug.
 * The duration-sized fallback in `trySnapToEdge()` (coordinate-utils.ts) is
 * preserved only for backward compatibility with non-drag callers.
 *
 * ── Scoped Follow-Up ───────────────────────────────────────────────────────
 *
 * Non-drag `trySnapToEdge()` callers in the following files still pass no
 * explicit `thresholdS` and therefore fall back to clip duration as the snap
 * window.  These paths deserve separate review for long generated assets:
 *
 *   - src/tools/video-editor/lib/sequence-drafts.ts  (line ~138)
 *   - src/tools/video-editor/lib/timeline-asset-plans.ts  (line ~239)
 *
 * These are sequence-draft insertion and asset-drop planning paths, not
 * pointer drags, so they were out of scope for this refactor.  A future pass
 * should audit whether these non-drag callers need an explicit threshold or
 * should be migrated to the planner.
 */

type NewTrackPlacement = 'top' | 'bottom';

interface SnapCandidate {
  time: number;
  edgeType: 'timeline-start' | 'sibling-start' | 'sibling-end';
}

interface RequestedTarget {
  rowIndex: number;
  trackId: string | null;
  trackKind: TrackKind | null;
}

interface ResolvedTarget {
  rowIndex: number;
  trackId: string;
  trackKind: TrackKind;
}

export interface ClipDragPlan {
  readonly pointerTime: number;
  readonly resolvedStart: number;
  readonly targetTrackId: string | null;
  readonly targetRowIndex: number;
  readonly requestedRowIndex: number;
  readonly requestedTrackId: string | null;
  readonly trackKind: TrackKind;
  readonly needsNewTrack: boolean;
  readonly newTrackPlacement: NewTrackPlacement | null;
  readonly snapThresholdS: number;
  readonly snapped: boolean;
  readonly snapEdgeType: 'none' | 'timeline-start' | 'sibling-start' | 'sibling-end';
  readonly pixelSnapThreshold: number;
  readonly pixelsPerSecond: number;
  readonly valid: boolean;
  readonly invalidReason: string | null;
  readonly rejectReason: string | null;
}

export interface ClipDragPlanInput {
  readonly pointerTime: number;
  readonly clipDuration: number;
  readonly clipId: string;
  readonly excludeClipIds?: ReadonlySet<string>;
  readonly sourceKind: TrackKind;
  readonly tracks: ReadonlyArray<TrackDefinition>;
  readonly rows: ReadonlyArray<TimelineRow>;
  /**
   * Raw pointer row index. Callers may pass negative values or values beyond the
   * last row; the planner resolves these into either a compatible row or a
   * new-track intent.
   */
  readonly pointerRowIndex: number;
  readonly pixelSnapThreshold: number;
  readonly pixelsPerSecond: number;
  readonly requestedNewTrackPlacement?: NewTrackPlacement | null;
  readonly allowTrackCreation?: boolean;
  readonly editability?: TimelineEditability;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function collectSiblingEdges(
  rows: ReadonlyArray<TimelineRow>,
  trackId: string,
  excludeIds: ReadonlySet<string>,
): SnapCandidate[] {
  const row = rows.find((candidate) => candidate.id === trackId);
  const siblings: TimelineAction[] = row
    ? row.actions.filter((action) => !excludeIds.has(action.id))
    : [];
  const candidates: SnapCandidate[] = [{ time: 0, edgeType: 'timeline-start' }];

  for (const sibling of siblings) {
    candidates.push({ time: sibling.start, edgeType: 'sibling-start' });
    candidates.push({ time: sibling.end, edgeType: 'sibling-end' });
  }

  return candidates;
}

function overlapsAnySibling(
  rows: ReadonlyArray<TimelineRow>,
  trackId: string,
  candidateTime: number,
  duration: number,
  excludeIds: ReadonlySet<string>,
): boolean {
  const row = rows.find((candidate) => candidate.id === trackId);
  if (!row) {
    return false;
  }

  return row.actions.some((action) => {
    if (excludeIds.has(action.id)) {
      return false;
    }
    return candidateTime < action.end && candidateTime + duration > action.start;
  });
}

function findNearestCompatibleTrack(
  tracks: ReadonlyArray<TrackDefinition>,
  sourceKind: TrackKind,
  requestedRowIndex: number,
): ResolvedTarget | null {
  const compatibleTracks = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.kind === sourceKind);

  if (compatibleTracks.length === 0) {
    return null;
  }

  const nearest = compatibleTracks.reduce((best, candidate) => {
    return Math.abs(candidate.index - requestedRowIndex) < Math.abs(best.index - requestedRowIndex)
      ? candidate
      : best;
  });

  return {
    rowIndex: nearest.index,
    trackId: nearest.track.id,
    trackKind: nearest.track.kind,
  };
}

function findNearestFreeTrackLocal(
  tracks: ReadonlyArray<TrackDefinition>,
  rows: ReadonlyArray<TimelineRow>,
  startTrackId: string,
  kind: TrackKind,
  time: number,
  duration: number,
  excludeIds: ReadonlySet<string>,
): ResolvedTarget | null {
  const startIndex = tracks.findIndex((track) => track.id === startTrackId);
  if (startIndex === -1) {
    return null;
  }

  const isFree = (trackId: string) => {
    return !overlapsAnySibling(rows, trackId, time, duration, excludeIds);
  };

  if (isFree(startTrackId)) {
    const startTrack = tracks[startIndex];
    return {
      rowIndex: startIndex,
      trackId: startTrack.id,
      trackKind: startTrack.kind,
    };
  }

  let below = startIndex + 1;
  let above = startIndex - 1;

  while (below < tracks.length || above >= 0) {
    if (below < tracks.length) {
      const track = tracks[below];
      if (track.kind === kind && isFree(track.id)) {
        return { rowIndex: below, trackId: track.id, trackKind: track.kind };
      }
      below++;
    }
    if (above >= 0) {
      const track = tracks[above];
      if (track.kind === kind && isFree(track.id)) {
        return { rowIndex: above, trackId: track.id, trackKind: track.kind };
      }
      above--;
    }
  }

  return null;
}

function resolveRequestedTarget(
  tracks: ReadonlyArray<TrackDefinition>,
  rows: ReadonlyArray<TimelineRow>,
  pointerRowIndex: number,
): RequestedTarget {
  if (rows.length === 0) {
    return { rowIndex: 0, trackId: null, trackKind: null };
  }

  const clampedRowIndex = clamp(pointerRowIndex, 0, rows.length - 1);
  const targetRow = rows[clampedRowIndex];
  const targetTrack = tracks.find((track) => track.id === targetRow.id) ?? tracks[clampedRowIndex] ?? null;

  return {
    rowIndex: clampedRowIndex,
    trackId: targetTrack?.id ?? targetRow.id,
    trackKind: targetTrack?.kind ?? null,
  };
}

function buildValidPlan(input: {
  pointerTime: number;
  resolvedStart: number;
  targetTrackId: string | null;
  targetRowIndex: number;
  requestedRowIndex: number;
  requestedTrackId: string | null;
  trackKind: TrackKind;
  needsNewTrack: boolean;
  newTrackPlacement: NewTrackPlacement | null;
  snapThresholdS: number;
  snapped: boolean;
  snapEdgeType: ClipDragPlan['snapEdgeType'];
  pixelSnapThreshold: number;
  pixelsPerSecond: number;
  rejectReason?: string | null;
}): ClipDragPlan {
  return {
    pointerTime: input.pointerTime,
    resolvedStart: input.resolvedStart,
    targetTrackId: input.targetTrackId,
    targetRowIndex: input.targetRowIndex,
    requestedRowIndex: input.requestedRowIndex,
    requestedTrackId: input.requestedTrackId,
    trackKind: input.trackKind,
    needsNewTrack: input.needsNewTrack,
    newTrackPlacement: input.newTrackPlacement,
    snapThresholdS: input.snapThresholdS,
    snapped: input.snapped,
    snapEdgeType: input.snapEdgeType,
    pixelSnapThreshold: input.pixelSnapThreshold,
    pixelsPerSecond: input.pixelsPerSecond,
    valid: true,
    invalidReason: null,
    rejectReason: input.rejectReason ?? null,
  };
}

export function planClipDrag(input: ClipDragPlanInput): ClipDragPlan {
  const {
    pointerTime,
    clipDuration,
    clipId,
    excludeClipIds,
    sourceKind,
    tracks,
    rows,
    pointerRowIndex,
    pixelSnapThreshold,
    pixelsPerSecond,
    requestedNewTrackPlacement = null,
    allowTrackCreation = true,
  } = input;

  const snapThresholdS = pixelSnapThreshold / pixelsPerSecond;
  const allExcludeIds = new Set(excludeClipIds ?? []);
  allExcludeIds.add(clipId);

  const requestedTarget = resolveRequestedTarget(tracks, rows, pointerRowIndex);
  const editabilityResult = input.editability?.check({
    clipId,
    sourceTrackId: rows.find((row) => row.actions.some((action) => action.id === clipId))?.id ?? null,
    targetTrackId: requestedTarget.trackId,
  });
  if (editabilityResult && !editabilityResult.allowed) {
    return createInvalidPlan(editabilityResult.reason ?? 'timeline is not editable', {
      pointerTime,
      pixelSnapThreshold,
      pixelsPerSecond,
      sourceKind,
      requestedRowIndex: requestedTarget.rowIndex,
      requestedTrackId: requestedTarget.trackId,
      newTrackPlacement: requestedNewTrackPlacement,
    });
  }
  const clampedPointerRowIndex = rows.length === 0
    ? 0
    : clamp(pointerRowIndex, 0, rows.length - 1);
  const defaultNewTrackPlacement: NewTrackPlacement = requestedNewTrackPlacement
    ?? (pointerRowIndex < 0 ? 'top' : 'bottom');
  const newTrackRowIndex = defaultNewTrackPlacement === 'top' ? 0 : rows.length;

  let resolvedStart = Math.max(0, pointerTime);
  let snapped = false;
  let snapEdgeType: ClipDragPlan['snapEdgeType'] = 'none';

  if (requestedNewTrackPlacement !== null || rows.length === 0) {
    if (resolvedStart > 0 && resolvedStart <= snapThresholdS) {
      resolvedStart = 0;
      snapped = true;
      snapEdgeType = 'timeline-start';
    }

    if (!allowTrackCreation) {
      return createInvalidPlan('track creation is not allowed', {
        pointerTime,
        pixelSnapThreshold,
        pixelsPerSecond,
        sourceKind,
        requestedRowIndex: clampedPointerRowIndex,
        requestedTrackId: requestedTarget.trackId,
        newTrackPlacement: defaultNewTrackPlacement,
      });
    }

    return buildValidPlan({
      pointerTime,
      resolvedStart,
      targetTrackId: null,
      targetRowIndex: newTrackRowIndex,
      requestedRowIndex: clampedPointerRowIndex,
      requestedTrackId: requestedTarget.trackId,
      trackKind: sourceKind,
      needsNewTrack: true,
      newTrackPlacement: defaultNewTrackPlacement,
      snapThresholdS,
      snapped,
      snapEdgeType,
      pixelSnapThreshold,
      pixelsPerSecond,
    });
  }

  let resolvedTarget: ResolvedTarget | null = null;

  if (requestedTarget.trackId && requestedTarget.trackKind === sourceKind) {
    resolvedTarget = {
      rowIndex: requestedTarget.rowIndex,
      trackId: requestedTarget.trackId,
      trackKind: sourceKind,
    };
  } else {
    resolvedTarget = findNearestCompatibleTrack(tracks, sourceKind, requestedTarget.rowIndex);
  }

  if (!resolvedTarget) {
    if (!allowTrackCreation) {
      return createInvalidPlan('no compatible track exists', {
        pointerTime,
        pixelSnapThreshold,
        pixelsPerSecond,
        sourceKind,
        requestedRowIndex: requestedTarget.rowIndex,
        requestedTrackId: requestedTarget.trackId,
        newTrackPlacement: defaultNewTrackPlacement,
      });
    }

    if (resolvedStart > 0 && resolvedStart <= snapThresholdS) {
      resolvedStart = 0;
      snapped = true;
      snapEdgeType = 'timeline-start';
    }

    return buildValidPlan({
      pointerTime,
      resolvedStart,
      targetTrackId: null,
      targetRowIndex: newTrackRowIndex,
      requestedRowIndex: requestedTarget.rowIndex,
      requestedTrackId: requestedTarget.trackId,
      trackKind: sourceKind,
      needsNewTrack: true,
      newTrackPlacement: defaultNewTrackPlacement,
      snapThresholdS,
      snapped,
      snapEdgeType,
      pixelSnapThreshold,
      pixelsPerSecond,
    });
  }

  const snapCandidates = collectSiblingEdges(rows, resolvedTarget.trackId, allExcludeIds);
  let bestCandidate: SnapCandidate | null = null;
  let bestDistance = snapThresholdS;

  for (const candidate of snapCandidates) {
    if (candidate.time < 0) {
      continue;
    }

    const distance = Math.abs(candidate.time - pointerTime);
    if (distance >= bestDistance) {
      continue;
    }

    if (overlapsAnySibling(rows, resolvedTarget.trackId, candidate.time, clipDuration, allExcludeIds)) {
      continue;
    }

    bestCandidate = candidate;
    bestDistance = distance;
  }

  if (bestCandidate) {
    resolvedStart = bestCandidate.time;
    snapped = true;
    snapEdgeType = bestCandidate.edgeType;
  }

  if (overlapsAnySibling(rows, resolvedTarget.trackId, resolvedStart, clipDuration, allExcludeIds)) {
    const freeTarget = findNearestFreeTrackLocal(
      tracks,
      rows,
      resolvedTarget.trackId,
      resolvedTarget.trackKind,
      resolvedStart,
      clipDuration,
      allExcludeIds,
    );

    if (freeTarget) {
      resolvedTarget = freeTarget;
      snapped = false;
      snapEdgeType = 'none';
      if (resolvedStart > 0 && resolvedStart <= snapThresholdS && !overlapsAnySibling(rows, resolvedTarget.trackId, 0, clipDuration, allExcludeIds)) {
        resolvedStart = 0;
        snapped = true;
        snapEdgeType = 'timeline-start';
      }
    } else {
      if (!allowTrackCreation) {
        return createInvalidPlan('all compatible tracks are blocked', {
          pointerTime,
          pixelSnapThreshold,
          pixelsPerSecond,
          sourceKind,
          requestedRowIndex: requestedTarget.rowIndex,
          requestedTrackId: requestedTarget.trackId,
          newTrackPlacement: defaultNewTrackPlacement,
        });
      }

      return buildValidPlan({
        pointerTime,
        resolvedStart: Math.max(0, resolvedStart),
        targetTrackId: null,
        targetRowIndex: newTrackRowIndex,
        requestedRowIndex: requestedTarget.rowIndex,
        requestedTrackId: requestedTarget.trackId,
        trackKind: resolvedTarget.trackKind,
        needsNewTrack: true,
        newTrackPlacement: defaultNewTrackPlacement,
        snapThresholdS,
        snapped,
        snapEdgeType,
        pixelSnapThreshold,
        pixelsPerSecond,
      });
    }
  }

  if (
    resolvedStart > 0
    && resolvedStart <= snapThresholdS
    && !overlapsAnySibling(rows, resolvedTarget.trackId, 0, clipDuration, allExcludeIds)
  ) {
    resolvedStart = 0;
    snapped = true;
    snapEdgeType = 'timeline-start';
  }

  return buildValidPlan({
    pointerTime,
    resolvedStart,
    targetTrackId: resolvedTarget.trackId,
    targetRowIndex: resolvedTarget.rowIndex,
    requestedRowIndex: requestedTarget.rowIndex,
    requestedTrackId: requestedTarget.trackId,
    trackKind: resolvedTarget.trackKind,
    needsNewTrack: false,
    newTrackPlacement: null,
    snapThresholdS,
    snapped,
    snapEdgeType,
    pixelSnapThreshold,
    pixelsPerSecond,
  });
}

export function createInvalidPlan(
  reason: string,
  partial: Pick<ClipDragPlanInput, 'pointerTime' | 'pixelSnapThreshold' | 'pixelsPerSecond' | 'sourceKind'>
    & {
      requestedRowIndex?: number;
      requestedTrackId?: string | null;
      newTrackPlacement?: NewTrackPlacement | null;
    },
): ClipDragPlan {
  return {
    pointerTime: partial.pointerTime,
    resolvedStart: Math.max(0, partial.pointerTime),
    targetTrackId: null,
    targetRowIndex: partial.requestedRowIndex ?? 0,
    requestedRowIndex: partial.requestedRowIndex ?? 0,
    requestedTrackId: partial.requestedTrackId ?? null,
    trackKind: partial.sourceKind,
    needsNewTrack: false,
    newTrackPlacement: partial.newTrackPlacement ?? null,
    snapThresholdS: partial.pixelSnapThreshold / partial.pixelsPerSecond,
    snapped: false,
    snapEdgeType: 'none',
    pixelSnapThreshold: partial.pixelSnapThreshold,
    pixelsPerSecond: partial.pixelsPerSecond,
    valid: false,
    invalidReason: reason,
    rejectReason: reason,
  };
}
