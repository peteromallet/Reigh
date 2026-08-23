// dataKind V1 (Batch 6): one duration-neutral lane row on the timeline.
//
// Layout mirrors the host's track-row vocabulary: a sticky label gutter
// (LABEL_WIDTH) plus a relative canvas area whose origin IS timeline zero
// (the gutter sits in-flow before it), scaled by the scroller's shared
// `pixelsPerSecond`. Lanes inform — they never edit, and
// their heights are the only quantity the canvas folds into scroll math.
//
// Renderer containment: a registered kind's laneRenderer runs inside a
// `HostContributionErrorBoundary` keyed to its owning extension; an opaque
// lane (unknown schemaRef) gets the host's extent-bar fallback paint.
//
// Interaction (dataKind V1 rework): host-painted chrome participates in the
// timeline interaction model — an extent-bar click dispatches a `dataItem`
// target, any other part of the row a `dataLane` target. Renderer-painted
// items join through the optional `onSelectItem` renderer prop (same
// `dataItem` dispatch); renderers that ignore it stay display-only.

import {
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { HostContributionErrorBoundary } from '@/tools/video-editor/runtime/ContributionErrorBoundary.tsx';
import type { DataLaneRendererProps } from '@reigh/editor-sdk';
import type { DataLaneView } from '@/tools/video-editor/data/typed/envelope.ts';
import { LABEL_WIDTH } from '@/tools/video-editor/lib/coordinate-utils.ts';

export interface DataLaneRowProps {
  readonly lane: DataLaneView;
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

/** Maximum interactive item controls a lane may contribute to the DOM. */
export const DATA_LANE_DOM_ITEM_BUDGET = 128;

type NavigationDirection = 'previous' | 'next' | 'first' | 'last';

function windowStartFor(activeIndex: number, totalItemCount: number): number {
  if (totalItemCount <= DATA_LANE_DOM_ITEM_BUDGET) return 0;
  const centered = activeIndex - Math.floor(DATA_LANE_DOM_ITEM_BUDGET / 2);
  return Math.max(0, Math.min(centered, totalItemCount - DATA_LANE_DOM_ITEM_BUDGET));
}

function navigationDirection(event: KeyboardEvent<HTMLElement>): NavigationDirection | null {
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return 'previous';
    case 'ArrowRight':
    case 'ArrowDown':
      return 'next';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

export function DataLaneRow({ lane, pixelsPerSecond, extensionId, onSelectLane, onSelectItem }: DataLaneRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusItemId, setFocusItemId] = useState<string>();
  const totalItemCount = lane.items.length;
  const clampedActiveIndex = Math.max(0, Math.min(activeIndex, Math.max(0, totalItemCount - 1)));
  const windowStartIndex = windowStartFor(clampedActiveIndex, totalItemCount);
  const windowEndIndex = Math.min(totalItemCount, windowStartIndex + DATA_LANE_DOM_ITEM_BUDGET);
  const windowItems = lane.items.slice(windowStartIndex, windowEndIndex);
  const activeItemId = lane.items[clampedActiveIndex]?.item.id;

  const absoluteIndexInWindow = useCallback((itemId: string): number => {
    const localIndex = windowItems.findIndex((view) => view.item.id === itemId);
    return localIndex < 0 ? -1 : windowStartIndex + localIndex;
  }, [windowItems, windowStartIndex]);

  const selectWindowItem = useCallback((itemId: string) => {
    const index = absoluteIndexInWindow(itemId);
    if (index >= 0) setActiveIndex(index);
    setFocusItemId(undefined);
    onSelectItem?.(itemId);
  }, [absoluteIndexInWindow, onSelectItem]);

  const navigateWindow = useCallback((itemId: string, direction: NavigationDirection) => {
    if (totalItemCount === 0) return;
    const currentIndex = absoluteIndexInWindow(itemId);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (direction === 'previous') nextIndex = Math.max(0, currentIndex - 1);
    if (direction === 'next') nextIndex = Math.min(totalItemCount - 1, currentIndex + 1);
    if (direction === 'first') nextIndex = 0;
    if (direction === 'last') nextIndex = totalItemCount - 1;
    const nextItemId = lane.items[nextIndex]?.item.id;
    if (!nextItemId) return;
    setActiveIndex(nextIndex);
    setFocusItemId(nextItemId);
    onSelectItem?.(nextItemId);
  }, [absoluteIndexInWindow, lane.items, onSelectItem, totalItemCount]);

  // Host-painted controls and cooperative extension renderers expose their
  // item id on the focusable element. Restore focus after the window moves.
  useEffect(() => {
    if (!focusItemId) return;
    const controls = rowRef.current?.querySelectorAll<HTMLElement>('[data-item-id]');
    const target = controls ? [...controls].find((element) => element.dataset.itemId === focusItemId) : undefined;
    target?.focus({ preventScroll: true });
  }, [focusItemId, windowStartIndex]);

  return (
    <div
      ref={rowRef}
      data-testid="data-lane-row"
      data-lane-id={lane.laneId}
      data-lane-kind={lane.opaque ? 'opaque' : lane.kindId}
      data-total-items={totalItemCount}
      data-window-start={windowStartIndex}
      data-window-end={windowEndIndex}
      className="relative flex border-t border-border/40"
      style={{ height: lane.height }}
      onClick={onSelectLane}
    >
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center gap-1 overflow-hidden bg-card px-2 text-[10px] font-medium text-muted-foreground"
        style={{ width: LABEL_WIDTH }}
      >
        <span className="truncate" title={lane.label}>{lane.label}</span>
        <span
          data-testid="data-lane-density-summary"
          className="ml-auto shrink-0 text-[9px] font-normal tabular-nums opacity-70"
          title={`${windowItems.length} of ${totalItemCount} lane items mounted`}
        >
          {windowItems.length}/{totalItemCount}
        </span>
      </div>
      <div className="relative min-w-0 flex-1">
        {paintLane({
          lane,
          pixelsPerSecond,
          extensionId,
          items: windowItems,
          windowStartIndex,
          windowEndIndex,
          totalItemCount,
          activeItemId,
          focusItemId,
          onSelectItem: selectWindowItem,
          onNavigateItem: navigateWindow,
        })}
      </div>
    </div>
  );
}

interface PaintLaneArgs {
  readonly lane: DataLaneView;
  readonly pixelsPerSecond: number;
  readonly extensionId?: string;
  readonly items: DataLaneView['items'];
  readonly windowStartIndex: number;
  readonly windowEndIndex: number;
  readonly totalItemCount: number;
  readonly activeItemId?: string;
  readonly focusItemId?: string;
  readonly onSelectItem: (itemId: string) => void;
  readonly onNavigateItem: (itemId: string, direction: NavigationDirection) => void;
}

function paintLane({
  lane,
  pixelsPerSecond,
  extensionId,
  items,
  windowStartIndex,
  windowEndIndex,
  totalItemCount,
  activeItemId,
  focusItemId,
  onSelectItem,
  onNavigateItem,
}: PaintLaneArgs): ReactNode {
  // Opaque lane (unknown schemaRef): the host paints extent bars itself.
  if (lane.opaque || typeof lane.laneRenderer !== 'function') {
    return extentBars({
      lane,
      items,
      pixelsPerSecond,
      activeItemId,
      onSelectItem,
      onNavigateItem,
    });
  }
  const toRenderItem = (view: DataLaneView['items'][number]) => ({
    id: view.item.id,
    ...(view.item.sourceItemId ? { sourceItemId: view.item.sourceItemId } : {}),
    timelineStart: view.timelineStart,
    timelineEnd: view.timelineEnd,
    clipId: view.clipId,
    ...(view.item.sourceArtifactRef ? { sourceArtifactRef: view.item.sourceArtifactRef } : {}),
    provenance: view.item.provenance,
    payload: view.item.payload,
  });
  const rendererProps: DataLaneRendererProps = {
    kindId: lane.kindId,
    schemaRef: lane.schemaRef,
    shape: lane.shape,
    domain: lane.domain,
    // Pixel offset of timeline zero within the renderer's box; host lane
    // rows are timeline-zero-origin, so the renderer box needs no gutter
    // correction (rework round-2 F1).
    startLeft: 0,
    pixelsPerSecond,
    onSelectItem,
    onNavigateItem,
    activeItemId,
    focusItemId,
    itemWindow: {
      startIndex: windowStartIndex,
      endIndex: windowEndIndex,
      totalItemCount,
    },
    items: items.map(toRenderItem),
    getAllItems: () => lane.items.map(toRenderItem),
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

interface ExtentBarsArgs {
  readonly lane: DataLaneView;
  readonly items: DataLaneView['items'];
  readonly pixelsPerSecond: number;
  readonly activeItemId?: string;
  readonly onSelectItem: (itemId: string) => void;
  readonly onNavigateItem: (itemId: string, direction: NavigationDirection) => void;
}

function extentBars({
  lane,
  items,
  pixelsPerSecond,
  activeItemId,
  onSelectItem,
  onNavigateItem,
}: ExtentBarsArgs): ReactNode {
  return items.map((view) => {
    // The canvas box's origin IS timeline zero (the label gutter sits
    // in-flow before it): bar left is time × scale, no startLeft term.
    const left = view.timelineStart * pixelsPerSecond;
    const spanSeconds = Math.max(0, view.timelineEnd - view.timelineStart);
    return (
      <button
        key={view.item.id}
        type="button"
        data-testid="data-lane-extent-bar"
        data-item-id={view.item.id}
        title={view.item.id}
        aria-label={`Select ${view.item.id}`}
        tabIndex={view.item.id === activeItemId ? 0 : -1}
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
          onSelectItem(view.item.id);
        }}
        onKeyDown={(event) => {
          const direction = navigationDirection(event);
          if (!direction) return;
          event.preventDefault();
          event.stopPropagation();
          onNavigateItem(view.item.id, direction);
        }}
      />
    );
  });
}
