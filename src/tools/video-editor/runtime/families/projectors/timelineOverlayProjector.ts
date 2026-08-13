/**
 * Dedicated timeline overlay projector — pure descriptor projection.
 *
 * Projects `{ extensionId, id, renderId, order }` directly from collected
 * `timelineOverlay` contributions. The renderer is deliberately NOT carried:
 * renderers are resolved only after the owning extension registers them via
 * `ctx.ui`, so normalized descriptors never fabricate callable renderers and
 * never emit `render: null` placeholders. There is no `when` clause on the
 * overlay contract, so none is projected either.
 *
 * Contains no imports from `extensionSurface.ts`, `useTimelineState.types.ts`,
 * or broad runtime slice modules.
 *
 * @module families/projectors/timelineOverlayProjector
 */

import type { TimelineOverlayDescriptor, ContributionId } from '@reigh/editor-sdk';
import type { CollectedContribution } from '../FamilyContributionSequence';
import { sortFamilyContributions, freezeDescriptor } from '../familyAdapterUtils';

/**
 * Project collected `timelineOverlay` contributions into SDK-owned
 * {@link TimelineOverlayDescriptor} objects.
 *
 * Ordering follows the canonical deterministic order (extension order, then
 * contribution `order`, then contribution id). Contributions that omit the
 * required `render` render-id reference are skipped: a descriptor cannot
 * carry a `renderId` without one.
 *
 * @returns A frozen array of frozen, unresolved overlay descriptors.
 */
export function buildTimelineOverlayDescriptors(
  contributions: readonly CollectedContribution[],
  extensionOrder?: ReadonlyMap<string, number>,
): readonly TimelineOverlayDescriptor[] {
  const sorted = sortFamilyContributions(contributions, extensionOrder);
  const descriptors: TimelineOverlayDescriptor[] = [];
  for (const { contribution, extensionId } of sorted) {
    const renderId = (contribution as { render?: string }).render;
    // `render` is a required manifest field; contributions without a
    // render-id reference cannot project a renderId-carrying descriptor.
    if (typeof renderId !== 'string' || renderId.length === 0) {
      continue;
    }
    descriptors.push(
      freezeDescriptor({
        extensionId,
        id: contribution.id as ContributionId,
        renderId,
        order: contribution.order,
      }),
    );
  }
  return Object.freeze(descriptors);
}
