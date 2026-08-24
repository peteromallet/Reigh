// IMPORTANT: If hook return shapes change, update these transformers.
import type { GenerationRow } from '@/domains/generation/types';
import type { GenerationRowDto } from '@/domains/generation/types/generationRowDto';
import { mapGenerationRowDtoToRow } from '@/domains/generation/mappers/generationRowMapper';
import { getGenerationId } from '@/shared/lib/media/mediaTypeHelpers';
import { toJson } from '@/shared/lib/supabaseTypeHelpers';
import {
  DEFAULT_STRUCTURE_GUIDANCE_CONTROLS,
  DEFAULT_STRUCTURE_VIDEO,
  resolveTravelStructureState,
  type ResolvedTravelStructureState,
} from '@/shared/lib/tasks/travelBetweenImages';

export function transformGenerationToParentRow(
  generation: GenerationRow | Record<string, unknown> | null | undefined
): GenerationRow | null {
  if (!generation) return null;
  const rawGeneration = generation as Record<string, unknown>;

  const metadata = rawGeneration.metadata;
  const generationIdentity = {
    generation_id: typeof rawGeneration.generation_id === 'string' ? rawGeneration.generation_id : null,
    id: typeof rawGeneration.id === 'string' ? rawGeneration.id : null,
    metadata: metadata && typeof metadata === 'object'
      ? metadata as Record<string, unknown>
      : undefined,
  };
  const resolvedGenerationId = getGenerationId(generationIdentity) || 'shared';

  const id = typeof rawGeneration.id === 'string'
    ? rawGeneration.id
    : (typeof rawGeneration.generation_id === 'string' ? rawGeneration.generation_id : 'shared');

  const dto: GenerationRowDto = {
    id,
    generation_id: resolvedGenerationId,
    location: typeof rawGeneration.location === 'string' ? rawGeneration.location : null,
    type: typeof rawGeneration.type === 'string' ? rawGeneration.type : 'video',
    createdAt: typeof rawGeneration.createdAt === 'string' ? rawGeneration.createdAt : undefined,
    created_at: typeof rawGeneration.created_at === 'string' ? rawGeneration.created_at : undefined,
    thumbnail_url: typeof rawGeneration.thumbnail_url === 'string'
      ? rawGeneration.thumbnail_url
      : (typeof rawGeneration.thumbUrl === 'string' ? rawGeneration.thumbUrl : undefined),
    params: toJson(rawGeneration.params),
  };

  return mapGenerationRowDtoToRow(dto);
}

export function calculateColumnsForDevice(
  mobileColumns: number
): 2 | 3 | 4 | 6 {
  if (mobileColumns <= 2) return 2;
  if (mobileColumns === 3) return 3;
  if (mobileColumns === 4) return 4;
  return 6;
}

export function extractStructureState(
  settings: Record<string, unknown> | null | undefined
): ResolvedTravelStructureState {
  return resolveTravelStructureState(settings, {
    defaultEndFrame: 300,
    defaultVideoTreatment: DEFAULT_STRUCTURE_VIDEO.treatment,
    defaultMotionStrength: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.motionStrength,
    defaultStructureType: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.structureType,
    defaultUni3cEndPercent: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.uni3cEndPercent,
  });
}
