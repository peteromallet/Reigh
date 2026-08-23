import {
  createElement,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
} from 'react';
import type { DataItemInspectorProps, DataLaneRendererProps } from '@reigh/editor-sdk';
import {
  retryRunawayTimeline,
  type RunawayLoadStatusPayload,
  type RunawayTransitionPayload,
} from './runawayTimelineData';

function payloadOf(value: unknown): RunawayTransitionPayload | null {
  if (!value || typeof value !== 'object' || !('manifestId' in value)) return null;
  return value as RunawayTransitionPayload;
}

function statusPayloadOf(value: unknown): RunawayLoadStatusPayload | null {
  if (!value || typeof value !== 'object' || !('kind' in value)) return null;
  const payload = value as Partial<RunawayLoadStatusPayload>;
  if (
    payload.kind !== 'runaway-load-status'
    || !['loading', 'empty', 'error'].includes(String(payload.status))
    || typeof payload.projectSlug !== 'string'
    || typeof payload.message !== 'string'
  ) return null;
  return payload as RunawayLoadStatusPayload;
}

export function renderRunawayTimelineLane(props: DataLaneRendererProps): unknown {
  return createElement(RunawayTimelineLane, props);
}

type NavigationDirection = 'previous' | 'next' | 'first' | 'last';

function navigationDirection(event: KeyboardEvent<HTMLButtonElement>): NavigationDirection | null {
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

function RunawayTimelineLane(props: DataLaneRendererProps) {
  const requestedFocusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!props.focusItemId) return;
    requestedFocusRef.current?.focus({ preventScroll: true });
  }, [props.focusItemId, props.itemWindow?.startIndex]);
  const loadStatus = statusPayloadOf(props.items[0]?.payload);
  if (loadStatus) {
    const isError = loadStatus.status === 'error';
    return createElement(
      'div',
      {
        'data-testid': 'runaway-load-state',
        'data-status': loadStatus.status,
        role: isError ? 'alert' : 'status',
        'aria-live': isError ? 'assertive' : 'polite',
        'aria-busy': loadStatus.status === 'loading' ? 'true' : undefined,
        style: {
          display: 'flex',
          height: '100%',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px',
          color: isError ? 'hsl(var(--destructive))' : 'var(--video-editor-fg-muted)',
          fontSize: 11,
        },
      },
      createElement('span', null, loadStatus.status === 'error'
        ? `Runaway transitions unavailable: ${loadStatus.message}`
        : loadStatus.message),
      ...(isError ? [createElement(
        'button',
        {
          key: 'retry',
          type: 'button',
          'data-testid': 'runaway-retry',
          style: {
            border: '1px solid currentColor',
            borderRadius: 4,
            padding: '1px 7px',
            background: 'var(--video-editor-panel-bg)',
            color: 'var(--video-editor-fg)',
            cursor: 'pointer',
          },
          onClick: (event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            retryRunawayTimeline(loadStatus.projectSlug);
          },
        },
        'Try again',
      )] : []),
    );
  }
  const regionExtents = new Map<string, { start: number; end: number; colour: string; label: string }>();
  for (const item of props.items) {
    const payload = payloadOf(item.payload);
    if (!payload) continue;
    const current = regionExtents.get(payload.segmentId);
    if (!current) {
      regionExtents.set(payload.segmentId, {
        start: item.timelineStart,
        end: item.timelineEnd,
        colour: payload.colourHex,
        label: payload.segmentLabel,
      });
    } else {
      current.start = Math.min(current.start, item.timelineStart);
      current.end = Math.max(current.end, item.timelineEnd);
    }
  }
  const regions = [...regionExtents.entries()].map(([id, region]) => createElement('span', {
    key: `region-${id}`,
    'data-testid': 'runaway-region-band',
    title: `${id} · ${region.label}`,
    style: {
      position: 'absolute',
      insetBlock: 0,
      left: region.start * props.pixelsPerSecond,
      width: Math.max(1, (region.end - region.start) * props.pixelsPerSecond),
      background: `${region.colour}16`,
      borderInlineStart: `1px solid ${region.colour}88`,
      pointerEvents: 'none',
    },
  }));
  const windowStartIndex = props.itemWindow?.startIndex ?? 0;
  const itemIndices = props.itemWindow?.itemIndices;
  const totalItemCount = props.itemWindow?.totalItemCount ?? props.items.length;
  const transitions = props.items.map((item, localIndex) => {
    const payload = payloadOf(item.payload);
    if (!payload) return null;
    const width = Math.max(2, (item.timelineEnd - item.timelineStart) * props.pixelsPerSecond);
    return createElement('button', {
      key: item.id,
      type: 'button',
      'data-testid': 'runaway-transition-chip',
      'data-item-id': item.id,
      'aria-label': `${payload.manifestId}, ${payload.segmentId}, ${payload.colourName}, ${item.timelineStart.toFixed(3)} seconds`,
      'aria-posinset': (itemIndices?.[localIndex] ?? windowStartIndex + localIndex) + 1,
      'aria-setsize': totalItemCount,
      title: `${payload.manifestId} · ${payload.segmentId} · ${payload.colourName}\n${payload.prompt}`,
      tabIndex: item.id === props.activeItemId ? 0 : -1,
      ref: item.id === props.focusItemId ? requestedFocusRef : undefined,
      style: {
        position: 'absolute',
        top: 3,
        bottom: 3,
        left: item.timelineStart * props.pixelsPerSecond,
        width,
        minWidth: 2,
        padding: 0,
        border: '1px solid color-mix(in srgb, currentColor 35%, transparent)',
        borderRadius: width >= 6 ? 2 : 0,
        background: payload.colourHex,
        cursor: 'pointer',
        boxShadow: '0 0 0 1px rgba(0,0,0,.22)',
      },
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        props.onSelectItem?.(item.id);
      },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        const direction = navigationDirection(event);
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        props.onNavigateItem?.(item.id, direction);
      },
    });
  });
  const summary = payloadOf(props.items[0]?.payload)?.timingSummary;
  const declaredRegions = Object.keys(summary?.segmentCounts ?? {}).length;
  const populatedRegions = [...regionExtents.keys()].length;
  return createElement(
    'div',
    {
      'data-testid': 'runaway-timeline-lane',
      'data-total-items': totalItemCount,
      'data-window-start': windowStartIndex,
      'data-window-end': props.itemWindow?.endIndex ?? props.items.length,
      role: 'group',
      'aria-label': `${totalItemCount} transitions, ${props.items.length} shown, ${populatedRegions} of ${declaredRegions || populatedRegions} regions in window`,
      title: `${totalItemCount} transitions · ${props.items.length} mounted · ${populatedRegions}/${declaredRegions || populatedRegions} populated regions in window`,
      style: { position: 'relative', height: '100%', overflow: 'hidden' },
    },
    ...regions,
    ...transitions,
  );
}

