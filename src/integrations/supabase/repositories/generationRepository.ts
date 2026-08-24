import type { GenerationRow } from '@/domains/generation/types';
import { AstridLocalClient } from '@/integrations/astrid/client';
import { BridgeRouteError } from '@/integrations/astrid/transport';
import type { BridgeGenerationDetailPayload } from '@/tools/video-editor/data/bridgeContract';
import { coerceGenerationRowDto, mapGenerationRowDtoToRow } from '@/domains/generation/mappers/generationRowMapper';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import {
  createRepositoryQueryError,
  createInvalidRowShapeError,
} from './repositoryErrors';

/**
 * Legacy generation-record shape the supabase layer used to return
 * (`Database['public']['Tables']['generations']['Row']` plus JSON extras).
 * Bridge detail rows are mapped INTO this shape so every downstream consumer
 * keeps its contract; display URLs are resolved to same-origin R9 content
 * routes at this boundary.
 */
export type GenerationRecord = {
  id: string;
  project_id?: string | null;
  location: string | null;
  thumbnail_url?: string | null;
  primary_variant_id?: string | null;
  storage_mode?: 'remote' | 'local' | 'uploading' | null;
  local_handle_id?: string | null;
  local_file_name?: string | null;
  local_file_size?: number | null;
  local_file_mime?: string | null;
  type?: string | null;
  created_at: string;
  updated_at?: string | null;
  params?: Record<string, unknown> | null;
  starred?: boolean | null;
  task_id?: string | null;
  based_on?: string | null;
  name?: string | null;
  is_child?: boolean | null;
  parent_generation_id?: string | null;
  child_order?: number | null;
  shot_data?: Record<string, (number | null)[]>;
} & Record<string, unknown>;

/**
 * The project slug scopes every bridge route. It is derived from the existing
 * project-selection context (the editor seeds it with the local-mode slug) —
 * no new singleton. Without a scope there is nothing to address.
 */
function resolveProjectSlug(): string | null {
  return getProjectSelectionFallbackId();
}

/** Document-native placements (`items`) back into the legacy shot_data map. */
function placementsToShotData(
  detail: BridgeGenerationDetailPayload['generation'],
): Record<string, (number | null)[]> {
  const shotData: Record<string, (number | null)[]> = {};
  for (const placement of detail.items ?? []) {
    const shotId = typeof placement.shot_id === 'string' ? placement.shot_id : null;
    if (!shotId) continue;
    const frame = typeof placement.timeline_frame === 'number' ? placement.timeline_frame : null;
    const frames = shotData[shotId] ?? (shotData[shotId] = []);
    frames.push(frame);
  }
  return shotData;
}

export function bridgeDetailToGenerationRecord(
  detail: BridgeGenerationDetailPayload['generation'],
  projectSlug: string,
): GenerationRecord {
  // Wire order is recency-first; the primary flag picks the displayed media.
  const primary = detail.variants.find((variant) => variant.is_primary) ?? detail.variants[0] ?? null;
  const primaryMediaUrl = primary ? bridgeMediaUrl(projectSlug, primary.media_id) : null;

  return {
    id: detail.generation_id,
    project_id: detail.project_id ?? null,
    location: primaryMediaUrl,
    thumbnail_url: primaryMediaUrl,
    primary_variant_id: primary?.id ?? null,
    storage_mode: 'remote',
    type: detail.type,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    params: detail.params ?? {},
    starred: detail.starred,
    task_id: detail.task_id ?? null,
    based_on: detail.based_on_generation_id ?? null,
    name: detail.name ?? null,
    is_child: detail.parent_generation_id !== null && detail.parent_generation_id !== undefined,
    parent_generation_id: detail.parent_generation_id ?? null,
    child_order: detail.child_order ?? null,
    shot_data: placementsToShotData(detail),
  };
}

async function fetchBridgeDetail(generationId: string): Promise<BridgeGenerationDetailPayload['generation'] | null> {
  const projectSlug = resolveProjectSlug();
  if (!projectSlug) {
    return null;
  }

  try {
    return await new AstridLocalClient({ projectSlug }).gallery.get(generationId);
  } catch (error) {
    if (error instanceof BridgeRouteError && error.status === 404) {
      return null;
    }
    throw createRepositoryQueryError('generation', error, { generationId });
  }
}

export async function fetchGenerationById(generationId: string): Promise<GenerationRow | null> {
  const detail = await fetchBridgeDetail(generationId);
  if (!detail) {
    return null;
  }

  const record = bridgeDetailToGenerationRecord(detail, resolveProjectSlug()!);
  const row = coerceGenerationRowDto(record as unknown as Record<string, unknown>);
  if (!row) {
    throw createInvalidRowShapeError('generation', { generationId });
  }

  return mapGenerationRowDtoToRow(row);
}

export async function fetchGenerationRecordById(generationId: string): Promise<GenerationRecord | null> {
  const detail = await fetchBridgeDetail(generationId);
  if (!detail) {
    return null;
  }

  return bridgeDetailToGenerationRecord(detail, resolveProjectSlug()!);
}
