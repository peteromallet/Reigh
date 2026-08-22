// dataKind V1 (Batch 6): the duration-neutral lane strip mounted under the
// timeline's track rows (inside the same scroller, sharing the ruler's
// `startLeft`/`pixelsPerSecond` mapping, outside the extension overlay host
// and never gated by `timelineOverlaysEnabled`).
//
// Reads lanes from the (patched) TimelineData plus the data-kind registry
// snapshot: a registered kind without a laneRenderer contributes no row (the
// host cannot paint it); opaque lanes render through the host's extent-bar
// fallback in DataLaneRow. The list is display-only — no selection, no
// duration, no export participation.

import { useMemo } from 'react';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data.ts';
import { useDataKindRegistrySnapshot } from '@/tools/video-editor/data-kinds/DataKindRegistryContext.tsx';
import { DataLaneRow } from './DataLaneRow.tsx';

export interface DataLaneListProps {
  /** Patched TimelineData whose `dataLanes` carry the assembled views. */
  readonly data: TimelineData | null;
  /** Shared timeline x-offset of t=0 (px) — same value TrackListRenderer uses. */
  readonly startLeft: number;
  /** Shared px-per-second scale — same value the ruler and tracks use. */
  readonly pixelsPerSecond: number;
}

export function DataLaneList({ data, startLeft, pixelsPerSecond }: DataLaneListProps) {
  const kindRecords = useDataKindRegistrySnapshot();

  const lanes = useMemo(
    () => (data?.dataLanes ?? []).filter((lane) =>
      // Hidden lanes are skipped; a renderer-less registered kind cannot be
      // painted, so its lane is absent; opaque lanes use the host fallback.
      !lane.hidden && (lane.opaque || typeof lane.laneRenderer === 'function')),
    [data],
  );

  if (lanes.length === 0) {
    return null;
  }

  return (
    <div data-testid="data-lane-list" role="group" aria-label="Data lanes">
      {lanes.map((lane) => (
        <DataLaneRow
          key={lane.laneId}
          lane={lane}
          startLeft={startLeft}
          pixelsPerSecond={pixelsPerSecond}
          extensionId={lane.kindId ? kindRecords.get(lane.kindId)?.ownerExtensionId : undefined}
          domain={lane.kindId ? kindRecords.get(lane.kindId)?.domain : undefined}
        />
      ))}
    </div>
  );
}
