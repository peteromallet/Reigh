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
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { HostContributionErrorBoundary } from '@/tools/video-editor/runtime/ContributionErrorBoundary.tsx';
import type {
  DataLaneActionDescriptor,
  DataLaneRenderItem,
  DataLaneRendererProps,
} from '@reigh/editor-sdk';
import type { DataLaneView } from '@/tools/video-editor/data/typed/envelope.ts';
import { LABEL_WIDTH } from '@/tools/video-editor/lib/coordinate-utils.ts';

export interface DataLaneRowProps {
  readonly lane: DataLaneView;
  /** Shared px-per-second scale — same value the ruler and tracks use. */
  readonly pixelsPerSecond: number;
  /** Actual horizontal timeline viewport, in scroll-container pixels. */
  readonly viewport?: DataLaneViewport;
  /** Move the real timeline scroller so a keyboard target becomes visible. */
  readonly onRequestItemIntoView?: (timelineStart: number, timelineEnd: number) => void;
  /** Owning extension of the registered kind, for boundary recovery keys. */
  readonly extensionId?: string;
  /** Host-rendered whole-lane actions bound to the kind registration. */
  readonly laneActions?: readonly DataLaneActionDescriptor[];
  /** Registered renderer explicitly accepts non-contiguous item windows. */
  readonly supportsSparseItemWindows?: boolean;
  /** Empty lane chrome pressed → dispatch a `dataLane` target upstream. */
  readonly onSelectLane?: () => void;
  /** Host-painted extent bar pressed → dispatch a `dataItem` target upstream. */
  readonly onSelectItem?: (itemId: string) => void;
}

const EXTENT_BAR_MIN_WIDTH_PX = 2;

/** Host recovery bound for extension actions that never settle. */
export const DATA_LANE_ACTION_TIMEOUT_MS = 15_000;

const DATA_LANE_ACTION_ERROR_MAX_LENGTH = 180;

function boundedActionError(cause: unknown): string {
  const rawMessage = cause instanceof Error ? cause.message : String(cause);
  const normalized = Array.from(rawMessage, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  }).join('').trim() || 'Action failed.';
  return normalized.length > DATA_LANE_ACTION_ERROR_MAX_LENGTH
    ? `${normalized.slice(0, DATA_LANE_ACTION_ERROR_MAX_LENGTH - 1)}…`
    : normalized;
}

/** Maximum interactive item controls a lane may contribute to the DOM. */
export const DATA_LANE_DOM_ITEM_BUDGET = 128;

/** Extra timeline pixels mounted on either side of the visible canvas. */
export const DATA_LANE_VIEWPORT_OVERSCAN_PX = 256;

/** Isolated-render fallback; TimelineCanvas always supplies measured geometry. */
export const DATA_LANE_DEFAULT_VIEWPORT_WIDTH_PX = 1_024;

export interface DataLaneViewport {
  readonly scrollLeft: number;
  readonly clientWidth: number;
}

type NavigationDirection = 'previous' | 'next' | 'first' | 'last';

interface DataLaneTemporalIndex {
  /** Canonical order is timelineStart, then occurrence id. */
  readonly items: DataLaneView['items'];
  /** Complete binary max-end tree for output-sensitive interval queries. */
  readonly maxEndTree: Float64Array;
  readonly treeLeafCount: number;
}

interface DataLaneItemWindow {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly itemIndices: readonly number[];
  readonly viewportStartSeconds: number;
  readonly viewportEndSeconds: number;
}

function timelineEndForIndex(view: DataLaneView['items'][number]): number {
  return Math.max(view.timelineStart, view.timelineEnd);
}

function compareLaneItems(
  left: DataLaneView['items'][number],
  right: DataLaneView['items'][number],
): number {
  return (left.timelineStart - right.timelineStart)
    || (left.item.id < right.item.id ? -1 : left.item.id > right.item.id ? 1 : 0);
}

