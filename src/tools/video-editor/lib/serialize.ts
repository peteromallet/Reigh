import {
  serializeForDisk as serializeTimelineForDisk,
  TIMELINE_CLIP_FIELDS,
  TRACK_DEFINITION_FIELDS,
  validateSerializedConfig,
} from '@tbd/schema';

import { setPinnedShotGroups } from '@/tools/video-editor/lib/config-utils';
import type {
  ResolvedTimelineConfig,
  TimelineConfig,
  TimelinePinnedShotGroups,
} from '@/tools/video-editor/types';

export {
  TIMELINE_CLIP_FIELDS,
  TRACK_DEFINITION_FIELDS,
  validateSerializedConfig,
} from '@tbd/schema';

export const serializeForDisk = (
  resolved: ResolvedTimelineConfig,
  pinnedShotGroups?: TimelinePinnedShotGroups,
): TimelineConfig => {
  return serializeTimelineForDisk(setPinnedShotGroups(resolved, pinnedShotGroups));
};
