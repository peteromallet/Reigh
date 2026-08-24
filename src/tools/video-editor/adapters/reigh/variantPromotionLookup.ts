import { AstridLocalClient } from '@/integrations/astrid/client.ts';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability.ts';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore.ts';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl.ts';

export async function loadPrimaryVariantForGeneration(generationId: string) {
  const projectSlug = getProjectSelectionFallbackId();
  if (!projectSlug) {
    throw bridgeCapabilityUnavailable(
      'load a promoted generation variant',
      'Select an Astrid project before adding the generation to a timeline.',
    );
  }

  const detail = await new AstridLocalClient({ projectSlug }).gallery.get(generationId);
  const primary = detail.variants.find((variant) => variant.is_primary) ?? null;
  if (!primary) return null;
  const location = bridgeMediaUrl(projectSlug, primary.media_id);
  return { id: primary.id, location, thumbnail_url: location };
}
