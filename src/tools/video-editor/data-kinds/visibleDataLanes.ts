// dataKind V1 (rework R5): the single lane-visibility rule shared by every
// consumer of assembled lanes. Hidden lanes are skipped; a renderer-less
// non-opaque lane cannot be painted by anyone, so it is absent too; opaque
// lanes render through the host extent-bar fallback in DataLaneRow.
//
// Consumers: TimelineCanvas folds only these lanes' heights into scroll math
// and DataLaneList mounts exactly these rows — one filter, two readers, so
// scrollContentHeight can never disagree with what is on screen.

import type { DataLaneView } from '@/tools/video-editor/data/typed/envelope.ts';

export function visibleDataLanes(
  dataLanes: readonly DataLaneView[] | undefined | null,
): DataLaneView[] {
  return (dataLanes ?? []).filter((lane) =>
    !lane.hidden && (lane.opaque || typeof lane.laneRenderer === 'function'));
}
