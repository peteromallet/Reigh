import { GenerationRow } from '@/domains/generation/types';
import { asRecord, asNullableString, asNullableNumber } from '@/shared/lib/typeCoercion';
import { ExpectedSegmentData, RawGenerationDbRow } from './segmentOutputTypes';

export function coerceRawGenerationDbRow(value: unknown): RawGenerationDbRow | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') {
    return null;
  }

  return {
    id: record.id,
    ...(asNullableString(record.generation_id) !== undefined ? { generation_id: asNullableString(record.generation_id) } : {}),
    ...(asNullableString(record.variant_fetch_generation_id) !== undefined
      ? { variant_fetch_generation_id: asNullableString(record.variant_fetch_generation_id) }
      : {}),
    ...(asNullableString(record.location) !== undefined ? { location: asNullableString(record.location) } : {}),
    ...(asNullableString(record.thumbnail_url) !== undefined ? { thumbnail_url: asNullableString(record.thumbnail_url) } : {}),
    ...(asNullableString(record.type) !== undefined ? { type: asNullableString(record.type) } : {}),
    ...(typeof record.created_at === 'string' ? { created_at: record.created_at } : {}),
    ...(asNullableString(record.updated_at) !== undefined ? { updated_at: asNullableString(record.updated_at) } : {}),
    ...(asRecord(record.params) || record.params === null ? { params: (asRecord(record.params) ?? null) } : {}),
    ...(asNullableString(record.parent_generation_id) !== undefined ? { parent_generation_id: asNullableString(record.parent_generation_id) } : {}),
    ...(asNullableNumber(record.child_order) !== undefined ? { child_order: asNullableNumber(record.child_order) } : {}),
    ...(typeof record.starred === 'boolean' ? { starred: record.starred } : {}),
    ...(asNullableString(record.pair_shot_generation_id) !== undefined ? { pair_shot_generation_id: asNullableString(record.pair_shot_generation_id) } : {}),
    ...(asNullableString(record.primary_variant_id) !== undefined ? { primary_variant_id: asNullableString(record.primary_variant_id) } : {}),
  };
}

export function coerceRawGenerationDbRows(value: unknown): RawGenerationDbRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const row = coerceRawGenerationDbRow(entry);
    if (!row) {
      throw new Error(`Invalid generation row at index ${index}`);
    }
    return row;
  });
}

export function extractExpectedSegmentData(
  parentParams: Record<string, unknown> | null,
): ExpectedSegmentData | null {
  if (!parentParams) {
    return null;
  }

  const orchestratorDetails = parentParams.orchestrator_details as Record<string, unknown> | undefined;
  if (!orchestratorDetails) {
    return null;
  }

  const segmentCount = (orchestratorDetails.num_new_segments_to_generate as number)
    || (orchestratorDetails.segment_frames_expanded as unknown[] | undefined)?.length
    || 0;

  if (segmentCount === 0) {
    return null;
  }

  return {
    count: segmentCount,
    frames: (orchestratorDetails.segment_frames_expanded as number[]) || [],
    prompts: (orchestratorDetails.enhanced_prompts_expanded as string[])
      || (orchestratorDetails.base_prompts_expanded as string[])
      || [],
    inputImages: (orchestratorDetails.input_image_paths_resolved as string[]) || [],
    inputImageGenIds: (orchestratorDetails.input_image_generation_ids as string[]) || [],
    pairShotGenIds: (orchestratorDetails.pair_shot_generation_ids as string[]) || [],
  };
}

export function getPairIdentifiers(
  generation: { pair_shot_generation_id?: string | null } | null,
  params: Record<string, unknown> | null,
): { pairShotGenId?: string; startGenId?: string } {
  const columnValue = generation?.pair_shot_generation_id;
  if (!columnValue) {
    return {};
  }

  const individualParams = params?.individual_segment_params as Record<string, unknown> | undefined;
  return {
    pairShotGenId: columnValue,
    startGenId: (individualParams?.start_image_generation_id || params?.start_image_generation_id) as string | undefined,
  };
}

export function isSegmentGeneration(params: Record<string, unknown> | null): boolean {
  return typeof params?.segment_index === 'number';
}

export function transformToGenerationRow(gen: RawGenerationDbRow): GenerationRow {
  const createdAt = gen.updated_at || gen.created_at || new Date().toISOString();
  const location = gen.location || '';

  return {
    id: gen.id,
    generation_id: gen.generation_id ?? undefined,
    variant_fetch_generation_id: gen.variant_fetch_generation_id ?? null,
    location,
    imageUrl: location,
    thumbUrl: gen.thumbnail_url || location,
    type: gen.type || 'video',
    createdAt,
    params: gen.params ?? undefined,
    parent_generation_id: gen.parent_generation_id,
    child_order: gen.child_order,
    starred: gen.starred,
    pair_shot_generation_id: gen.pair_shot_generation_id,
    primary_variant_id: gen.primary_variant_id,
  };
}
