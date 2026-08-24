import type { AuthoredVideoMetadata } from '@/shared/lib/media/videoMetadata';
import { resolveStructureGuidanceControls } from '@/shared/lib/tasks/structureGuidance';
import {
  resolveTravelGuidanceControls,
  type TravelGuidanceMode,
} from '@/shared/lib/tasks/travelGuidance';
import {
  DEFAULT_STRUCTURE_GUIDANCE_CONTROLS,
  DEFAULT_STRUCTURE_VIDEO,
} from './defaults';
import type { StructureGuidanceConfig, TravelGuidance } from './taskTypes';
import type { StructureVideoConfigWithLegacyGuidance, StructureVideoConfigWithMetadata as StructureVideoWithMetadata } from './uiTypes';

export interface PrimaryStructureVideo {
  path: string | null;
  metadata: AuthoredVideoMetadata | null;
  treatment: 'adjust' | 'clip';
  motionStrength: number;
  structureType: TravelGuidanceMode;
  uni3cEndPercent: number;
}

/**
 * Derive the editor's primary structure video from canonical structureVideos[0].
 * Legacy field migration is handled upstream in data loading hooks.
 */
export function resolvePrimaryStructureVideo(
  structureVideos?: StructureVideoWithMetadata[] | null,
  guidance?: StructureGuidanceConfig | TravelGuidance | null,
): PrimaryStructureVideo {
  const primary = structureVideos?.[0] as StructureVideoConfigWithLegacyGuidance | undefined;
  const travelControls = guidance && 'kind' in guidance
    ? resolveTravelGuidanceControls(guidance, {
        defaultMode: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.structureType,
        defaultStrength: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.motionStrength,
        defaultUni3cEndPercent: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.uni3cEndPercent,
      })
    : null;
  const structureControls = guidance && !('kind' in guidance)
    ? resolveStructureGuidanceControls(guidance, {
        defaultStructureType: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.structureType,
        defaultMotionStrength: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.motionStrength,
        defaultUni3cEndPercent: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.uni3cEndPercent,
      })
    : null;

  return {
    path: primary?.path ?? null,
    metadata: primary?.metadata ?? null,
    treatment: primary?.treatment ?? DEFAULT_STRUCTURE_VIDEO.treatment,
    motionStrength: travelControls?.strength
      ?? structureControls?.motionStrength
      ?? primary?.motion_strength
      ?? DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.motionStrength,
    structureType: travelControls?.mode
      ?? structureControls?.structureType
      ?? primary?.structure_type
      ?? DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.structureType,
    uni3cEndPercent: travelControls?.uni3cEndPercent
      ?? structureControls?.uni3cEndPercent
      ?? primary?.uni3c_end_percent
      ?? DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.uni3cEndPercent,
  };
}
