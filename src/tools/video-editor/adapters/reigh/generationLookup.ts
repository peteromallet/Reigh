import type { GenerationRow } from '@/domains/generation/types/index.ts';
import { fetchGenerationById } from '@/integrations/supabase/repositories/generationRepository.ts';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability.ts';

export interface DuplicatedGenerationAsset {
  generationId: string;
  variantId: string;
  variantType: 'image' | 'video';
  imageUrl: string;
  thumbUrl: string;
}

/** The frozen bridge has no generation-create or duplicate command. */
export async function duplicateGenerationAsset(_params: {
  generationId: string;
  projectId: string;
}): Promise<DuplicatedGenerationAsset> {
  throw bridgeCapabilityUnavailable(
    'duplicate generation from the video editor',
    'Duplicate the media in Astrid, then refresh the project gallery.',
  );
}

/** Gallery detail is part of the frozen bridge route set. */
export async function loadGenerationForLightbox(generationId: string): Promise<GenerationRow | null> {
  return await fetchGenerationById(generationId);
}
