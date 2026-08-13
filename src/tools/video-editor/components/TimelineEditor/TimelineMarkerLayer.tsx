import {
  memo,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  TimelineMarkerLayerOptions,
  TimelineOverlayGeometry,
  TimelinePointMarker,
  TimelineViewportSnapshot,
  TimelineViewportStore,
} from '@/sdk/video/families/timelineOverlays';
import { framesToSeconds, secondsToFrames } from '@/tools/video-editor/lib/time-grid.ts';
import { useTimelineMarkerDrag } from './useTimelineMarkerDrag.ts';

/**
 * Measured against the 10/100/1,000 marker fixture: below 200, mounting the
 * complete list is cheaper than maintaining viewport churn; at 1,000 the
 * binary-search window is materially cheaper.
 */
export const TIMELINE_MARKER_CULLING_THRESHOLD = 200;
/** Four auto-scroll edge zones, enough to avoid boundary churn at 12 px/frame. */
export const TIMELINE_MARKER_OVERSCAN_PX = 160;

export interface TimelineMarkerLayerHostProps {
  geometry: TimelineOverlayGeometry;
  viewport: TimelineViewportStore;
  fps: number;
  getScrollContainer: () => HTMLElement | null;
  claimPointer: () => boolean;
  releasePointer: () => void;
}

export type TimelineMarkerLayerProps<T = unknown> =
  TimelineMarkerLayerHostProps & TimelineMarkerLayerOptions<T>;

interface IndexedMarker<T> {
  marker: TimelinePointMarker<T>;
  originalIndex: number;
}

const compareIndexedMarkers = <T,>(left: IndexedMarker<T>, right: IndexedMarker<T>): number => {
  const byTime = left.marker.time - right.marker.time;
  return byTime === 0 ? left.originalIndex - right.originalIndex : byTime;
};

