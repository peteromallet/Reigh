/**
 * transcript-lane — renderer components for the dev-local dataKind example.
 *
 * These components are bound imperatively at activation via
 * `ctx.dataKinds.register(kindId, laneRenderer, inspector?)`; they never
 * fetch anything (no `loadTranscript` here — the host adapts injected
 * transcript segments into pre-mapped `DataLaneRenderItem[]`) and never
 * touch duration, rows, or selection.
 *
 * Imports stay on the public SDK plus React, mirroring the
 * scene-phase-markers precedent for `dev/` scratchpad extensions.
 */

import { createElement, type KeyboardEvent, type MouseEvent } from 'react';
import type {
  DataItemInspectorProps,
  DataLaneRendererProps,
} from '@reigh/editor-sdk';

/** Longest text snippet painted per segment chip (kept small on purpose). */
const MAX_CHIP_CHARS = 48;
export const NO_TEXT_LABEL = '(no text)';

export interface TranscriptChipPlacement {
  /** Zero-based vertical lane within the item's connected overlap group. */
  readonly lane: number;
  /** Number of vertical lanes required by this item's overlap group. */
  readonly laneCount: number;
}

/**
 * Assign transcript intervals to deterministic vertical hit-target lanes.
 *
 * The host's renderer coordinate system owns the horizontal geometry (the
 * exact timeline interval remains `left`/`width`); this helper only partitions
 * concurrent intervals vertically so one button cannot cover another button's
 * center.  Connected overlap groups are sized independently, so a later
 * isolated caption does not inherit a tiny height from an earlier burst.
 *
 * The lane assignment is intentionally based on the mounted window.  The host
 * may virtualize the data lane, and the returned map therefore remains total
 * for exactly the items that can receive pointer events in this render.
 */
export function computeTranscriptChipPlacements(
  items: readonly DataLaneRendererProps['items'][number][],
): ReadonlyMap<string, TranscriptChipPlacement> {
  const sorted = items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => (
      (left.item.timelineStart - right.item.timelineStart)
      || left.item.id.localeCompare(right.item.id)
      || (left.sourceIndex - right.sourceIndex)
    ));
  const placements = new Map<string, TranscriptChipPlacement>();
  let currentGroup: Array<{ id: string; lane: number }> = [];
  let overlapLaneEnds: number[] = [];
  let currentGroupEnd = Number.NEGATIVE_INFINITY;

  const finishGroup = () => {
    if (currentGroup.length === 0) return;
    const laneCount = Math.max(...currentGroup.map(({ lane }) => lane)) + 1;
    for (const placement of currentGroup) {
      placements.set(placement.id, { lane: placement.lane, laneCount });
    }
    currentGroup = [];
    overlapLaneEnds = [];
    currentGroupEnd = Number.NEGATIVE_INFINITY;
  };

  for (const { item } of sorted) {
    const start = item.timelineStart;
    const end = item.timelineEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      // Invalid intervals are still rendered by the host for diagnostics, but
      // never participate in an overlap calculation or perturb valid chips.
      placements.set(item.id, { lane: 0, laneCount: 1 });
      continue;
    }
    if (currentGroup.length > 0 && start >= currentGroupEnd) finishGroup();

    let lane = overlapLaneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = overlapLaneEnds.length;
      overlapLaneEnds.push(end);
    } else {
      overlapLaneEnds[lane] = end;
    }
    currentGroup.push({ id: item.id, lane });
    currentGroupEnd = Math.max(currentGroupEnd, end);
  }
  finishGroup();

  // Duplicate IDs are not expected from the typed host envelope. Keep the
  // renderer total if a malformed provider does send one by giving the last
  // duplicate a safe single lane rather than throwing during paint.
  for (const item of items) {
    if (!placements.has(item.id)) placements.set(item.id, { lane: 0, laneCount: 1 });
  }
  return placements;
}

function truncate(text: string): string {
  return text.length > MAX_CHIP_CHARS ? `${text.slice(0, MAX_CHIP_CHARS - 1)}…` : text;
}

/**
 * Lane renderer for the `reigh.transcript` data kind: one labeled chip per
 * interval item, painted on the shared host scale — each chip sits at
 * `timelineStart * pixelsPerSecond` with width
 * `(timelineEnd - timelineStart) * pixelsPerSecond`, the exact mapping the
 * host's own extent bars use (the renderer box's origin IS timeline zero —
 * rework round-2 F1). Chips are selectable: a press stops propagation and
 * dispatches `onSelectItem` so the kind inspector is reachable from pointer.
 */
