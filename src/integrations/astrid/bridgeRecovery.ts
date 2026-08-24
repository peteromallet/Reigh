/**
 * Recovery copy for the Phase C C4 browser surfaces.
 *
 * The bridge exposes exactly five public failure categories. Keeping the
 * guidance in one exhaustive record prevents callers from silently dropping a
 * new category or inventing route-specific recovery behavior.
 */

import {
  BRIDGE_ERROR_CATEGORIES,
  type BridgeErrorCategory,
} from '@/tools/video-editor/data/bridgeContract.ts';

export type BridgeRecoveryGuidance = Readonly<{
  title: string;
  detail: string;
  nextAction: string;
}>;

export const BRIDGE_RECOVERY_BY_CATEGORY = {
  invalid_body: {
    title: 'The request needs attention',
    detail: 'One or more inputs do not match the operation the local bridge accepts.',
    nextAction: 'Correct the highlighted input, then retry the operation.',
  },
  not_found: {
    title: 'The item is no longer available',
    detail: 'The project data may have changed since this view was loaded.',
    nextAction: 'Refresh the project data, then choose the item again.',
  },
  conflict: {
    title: 'The project changed elsewhere',
    detail: 'The bridge refused to overwrite a newer state or an active operation.',
    nextAction: 'Reload the latest state, review the changes, then retry.',
  },
  capability_unavailable: {
    title: 'A local capability is unavailable',
    detail: 'Astrid is reachable, but the requested model or capability is not ready on this machine.',
    nextAction: 'Run `python3 -m astrid doctor --json`, resolve the reported issue, then retry.',
  },
  payload_too_large: {
    title: 'The request is too large',
    detail: 'The bridge rejected the request before processing it because it exceeds the supported size.',
    nextAction: 'Reduce the input or split it into smaller operations, then retry.',
  },
} as const satisfies Record<BridgeErrorCategory, BridgeRecoveryGuidance>;

/** Return the single recovery path owned by a public bridge category. */
export function getBridgeRecoveryGuidance(
  category: BridgeErrorCategory,
): BridgeRecoveryGuidance {
  return BRIDGE_RECOVERY_BY_CATEGORY[category];
}

/**
 * Runtime guard for raw envelope codes. Frozen route-specific codes are not
 * relabelled here; the transport owns their status-aware classification.
 */
export function isBridgeErrorCategory(value: unknown): value is BridgeErrorCategory {
  return typeof value === 'string'
    && (BRIDGE_ERROR_CATEGORIES as readonly string[]).includes(value);
}
