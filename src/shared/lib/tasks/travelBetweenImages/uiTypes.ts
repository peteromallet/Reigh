import type { StructureVideoConfig } from './taskTypes';

/**
 * Editor-facing structure-video model with local metadata and UI-only control
 * metadata. Guidance controls are modeled separately through canonical `travel_guidance`.
 */
export interface StructureVideoConfigWithMetadata extends StructureVideoConfig {
  metadata?: import('@/shared/lib/media/videoMetadata').VideoMetadata | null;
  resource_id?: string | null;
}

/**
 * Compatibility read shape for legacy or shared payloads that still inline
 * guidance controls onto the first structure video.
 */
export interface StructureVideoConfigWithLegacyGuidance extends StructureVideoConfigWithMetadata {
  motion_strength?: number;
  structure_type?: 'uni3c' | 'flow' | 'canny' | 'depth';
  uni3c_start_percent?: number;
  uni3c_end_percent?: number;
}
