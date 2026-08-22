// dataKind V1 (Batch 6): one duration-neutral lane row on the timeline.
//
// Layout mirrors the host's track-row vocabulary: a sticky label gutter
// (LABEL_WIDTH) plus a relative canvas area sharing the scroller's
// `startLeft`/`pixelsPerSecond` mapping. Lanes inform — they never edit, and
// their heights are the only quantity the canvas folds into scroll math.
//
// Renderer containment: a registered kind's laneRenderer runs inside a
// `HostContributionErrorBoundary` keyed to its owning extension; an opaque
// lane (unknown schemaRef) gets the host's extent-bar fallback paint.
//
// Interaction (dataKind V1 rework): host-painted chrome participates in the
// timeline interaction model — an extent-bar click dispatches a `dataItem`
// target, any other part of the row a `dataLane` target. Renderer-painted
// content stays display-only in V1 and falls through to the lane target.

import { type ComponentType, type ReactNode } from 'react';
import { HostContributionErrorBoundary } from '@/tools/video-editor/runtime/ContributionErrorBoundary.tsx';
import type { DataLaneRendererProps } from '@reigh/editor-sdk';
import type { DataLaneView } from '@/tools/video-editor/data/typed/envelope.ts';
import { LABEL_WIDTH } from '@/tools/video-editor/lib/coordinate-utils.ts';

export interface DataLaneRowProps {
  readonly lane: DataLaneView;
  /** Shared timeline x-offset of t=0 (px) — same value TrackListRenderer uses. */
  readonly startLeft: number;
  /** Shared px-per-second scale — same value the ruler and tracks use. */
  readonly pixelsPerSecond: number;
  /** Owning extension of the registered kind, for boundary recovery keys. */
  readonly extensionId?: string;
  /** Empty lane chrome pressed → dispatch a `dataLane` target upstream. */
  readonly onSelectLane?: () => void;
  /** Host-painted extent bar pressed → dispatch a `dataItem` target upstream. */
  readonly onSelectItem?: (itemId: string) => void;
}

const EXTENT_BAR_MIN_WIDTH_PX = 2;

export function DataLaneRow({ lane, startLeft, pixelsPerSecond, extensionId, onSelectLane, onSelectItem }: DataLaneRowProps) {
  return (
    <div
      data-testid="data-lane-row"
      data-lane-id={lane.laneId}
      data-lane-kind={lane.opaque ? 'opaque' : lane.kindId}
      className="relative flex border-t border-border/40"
      style={{ height: lane.height }}
      onClick={onSelectLane}
    >
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center overflow-hidden bg-card px-2 text-[10px] font-medium text-muted-foreground"
        style={{ width: LABEL_WIDTH }}
      >
        <span className="truncate" title={lane.label}>{lane.label}</span>
      </div>
      <div className="relative min-w-0 flex-1">
        {paintLane(lane, startLeft, pixelsPerSecond, extensionId, onSelectItem)}
      </div>
    </div>
  );
}


function paintLane(
  lane: DataLaneView,
  startLeft: number,
  pixelsPerSecond: number,
  extensionId: string | undefined,
  onSelectItem: ((itemId: string) => void) | undefined,
): ReactNode {
  // Opaque lane (unknown schemaRef): the host paints extent bars itself.
  if (lane.opaque || typeof lane.laneRenderer !== 'function') {
    return extentBars(lane, startLeft, pixelsPerSecond, onSelectItem);
  }
  const rendererProps: DataLaneRendererProps = {
    kindId: lane.kindId,
    schemaRef: lane.schemaRef,
    shape: lane.shape,
    domain: lane.domain,
    items: lane.items.map((view) => ({
      id: view.item.id,
      timelineStart: view.timelineStart,
      timelineEnd: view.timelineEnd,
      clipId: view.clipId,
      payload: view.item.payload,
    })),
  };
  const LaneRenderer = lane.laneRenderer as unknown as ComponentType<DataLaneRendererProps>;
  return (
    <HostContributionErrorBoundary
      contributionId={`dataLane:${lane.laneId}`}
      extensionId={extensionId}
      kind="slot"
      label={`Data lane: ${lane.label}`}
    >
      <LaneRenderer {...rendererProps} />
    </HostContributionErrorBoundary>
  );
}

function extentBars(
  lane: DataLaneView,
  startLeft: number,
  pixelsPerSecond: number,
  onSelectItem: ((itemId: string) => void) | undefined,
): ReactNode {
  return lane.items.map((view) => {
    const left = startLeft + view.timelineStart * pixelsPerSecond;
    const spanSeconds = Math.max(0, view.timelineEnd - view.timelineStart);
    return (
      <div
        key={view.item.id}
        data-testid="data-lane-extent-bar"
        data-item-id={view.item.id}
        title={view.item.id}
        className="absolute top-1/2 -translate-y-1/2 rounded-sm bg-[color:var(--video-editor-accent-bg-strong)] ring-1 ring-[color:var(--video-editor-accent-ring)]"
        style={{
          left,
          width: Math.max(EXTENT_BAR_MIN_WIDTH_PX, spanSeconds * pixelsPerSecond),
          height: Math.max(6, Math.round(lane.height * 0.5)),
        }}
        onClick={(event) => {
          // The bar is the item, not empty lane chrome: keep the row's
          // dataLane handler from also firing.
          event.stopPropagation();
          onSelectItem?.(view.item.id);
        }}
      />
    );
  });
}
