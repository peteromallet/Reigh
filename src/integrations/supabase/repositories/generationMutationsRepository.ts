import { getSupabaseClient } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/jsonTypes';
import type { PersistedGenerationParams } from '@/domains/generation/types/generationParams';
import type { GenerationRowDto } from '@/domains/generation/types/generationRowDto';
import { VARIANT_TYPE } from '@/shared/constants/variantTypes';
import {
  resolveGenerationProjectScope,
  resolveVariantProjectScope,
} from '@/shared/lib/tasks/generationTaskRepository';

interface ProjectScopedGenerationInput {
  id: string;
  projectId: string;
}

export interface ExternalUploadGenerationParams extends PersistedGenerationParams {
  prompt: string;
  extra: {
    source: 'external_upload';
    original_filename: string;
    file_type: string;
    file_size: number;
  };
}

interface CreateExternalUploadGenerationInput {
  imageUrl: string;
  thumbnailUrl: string;
  fileType: string;
  projectId: string;
  generationParams: ExternalUploadGenerationParams;
}

type ScopedMutationRowsResult<Row extends { id: string }> = PromiseLike<{
  data: Row[] | null;
  error: unknown;
}>;

function requireProjectScope(projectId: string): string {
  if (projectId.trim().length > 0) {
    return projectId;
  }

  throw new Error('Mutation requires project scope');
}

function throwScopedMutationFailure(error: unknown, emptyMessage: string): never {
  if (error instanceof Error) {
    throw error;
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    throw new Error((error as { message: string }).message);
  }
  throw new Error(emptyMessage);
}

async function assertGenerationProjectScope(
  generationId: string,
  projectId: string,
): Promise<string> {
  const scope = await resolveGenerationProjectScope(generationId, projectId);
  if (scope.status === 'ok') {
    return projectId;
  }

  throw new Error(`Generation scope validation failed (${scope.status})`);
}

async function resolveScopedVariantGenerationId(
  variantId: string,
  projectId: string,
): Promise<string> {
  const scope = await resolveVariantProjectScope(variantId, projectId);
  if (scope.status === 'ok' && scope.generationId) {
    return scope.generationId;
  }

  throw new Error(`Variant scope validation failed (${scope.status})`);
}

async function requireScopedRows<Row extends { id: string }>(
  resultPromise: ScopedMutationRowsResult<Row>,
  emptyMessage: string,
): Promise<Row[]> {
  const result = await resultPromise;
  if (result.error) {
    throwScopedMutationFailure(result.error, emptyMessage);
  }
  if (!result.data || result.data.length === 0) {
    throw new Error(emptyMessage);
  }
  return result.data;
}

export async function updateGenerationLocationInProject(
  params: ProjectScopedGenerationInput & { location: string; thumbnailUrl?: string },
): Promise<void> {
  const projectId = requireProjectScope(params.projectId);
  await assertGenerationProjectScope(params.id, projectId);
  await requireScopedRows(
    getSupabaseClient()
      .from('generations')
      .update({
        location: params.location,
        ...(params.thumbnailUrl ? { thumbnail_url: params.thumbnailUrl } : {}),
      })
      .eq('id', params.id)
      .eq('project_id', projectId)
      .select('id'),
    'No rows updated while enforcing generation project scope',
  );
}

export async function updateGenerationParams(
  params: { id: string; generationParams: Json },
): Promise<void> {
  await requireScopedRows(
    getSupabaseClient()
      .from('generations')
      .update({ params: params.generationParams })
      .eq('id', params.id)
      .select('id'),
    'No rows updated while saving generation params',
  );
}

export async function createExternalUploadGeneration(
  params: CreateExternalUploadGenerationInput,
): Promise<GenerationRowDto & { params?: Json | null }> {
  const projectId = requireProjectScope(params.projectId);
  const { data, error } = await getSupabaseClient()
    .from('generations')
    .insert({
      location: params.imageUrl,
      thumbnail_url: params.thumbnailUrl,
      type: params.fileType,
      project_id: projectId,
      params: params.generationParams as unknown as Json,
    })
    .select()
    .single();

  if (error || !data) {
    throwScopedMutationFailure(error, 'Failed to create generation');
  }

  const { error: variantError } = await getSupabaseClient()
    .from('generation_variants')
    .insert({
      generation_id: data.id,
      location: params.imageUrl,
      thumbnail_url: params.thumbnailUrl,
      is_primary: true,
      variant_type: VARIANT_TYPE.ORIGINAL,
      name: 'Original',
      params: params.generationParams as unknown as Json,
    });

  if (variantError) {
    throwScopedMutationFailure(variantError, 'Failed to create primary variant');
  }

  return data as GenerationRowDto & { params?: Json | null };
}

export async function updateGenerationStarInProject(
  params: ProjectScopedGenerationInput & { starred: boolean },
): Promise<void> {
  const projectId = requireProjectScope(params.projectId);
  await assertGenerationProjectScope(params.id, projectId);
  await requireScopedRows(
    getSupabaseClient()
      .from('generations')
      .update({ starred: params.starred })
      .eq('id', params.id)
      .eq('project_id', projectId)
      .select('id, starred'),
    'No rows updated while toggling generation star',
  );
}

export async function deleteGenerationInProject(
  params: ProjectScopedGenerationInput,
): Promise<void> {
  const projectId = requireProjectScope(params.projectId);
  await assertGenerationProjectScope(params.id, projectId);
  await requireScopedRows(
    getSupabaseClient()
      .from('generations')
      .delete()
      .eq('id', params.id)
      .eq('project_id', projectId)
      .select('id'),
    'No rows deleted while enforcing generation scope',
  );
}

export async function deleteVariantInProject(
  params: ProjectScopedGenerationInput,
): Promise<void> {
  const projectId = requireProjectScope(params.projectId);
  const generationId = await resolveScopedVariantGenerationId(params.id, projectId);
  await requireScopedRows(
    getSupabaseClient()
      .from('generation_variants')
      .delete()
      .eq('id', params.id)
      .eq('generation_id', generationId)
      .neq('variant_type', 'original')
      .select('id'),
    'No rows deleted while enforcing variant scope',
  );
}
