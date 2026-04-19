import type { ClipMeta, TimelineAction, TimelineRow } from '../types.js';

const MIN_CLIP_DURATION = 0.05;

export interface OverlapResult {
  rows: TimelineRow[];
  metaPatches: Record<string, Partial<ClipMeta>>;
  adjustments: Array<{ clipId: string; requestedStart: number; actualStart: number }>;
}

export interface GroupExtent {
  start: number;
  end: number;
}

function findBestGap(
  preferred: number,
  siblings: TimelineAction[],
): { start: number; end: number } | null {
  const occupied = siblings
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start);

  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const occ of occupied) {
    if (occ.start > cursor) {
      gaps.push({ start: cursor, end: occ.start });
    }
    cursor = Math.max(cursor, occ.end);
  }
  gaps.push({ start: cursor, end: Number.POSITIVE_INFINITY });

  let bestGap: { start: number; end: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const gap of gaps) {
    if (preferred >= gap.start && preferred < gap.end) {
      return gap;
    }
    const dist = preferred < gap.start ? gap.start - preferred : preferred - gap.end;
    if (dist < bestDistance) {
      bestDistance = dist;
      bestGap = gap;
    }
  }

  return bestGap;
}

export function findBestGroupStart(
  preferredExtent: GroupExtent,
  siblings: TimelineAction[],
): number | null {
  const preferred = preferredExtent.start;
  const duration = preferredExtent.end - preferredExtent.start;
  const occupied = siblings
    .map((sibling) => ({ start: sibling.start, end: sibling.end }))
    .sort((left, right) => left.start - right.start);

  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const interval of occupied) {
    if (interval.start > cursor) {
      gaps.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  gaps.push({ start: cursor, end: Number.POSITIVE_INFINITY });

  let bestStart: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const gap of gaps) {
    if (gap.end !== Number.POSITIVE_INFINITY && gap.end - gap.start < duration) {
      continue;
    }

    const maxStart = gap.end === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : gap.end - duration;
    const candidateStart = preferred < gap.start
      ? gap.start
      : preferred > maxStart
        ? maxStart
        : preferred;
    const distance = Math.abs(candidateStart - preferred);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStart = candidateStart;
    }
  }

  return bestStart;
}

export function resolveOverlaps(
  rows: TimelineRow[],
  rowId: string,
  clipId: string,
  meta: Record<string, ClipMeta>,
): OverlapResult {
  const metaPatches: Record<string, Partial<ClipMeta>> = {};
  const adjustments: Array<{ clipId: string; requestedStart: number; actualStart: number }> = [];

  const nextRows = rows.map((row) => {
    if (row.id !== rowId) {
      return row;
    }

    const movedAction = row.actions.find((a) => a.id === clipId);
    if (!movedAction) {
      return row;
    }

    const siblings = row.actions.filter((a) => a.id !== clipId);
    const hasOverlap = siblings.some((sib) => movedAction.start < sib.end && movedAction.end > sib.start);
    if (!hasOverlap) {
      return row;
    }

    const clipMeta = meta[clipId];
    const speed = clipMeta?.speed ?? 1;
    const duration = movedAction.end - movedAction.start;
    const gap = findBestGap(movedAction.start, siblings);
    if (!gap) {
      return row;
    }

    let start = Math.max(movedAction.start, gap.start);
    let end = gap.end === Number.POSITIVE_INFINITY ? start + duration : Math.min(start + duration, gap.end);

    if (end - start < MIN_CLIP_DURATION && gap.end !== Number.POSITIVE_INFINITY) {
      start = gap.start;
      end = Math.min(gap.start + duration, gap.end);
    }

    if (end - start < MIN_CLIP_DURATION) {
      return row;
    }

    if (start !== movedAction.start && clipMeta && typeof clipMeta.hold !== 'number') {
      const trimmedSeconds = start - movedAction.start;
      metaPatches[clipId] = {
        ...metaPatches[clipId],
        from: (clipMeta.from ?? 0) + trimmedSeconds * speed,
      };
    }

    if (end !== movedAction.end && clipMeta && typeof clipMeta.hold !== 'number') {
      const from = metaPatches[clipId]?.from ?? clipMeta.from ?? 0;
      metaPatches[clipId] = {
        ...metaPatches[clipId],
        to: from + (end - start) * speed,
      };
    }

    if (start !== movedAction.start) {
      adjustments.push({ clipId, requestedStart: movedAction.start, actualStart: start });
    }

    const trimmedAction = { ...movedAction, start, end };
    return {
      ...row,
      actions: row.actions.map((action) => (action.id === clipId ? trimmedAction : action)),
    };
  });

  return { rows: nextRows, metaPatches, adjustments };
}
