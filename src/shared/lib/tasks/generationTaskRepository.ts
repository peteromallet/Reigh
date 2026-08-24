import { AstridLocalClient } from '@/integrations/astrid/client';
import { BridgeRouteError } from '@/integrations/astrid/transport';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { isUuid } from '@/shared/lib/uuid';

export type GenerationTaskMappingStatus =
  | 'ok'
  | 'not_loaded'
  | 'missing_generation'
  | 'scope_mismatch'
  | 'invalid_tasks_shape'
  | 'query_failed';

export interface GenerationTaskMapping {
  generationId: string;
  taskId: string | null;
  status: GenerationTaskMappingStatus;
  queryError?: string;
}

export interface GenerationTaskMappingCacheEntry {
  taskId: string | null;
  status: GenerationTaskMappingStatus;
  queryError?: string;
}

type GenerationProjectScopeStatus =
  | 'ok'
  | 'query_failed'
  | 'missing_generation'
  | 'scope_mismatch'
  | 'missing_project_scope';

interface GenerationProjectScopeResolution {
  generationId: string;
  projectId: string | null;
  status: GenerationProjectScopeStatus;
  queryError?: string;
}

export type VariantProjectScopeStatus =
  | 'ok'
  | 'query_failed'
  | 'missing_variant'
  | 'missing_generation'
  | 'scope_mismatch'
  | 'missing_project_scope';

interface VariantProjectScopeResolution {
  variantId: string;
  generationId: string | null;
  projectId: string | null;
  status: VariantProjectScopeStatus;
  queryError?: string;
}

interface GenerationTaskRepositoryOptions {
  projectId?: string;
}

function scopeFor(expectedProjectId?: string): string | null {
  return expectedProjectId ?? getProjectSelectionFallbackId();
}

function isMissing(error: unknown): boolean {
  return error instanceof BridgeRouteError && error.status === 404;
}

export async function resolveGenerationProjectScope(
  generationId: string,
  expectedProjectId?: string,
): Promise<GenerationProjectScopeResolution> {
  const projectId = scopeFor(expectedProjectId);
  if (!projectId) return { generationId, projectId: null, status: 'missing_project_scope' };
  try {
    const detail = await new AstridLocalClient({ projectSlug: projectId }).gallery.get(generationId);
    if (detail.project_id !== projectId) {
      return { generationId, projectId: detail.project_id, status: 'scope_mismatch' };
    }
    return { generationId, projectId: detail.project_id, status: 'ok' };
  } catch (error) {
    return isMissing(error)
      ? { generationId, projectId: null, status: 'missing_generation' }
      : { generationId, projectId: null, status: 'query_failed', queryError: error instanceof Error ? error.message : String(error) };
  }
}

export async function resolveVariantProjectScope(
  variantId: string,
  expectedProjectId?: string,
): Promise<VariantProjectScopeResolution> {
  const projectId = scopeFor(expectedProjectId);
  if (!projectId) return { variantId, generationId: null, projectId: null, status: 'missing_project_scope' };
  const client = new AstridLocalClient({ projectSlug: projectId });
  try {
    let cursor: string | undefined;
    do {
      const page = await client.gallery.list({ limit: 200, cursor });
      for (const summary of page.generations) {
        const detail = await client.gallery.get(summary.generation_id);
        if (detail.variants.some((variant) => variant.id === variantId)) {
          return {
            variantId,
            generationId: detail.generation_id,
            projectId: detail.project_id,
            status: detail.project_id === projectId ? 'ok' : 'scope_mismatch',
          };
        }
      }
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return { variantId, generationId: null, projectId, status: 'missing_variant' };
  } catch (error) {
    return { variantId, generationId: null, projectId, status: 'query_failed', queryError: error instanceof Error ? error.message : String(error) };
  }
}

export async function resolveGenerationTaskMapping(
  generationId: string,
  options?: GenerationTaskRepositoryOptions,
): Promise<GenerationTaskMapping> {
  const mappings = await resolveGenerationTaskMappings([generationId], options);
  return mappings.get(generationId) ?? { generationId, taskId: null, status: 'missing_generation' };
}

export async function resolveGenerationTaskMappings(
  generationIds: string[],
  options?: GenerationTaskRepositoryOptions,
): Promise<Map<string, GenerationTaskMapping>> {
  const requestedIds = Array.from(new Set(generationIds));
  const mappings = new Map<string, GenerationTaskMapping>();
  const projectId = scopeFor(options?.projectId);

  for (const generationId of requestedIds) {
    if (!isUuid(generationId)) {
      mappings.set(generationId, { generationId, taskId: null, status: 'not_loaded' });
      continue;
    }
    if (!projectId) {
      mappings.set(generationId, { generationId, taskId: null, status: 'query_failed', queryError: 'No Astrid project is selected.' });
      continue;
    }
    try {
      const detail = await new AstridLocalClient({ projectSlug: projectId }).gallery.get(generationId);
      mappings.set(generationId, detail.project_id !== projectId
        ? { generationId, taskId: null, status: 'scope_mismatch' }
        : { generationId, taskId: detail.task_id ?? null, status: 'ok' });
    } catch (error) {
      mappings.set(generationId, isMissing(error)
        ? { generationId, taskId: null, status: 'missing_generation' }
        : { generationId, taskId: null, status: 'query_failed', queryError: error instanceof Error ? error.message : String(error) });
    }
  }
  return mappings;
}

export function toGenerationTaskMappingCacheEntry(
  mapping: GenerationTaskMapping | undefined,
): GenerationTaskMappingCacheEntry {
  return {
    taskId: mapping?.taskId ?? null,
    status: mapping?.status ?? 'not_loaded',
    ...(mapping?.queryError ? { queryError: mapping.queryError } : {}),
  };
}
