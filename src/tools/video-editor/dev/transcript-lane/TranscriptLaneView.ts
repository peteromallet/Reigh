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

import { createElement } from 'react';
import type {
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
 * interval item, in the order the host mapped them. Items arrive with
 * timeline-space `timelineStart`/`timelineEnd` already applied by the host;
 * this V1 example paints sequence-order chips (the SDK renderer props do not
 * yet carry the viewport scale) — the point of the example is the bind path,
 * not pixel-exact painting.
 */
export function renderTranscriptLane(props: DataLaneRendererProps): unknown {
  return createElement(
    'div',
    {
      'data-testid': 'transcript-lane-renderer',
      style: { display: 'flex', alignItems: 'center', gap: 4, height: '100%', padding: '0 4px', overflow: 'hidden' },
    },
    ...props.items.map((item) =>
      createElement(
        'span',
        {
          key: item.id,
          'data-testid': 'transcript-lane-chip',
          title: `${item.id} · ${props.schemaRef}`,
          style: {
            flexShrink: 0,
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 10,
            lineHeight: '16px',
            padding: '0 6px',
            borderRadius: 4,
            background: 'var(--video-editor-accent-bg-strong)',
            color: 'var(--video-editor-accent-fg)',
          },
        },
        truncate(readChipText(item.payload)),
      ),
    ),
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
function readChipText(payload: unknown): string {
  if (payload !== null && typeof payload === 'object' && 'text' in payload) {
    const text: unknown = payload.text;
    if (typeof text === 'string') return text;
  }
  return '(no text)';
}
