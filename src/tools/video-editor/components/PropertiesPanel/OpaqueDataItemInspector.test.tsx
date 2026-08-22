// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OpaqueDataItemInspector } from '@/tools/video-editor/components/PropertiesPanel/OpaqueDataItemInspector';
import type { FrozenDataItem } from '@/tools/video-editor/data/typed/envelope';

function createItem(overrides: Partial<FrozenDataItem> = {}): FrozenDataItem {
  return {
    id: 'asset-1:0',
    shape: 'interval',
    domain: 'source_seconds',
    extent: { start: 2, end: 4 },
    schemaRef: 'reigh.transcript_segment/v1',
    payload: { text: 'hello world' },
    provenance: { adapterId: 'reigh.adaptTranscript', adapterVersion: '1' },
    ...overrides,
  };
}

describe('OpaqueDataItemInspector', () => {
  it('renders the six envelope facts plus the payload JSON', () => {
    render(<OpaqueDataItemInspector item={createItem()} />);

    expect(screen.getByTestId('opaque-data-item-id')).toHaveTextContent('asset-1:0');
    expect(screen.getByTestId('opaque-data-item-shape')).toHaveTextContent('interval');
    expect(screen.getByTestId('opaque-data-item-schema-ref')).toHaveTextContent('reigh.transcript_segment/v1');
    expect(screen.getByTestId('opaque-data-item-extent')).toHaveTextContent('[2, 4)');
    expect(screen.getByTestId('opaque-data-item-domain')).toHaveTextContent('source_seconds');
    expect(screen.getByTestId('opaque-data-item-adapter')).toHaveTextContent('reigh.adaptTranscript');
    expect(screen.getByTestId('opaque-data-item-payload')).toHaveTextContent('hello world');
  });

  it('renders an open-ended extent when the item has no end', () => {
    render(<OpaqueDataItemInspector item={createItem({ extent: { start: 7 } })} />);

    expect(screen.getByTestId('opaque-data-item-extent')).toHaveTextContent('[7, ∞)');
  });

  it('truncates long payload JSON instead of flooding the panel', () => {
    const payload = { text: 'x'.repeat(2000) };
    render(<OpaqueDataItemInspector item={createItem({ payload })} />);

    const rendered = screen.getByTestId('opaque-data-item-payload').textContent ?? '';
    expect(rendered.endsWith('…')).toBe(true);
    expect(rendered.length).toBeLessThan(500);
  });

  it('falls back to a plain string form for non-serializable payloads', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    render(<OpaqueDataItemInspector item={createItem({ payload: circular })} />);

    expect(screen.getByTestId('opaque-data-item-payload')).toBeInTheDocument();
  });

  it('renders scalar payloads that JSON.stringify skips', () => {
    render(<OpaqueDataItemInspector item={createItem({ payload: undefined })} />);

    expect(screen.getByTestId('opaque-data-item-payload')).toHaveTextContent('undefined');
  });
});
