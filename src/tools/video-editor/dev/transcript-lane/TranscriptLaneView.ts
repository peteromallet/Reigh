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
  DataLaneRenderItem,
  DataItemInspectorProps,
  DataLaneRendererProps,
} from '@reigh/editor-sdk';

/** Longest text snippet painted per segment chip (kept small on purpose). */
const MAX_CHIP_CHARS = 48;

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
  onCreateCaptions?: (items: readonly DataLaneRenderItem[]) => void,
  onRegenerateCaptions?: (items: readonly DataLaneRenderItem[]) => void,
  onProposeSourceUpdates?: (items: readonly DataLaneRenderItem[]) => void,
): unknown {
  const windowStartIndex = props.itemWindow?.startIndex ?? 0;
  const totalItemCount = props.itemWindow?.totalItemCount ?? props.items.length;
  const chips = props.items.map((item, localIndex) =>
    createElement(
      'button',
      {
        key: item.id,
        type: 'button',
        'data-testid': 'transcript-lane-chip',
        'data-item-id': item.id,
        'aria-label': `Transcript segment: ${readChipText(item.payload)}, ${item.timelineStart.toFixed(2)} to ${item.timelineEnd.toFixed(2)} seconds`,
        'aria-posinset': windowStartIndex + localIndex + 1,
        'aria-setsize': totalItemCount,
        title: `${item.id} · ${props.schemaRef}`,
        tabIndex: item.id === props.activeItemId ? 0 : -1,
        style: {
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          left: item.timelineStart * props.pixelsPerSecond,
          width: (item.timelineEnd - item.timelineStart) * props.pixelsPerSecond,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 10,
          lineHeight: '16px',
          padding: '0 6px',
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
    ),
  );
  return createElement(
    'div',
    {
      'data-testid': 'transcript-lane-renderer',
      style: { position: 'relative', height: '100%', overflow: 'hidden' },
    },
    ...chips,
    ...(onCreateCaptions ? [
      createElement(
        'div',
        {
          key: 'caption-actions',
          role: 'group',
          'aria-label': 'Transcript caption round-trip actions',
          style: {
            position: 'absolute',
            right: 6,
            top: 2,
            zIndex: 2,
            display: 'flex',
            gap: 3,
          },
        },
        ...[
          {
            key: 'create-caption-clips',
            testId: 'transcript-create-caption-clips',
            title: 'Create missing editable video text clips and preserve existing edits',
            ariaLabel: 'Render transcript as editable video text',
            label: 'Add missing',
            action: onCreateCaptions,
          },
          ...(onRegenerateCaptions ? [{
            key: 'regenerate-caption-clips',
            testId: 'transcript-regenerate-caption-clips',
            title: 'Explicitly regenerate caption clips, replacing human edits',
            ariaLabel: 'Regenerate transcript captions and replace edits',
            label: 'Regenerate',
            action: onRegenerateCaptions,
          }] : []),
          ...(onProposeSourceUpdates ? [{
            key: 'propose-source-updates',
            testId: 'transcript-propose-source-updates',
            title: 'Create review proposals from human-edited caption text',
            ariaLabel: 'Propose caption edits back to transcript source',
            label: 'Propose edits',
            action: onProposeSourceUpdates,
          }] : []),
        ].map((button) => createElement(
          'button',
          {
            key: button.key,
            type: 'button',
            'data-testid': button.testId,
            title: button.title,
            'aria-label': button.ariaLabel,
            style: {
            fontSize: 10,
            lineHeight: '18px',
            padding: '0 8px',
            borderRadius: 4,
            border: '1px solid var(--video-editor-accent-border-strong)',
            background: 'var(--video-editor-panel-bg)',
            color: 'var(--video-editor-fg)',
            cursor: 'pointer',
            },
            onClick: (event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              button.action(props.getAllItems?.() ?? props.items);
            },
          },
          button.label,
        )),
      ),
    ] : []),
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
    if (typeof text === 'string') return text;
  }
  return '(no text)';
}
