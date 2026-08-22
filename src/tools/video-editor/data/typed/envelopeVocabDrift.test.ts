// @vitest-environment node
// dataKind V1 (rework R3): drift guard for the deliberately duplicated
// [CONVERGE-WITH-M1] vocabularies. `DataShape`/`DataCoordinateDomain` are
// declared twice — SDK (`sdk/video/families/dataKind.ts`, the manifest
// contract) and host envelope (`data/typed/envelope.ts`, the lane plane) —
// with import isolation by design. This test fails if they ever diverge:
//
// - Compile-time: the `Exactly` asserts below make any member-level drift a
//   type error in this file (`npx tsc --noEmit`, Batch 9's typecheck gate).
// - Runtime: the literal arrays pin both unions so a vitest-only run still
//   catches drift on either side.
import { describe, expect, it } from 'vitest';
import {
  KNOWN_DATA_DOMAINS,
  KNOWN_DATA_SHAPES,
  type DataCoordinateDomain as SdkDataCoordinateDomain,
  type DataShape as SdkDataShape,
} from '@reigh/editor-sdk';
import type {
  DataCoordinateDomain,
  DataShape,
} from '@/tools/video-editor/data/typed/envelope.ts';

/** Mutual assignability, invariant: true only when A and B are identical. */
type Exactly<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
  ? true
  : never;

// Compile-time equality asserts (R3). Any vocabulary drift breaks `tsc`.
const shapesTypeIdentical: Exactly<DataShape, SdkDataShape> = true;
const domainsTypeIdentical: Exactly<DataCoordinateDomain, SdkDataCoordinateDomain> = true;
void shapesTypeIdentical;
void domainsTypeIdentical;

describe('dataKind V1 vocabulary drift guard (envelope ↔ SDK)', () => {
  it('envelope DataShape is type-identical to the SDK DataShape', () => {
    // Mirror of the compile-time assert above, visible to vitest-only runs.
    const envelopeShapes: readonly SdkDataShape[] = ['point', 'interval', 'series'];
    expect([...KNOWN_DATA_SHAPES].sort()).toEqual([...envelopeShapes].sort());
  });

  it('envelope DataCoordinateDomain is type-identical to the SDK domain', () => {
    const envelopeDomains: readonly SdkDataCoordinateDomain[] = [
      'timeline_seconds',
      'source_seconds',
      'frames',
      'samples',
      'ticks',
      'ordinal',
      'char_offset',
      'token_offset',
    ];
    expect([...KNOWN_DATA_DOMAINS].sort()).toEqual([...envelopeDomains].sort());
  });
});
