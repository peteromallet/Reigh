// [CONVERGE-WITH-M1] Transcript → canonical envelope adapter. Pure and
// synchronous: segments are injected by the caller (host hook, Batch 6); no
// fetching happens here.
//
// Identity (source identity ≠ occurrence identity): `sourceItemId` is
// CONTENT-STABLE — `${assetId}:src:` plus a fixed 12-hex-char slice of the
// sync FNV-1a/64 hash over the canonical stringify of `{start,end,text}` —
// so reordering segments or re-transcribing with one edit leaves every other
// segment's id untouched. `id` names the occurrence and is assembly-derived
// VIEW-ONLY data (`${assetId}:${index}` asset-level,
// `${assetId}:${clipId}:${index}` clip-mapped), never persisted: one source
// segment reused on two clips yields two occurrences with distinct ids and
// the SAME `sourceItemId` as the join key. Identical-content segments share
// a `sourceItemId` by design (content addressing); their occurrences stay
// distinct via index.

import type { TranscriptSegment } from '@/tools/video-editor/lib/timeline-data.ts';
import { freezeDataItem, type FrozenDataItem } from './envelope.ts';
import { canonicalJsonStringify, fnv1a64Hex } from './timelineBundle.ts';

export const TRANSCRIPT_SCHEMA_REF = 'reigh.transcript_segment/v1';
export const ADAPT_TRANSCRIPT_ADAPTER_ID = 'reigh.adaptTranscript';

const ADAPTER_VERSION = '1';

/** Hex chars kept from `fnv1a64Hex` in `sourceItemId`; slice length pinned in tests. */
const SOURCE_ID_SLICE_HEX_CHARS = 12;

/**
 * Content-derived source id (L6 #2): positional `${assetId}:src:${i}` ids
 * must never be persisted. REV 3: the adapter stays synchronous, so the id
 * uses the pinned sync FNV-1a/64 hash; WebCrypto SHA-256 remains the async
 * bundle digest only.
 */
const deriveSourceItemId = (assetId: string, segment: TranscriptSegment): string =>
  `${assetId}:src:${fnv1a64Hex(
    canonicalJsonStringify({ start: segment.start, end: segment.end, text: segment.text }),
  ).slice(0, SOURCE_ID_SLICE_HEX_CHARS)}`;

export interface AdaptTranscriptOptions {
  assetId: string;
  clipId?: string;
}

/**
 * Adapt transcript segments into canonical interval items in
 * `source_seconds`. Extra segment fields (speaker, word timing, …) are
 * dropped — Reigh's profile carries none of them; payload is `{ text }` only.
 */
export function adaptTranscript(
  segments: readonly TranscriptSegment[] | null | undefined,
  options: AdaptTranscriptOptions,
): readonly FrozenDataItem[] {
  const { assetId, clipId } = options;
  return Object.freeze((segments ?? []).map((segment, index): FrozenDataItem => {
    const item: FrozenDataItem = {
      id: clipId === undefined ? `${assetId}:${index}` : `${assetId}:${clipId}:${index}`,
      sourceItemId: deriveSourceItemId(assetId, segment),
      shape: 'interval',
      domain: 'source_seconds',
      extent: { start: segment.start, end: segment.end },
      schemaRef: TRANSCRIPT_SCHEMA_REF,
      payload: { text: segment.text },
      provenance: { adapterId: ADAPT_TRANSCRIPT_ADAPTER_ID, adapterVersion: ADAPTER_VERSION },
      sourceArtifactRef: { assetId },
    };
    if (clipId !== undefined) {
      item.entityRef = { kind: 'clip', id: clipId };
    }
    return freezeDataItem(item);
  }));
}
