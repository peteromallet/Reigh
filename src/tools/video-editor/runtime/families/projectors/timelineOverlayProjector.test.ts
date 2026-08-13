/**
 * Dedicated timeline overlay projector — descriptor projection tests.
 *
 * Validates that `buildTimelineOverlayDescriptors` projects
 * `{ extensionId, id, renderId, order }` directly from collected
 * `timelineOverlay` contributions: extension ownership, render-ID
 * retention, deterministic ordering, and the absence of any callable
 * or `null` placeholder renderer (and of any `when` clause).
 *
 * @module families/projectors/timelineOverlayProjector.test
 */

import { describe, it, expect } from 'vitest';

import { buildTimelineOverlayDescriptors } from './timelineOverlayProjector';
import type { CollectedContribution } from '../FamilyContributionSequence';
import type { TimelineOverlayDescriptor } from '@reigh/editor-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OverlayContributionShape {
  readonly id?: string;
  readonly kind?: 'timelineOverlay';
  readonly order?: number;
  readonly render?: string;
  readonly when?: unknown;
}

/** Build a minimal CollectedContribution for a timelineOverlay contribution. */
function collectedOverlay(
  overrides: OverlayContributionShape,
  extensionId = 'test.ext',
): CollectedContribution {
  const contribution: OverlayContributionShape = {
    id: overrides.id ?? ('test-overlay' as any),
    kind: 'timelineOverlay',
    order: overrides.order,
    render: overrides.render,
    ...(overrides.when !== undefined ? { when: overrides.when } : {}),
  };

  return {
    contribution: contribution as any,
    extensionId,
    scopedKey: `timelineOverlay:${extensionId}:${contribution.id as string}`,
    duplicateOrdinal: 0,
    projectionEligible: true,
  };
}

/** Extract a single descriptor from the result, failing if count != 1. */
function singleDescriptor(
  descriptors: readonly TimelineOverlayDescriptor[],
): TimelineOverlayDescriptor {
  if (descriptors.length !== 1) {
    throw new Error(
      `Expected exactly 1 descriptor, got ${descriptors.length}`,
    );
  }
  return descriptors[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTimelineOverlayDescriptors', () => {
  // ---- Basic projection ---------------------------------------------------

  it('projects extension ownership, id, renderId, and order', () => {
    const result = buildTimelineOverlayDescriptors([
      collectedOverlay(
        {
          id: 'ruler-marker-layer' as any,
          order: 5,
          render: 'render/ruler-marker-layer',
        },
        'com.example.markers',
      ),
    ]);

    const d = singleDescriptor(result);
    expect(d.extensionId).toBe('com.example.markers');
    expect(d.id).toBe('ruler-marker-layer');
    expect(d.renderId).toBe('render/ruler-marker-layer');
    expect(d.order).toBe(5);
  });

  it('retains the render-id reference without fabricating a callable renderer', () => {
    const result = buildTimelineOverlayDescriptors([
      collectedOverlay({ render: 'render/phase-markers' }),
    ]);

    const d = singleDescriptor(result);
    expect(d.renderId).toBe('render/phase-markers');
    // Unresolved descriptors carry the render-id reference only — no
    // callable renderer is fabricated at projection time.
    expect('render' in d).toBe(false);
    expect((d as { render?: unknown }).render).toBeUndefined();
    expect(typeof (d as { render?: unknown }).render).not.toBe('function');
  });

  it('never emits a null placeholder renderer', () => {
    const result = buildTimelineOverlayDescriptors([
      collectedOverlay({ render: 'render/phase-markers' }),
    ]);

    const d = singleDescriptor(result);
    expect((d as { render?: unknown }).render).not.toBeNull();
    expect('render' in d).toBe(false);
  });

  it('does not carry a when clause', () => {
    const result = buildTimelineOverlayDescriptors([
      collectedOverlay({
        render: 'render/phase-markers',
        when: () => true,
      }),
    ]);

    const d = singleDescriptor(result);
    expect('when' in d).toBe(false);
    expect((d as { when?: unknown }).when).toBeUndefined();
  });

  it('omits order when the contribution has no order', () => {
    const result = buildTimelineOverlayDescriptors([
      collectedOverlay({ render: 'render/no-order' }),
    ]);

    const d = singleDescriptor(result);
    expect(d.order).toBeUndefined();
  });

  // ---- Ordering -----------------------------------------------------------

  it('orders by contribution order ascending', () => {
    const result = buildTimelineOverlayDescriptors(
      [
        collectedOverlay({ id: 'late' as any, order: 10, render: 'render/late' }),
        collectedOverlay({ id: 'early' as any, order: 1, render: 'render/early' }),
      ],
      new Map([['test.ext', 0]]),
    );

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('early');
    expect(result[1].id).toBe('late');
  });

  it('breaks equal orders alphabetically by contribution id', () => {
    const result = buildTimelineOverlayDescriptors(
      [
        collectedOverlay({ id: 'zzz-overlay' as any, order: 10, render: 'render/zzz' }),
        collectedOverlay({ id: 'aaa-overlay' as any, order: 10, render: 'render/aaa' }),
      ],
      new Map([['test.ext', 0]]),
    );

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('aaa-overlay');
    expect(result[0].renderId).toBe('render/aaa');
    expect(result[1].id).toBe('zzz-overlay');
    expect(result[1].renderId).toBe('render/zzz');
  });

  it('uses extension order as the primary sort key', () => {
    const result = buildTimelineOverlayDescriptors(
      [
        collectedOverlay({ id: 'second-ext' as any, order: 1, render: 'render/second' }, 'com.example.second'),
        collectedOverlay({ id: 'first-ext' as any, order: 1, render: 'render/first' }, 'com.example.first'),
      ],
      new Map([
        ['com.example.first', 0],
        ['com.example.second', 1],
      ]),
    );

    expect(result).toHaveLength(2);
    expect(result[0].extensionId).toBe('com.example.first');
    expect(result[1].extensionId).toBe('com.example.second');
  });

  // ---- Required render ----------------------------------------------------

  it('skips contributions without a render-id reference', () => {
    const result = buildTimelineOverlayDescriptors([
      collectedOverlay({ id: 'no-render' as any }),
    ]);

    expect(result).toHaveLength(0);
  });

  it('skips contributions with a blank render-id reference', () => {
    const result = buildTimelineOverlayDescriptors([
      collectedOverlay({ id: 'blank-render' as any, render: '' }),
    ]);

    expect(result).toHaveLength(0);
  });

  // ---- Multiple contributions ---------------------------------------------

  it('projects multiple overlay contributions in deterministic order', () => {
    const result = buildTimelineOverlayDescriptors([
      collectedOverlay({ id: 'first' as any, order: 1, render: 'render/first' }),
      collectedOverlay({ id: 'second' as any, order: 2, render: 'render/second' }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('first');
    expect(result[1].id).toBe('second');
    expect(result[0].extensionId).toBe('test.ext');
    expect(result[1].extensionId).toBe('test.ext');
  });

  // ---- Freezing -----------------------------------------------------------

  it('returns a frozen array of frozen descriptors', () => {
    const result = buildTimelineOverlayDescriptors([
      collectedOverlay({ render: 'render/frozen' }),
    ]);

    expect(Object.isFrozen(result)).toBe(true);
    const d = singleDescriptor(result);
    expect(Object.isFrozen(d)).toBe(true);
  });

  it('returns a frozen empty array for empty input', () => {
    const result = buildTimelineOverlayDescriptors([]);
    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
