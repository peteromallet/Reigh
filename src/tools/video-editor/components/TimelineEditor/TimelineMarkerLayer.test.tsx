import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  DisposeHandle,
  TimelinePointMarker,
  TimelineViewportSnapshot,
  TimelineViewportStore,
} from '@/sdk/index.ts';
import { createTimelineOverlayGeometry } from '@/sdk/video/families/timelineOverlays.ts';
import { snapToFrameGrid } from '@/tools/video-editor/lib/time-grid.ts';
import {
  TimelineMarkerLayer,
  TIMELINE_MARKER_CULLING_THRESHOLD,
  TIMELINE_MARKER_OVERSCAN_PX,
  type TimelineMarkerLayerProps,
} from './TimelineMarkerLayer.tsx';

const autoScrollMocks = vi.hoisted(() => ({
  update: vi.fn(),
  stop: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/tools/video-editor/lib/auto-scroll.ts', () => ({
  createAutoScroller: (...args: unknown[]) => {
    autoScrollMocks.create(...args);
    return { update: autoScrollMocks.update, stop: autoScrollMocks.stop };
  },
}));

const viewportSnapshot = (
  overrides: Partial<TimelineViewportSnapshot> = {},
): TimelineViewportSnapshot => Object.freeze({
  scrollLeft: 0,
  scrollTop: 0,
  viewportWidth: 400,
  viewportHeight: 100,
  totalWidth: 40_000,
  totalHeight: 100,
  ...overrides,
});

function createViewportStore(initial = viewportSnapshot()): TimelineViewportStore & {
  set(next: Partial<TimelineViewportSnapshot>): void;
} {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener): DisposeHandle {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    set(next) {
      snapshot = viewportSnapshot({ ...snapshot, ...next });
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

const geometry = (scaleWidth = 40) => createTimelineOverlayGeometry({
  scale: 1,
  scaleWidth,
  startLeft: 20,
  extentStart: 0,
  extentEnd: 10_000,
});

const makeMarkers = (count: number): readonly TimelinePointMarker[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    time: index * 0.25,
    label: `Marker ${index}`,
  }));

const scrollContainer = document.createElement('div');
const getScrollContainer = () => scrollContainer;
const claimPointer = () => true;
const releasePointer = () => {};

function baseProps(
  overrides: Partial<TimelineMarkerLayerProps> = {},
): TimelineMarkerLayerProps {
  return {
    markers: [{ id: 'm-1', time: 1, label: 'One' }],
    interactive: true,
    snap: true,
    geometry: geometry(),
    viewport: createViewportStore(),
    fps: 24,
    getScrollContainer,
    claimPointer,
    releasePointer,
    ...overrides,
  };
}