function createTemporalIndex(items: DataLaneView['items']): DataLaneTemporalIndex {
  let ordered = true;
  for (let index = 1; index < items.length; index += 1) {
    if (compareLaneItems(items[index - 1], items[index]) > 0) {
      ordered = false;
      break;
    }
  }
  // assembleDataLanes guarantees this order. The fallback keeps isolated and
  // legacy callers safe without paying a sort for canonical host lanes.
  const indexedItems = ordered ? items : [...items].sort(compareLaneItems);
  let treeLeafCount = 1;
  while (treeLeafCount < indexedItems.length) treeLeafCount *= 2;
  const maxEndTree = new Float64Array(treeLeafCount * 2);
  maxEndTree.fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < indexedItems.length; index += 1) {
    maxEndTree[treeLeafCount + index] = timelineEndForIndex(indexedItems[index]);
  }
  for (let node = treeLeafCount - 1; node > 0; node -= 1) {
    maxEndTree[node] = Math.max(maxEndTree[node * 2], maxEndTree[node * 2 + 1]);
  }
  return { items: indexedItems, maxEndTree, treeLeafCount };
}

function upperBoundStart(items: DataLaneView['items'], target: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (items[middle].timelineStart <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function centeredBoundedWindow(
  rangeStart: number,
  rangeEnd: number,
  anchorIndex: number,
): Pick<DataLaneItemWindow, 'startIndex' | 'endIndex'> {
  const rangeLength = rangeEnd - rangeStart;
  if (rangeLength <= DATA_LANE_DOM_ITEM_BUDGET) {
    return { startIndex: rangeStart, endIndex: rangeEnd };
  }
  const desiredStart = anchorIndex - Math.floor(DATA_LANE_DOM_ITEM_BUDGET / 2);
  const startIndex = Math.max(
    rangeStart,
    Math.min(desiredStart, rangeEnd - DATA_LANE_DOM_ITEM_BUDGET),
  );
  return { startIndex, endIndex: startIndex + DATA_LANE_DOM_ITEM_BUDGET };
}

function contiguousIndices(startIndex: number, endIndex: number): readonly number[] {
  return Array.from({ length: Math.max(0, endIndex - startIndex) }, (_, offset) => startIndex + offset);
}

/**
 * Query actual temporal intersections. The max-end tree skips expired dense
 * subtrees even when one ancient long interval keeps an overall prefix alive.
 */
function overlappingItemIndices(
  index: DataLaneTemporalIndex,
  queryStart: number,
  queryEnd: number,
): readonly number[] {
  const startBound = upperBoundStart(index.items, queryEnd);
  const matches: number[] = [];
  const visit = (node: number, left: number, right: number) => {
    if (left >= startBound || index.maxEndTree[node] < queryStart) return;
    if (right - left === 1) {
      if (left < index.items.length && timelineEndForIndex(index.items[left]) >= queryStart) {
        matches.push(left);
      }
      return;
    }
    const middle = left + Math.floor((right - left) / 2);
    visit(node * 2, left, middle);
    visit(node * 2 + 1, middle, right);
  };
  visit(1, 0, index.treeLeafCount);
  return matches;
}

function capOverlappingIndices(
  index: DataLaneTemporalIndex,
  indices: readonly number[],
  viewportStartSeconds: number,
  viewportEndSeconds: number,
): readonly number[] {
  if (indices.length <= DATA_LANE_DOM_ITEM_BUDGET) return indices;
  const viewportMiddle = (viewportStartSeconds + viewportEndSeconds) / 2;
  const comparePriority = (leftIndex: number, rightIndex: number): number => {
    const left = index.items[leftIndex];
    const right = index.items[rightIndex];
    const leftEnd = timelineEndForIndex(left);
    const rightEnd = timelineEndForIndex(right);
    const leftDistance = viewportMiddle < left.timelineStart
      ? left.timelineStart - viewportMiddle
      : viewportMiddle > leftEnd ? viewportMiddle - leftEnd : 0;
    const rightDistance = viewportMiddle < right.timelineStart
      ? right.timelineStart - viewportMiddle
      : viewportMiddle > rightEnd ? viewportMiddle - rightEnd : 0;
    return (leftDistance - rightDistance)
      || ((rightEnd - right.timelineStart) - (leftEnd - left.timelineStart))
      || compareLaneItems(left, right)
      || (leftIndex - rightIndex);
  };

  // Fixed-size max heap: the worst retained candidate stays at the root, so
  // each additional overlap costs O(log DOM_ITEM_BUDGET), never a full k sort.
  const heap: number[] = [];
  const siftUp = (start: number) => {
    let child = start;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (comparePriority(heap[parent], heap[child]) >= 0) break;
      [heap[parent], heap[child]] = [heap[child], heap[parent]];
      child = parent;
    }
  };
  const siftDown = () => {
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      if (left >= heap.length) return;
      const right = left + 1;
      const worseChild = right < heap.length && comparePriority(heap[right], heap[left]) > 0
        ? right
        : left;
      if (comparePriority(heap[parent], heap[worseChild]) >= 0) return;
      [heap[parent], heap[worseChild]] = [heap[worseChild], heap[parent]];
      parent = worseChild;
    }
  };
  for (const itemIndex of indices) {
    if (heap.length < DATA_LANE_DOM_ITEM_BUDGET) {
      heap.push(itemIndex);
      siftUp(heap.length - 1);
    } else if (comparePriority(itemIndex, heap[0]) < 0) {
      heap[0] = itemIndex;
      siftDown();
    }
  }
  return heap.sort((left, right) => left - right);
}