const lowerBound = <T,>(markers: readonly IndexedMarker<T>[], time: number): number => {
  let low = 0;
  let high = markers.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (markers[middle].marker.time < time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const upperBound = <T,>(markers: readonly IndexedMarker<T>[], time: number): number => {
  let low = 0;
  let high = markers.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (markers[middle].marker.time <= time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

export function selectVisibleTimelineMarkers<T>(
  sortedMarkers: readonly IndexedMarker<T>[],
  geometry: TimelineOverlayGeometry,
  viewport: TimelineViewportSnapshot,
): readonly IndexedMarker<T>[] {
  if (
    sortedMarkers.length < TIMELINE_MARKER_CULLING_THRESHOLD
    || viewport.viewportWidth <= 0
  ) {
    return sortedMarkers;
  }

  const firstTime = geometry.pixelToTime(viewport.scrollLeft - TIMELINE_MARKER_OVERSCAN_PX);
  const lastTime = geometry.pixelToTime(
    viewport.scrollLeft + viewport.viewportWidth + TIMELINE_MARKER_OVERSCAN_PX,
  );
  const start = lowerBound(sortedMarkers, Math.min(firstTime, lastTime));
  const end = upperBound(sortedMarkers, Math.max(firstTime, lastTime));
  return sortedMarkers.slice(start, end);
}

interface MarkerButtonProps<T> {
  marker: TimelinePointMarker<T>;
  left: number;
  selected: boolean;
  interactive: boolean;
  geometry: TimelineOverlayGeometry;
  fps: number;
  snap: boolean;
  getScrollContainer: () => HTMLElement | null;
  claimPointer: () => boolean;
  releasePointer: () => void;
  onActivate?: (marker: TimelinePointMarker<T>) => void;
  onChange?: TimelineMarkerLayerOptions<T>['onChange'];
  renderMarker?: TimelineMarkerLayerOptions<T>['renderMarker'];
  onDragStateChange: (markerId: string, dragging: boolean) => void;
}

function DefaultMarker<T>({ marker }: { marker: TimelinePointMarker<T> }) {
  return (
    <span aria-hidden="true" className="flex h-full items-start">
      <span
        className="mt-0.5 block h-3 w-2 rotate-45 rounded-[1px] border border-current bg-current"
      />
      {marker.label ? (
        <span className="ml-1 whitespace-nowrap text-[10px] font-medium leading-4">
          {marker.label}
        </span>
      ) : null}
    </span>
  );
}

function MarkerButton<T>({
  marker,
  left,
  selected,
  interactive,
  geometry,
  fps,
  snap,
  getScrollContainer,
  claimPointer,
  releasePointer,
  onActivate,
  onChange,
  renderMarker,
  onDragStateChange,
}: MarkerButtonProps<T>) {
  const enabled = interactive && !marker.disabled;
  const { dragging, onPointerDown } = useTimelineMarkerDrag({
    marker,
    geometry,
    fps,
    interactive,
    snap,
    getScrollContainer,
    claimPointer,
    releasePointer,
    onChange,
    onDragStateChange,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!enabled) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate?.(marker);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const frameDelta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1);
    const currentFrame = secondsToFrames(marker.time, fps);
    const nextTime = framesToSeconds(currentFrame + frameDelta, fps);
    const min = Math.min(geometry.extentStart, geometry.extentEnd);
    const max = Math.max(geometry.extentStart, geometry.extentEnd);
    onChange?.({
      id: marker.id,
      time: Math.min(max, Math.max(min, nextTime)),
      phase: 'commit',
    });
  };

  const style: CSSProperties = {
    color: marker.color ?? 'var(--video-editor-accent-border-strong, #38bdf8)',
    left: 0,
    pointerEvents: enabled ? 'auto' : 'none',
    touchAction: enabled ? 'none' : undefined,
    transform: `translateX(${left}px)`,
  };

  return (
    <button
      type="button"
      data-testid={`timeline-marker-${marker.id}`}
      data-marker-id={marker.id}
      data-marker-time={marker.time}
      data-marker-dragging={dragging ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      className="absolute top-0 z-10 h-5 min-w-3 -translate-x-1/2 cursor-ew-resize border-0 bg-transparent p-0 text-left disabled:cursor-default disabled:opacity-40"
      style={style}
      aria-label={`${marker.label ?? 'Timeline marker'} at ${marker.time} seconds`}
      aria-pressed={selected}
      aria-disabled={!enabled}
      disabled={!enabled}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        event.stopPropagation();
        onActivate?.(marker);
      }}
      onKeyDown={handleKeyDown}
    >
      {renderMarker ? (renderMarker(marker) as ReactNode) : <DefaultMarker marker={marker} />}
    </button>
  );
}

const markerButtonPropsEqual = <T,>(
  previous: MarkerButtonProps<T>,
  next: MarkerButtonProps<T>,
): boolean => (
  previous.marker.id === next.marker.id
  && previous.marker.time === next.marker.time
  && previous.marker.label === next.marker.label
  && previous.marker.color === next.marker.color
  && previous.marker.disabled === next.marker.disabled
  && previous.marker.data === next.marker.data
  && previous.left === next.left
  && previous.selected === next.selected
  && previous.interactive === next.interactive
  && previous.geometry === next.geometry
  && previous.fps === next.fps
  && previous.snap === next.snap
  && previous.getScrollContainer === next.getScrollContainer
  && previous.claimPointer === next.claimPointer
  && previous.releasePointer === next.releasePointer
  && previous.onActivate === next.onActivate
  && previous.onChange === next.onChange
  && previous.renderMarker === next.renderMarker
  && previous.onDragStateChange === next.onDragStateChange
);

const MemoizedMarkerButton = memo(MarkerButton, markerButtonPropsEqual) as typeof MarkerButton;

/** Host-owned, controlled ruler marker layer. */
export function TimelineMarkerLayer<T = unknown>({
  markers,
  placement = 'ruler',
  interactive,
  snap,
  selectedIds,
  onActivate,
  onChange,
  renderMarker,
  geometry,
  viewport,
  fps,
  getScrollContainer,
  claimPointer,
  releasePointer,
}: TimelineMarkerLayerProps<T>) {
  const subscribe = useCallback((listener: () => void) => {
    const handle = viewport.subscribe(listener);
    return () => handle.dispose();
  }, [viewport]);
  const viewportSnapshot = useSyncExternalStore(
    subscribe,
    viewport.getSnapshot,
    viewport.getSnapshot,
  );
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);

  const sortedMarkers = useMemo<readonly IndexedMarker<T>[]>(() => markers
    .map((marker, originalIndex) => ({ marker, originalIndex }))
    .filter(({ marker }) => Number.isFinite(marker.time))
    .sort(compareIndexedMarkers), [markers]);

  const visibleMarkers = useMemo(() => {
    const visible = selectVisibleTimelineMarkers(sortedMarkers, geometry, viewportSnapshot);
    if (!activeMarkerId || visible.some(({ marker }) => marker.id === activeMarkerId)) {
      return visible;
    }
    const active = sortedMarkers.find(({ marker }) => marker.id === activeMarkerId);
    return active ? [...visible, active].sort(compareIndexedMarkers) : visible;
  }, [activeMarkerId, geometry, sortedMarkers, viewportSnapshot]);

  const handleDragStateChange = useCallback((markerId: string, isDragging: boolean) => {
    setActiveMarkerId((current) => isDragging ? markerId : current === markerId ? null : current);
  }, []);

  if (placement !== 'ruler') {
    return null;
  }

  return (
    <div
      role="group"
      aria-label="Timeline markers"
      data-testid="timeline-marker-layer"
      data-marker-count={visibleMarkers.length}
      className="pointer-events-none absolute inset-x-0 top-0 h-5 overflow-visible"
    >
      {visibleMarkers.map(({ marker }) => (
        <MemoizedMarkerButton
          key={marker.id}
          marker={marker}
          left={geometry.timeToPixel(marker.time)}
          selected={selectedIds?.has(marker.id) ?? false}
          interactive={interactive}
          geometry={geometry}
          fps={fps}
          snap={snap}
          getScrollContainer={getScrollContainer}
          claimPointer={claimPointer}
          releasePointer={releasePointer}
          onActivate={onActivate}
          onChange={onChange}
          renderMarker={renderMarker}
          onDragStateChange={handleDragStateChange}
        />
      ))}
    </div>
  );
}
