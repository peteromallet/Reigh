import type { Json } from '@/integrations/supabase/jsonTypes';
import type { GenerationMetadata, GenerationRow } from '@/domains/generation/types';
import type { GenerationRowDto } from '@/domains/generation/types/generationRowDto';
import { asRecord, asNullableString, asNullableNumber } from '@/shared/lib/typeCoercion';

function asJsonRecord(value: unknown): Json | null | undefined {
  if (value === null) {
    return null;
  }
  return asRecord(value) as Json | null;
}

function asGenerationMetadata(value: unknown): GenerationMetadata | null | undefined {
  if (value === null) {
    return null;
  }
  return asRecord(value) ?? undefined;
}

export function coerceGenerationRowDto(
  value: unknown,
): GenerationRowDto | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') {
    return null;
  }

  return {
    id: record.id,
    ...(asNullableString(record.shot_generation_id) !== undefined ? { shot_generation_id: asNullableString(record.shot_generation_id) } : {}),
    ...(asNullableString(record.shotImageEntryId) !== undefined && asNullableString(record.shot_generation_id) === undefined
      ? { shot_generation_id: asNullableString(record.shotImageEntryId) }
      : {}),
    ...(typeof record.generation_id === 'string' ? { generation_id: record.generation_id } : {}),
    ...(asNullableString(record.location) !== undefined ? { location: asNullableString(record.location) } : {}),
    ...(asNullableString(record.thumbnail_url) !== undefined ? { thumbnail_url: asNullableString(record.thumbnail_url) } : {}),
    ...(asNullableString(record.type) !== undefined ? { type: asNullableString(record.type) } : {}),
    ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
    ...(typeof record.created_at === 'string' ? { created_at: record.created_at } : {}),
    ...(asGenerationMetadata(record.metadata) !== undefined ? { metadata: asGenerationMetadata(record.metadata) } : {}),
    ...(asNullableString(record.name) !== undefined ? { name: asNullableString(record.name) } : {}),
    ...(asNullableNumber(record.timeline_frame) !== undefined ? { timeline_frame: asNullableNumber(record.timeline_frame) } : {}),
    ...(typeof record.starred === 'boolean' ? { starred: record.starred } : {}),
    ...(asNullableString(record.based_on) !== undefined ? { based_on: asNullableString(record.based_on) } : {}),
    ...(asJsonRecord(record.params) !== undefined ? { params: asJsonRecord(record.params) } : {}),
    ...(asNullableString(record.parent_generation_id) !== undefined ? { parent_generation_id: asNullableString(record.parent_generation_id) } : {}),
    ...(typeof record.is_child === 'boolean' ? { is_child: record.is_child } : {}),
    ...(asNullableNumber(record.child_order) !== undefined ? { child_order: asNullableNumber(record.child_order) } : {}),
    ...(asNullableString(record.pair_shot_generation_id) !== undefined ? { pair_shot_generation_id: asNullableString(record.pair_shot_generation_id) } : {}),
    ...(asNullableString(record.primary_variant_id) !== undefined ? { primary_variant_id: asNullableString(record.primary_variant_id) } : {}),
    ...(asNullableString(record.source_task_id) !== undefined ? { source_task_id: asNullableString(record.source_task_id) } : {}),
  } satisfies GenerationRowDto;
}

export function mapGenerationRowDtoToRow(
  dto: GenerationRowDto,
): GenerationRow {
  return {
    id: dto.id,
    shot_generation_id: dto.shot_generation_id ?? dto.shotImageEntryId ?? null,
    generation_id: dto.generation_id,
    location: dto.location ?? null,
    imageUrl: dto.location ?? undefined,
    thumbUrl: dto.thumbnail_url ?? dto.location ?? undefined,
    type: dto.type ?? null,
    createdAt: dto.createdAt ?? dto.created_at,
    metadata: dto.metadata ?? null,
    name: dto.name ?? null,
    timeline_frame: dto.timeline_frame ?? null,
    starred: dto.starred,
    based_on: dto.based_on ?? null,
    params: (dto.params ?? undefined) as GenerationRow['params'],
    parent_generation_id: dto.parent_generation_id ?? null,
    is_child: dto.is_child,
    child_order: dto.child_order ?? null,
    pair_shot_generation_id: dto.pair_shot_generation_id ?? null,
    primary_variant_id: dto.primary_variant_id ?? null,
    source_task_id: dto.source_task_id ?? null,
  };
}