function selectViewportWindow(
  index: DataLaneTemporalIndex,
  pixelsPerSecond: number,
  viewport: DataLaneViewport,
  pinnedIndex?: number,
  supportsSparseItemWindows = false,
): DataLaneItemWindow {
  const safePixelsPerSecond = Math.max(Number.EPSILON, pixelsPerSecond);
  // The sticky LABEL_WIDTH gutter occludes the left side of the scroller. In
  // row-canvas coordinates its right edge is exactly scrollLeft, so t=0 is
  // visible at scrollLeft=0 and late scrolls map directly to scrollLeft / pps.
  const canvasViewportWidth = Math.max(0, viewport.clientWidth - LABEL_WIDTH);
  const viewportStartSeconds = Math.max(0, viewport.scrollLeft / safePixelsPerSecond);
  const viewportEndSeconds = Math.max(
    viewportStartSeconds,
    (viewport.scrollLeft + canvasViewportWidth) / safePixelsPerSecond,
  );
  if (index.items.length === 0) {
    return { startIndex: 0, endIndex: 0, itemIndices: [], viewportStartSeconds, viewportEndSeconds };
  }

  if (pinnedIndex !== undefined) {
    const boundedPin = Math.max(0, Math.min(pinnedIndex, index.items.length - 1));
    const pinned = centeredBoundedWindow(0, index.items.length, boundedPin);
    return {
      ...pinned,
      itemIndices: contiguousIndices(pinned.startIndex, pinned.endIndex),
      viewportStartSeconds,
      viewportEndSeconds,
    };
  }

  const overscanSeconds = DATA_LANE_VIEWPORT_OVERSCAN_PX / safePixelsPerSecond;
  const queryStart = Math.max(0, viewportStartSeconds - overscanSeconds);
  const queryEnd = viewportEndSeconds + overscanSeconds;
  const overlapping = overlappingItemIndices(index, queryStart, queryEnd);
  if (overlapping.length === 0) {
    const insertionIndex = upperBoundStart(index.items, queryEnd);
    return {
      startIndex: insertionIndex,
      endIndex: insertionIndex,
      itemIndices: [],
      viewportStartSeconds,
      viewportEndSeconds,
    };
  }
  if (!supportsSparseItemWindows) {
    const viewportMiddle = (viewportStartSeconds + viewportEndSeconds) / 2;
    const bounded = centeredBoundedWindow(
      overlapping[0],
      overlapping[overlapping.length - 1] + 1,
      upperBoundStart(index.items, viewportMiddle),
    );
    return {
      ...bounded,
      itemIndices: contiguousIndices(bounded.startIndex, bounded.endIndex),
      viewportStartSeconds,
      viewportEndSeconds,
    };
  }
  const itemIndices = capOverlappingIndices(
    index,
    overlapping,
    viewportStartSeconds,
    viewportEndSeconds,
  );
  return {
    startIndex: itemIndices[0],
    endIndex: itemIndices[itemIndices.length - 1] + 1,
    itemIndices,
    viewportStartSeconds,
    viewportEndSeconds,
  };
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

export function DataLaneRow({
  lane,
  pixelsPerSecond,
  viewport,
  onRequestItemIntoView,
  extensionId,
  laneActions,
  supportsSparseItemWindows,
  onSelectLane,
  onSelectItem,
}: DataLaneRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Keep the roving selection anchored to the stable item id. The absolute
  // index is only a fallback when the selected item is removed; insertion or
  // re-sorting must not silently move selection to a neighbouring interval.
  const activeItemIdRef = useRef<string>();
  const [focusItemId, setFocusItemId] = useState<string>();
  const [pinnedIndex, setPinnedIndex] = useState<number>();
  const temporalIndex = useMemo(() => createTemporalIndex(lane.items), [lane.items]);
  const orderedItems = temporalIndex.items;
  const totalItemCount = orderedItems.length;
  const selectedItemIndex = activeItemIdRef.current === undefined
    ? -1
    : orderedItems.findIndex((view) => view.item.id === activeItemIdRef.current);
  const clampedActiveIndex = selectedItemIndex >= 0
    ? selectedItemIndex
    : Math.max(0, Math.min(activeIndex, Math.max(0, totalItemCount - 1)));
  const resolvedViewport = viewport ?? {
    scrollLeft: 0,
    clientWidth: DATA_LANE_DEFAULT_VIEWPORT_WIDTH_PX,
  };
  // Isolated renderers have no real scroller to observe, so retain the legacy
  // active-item window only for that compatibility path. TimelineCanvas always
  // supplies viewport geometry and never takes this branch.
  const pinnedWindowIndex = pinnedIndex ?? (viewport ? undefined : clampedActiveIndex);
  const itemWindow = selectViewportWindow(
    temporalIndex,
    pixelsPerSecond,
    resolvedViewport,
    pinnedWindowIndex,
    lane.opaque || supportsSparseItemWindows === true,
  );
  const {
    startIndex: windowStartIndex,
    endIndex: windowEndIndex,
    itemIndices: windowItemIndices,
  } = itemWindow;
  const windowItems = useMemo(
    () => windowItemIndices.map((index) => orderedItems[index]),
    [orderedItems, windowItemIndices],
  );
  const activeLocalIndex = windowItemIndices.indexOf(clampedActiveIndex);
  const windowActiveIndex = activeLocalIndex >= 0
    ? clampedActiveIndex
    : windowItemIndices[Math.floor(windowItemIndices.length / 2)];
  const activeItemId = orderedItems[windowActiveIndex]?.item.id;

  // If the selected item disappeared, deliberately fall back to the nearest
  // surviving index. Persist that fallback so subsequent inserts/re-sorts are
  // again tracked by stable id rather than by a stale numeric index.
  useEffect(() => {
    const fallbackId = orderedItems[clampedActiveIndex]?.item.id;
    if (activeItemIdRef.current !== fallbackId) activeItemIdRef.current = fallbackId;
    setActiveIndex((current) => current === clampedActiveIndex ? current : clampedActiveIndex);
  }, [clampedActiveIndex, orderedItems]);
  const getAllRenderItems = useMemo(() => {
    let cached: readonly DataLaneRenderItem[] | undefined;
    return () => {
      cached ??= orderedItems.map(toRenderItem);
      return cached;
    };
  }, [orderedItems]);

  const absoluteIndexInWindow = useCallback((itemId: string): number => {
    const localIndex = windowItems.findIndex((view) => view.item.id === itemId);
    return localIndex < 0 ? -1 : windowItemIndices[localIndex];
  }, [windowItemIndices, windowItems]);

  const selectWindowItem = useCallback((itemId: string) => {
    const index = absoluteIndexInWindow(itemId);
    if (index >= 0) {
      activeItemIdRef.current = itemId;
      setActiveIndex(index);
    }
    setPinnedIndex(undefined);
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
    const nextItem = orderedItems[nextIndex];
    if (!nextItem) return;
    const nextItemId = nextItem.item.id;
    activeItemIdRef.current = nextItemId;
    setActiveIndex(nextIndex);
    // State and scroll updates batch in React. Pin the requested item during
    // that hand-off so focus never lands in an empty/unmounted window.
    setPinnedIndex(nextIndex);
    setFocusItemId(nextItemId);
    onRequestItemIntoView?.(nextItem.timelineStart, nextItem.timelineEnd);
    onSelectItem?.(nextItemId);
  }, [absoluteIndexInWindow, onRequestItemIntoView, onSelectItem, orderedItems, totalItemCount]);

  useEffect(() => {
    if (pinnedIndex === undefined) return;
    const pinnedItem = orderedItems[pinnedIndex];
    if (!pinnedItem) {
      setPinnedIndex(undefined);
      return;
    }
    const itemEnd = timelineEndForIndex(pinnedItem);
    if (
      pinnedItem.timelineStart <= itemWindow.viewportEndSeconds
      && itemEnd >= itemWindow.viewportStartSeconds
    ) {
      setPinnedIndex(undefined);
    }
  }, [itemWindow.viewportEndSeconds, itemWindow.viewportStartSeconds, orderedItems, pinnedIndex]);

  // Host-painted controls and cooperative extension renderers expose their
  // item id on the focusable element. Restore focus after the window moves.
  useEffect(() => {
    if (!focusItemId) return;
    const controls = rowRef.current?.querySelectorAll<HTMLElement>('[data-item-id]');
    const target = controls ? [...controls].find((element) => element.dataset.itemId === focusItemId) : undefined;
    target?.focus({ preventScroll: true });
  }, [focusItemId, windowItems]);

  return (
    <div
      ref={rowRef}
      data-testid="data-lane-row"
      data-lane-id={lane.laneId}
      data-lane-kind={lane.opaque ? 'opaque' : lane.kindId}
      data-total-items={totalItemCount}
      data-window-start={windowStartIndex}
      data-window-end={windowEndIndex}
      data-viewport-start={itemWindow.viewportStartSeconds}
      data-viewport-end={itemWindow.viewportEndSeconds}
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
      <div className="relative grid min-w-0 flex-1">
        <div className="col-start-1 row-start-1 min-w-0">
          {paintLane({
            lane,
            pixelsPerSecond,
            extensionId,
            items: windowItems,
            itemIndices: windowItemIndices,
            windowStartIndex,
            windowEndIndex,
            totalItemCount,
            activeItemId,
            focusItemId,
            getAllRenderItems,
            onSelectItem: selectWindowItem,
            onNavigateItem: navigateWindow,
          })}
        </div>
        {laneActions && laneActions.length > 0 ? (
          <LaneActionMenu
            laneLabel={lane.label}
            actions={laneActions}
            getItems={getAllRenderItems}
          />
        ) : null}
      </div>
    </div>
  );
}

interface LaneActionMenuProps {
  readonly laneLabel: string;
  readonly actions: readonly DataLaneActionDescriptor[];
  readonly getItems: () => readonly DataLaneRenderItem[];
}

const LaneActionMenu = memo(function LaneActionMenu({ laneLabel, actions, getItems }: LaneActionMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [runningActionId, setRunningActionId] = useState<string>();
  const [error, setError] = useState<string>();
  const [menuPosition, setMenuPosition] = useState({ left: 4, top: 4 });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>('.timeline-canvas-edit-area');
    if (!root || !scroller) return;
    const syncViewportClamp = () => {
      const scrollerRight = scroller.getBoundingClientRect().right;
      const hiddenRight = Math.max(0, scrollerRight - window.innerWidth);
      root.style.right = `${4 + hiddenRight}px`;
    };
    syncViewportClamp();
    window.addEventListener('resize', syncViewportClamp);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(syncViewportClamp);
    observer?.observe(scroller);
    return () => {
      window.removeEventListener('resize', syncViewportClamp);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    actionRefs.current[0]?.focus({ preventScroll: true });
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const menuWidth = Math.min(176, Math.max(1, window.innerWidth - 8));
      const menuHeight = menuRef.current?.getBoundingClientRect().height ?? 104;
      const left = Math.max(4, Math.min(trigger.right - menuWidth, window.innerWidth - menuWidth - 4));
      const below = trigger.bottom + 2;
      const top = below + menuHeight <= window.innerHeight - 4
        ? below
        : Math.max(4, trigger.top - menuHeight - 2);
      setMenuPosition((current) => current.left === left && current.top === top
        ? current
        : { left, top });
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, error]);

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    setError(undefined);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const invoke = useCallback(async (action: DataLaneActionDescriptor) => {
    setRunningActionId(action.id);
    setError(undefined);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const invocation = Promise.resolve().then(() => action.invoke(getItems()));
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Action timed out after ${DATA_LANE_ACTION_TIMEOUT_MS / 1_000} seconds. Try again.`));
        }, DATA_LANE_ACTION_TIMEOUT_MS);
      });
      await Promise.race([invocation, timeout]);
      closeAndRestoreFocus();
    } catch (cause) {
      setError(boundedActionError(cause));
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      setRunningActionId(undefined);
    }
  }, [closeAndRestoreFocus, getItems]);

  const stopRowSelection = (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation();

  return (
    <div
      ref={rootRef}
      data-testid="data-lane-action-rail"
      className="pointer-events-none sticky right-1 z-30 col-start-1 row-start-1 mr-1 flex h-full w-20 items-center justify-self-end bg-card pl-2"
      onClick={stopRowSelection}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid="data-lane-actions-trigger"
        className="pointer-events-auto h-5 rounded border border-border bg-card/95 px-2 text-[10px] font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${laneLabel} actions`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${laneLabel} actions`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
          setError(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        Actions ({actions.length})
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${laneLabel} actions`}
          data-testid="data-lane-actions-menu"
          className="pointer-events-auto fixed z-[100] grid min-w-44 gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeAndRestoreFocus();
              return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const currentIndex = actionRefs.current.findIndex((button) => button === document.activeElement);
            let nextIndex = currentIndex;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = actions.length - 1;
            if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % actions.length;
            if (event.key === 'ArrowUp') nextIndex = currentIndex < 0
              ? actions.length - 1
              : (currentIndex - 1 + actions.length) % actions.length;
            actionRefs.current[nextIndex]?.focus({ preventScroll: true });
          }}
        >
          {actions.map((action, index) => (
            <button
              key={action.id}
              ref={(element) => { actionRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              data-lane-action-id={action.id}
              className="rounded px-2 py-1 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
              aria-label={action.ariaLabel ?? action.label}
              title={action.title}
              disabled={runningActionId !== undefined}
              onClick={(event) => {
                event.stopPropagation();
                void invoke(action);
              }}
            >
              {runningActionId === action.id ? `${action.label}…` : action.label}
            </button>
          ))}
          {error ? (
            <div role="alert" className="max-w-64 px-2 py-1 text-[10px] leading-tight text-destructive">
              {error}
            </div>
          ) : null}
        </div>
      , document.body) : null}
    </div>
  );
});