export function renderRunawayTransitionInspector(props: DataItemInspectorProps): unknown {
  const loadStatus = statusPayloadOf(props.item.payload);
  if (loadStatus) {
    return createElement(
      'div',
      { 'data-testid': 'runaway-load-state-inspector' },
      loadStatus.status === 'error'
        ? `Runaway transitions unavailable: ${loadStatus.message}`
        : loadStatus.message,
    );
  }
  const payload = payloadOf(props.item.payload);
  if (!payload) return createElement('div', null, 'Invalid Runaway transition payload');
  const summary = payload.timingSummary;
  return createElement(
    'div',
    { 'data-testid': 'runaway-transition-inspector', style: { display: 'grid', gap: 5, fontSize: 11 } },
    createElement('strong', null, `${payload.manifestId} · ${payload.segmentId}`),
    createElement('div', null, payload.segmentLabel),
    createElement('div', null, `${(payload.startMs / 1000).toFixed(3)}s – ${((payload.startMs + payload.durationMs) / 1000).toFixed(3)}s · frame ${payload.frame} @ ${payload.fps}fps`),
    createElement('div', null, `${payload.colourName} · ${payload.colourHex} · ${payload.timingMode}`),
    createElement('div', null, `run: ${payload.runId}`),
    createElement('div', null, `task: ${payload.taskId ?? 'none'}`),
    createElement('div', { style: { lineHeight: 1.35 } }, payload.prompt),
    summary ? createElement('div', null, `${summary.transitionCount ?? '—'} typed transitions · ${Object.keys(summary.segmentCounts).length} declared regions`) : null,
  );
}
