import { useMemo } from 'react';
import type { TimelineShotGroupView } from '@/tools/video-editor/lib/timeline-domain.ts';
import type { TimelineRow } from '@/tools/video-editor/types/timeline-canvas.ts';

const SHOT_COLORS = ['#a855f7', '#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16'];

export interface ShotGroup {
  shotId: string;
  shotName: string;
  rowId: string;
  rowIndex: number;
  start: number;
  clipIds: string[];
  children: Array<{ clipId: string; offset: number; duration: number }>;
  color: string;
  mode?: 'images' | 'video';
  poolGenerationIds: string[];
  variantIdsByGenerationId: Readonly<Record<string, string>>;
  finalVideoAssetKey?: string;
  derivedFrom?: Readonly<{ shotId: string; trackId: string }>;
}

export function getShotColor(shotId: string): string {
  let hash = 0;
  for (let index = 0; index < shotId.length; index += 1) {
    hash = ((hash * 31) + shotId.charCodeAt(index)) >>> 0;
  }
  return SHOT_COLORS[hash % SHOT_COLORS.length];
}

export function useShotGroups(
  rows: TimelineRow[],
  documentGroups: readonly TimelineShotGroupView[],
): ShotGroup[] {
  return useMemo(() => {
    const rowIndexById = new Map(rows.map((row, rowIndex) => [row.id, rowIndex]));

    const result: ShotGroup[] = [];
    for (const group of documentGroups) {
      const placedClipIds = group.placedMembers
        .map((member) => member.clipId)
        .filter((clipId): clipId is string => clipId !== null);
      const resolvedTrackId = rowIndexById.has(group.trackId)
        ? group.trackId
        : rows.find((row) => placedClipIds.some((clipId) => row.actions.some((action) => action.id === clipId)))?.id;
      if (!resolvedTrackId) continue;
      const rowIndex = rowIndexById.get(resolvedTrackId);
      if (typeof rowIndex !== 'number') continue;

      // Soft-tag model: derive children (clipId/offset/duration) from
      // the live row actions, since the data no longer carries them.
      const row = rows[rowIndex];
      if (!row) continue;
      const actionsById = new Map(
        row.actions.map((action) => [action.id, action] as const),
      );
      const liveClipIds = placedClipIds.filter((clipId) => actionsById.has(clipId));
      if (liveClipIds.length === 0 && group.pooledMembers.length === 0) continue;

      const liveActions = liveClipIds
        .map((clipId) => actionsById.get(clipId)!)
        .sort((a, b) => a.start - b.start);
      const firstAction = liveActions[0];
      const groupStart = firstAction?.start ?? 0;
      const children = liveActions.map((action) => ({
        clipId: action.id,
        offset: action.start - groupStart,
        duration: action.end - action.start,
      }));

      result.push({
        shotId: group.shotId,
        shotName: group.name,
        rowId: resolvedTrackId,
        rowIndex,
        start: groupStart,
        clipIds: children.map((child) => child.clipId),
        children,
        color: getShotColor(group.shotId),
        mode: group.mode,
        poolGenerationIds: group.pooledMembers
          .map((member) => member.generationId)
          .filter((generationId): generationId is string => generationId !== null),
        variantIdsByGenerationId: Object.freeze(Object.fromEntries(
          group.members.flatMap((member) => (
            member.generationId && member.variantId
              ? [[member.generationId, member.variantId] as const]
              : []
          )),
        )),
        ...(group.finalVideo ? { finalVideoAssetKey: group.finalVideo.assetKey } : {}),
        ...(group.derivedFrom ? { derivedFrom: group.derivedFrom } : {}),
      });
    }
    return result;
  }, [documentGroups, rows]);
}
