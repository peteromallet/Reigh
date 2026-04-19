import type { GenerationMetadata } from './generationMetadata';
import type { PersistedGenerationParams } from './generationParams';

/**
 * DB/API-facing generation shape.
 * - `id`: shot_generations.id (unique per entry in a shot)
 * - `generation_id`: generations.id (underlying generation record)
 */
export interface PersistedGenerationRow {
  id: string;
  generation_id?: string;
  variant_fetch_generation_id?: string | null;
  location?: string | null;
  thumbnail_url?: string | null;
  type?: string | null;
  createdAt?: string;
  created_at?: string;
  metadata?: GenerationMetadata | null;
  name?: string | null;
  variant_name?: string | null;
  timeline_frame?: number | null;
  starred?: boolean;
  based_on?: string | null;
  params?: PersistedGenerationParams;
  parent_generation_id?: string | null;
  is_child?: boolean;
  child_order?: number | null;
  pair_shot_generation_id?: string | null;
  primary_variant_id?: string | null;
  shotImageEntryId?: string;
  shot_generation_id?: string;
  source_task_id?: string | null;
}
