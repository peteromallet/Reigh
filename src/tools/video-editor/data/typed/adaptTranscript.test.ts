import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/tools/video-editor/lib/timeline-data.ts';
import { adaptTranscript, ADAPT_TRANSCRIPT_ADAPTER_ID, TRANSCRIPT_SCHEMA_REF } from './adaptTranscript.ts';
import type { FrozenDataItem } from './envelope.ts';

const SEGMENTS: TranscriptSegment[] = [
  { start: 1.5, end: 3.25, text: 'hello world' },
  { start: 4, end: 5, text: 'second' },
];

// Type-level gate: the data plane is synchronous — no Promise may appear.
type ReturnsPromise<T> = Promise<unknown> extends T ? true : false;

describe('adaptTranscript', () => {
  it('maps segments to canonical interval items exactly', () => {
    const items = adaptTranscript(SEGMENTS, { assetId: 'asset-a' });
    expect(items).toEqual([
      {
        id: 'asset-a:0',
        sourceItemId: 'asset-a:src:0',
        shape: 'interval',
        domain: 'source_seconds',
        extent: { start: 1.5, end: 3.25 },
        schemaRef: TRANSCRIPT_SCHEMA_REF,
        payload: { text: 'hello world' },
        provenance: { adapterId: ADAPT_TRANSCRIPT_ADAPTER_ID, adapterVersion: '1' },
      },
      {
        id: 'asset-a:1',
        sourceItemId: 'asset-a:src:1',
        shape: 'interval',
        domain: 'source_seconds',
        extent: { start: 4, end: 5 },
        schemaRef: TRANSCRIPT_SCHEMA_REF,
        payload: { text: 'second' },
        provenance: { adapterId: ADAPT_TRANSCRIPT_ADAPTER_ID, adapterVersion: '1' },
      },
    ]);
  });

  it('stamps a clip entityRef and clip-scoped occurrence id when mapped', () => {
    const [item] = adaptTranscript(SEGMENTS.slice(0, 1), { assetId: 'asset-a', clipId: 'clip-9' });
    expect(item.id).toBe('asset-a:clip-9:0');
    expect(item.sourceItemId).toBe('asset-a:src:0');
    expect(item.entityRef).toEqual({ kind: 'clip', id: 'clip-9' });
  });

  it('keeps source identity stable while occurrences diverge per clip', () => {
    const [onOne] = adaptTranscript(SEGMENTS.slice(0, 1), { assetId: 'a', clipId: 'c1' });
    const [onTwo] = adaptTranscript(SEGMENTS.slice(0, 1), { assetId: 'a', clipId: 'c2' });
    expect(onOne.sourceItemId).toBe(onTwo.sourceItemId);
    expect(onOne.id).not.toBe(onTwo.id);
  });

  it('drops extra segment fields; payload carries text only', () => {
    const enriched = {
      start: 0,
      end: 1,
      text: 'hi',
      speaker: 'nova',
      words: [{ t: 0, w: 'hi' }],
    } as unknown as TranscriptSegment;
    const [item] = adaptTranscript([enriched], { assetId: 'a' });
    expect(item.payload).toEqual({ text: 'hi' });
    expect(Object.keys(item)).not.toContain('speaker');
    expect(Object.keys(item)).not.toContain('words');
    expect(item).not.toHaveProperty('speaker');
    expect(JSON.stringify(item)).not.toContain('nova');
  });

  it('returns [] for empty and missing input', () => {
    expect(adaptTranscript([], { assetId: 'a' })).toEqual([]);
    expect(adaptTranscript(undefined, { assetId: 'a' })).toEqual([]);
    expect(adaptTranscript(null, { assetId: 'a' })).toEqual([]);
  });

  it('deep-freezes each item and its envelope structures', () => {
    const items = adaptTranscript(SEGMENTS, { assetId: 'a', clipId: 'c1' });
    const [item] = items as readonly [FrozenDataItem];
    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.extent)).toBe(true);
    expect(Object.isFrozen(item.payload)).toBe(true);
    expect(Object.isFrozen(item.provenance)).toBe(true);
    expect(Object.isFrozen(item.entityRef)).toBe(true);
  });

  it('is synchronous at the type level (no Promise in signature)', () => {
    const items = adaptTranscript(SEGMENTS, { assetId: 'a' });
    const returnsPromise: ReturnsPromise<typeof items> = false;
    expect(returnsPromise).toBe(false);
  });
});
