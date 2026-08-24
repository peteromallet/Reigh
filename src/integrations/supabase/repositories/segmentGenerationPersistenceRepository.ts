import { getSupabaseClient } from '@/integrations/supabase/client';
import { toJson } from '@/shared/lib/supabaseTypeHelpers';

export async function findChildGenerationIdByPair(
  parentGenerationId: string,
  pairShotGenerationId: string,
): Promise<string | undefined> {
  const { data, error } = await getSupabaseClient()
    .from('generations')
    .select('id')
    .eq('parent_generation_id', parentGenerationId)
    .eq('pair_shot_generation_id', pairShotGenerationId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`lookupChildGenerationIdByPair failed: ${error.message}`);
  }

  return data?.id;
}

export async function findChildGenerationIdByOrder(
  parentGenerationId: string,
  segmentIndex: number,
): Promise<string | undefined> {
  const { data, error } = await getSupabaseClient()
    .from('generations')
    .select('id')
    .eq('parent_generation_id', parentGenerationId)
    .eq('child_order', segmentIndex)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`lookupChildGenerationIdByOrder failed: ${error.message}`);
  }

  return data?.id;
}

export async function loadShotGenerationMetadata(
  shotGenerationId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabaseClient()
    .from('shot_generations')
    .select('metadata')
    .eq('id', shotGenerationId)
    .single();

  if (error) {
    throw new Error(`Failed to load segment metadata: ${error.message}`);
  }

  return (data?.metadata as Record<string, unknown> | null) ?? {};
}

export async function updateShotGenerationMetadata(
  shotGenerationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('shot_generations')
    .update({ metadata: toJson(metadata) })
    .eq('id', shotGenerationId);

  if (error) {
    throw new Error(`Failed to update segment metadata: ${error.message}`);
  }
}
