// dataKind V1 (Batch 6): the duration-neutral lane strip mounted under the
// timeline's track rows (inside the same scroller, sharing the ruler's
// `pixelsPerSecond` scale — lane rows themselves are timeline-zero-origin,
// and never gated by `timelineOverlaysEnabled`).
//
// Reads lanes from the (patched) TimelineData plus the data-kind registry
// snapshot: a registered kind without a laneRenderer contributes no row (the
// host cannot paint it); opaque lanes render through the host's extent-bar
// fallback in DataLaneRow. The list is display-only — no duration, no export
// participation.
//
// Interaction (dataKind V1 rework): host-painted chrome dispatches timeline
// interaction targets through the same setters the overlay host uses — an
// extent-bar press produces `{kind:'dataItem', laneId, itemId, …}` and empty
// lane chrome a `{kind:'dataLane', laneId, …}`, with extension/contribution
// ids resolved from the registry record. With no setters (tests, isolated
// renders) the rows stay purely display-only.

import { useCallback, useMemo } from 'react';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data.ts';
import type {
  TimelineInteractionTarget,
  TimelineInspectorTarget,
  TimelineContextTarget,
} from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import { visibleDataLanes } from '@/tools/video-editor/data-kinds/visibleDataLanes.ts';
import { useDataKindRegistrySnapshot } from '@/tools/video-editor/data-kinds/DataKindRegistryContext.tsx';
import { DataLaneRow, type DataLaneViewport } from './DataLaneRow.tsx';

export interface DataLaneListProps {
  /** Patched TimelineData whose `dataLanes` carry the assembled views. */
  readonly data: TimelineData | null;
  /**
   * Optional call-site symmetry with the track rows; lane rows never consume
   * it (their gutter sits in-flow, so the canvas origin IS t=0) and renderer
   * props always carry `startLeft: 0` (rework round-2 F1). Defaults to 0.
   */
  readonly startLeft?: number;
  /** Shared px-per-second scale — same value the ruler and tracks use. */
  readonly pixelsPerSecond: number;
  /** Measured timeline scroll viewport used for time-based item virtualization. */
  readonly viewport?: DataLaneViewport;
  /** Scroll the shared timeline viewport to a keyboard navigation target. */
  readonly onRequestItemIntoView?: (timelineStart: number, timelineEnd: number) => void;
  /** Timeline interaction-model setters, shared with the overlay host. */
  readonly clearSelection?: () => void;
  readonly setSelectedTrackId?: (trackId: string | null) => void;
  readonly setContextTarget?: (target: TimelineContextTarget) => void;
  readonly setInspectorTarget?: (target: TimelineInspectorTarget) => void;
}

export function DataLaneList({
  data,
  pixelsPerSecond,
  viewport,
  onRequestItemIntoView,
  clearSelection,
  setSelectedTrackId,
  setContextTarget,
  setInspectorTarget,
}: DataLaneListProps) {
  const kindRecords = useDataKindRegistrySnapshot();

  const dispatch = useCallback((target: TimelineInteractionTarget) => {
    // A data target replaces clip/track selection. Clear those synchronous
    // selection-store values before publishing the target so the shell cannot
    // derive a stale clip inspector and overwrite the user's first lane click.
    clearSelection?.();
    setSelectedTrackId?.(null);
    setContextTarget?.(target);
    setInspectorTarget?.(target);
  }, [clearSelection, setContextTarget, setInspectorTarget, setSelectedTrackId]);

  const lanes = useMemo(
    () => visibleDataLanes(data?.dataLanes),
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
          pixelsPerSecond={pixelsPerSecond}
          viewport={viewport}
          onRequestItemIntoView={onRequestItemIntoView}
          extensionId={lane.kindId ? kindRecords.get(lane.kindId)?.ownerExtensionId : undefined}
          laneActions={lane.kindId ? kindRecords.get(lane.kindId)?.laneActions : undefined}
          supportsSparseItemWindows={lane.kindId
            ? kindRecords.get(lane.kindId)?.supportsSparseItemWindows === true
            : false}
          onSelectLane={() => dispatch({
            kind: 'dataLane',
            laneId: lane.laneId,
            extensionId: lane.kindId ? kindRecords.get(lane.kindId)?.ownerExtensionId : undefined,
            contributionId: lane.kindId ? kindRecords.get(lane.kindId)?.contributionId : undefined,
          })}
          onSelectItem={(itemId) => dispatch({
            kind: 'dataItem',
            laneId: lane.laneId,
            itemId,
            extensionId: lane.kindId ? kindRecords.get(lane.kindId)?.ownerExtensionId : undefined,
            contributionId: lane.kindId ? kindRecords.get(lane.kindId)?.contributionId : undefined,
          })}
        />
      ))}
    </div>
  );
}