export function renderTranscriptLane(
  props: DataLaneRendererProps,
): unknown {
  const placements = computeTranscriptChipPlacements(props.items);
  const windowStartIndex = props.itemWindow?.startIndex ?? 0;
  const itemIndices = props.itemWindow?.itemIndices;
  const totalItemCount = props.itemWindow?.totalItemCount ?? props.items.length;
  const chips = props.items.map((item, localIndex) =>
    (() => {
      const placement = placements.get(item.id) ?? { lane: 0, laneCount: 1 };
      const stacked = placement.laneCount > 1;
      return createElement(
      'button',
      {
        key: item.id,
        type: 'button',
        'data-testid': 'transcript-lane-chip',
        'data-item-id': item.id,
        'aria-label': `Transcript segment: ${readChipText(item.payload)}, ${item.timelineStart.toFixed(2)} to ${item.timelineEnd.toFixed(2)} seconds`,
        'aria-posinset': (itemIndices?.[localIndex] ?? windowStartIndex + localIndex) + 1,
        'aria-setsize': totalItemCount,
        title: `${item.id} · ${props.schemaRef}`,
        tabIndex: item.id === props.activeItemId ? 0 : -1,
        style: {
          position: 'absolute',
          top: stacked ? `${(placement.lane * 100) / placement.laneCount}%` : '50%',
          transform: stacked ? 'none' : 'translateY(-50%)',
          left: item.timelineStart * props.pixelsPerSecond,
          // Keep even empty/whitespace diagnostics keyboard- and pointer-
          // reachable. A text node cannot be the source of the hit target's
          // size because the diagnostic label is derived at render time.
          width: Math.max(1, (item.timelineEnd - item.timelineStart) * props.pixelsPerSecond),
          height: stacked ? `${100 / placement.laneCount}%` : '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 10,
          lineHeight: 'normal',
          padding: '0 6px',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          border: 0,
          background: 'var(--video-editor-accent-bg-strong)',
          color: 'var(--video-editor-accent-fg)',
          cursor: 'pointer',
        },
        onClick: (event: MouseEvent<HTMLElement>) => {
          event.stopPropagation();
          props.onSelectItem?.(item.id);
        },
        onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
          const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? 'previous'
            : event.key === 'ArrowRight' || event.key === 'ArrowDown'
              ? 'next'
              : event.key === 'Home'
                ? 'first'
                : event.key === 'End'
                  ? 'last'
                  : null;
          if (!direction) return;
          event.preventDefault();
          event.stopPropagation();
          props.onNavigateItem?.(item.id, direction);
        },
      },
      truncate(readChipText(item.payload)),
      );
    })(),
  );
  return createElement(
    'div',
    {
      'data-testid': 'transcript-lane-renderer',
      style: { position: 'relative', height: '100%', overflow: 'hidden' },
    },
    ...chips,
  );
}

/** Item inspector for the `reigh.transcript` data kind: the six facts plus text. */
export function renderTranscriptItemInspector(props: DataItemInspectorProps): unknown {
  const { item } = props;
  return createElement(
    'div',
    { 'data-testid': 'transcript-item-inspector', style: { display: 'grid', gap: 2, fontSize: 11 } },
    createElement('div', null, `id: ${item.id}`),
    createElement('div', null, `schemaRef: ${props.schemaRef}`),
    createElement('div', null, `shape: ${props.shape} · domain: ${props.domain}`),
    createElement(
      'div',
      null,
      `extent: ${item.timelineStart.toFixed(2)}s – ${item.timelineEnd.toFixed(2)}s`,
    ),
    createElement('div', null, `text: ${readChipText(item.payload)}`),
  );
}

/** Payloads are opaque to the host; this kind knows its own `{ text }`. */
export function readChipText(payload: unknown): string {
  if (payload !== null && typeof payload === 'object' && 'text' in payload) {
    const text: unknown = payload.text;
    if (typeof text === 'string' && text.trim() !== '') return text;
  }
  return NO_TEXT_LABEL;
}

/** Caption materialization must inspect source text, not the display label. */
export function hasChipText(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || !('text' in payload)) return false;
  const text: unknown = payload.text;
  return typeof text === 'string' && text.trim() !== '';
}
