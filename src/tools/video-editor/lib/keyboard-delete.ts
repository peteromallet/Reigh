import { getPinnedShotGroups } from '@/tools/video-editor/lib/config-utils';
import { categorizeSelection, findGroupForTrack } from '@/tools/video-editor/lib/pinned-group-projection';
import { buildDeleteShotGroupMutation, clonePinnedShotGroup } from '@/tools/video-editor/lib/shot-group-commands';
import type { TimelineEditMutation } from '@/tools/video-editor/hooks/useTimelineCommit';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data';

export function buildKeyboardDeleteMutation(
  currentData: TimelineData | null,
  selectedClipIds: Iterable<string>,
): TimelineEditMutation | null {
  if (!currentData) {
    return null;
  }

  const uniqueSelectedClipIds = [...new Set(selectedClipIds)];
  if (uniqueSelectedClipIds.length === 0) {
    return null;
  }

  const selection = categorizeSelection(uniqueSelectedClipIds, currentData.config);
  if (selection.groups.length === 0) {
    return null;
  }

  if (selection.groups.length === 1 && selection.freeClipIds.length === 0) {
    const [groupEntry] = selection.groups;
    return buildDeleteShotGroupMutation({
      currentData,
      group: {
        shotId: groupEntry.groupKey.shotId,
        trackId: groupEntry.groupKey.trackId,
        clipIds: groupEntry.clipIds,
      },
    });
  }

  const matchedGroups = selection.groups
    .map((groupEntry) => findGroupForTrack(
      getPinnedShotGroups(currentData.config) ?? [],
      groupEntry.groupKey.shotId,
      groupEntry.groupKey.trackId,
      currentData.rows,
    ))
    .filter((group): group is NonNullable<typeof group> => Boolean(group));

  const deletedClipIds = [
    ...new Set([
      ...selection.freeClipIds,
      ...matchedGroups.flatMap((group) => group.clipIds),
    ]),
  ];
  if (deletedClipIds.length === 0) {
    return null;
  }

  const deletedClipIdSet = new Set(deletedClipIds);
  const matchedGroupSet = new Set(matchedGroups);

  return {
    type: 'rows',
    rows: currentData.rows.map((row) => ({
      ...row,
      actions: row.actions.filter((action) => !deletedClipIdSet.has(action.id)),
    })),
    metaDeletes: deletedClipIds,
    pinnedShotGroupsOverride: (getPinnedShotGroups(currentData.config) ?? [])
      .filter((group) => !matchedGroupSet.has(group))
      .map(clonePinnedShotGroup),
  };
}
