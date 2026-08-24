import type { PersistedGenerationRow } from './generationRow';
import type { Json } from '@/integrations/supabase/jsonTypes';

/**
 * Transport aliases that appear on DB/API payloads.
 * Keep these outside the domain contract and map explicitly at boundaries.
 */
interface GenerationRowLegacyAliases {
  thumbnail_url?: string | null; // DB column name (alias for thumbUrl)
  created_at?: string; // DB column name
  shotImageEntryId?: string; // Legacy alias for shot_generations id
  shot_generation_id?: string; // Legacy snake_case alias for shotImageEntryId
  variant_name?: string;
}

/** Database/API shape before JSON fields are mapped into domain contracts. */
export type GenerationRowDto = Omit<PersistedGenerationRow, 'params'>
  & Partial<GenerationRowLegacyAliases>
  & { params?: Json | null };
