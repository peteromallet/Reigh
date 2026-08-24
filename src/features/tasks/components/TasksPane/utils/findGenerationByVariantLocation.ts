type GenerationRecord = Record<string, unknown> & {
  id: string;
  thumbnail_url?: string | null;
};

interface VariantGenerationLookupResult {
  generation: GenerationRecord;
  variantId: string;
  variantIsPrimary: boolean;
}

export async function findGenerationByVariantLocation(
  outputLocation: string,
  projectSlug: string,
): Promise<VariantGenerationLookupResult | null> {
  const client = new AstridLocalClient({ projectSlug });
  let cursor: string | undefined;
  do {
    const page = await client.gallery.list({ limit: 200, cursor });
    for (const summary of page.generations) {
      const detail = await client.gallery.get(summary.generation_id);
      const variant = detail.variants.find(
        (candidate) => bridgeMediaUrl(projectSlug, candidate.media_id) === outputLocation,
      );
      if (!variant) continue;
      const generation = bridgeDetailToGenerationRecord(detail, projectSlug) as GenerationRecord;
      return {
        generation: {
          ...generation,
          location: outputLocation,
          thumbnail_url: outputLocation,
        },
        variantId: variant.id,
        variantIsPrimary: variant.is_primary,
      };
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return null;
}
import { AstridLocalClient } from '@/integrations/astrid/client';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import { bridgeDetailToGenerationRecord } from '@/integrations/supabase/repositories/generationRepository';