describe('TimelineMarkerLayer', () => {
  it('keeps drag previews raw and snaps only the commit', () => {
    autoScrollMocks.create.mockClear();
    autoScrollMocks.update.mockClear();
    autoScrollMocks.stop.mockClear();
    const onChange = vi.fn();
    const claim = vi.fn(() => true);
    const release = vi.fn();
    render(<TimelineMarkerLayer {...baseProps({ onChange, claimPointer: claim, releasePointer: release })} />);
    const marker = screen.getByTestId('timeline-marker-m-1');

    fireEvent.pointerDown(marker, { button: 0, pointerId: 7, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 99, clientX: 140, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 103, clientY: 10 });
    expect(claim).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerMove(window, { pointerId: 7, clientX: 104, clientY: 10 });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ id: 'm-1', time: 1.1, phase: 'preview' });
    expect(snapToFrameGrid(1.1, 24)).not.toBe(1.1);

    fireEvent.pointerMove(window, { pointerId: 7, clientX: 106, clientY: 10 });
    expect(onChange).toHaveBeenLastCalledWith({ id: 'm-1', time: 1.15, phase: 'preview' });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 106, clientY: 10 });

    expect(onChange).toHaveBeenLastCalledWith({
      id: 'm-1',
      time: snapToFrameGrid(1.15, 24),
      phase: 'commit',
    });
    expect(autoScrollMocks.create).toHaveBeenCalledWith(scrollContainer, expect.any(Function));
    expect(autoScrollMocks.update).toHaveBeenCalled();
    expect(autoScrollMocks.stop).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    const callsAfterCommit = onChange.mock.calls.length;
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 120, clientY: 10 });
    expect(onChange).toHaveBeenCalledTimes(callsAfterCommit);
  });

  it('re-checks ownership at exactly 4 px and cancels when the owner changed', () => {
    let owner: 'none' | 'foreign' = 'none';
    const claim = vi.fn(() => owner === 'none');
    const release = vi.fn();
    const onChange = vi.fn();
    render(<TimelineMarkerLayer {...baseProps({ claimPointer: claim, releasePointer: release, onChange })} />);
    const marker = screen.getByTestId('timeline-marker-m-1');

    fireEvent.pointerDown(marker, { button: 0, pointerId: 11, clientX: 50, clientY: 8 });
    owner = 'foreign';
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 54, clientY: 8 });
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 80, clientY: 8 });
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 80, clientY: 8 });

    expect(claim).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(marker).not.toHaveAttribute('data-marker-dragging');
  });

  it.each([
    { count: 10, scaleWidth: 40, expectedMounts: 10, markerOneLeft: 30 },
    { count: 10, scaleWidth: 160, expectedMounts: 10, markerOneLeft: 60 },
    { count: 10, scaleWidth: 500, expectedMounts: 10, markerOneLeft: 145 },
    { count: 100, scaleWidth: 40, expectedMounts: 100, markerOneLeft: 30 },
    { count: 100, scaleWidth: 160, expectedMounts: 100, markerOneLeft: 60 },
    { count: 100, scaleWidth: 500, expectedMounts: 100, markerOneLeft: 145 },
    { count: 1000, scaleWidth: 40, expectedMounts: 55, markerOneLeft: 30 },
    { count: 1000, scaleWidth: 160, expectedMounts: 14, markerOneLeft: 60 },
    { count: 1000, scaleWidth: 500, expectedMounts: 5, markerOneLeft: 145 },
  ])(
    'mounts $expectedMounts of $count markers with canonical geometry at scaleWidth $scaleWidth',
    ({ count, scaleWidth, expectedMounts, markerOneLeft }) => {
      const { container } = render(
        <TimelineMarkerLayer
          {...baseProps({ markers: makeMarkers(count), geometry: geometry(scaleWidth) })}
        />,
      );
      const mounted = container.querySelectorAll('[data-marker-id]');
      expect(mounted).toHaveLength(expectedMounts);
      expect(screen.getByTestId('timeline-marker-m-1')).toHaveStyle({
        transform: `translateX(${markerOneLeft}px)`,
      });
    },
  );

  it('pins the measured culling policy and keeps a stable time/index order', () => {
    expect(TIMELINE_MARKER_CULLING_THRESHOLD).toBe(200);
    expect(TIMELINE_MARKER_OVERSCAN_PX).toBe(160);
    render(<TimelineMarkerLayer {...baseProps({
      markers: [
        { id: 'late', time: 2 },
        { id: 'tie-a', time: 1 },
        { id: 'tie-b', time: 1 },
        { id: 'early', time: 0 },
      ],
    })} />);
    expect(screen.getAllByRole('button').map((button) => button.dataset.markerId)).toEqual([
      'early',
      'tie-a',
      'tie-b',
      'late',
    ]);
  });

  it('lays a multi-overlay layer into a bounded ruler lane and keeps labels accessible', () => {
    render(<TimelineMarkerLayer {...baseProps({
      overlayCount: 10,
      layerIndex: 7,
      layerKey: 'ext.seven:terrain',
      markers: [{ id: 'coincident', time: 4, label: 'Hidden visual label' }],
    })} />);

    const layer = screen.getByTestId('timeline-marker-layer');
    const marker = screen.getByTestId('timeline-marker-coincident');
    expect(layer).toHaveAttribute('data-marker-layer-index', '7');
    expect(layer).toHaveAttribute('data-marker-layer-count', '10');
    expect(layer).toHaveAttribute('data-marker-layer-key', 'ext.seven:terrain');
    expect(marker).toHaveAttribute('data-marker-layer-lane', '1');
    expect(marker).toHaveAttribute('data-marker-layer-column', '2');
    expect(marker).toHaveAttribute('aria-label', 'Hidden visual label at 4 seconds');
    expect(marker).toHaveStyle({
      transform: 'translateX(180px)',
      height: '10px',
      minWidth: '18px',
    });
    expect(marker).toHaveAttribute('data-marker-anchor-x', '180');
    expect(marker).toHaveAttribute('data-marker-visual-offset-x', '9');
    expect(marker.querySelector('[data-marker-visual]')).toHaveStyle({
      transform: 'translateX(9px) translateY(10px)',
    });
    expect(marker.querySelector('[data-marker-leader]')).toBeInTheDocument();
    expect(screen.queryByText('Hidden visual label')).toBeNull();
  });

  it('keeps positive and negative collision columns visually linked to the same temporal anchor', () => {
    const { rerender } = render(<TimelineMarkerLayer {...baseProps({
      overlayCount: 10,
      layerIndex: 0,
      markers: [{ id: 'negative', time: 4 }],
    })} />);
    const negative = screen.getByTestId('timeline-marker-negative');
    expect(negative).toHaveStyle({ transform: 'translateX(180px)' });
    expect(negative).toHaveAttribute('data-marker-visual-offset-x', '-27');
    expect(negative.querySelector('[data-marker-leader]')).toBeInTheDocument();

    rerender(<TimelineMarkerLayer {...baseProps({
      overlayCount: 10,
      layerIndex: 9,
      markers: [{ id: 'positive', time: 4 }],
    })} />);
    const positive = screen.getByTestId('timeline-marker-positive');
    expect(positive).toHaveStyle({ transform: 'translateX(180px)' });
    expect(positive).toHaveAttribute('data-marker-visual-offset-x', '27');
    expect(positive.querySelector('[data-marker-leader]')).toBeInTheDocument();
  });

  it('preserves a compact visual offset through drag preview, cancel, and commit', () => {
    const onChange = vi.fn();
    const claim = vi.fn(() => true);
    const release = vi.fn();
    const props = baseProps({
      overlayCount: 10,
      layerIndex: 9,
      onChange,
      claimPointer: claim,
      releasePointer: release,
      markers: [{ id: 'dragged', time: 4 }],
    });
    const view = render(<TimelineMarkerLayer {...props} />);
    const marker = screen.getByTestId('timeline-marker-dragged');
    const visual = marker.querySelector('[data-marker-visual]')!;
    const originalVisualTransform = (visual as HTMLElement).style.transform;

    fireEvent.pointerDown(marker, { button: 0, pointerId: 31, clientX: 180, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 31, clientX: 220, clientY: 10 });
    expect(marker).toHaveAttribute('data-marker-dragging', 'true');
    expect(marker).toHaveStyle({ transform: 'translateX(220px)' });
    expect((visual as HTMLElement).style.transform).toBe(originalVisualTransform);
    expect(onChange).toHaveBeenLastCalledWith({ id: 'dragged', time: 5, phase: 'preview' });

    fireEvent.pointerCancel(window, { pointerId: 31 });
    expect(marker).not.toHaveAttribute('data-marker-dragging');
    expect(marker).toHaveStyle({ transform: 'translateX(180px)' });
    expect((visual as HTMLElement).style.transform).toBe(originalVisualTransform);

    view.rerender(<TimelineMarkerLayer {...props} />);
    const rerenderedMarker = screen.getByTestId('timeline-marker-dragged');
    fireEvent.pointerDown(rerenderedMarker, { button: 0, pointerId: 32, clientX: 180, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 32, clientX: 220, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 32, clientX: 220, clientY: 10 });
    expect(onChange).toHaveBeenLastCalledWith({
      id: 'dragged',
      time: 5,
      phase: 'commit',
    });
    expect(rerenderedMarker).toHaveStyle({ transform: 'translateX(220px)' });
    expect((rerenderedMarker.querySelector('[data-marker-visual]') as HTMLElement).style.transform)
      .toBe(originalVisualTransform);
  });

  it('keeps exact-time clusters on one anchor while preserving each target', () => {
    render(<TimelineMarkerLayer {...baseProps({
      overlayCount: 10,
      layerIndex: 0,
      markers: [
        { id: 'cluster-a', time: 4 },
        { id: 'cluster-b', time: 4 },
      ],
    })} />);
    const markers = [
      screen.getByTestId('timeline-marker-cluster-a'),
      screen.getByTestId('timeline-marker-cluster-b'),
    ];
    expect(markers.map((marker) => marker.getAttribute('data-marker-anchor-x'))).toEqual(['180', '180']);
    expect(markers.map((marker) => marker.getAttribute('data-marker-time'))).toEqual(['4', '4']);
    expect(markers.every((marker) => marker.querySelector('[data-marker-leader]'))).toBe(true);
  });

  it('culls against aggregate overlay work and removes offscreen markers from tab order', () => {
    const markers = Array.from({ length: 25 }, (_, index) => ({
      id: `spread-${index}`,
      time: index * 100,
      label: `Spread ${index}`,
    }));
    render(<TimelineMarkerLayer {...baseProps({ markers, overlayCount: 10 })} />);

    const mounted = screen.getAllByRole('button');
    expect(mounted.length).toBeLessThan(markers.length);
    expect(screen.queryByTestId('timeline-marker-spread-24')).toBeNull();
    expect(mounted.every((button) => button.getAttribute('tabindex') !== '-1')).toBe(true);
  });

  it('adds zero per-marker renders for viewport and 60 Hz parent/playhead updates', () => {
    const viewport = createViewportStore();
    const markers = makeMarkers(100);
    const renderMarker = vi.fn((marker: TimelinePointMarker) => <span>{marker.id}</span>);
    const props = baseProps({ viewport, markers, renderMarker });
    const view = render(<TimelineMarkerLayer {...props} />);
    expect(renderMarker).toHaveBeenCalledTimes(100);

    act(() => viewport.set({ scrollLeft: 10 }));
    expect(renderMarker).toHaveBeenCalledTimes(100);

    for (let frame = 0; frame < 60; frame += 1) {
      view.rerender(<TimelineMarkerLayer {...props} />);
    }
    expect(renderMarker).toHaveBeenCalledTimes(100);
  });

  it('supports activation, frame keyboard nudging, selection, and disabled state', () => {
    const onActivate = vi.fn();
    const onChange = vi.fn();
    render(<TimelineMarkerLayer {...baseProps({
      markers: [
        { id: 'enabled', time: 1.01, label: 'Enabled' },
        { id: 'disabled', time: 2, label: 'Disabled', disabled: true },
      ],
      selectedIds: new Set(['enabled']),
      onActivate,
      onChange,
    })} />);

    const enabled = screen.getByTestId('timeline-marker-enabled');
    const disabled = screen.getByTestId('timeline-marker-disabled');
    expect(enabled).toHaveAttribute('aria-pressed', 'true');
    expect(enabled).toHaveStyle({ touchAction: 'none' });
    expect(disabled).toBeDisabled();
    expect(disabled).toHaveAttribute('aria-disabled', 'true');

    fireEvent.keyDown(enabled, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith({
      id: 'enabled',
      time: 25 / 24,
      phase: 'commit',
    });
    fireEvent.keyDown(enabled, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'enabled' }));
  });
});
