import { AstridLocalClient } from '@/integrations/astrid/client';
import { BridgeRouteError } from '@/integrations/astrid/transport';
import type { BridgeGenerationDetailPayload } from '@/tools/video-editor/data/bridgeContract';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import { EDIT_VARIANT_TYPES } from '@/shared/constants/variantTypes';

export interface DerivedItem {
  id: string;
  thumbUrl: string | null;
  url: string | null;
  createdAt: string;
  derivedCount: number;
  starred?: boolean;
  prompt?: string;
  itemType: 'generation' | 'variant';
  variantType?: string | null;
  variantName?: string | null;
  viewedAt?: string | null;
  basedOn?: string | null;
  shot_id?: string;
  timeline_frame?: number | null;
  all_shot_associations?: Array<{ shot_id: string; timeline_frame: number | null; position: number | null }>;
}

function normalizePrompt(params: unknown): string | undefined {
  const record = params as Record<string, unknown> | null;
  if (!record) {
    return undefined;
  }

  if (typeof record.prompt === 'string') {
    return record.prompt;
  }

  const originalParams = record.originalParams as Record<string, unknown> | undefined;
  const orchestratorDetails = originalParams?.orchestrator_details as Record<string, unknown> | undefined;
  return typeof orchestratorDetails?.prompt === 'string' ? orchestratorDetails.prompt : undefined;
}

/**
 * Derived items for one source generation, re-sourced onto the bridge
 * generation-detail read (R13). The detail payload carries the full variant
 * list; edit variants become derived items whose display URLs are same-origin
 * R9 content routes.
 *
 * Child generations (rows with `based_on` = this generation) have no listing
 * route in the doc-27 §4.1 v1 set — that half of the surface is dispositioned
 * `defer` in docs/cutover-inventory.md.
 */
export function mapDerivedItemsFromGenerationDetail(
  detail: BridgeGenerationDetailPayload['generation'],
  projectSlug: string,
): DerivedItem[] {
  const variantItems: DerivedItem[] = detail.variants
    .filter((variant) =>
      !variant.is_primary
      && variant.variant_type !== null
      && variant.variant_type !== undefined
      && EDIT_VARIANT_TYPES.includes(variant.variant_type as never))
    .map((variant) => ({
      id: variant.id,
      // R9 serves the managed bytes; there is no separate thumbnail media on
      // the wire, so the content route doubles as the thumbnail address.
      thumbUrl: bridgeMediaUrl(projectSlug, variant.media_id),
      url: bridgeMediaUrl(projectSlug, variant.media_id),
      createdAt: variant.created_at,
      derivedCount: 0,
      starred: false,
      prompt: normalizePrompt(variant.params),
      itemType: 'variant',
      variantType: variant.variant_type ?? null,
      variantName: variant.name ?? null,
      viewedAt: variant.viewed_at ?? null,
    }));

  return [...variantItems].sort((a, b) => {
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export async function fetchDerivedItemsFromRepository(
  sourceGenerationId: string | null,
): Promise<DerivedItem[]> {
  if (!sourceGenerationId) {
    return [];
  }

  const projectSlug = getProjectSelectionFallbackId();
  if (!projectSlug) {
    return [];
  }

  let detail: BridgeGenerationDetailPayload['generation'];
  try {
    detail = await new AstridLocalClient({ projectSlug }).gallery.get(sourceGenerationId);
  } catch (error) {
    if (error instanceof BridgeRouteError && error.status === 404) {
      return [];
    }
    throw error;
  }

  return mapDerivedItemsFromGenerationDetail(detail, projectSlug);
}
