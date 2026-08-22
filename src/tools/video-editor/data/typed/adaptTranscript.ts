// [CONVERGE-WITH-M1] Transcript → canonical envelope adapter. Pure and
// synchronous: segments are injected by the caller (host hook, Batch 6); no
// fetching happens here.
//
// Identity (source identity ≠ occurrence identity): `sourceItemId`
// (`${assetId}:src:${i}`) names the source segment; `id` names the
// occurrence — `${assetId}:${i}` when adapted asset-level,
// `${assetId}:${clipId}:${i}` when mapped onto a clip, so one source segment
// reused on two clips yields two occurrences with distinct ids and the SAME
// `sourceItemId` as the join key.

import type { TranscriptSegment } from '@/tools/video-editor/lib/timeline-data.ts';
import { freezeDataItem, type FrozenDataItem } from './envelope.ts';

export const TRANSCRIPT_SCHEMA_REF = 'reigh.transcript_segment/v1';
export const ADAPT_TRANSCRIPT_ADAPTER_ID = 'reigh.adaptTranscript';

const ADAPTER_VERSION = '1';

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
      sourceItemId: `${assetId}:src:${index}`,
      shape: 'interval',
      domain: 'source_seconds',
      extent: { start: segment.start, end: segment.end },
      schemaRef: TRANSCRIPT_SCHEMA_REF,
      payload: { text: segment.text },
      provenance: { adapterId: ADAPT_TRANSCRIPT_ADAPTER_ID, adapterVersion: ADAPTER_VERSION },
    };
    if (clipId !== undefined) {
      item.entityRef = { kind: 'clip', id: clipId };
    }
    return freezeDataItem(item);
  }));
}