interface PaintLaneArgs {
  readonly lane: DataLaneView;
  readonly pixelsPerSecond: number;
  readonly extensionId?: string;
  readonly items: DataLaneView['items'];
  readonly itemIndices: readonly number[];
  readonly windowStartIndex: number;
  readonly windowEndIndex: number;
  readonly totalItemCount: number;
  readonly activeItemId?: string;
  readonly focusItemId?: string;
  readonly getAllRenderItems: () => readonly DataLaneRenderItem[];
  readonly onSelectItem: (itemId: string) => void;
  readonly onNavigateItem: (itemId: string, direction: NavigationDirection) => void;
}

function toRenderItem(view: DataLaneView['items'][number]): DataLaneRenderItem {
  return {
    id: view.item.id,
    ...(view.item.sourceItemId ? { sourceItemId: view.item.sourceItemId } : {}),
    timelineStart: view.timelineStart,
    timelineEnd: view.timelineEnd,
    clipId: view.clipId,
    ...(view.item.sourceArtifactRef ? { sourceArtifactRef: view.item.sourceArtifactRef } : {}),
    provenance: view.item.provenance,
    payload: view.item.payload,
  };
}

function paintLane({
  lane,
  pixelsPerSecond,
  extensionId,
  items,
  itemIndices,
  windowStartIndex,
  windowEndIndex,
  totalItemCount,
  activeItemId,
  focusItemId,
  getAllRenderItems,
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
  const indicesAreContiguous = itemIndices.every(
    (absoluteIndex, localIndex) => absoluteIndex === windowStartIndex + localIndex,
  );
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
      ...(!indicesAreContiguous ? { itemIndices } : {}),
    },
    items: items.map(toRenderItem),
    getAllItems: getAllRenderItems,
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
