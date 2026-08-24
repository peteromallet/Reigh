import type { GenerationMetadata } from './generationMetadata';
import type { PersistedGenerationParams } from './generationParams';

/**
 * DB/API-facing generation shape.
 * - `id`: shot_generations.id (unique per entry in a shot)
 * - `generation_id`: generations.id (underlying generation record)
 */
export interface PersistedGenerationRow {
  id: string;
  /** Stable shot_generations identifier when the transport's id is a generation id. */
  shot_generation_id?: string | null;
  generation_id?: string;
  variant_fetch_generation_id?: string | null;
  location?: string | null;
  type?: string | null;
  createdAt?: string;
  metadata?: GenerationMetadata | null;
  name?: string | null;
  timeline_frame?: number | null;
  starred?: boolean;
  based_on?: string | null;
  params?: PersistedGenerationParams;
  parent_generation_id?: string | null;
  is_child?: boolean;
  child_order?: number | null;
  pair_shot_generation_id?: string | null;
  primary_variant_id?: string | null;
  source_task_id?: string | null;
}
