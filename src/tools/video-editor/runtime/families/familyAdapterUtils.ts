/**
 * Shared utilities for host family adapters.
 *
 * Pure helpers used by both real and placeholder adapters.  No imports
 * from extensionSurface or broad runtime slices.
 *
 * @module families/familyAdapterUtils
 */

import type {
  ExtensionManifestContribution,
  FamilyContributionRef,
} from '@reigh/editor-sdk';
import type { CollectedContribution } from './FamilyContributionSequence';

interface CollectionMetadata {
  readonly scopedKey?: unknown;
  readonly duplicateOrdinal?: unknown;
  readonly projectionEligible?: unknown;
}

function hasCollectionMetadata(
  ref: FamilyContributionRef<unknown>,
): ref is CollectedContribution {
  const candidate: FamilyContributionRef<unknown> & CollectionMetadata = ref;
  return (
    typeof candidate.scopedKey === 'string' &&
    typeof candidate.duplicateOrdinal === 'number' &&
    typeof candidate.projectionEligible === 'boolean'
  );
}

function isManifestContribution(value: unknown): value is ExtensionManifestContribution {
  if (typeof value !== 'object' || value === null) return false;
  if (!('id' in value) || !('kind' in value)) return false;
  return typeof value.id === 'string' && typeof value.kind === 'string';
}

/**
 * Adapt the public SDK reference shape to the host's collected shape.
 * Runtime assembly already supplies collected records; direct adapter callers
 * (including SDK compatibility tests) may provide plain references.
 */
export function toCollectedContributions(
  contributions: readonly FamilyContributionRef<unknown>[],
): readonly CollectedContribution[] {
  const duplicateCounts = new Map<string, number>();
  return contributions.map((ref) => {
    if (hasCollectionMetadata(ref)) return ref;
    if (!isManifestContribution(ref.contribution)) {
      throw new TypeError('Family adapter received an invalid contribution reference.');
    }
    const contribution = ref.contribution;
    const scopedKey = `${contribution.kind}:${ref.extensionId}:${contribution.id}`;
    const duplicateOrdinal = duplicateCounts.get(scopedKey) ?? 0;
    duplicateCounts.set(scopedKey, duplicateOrdinal + 1);
    return {
      contribution,
      extensionId: ref.extensionId,
      scopedKey,
      duplicateOrdinal,
      projectionEligible: duplicateOrdinal === 0,
    };
  });
}

/**
 * Sort family contributions using the canonical deterministic order:
 * extension order ascending, then contribution.order ascending, then
 * contribution.id alphabetically.
 *
 * When `extensionOrder` is omitted, the input order is preserved.
 */
export function sortFamilyContributions<TContribution>(
  contributions: readonly FamilyContributionRef<TContribution>[],
  extensionOrder?: ReadonlyMap<string, number>,
): readonly FamilyContributionRef<TContribution>[] {
  if (!extensionOrder || contributions.length <= 1) {
    return contributions;
  }

  return [...contributions].sort((a, b) => {
    const extOrderA = extensionOrder.get(a.extensionId) ?? Number.MAX_SAFE_INTEGER;
    const extOrderB = extensionOrder.get(b.extensionId) ?? Number.MAX_SAFE_INTEGER;
    if (extOrderA !== extOrderB) return extOrderA - extOrderB;

    const orderA = (a.contribution as { order?: number }).order ?? 0;
    const orderB = (b.contribution as { order?: number }).order ?? 0;
    if (orderA !== orderB) return orderA - orderB;

    const idA = (a.contribution as { id?: string }).id ?? '';
    const idB = (b.contribution as { id?: string }).id ?? '';
    return idA.localeCompare(idB);
  });
}

/**
 * Freeze a single descriptor object shallowly.
 */
export function freezeDescriptor<T>(descriptor: T): T {
  return Object.freeze(descriptor);
}

/**
 * Freeze an array of descriptors shallowly.
 */
export function freezeDescriptors<T>(descriptors: readonly T[]): readonly T[] {
  return Object.freeze([...descriptors]);
}
