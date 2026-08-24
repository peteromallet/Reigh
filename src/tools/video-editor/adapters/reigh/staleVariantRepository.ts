import { AstridLocalClient } from '@/integrations/astrid/client.ts';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability.ts';
import { BridgeRouteError } from '@/integrations/astrid/transport.ts';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore.ts';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl.ts';

export interface PrimaryVariantInfo {
  location: string;
  variant_id: string;
}

function clientForSelectedProject(): { client: AstridLocalClient; projectSlug: string } {
  const projectSlug = getProjectSelectionFallbackId();
  if (!projectSlug) {
    throw bridgeCapabilityUnavailable(
      'read primary generation variants',
      'Select an Astrid project before checking timeline assets.',
    );
  }
  return { client: new AstridLocalClient({ projectSlug }), projectSlug };
}

async function readPrimaryVariant(generationId: string): Promise<PrimaryVariantInfo | null> {
  const { client, projectSlug } = clientForSelectedProject();
  try {
    const detail = await client.gallery.get(generationId);
    const primary = detail.variants.find((variant) => variant.is_primary) ?? null;
    return primary
      ? { variant_id: primary.id, location: bridgeMediaUrl(projectSlug, primary.media_id) }
      : null;
  } catch (error) {
    if (error instanceof BridgeRouteError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchPrimaryVariantLocations(
  generationIds: string[],
): Promise<Record<string, PrimaryVariantInfo | null>> {
  const entries = await Promise.all(
    generationIds.map(async (generationId) => [generationId, await readPrimaryVariant(generationId)] as const),
  );
  return Object.fromEntries(entries);
}

export async function fetchCurrentPrimaryVariant(generationId: string) {
  const primary = await readPrimaryVariant(generationId);
  return primary
    ? { id: primary.variant_id, location: primary.location, thumbnail_url: primary.location }
    : null;
}
