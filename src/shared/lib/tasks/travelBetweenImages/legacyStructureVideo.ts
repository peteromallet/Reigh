import {
  parseAuthoredVideoMetadata,
  type AuthoredVideoMetadata,
} from '@/shared/lib/media/videoMetadata';
import { getDeprecationPolicy } from '@/shared/lib/governance/deprecationPolicy';
import { signalPastRemovalTargetUsage } from '@/shared/lib/governance/deprecationEnforcement';
import type { StructureVideoConfig } from './taskTypes';

const legacyStructurePolicy = getDeprecationPolicy('travel_structure_legacy');

/**
 * Compatibility shim for legacy travel-between-images payload fields.
 */

/** Legacy read-shape for structure videos used only at adapter boundaries. */
interface LegacyStructureVideoConfig extends StructureVideoConfig {
  /** @deprecated Use structure_guidance.strength instead */
  motion_strength?: number;
  /** @deprecated Use structure_guidance.target + preprocessing instead */
  structure_type?: 'uni3c' | 'flow' | 'canny' | 'depth';
  /** @deprecated Use structure_guidance.canny_intensity instead */
  canny_intensity?: number;
  /** @deprecated Use structure_guidance.depth_contrast instead */
  depth_contrast?: number;
  /** @deprecated Use structure_guidance.step_window[0] instead */
  uni3c_start_percent?: number;
  /** @deprecated Use structure_guidance.step_window[1] instead */
  uni3c_end_percent?: number;
}

export const LEGACY_TRAVEL_TOP_LEVEL_FIELDS = [
  'structure_video_path',
  'structure_video_treatment',
  'structure_video_motion_strength',
  'structure_video_type',
  'uni3c_start_percent',
  'uni3c_end_percent',
  'use_uni3c',
] as const;

export const LEGACY_TRAVEL_STRUCTURE_VIDEO_FIELDS = [
  'motion_strength',
  'structure_type',
  'uni3c_start_percent',
  'uni3c_end_percent',
] as const;

export type LegacyTopLevelField = (typeof LEGACY_TRAVEL_TOP_LEVEL_FIELDS)[number];
export type LegacyStructureVideoField = (typeof LEGACY_TRAVEL_STRUCTURE_VIDEO_FIELDS)[number];

type StructureVideoType = 'uni3c' | 'flow' | 'canny' | 'depth';

interface MigratedLegacyStructureVideo extends LegacyStructureVideoConfig {
  metadata?: AuthoredVideoMetadata | null;
  resource_id?: string | null;
}

interface LegacyStructureVideoMigrationOptions {
  defaultEndFrame: number;
  defaultVideoTreatment: 'adjust' | 'clip';
  defaultMotionStrength: number;
  defaultStructureType: StructureVideoType;
  defaultUni3cEndPercent: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseStructureType(value: unknown): StructureVideoType | undefined {
  return value === 'uni3c' || value === 'flow' || value === 'canny' || value === 'depth'
    ? value
    : undefined;
}

function parseTreatment(value: unknown): 'adjust' | 'clip' | undefined {
  return value === 'adjust' || value === 'clip' ? value : undefined;
}

function parseNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function hasLegacyField(
  value: unknown,
  field: string,
): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && field in (value as Record<string, unknown>)
    && (value as Record<string, unknown>)[field] !== undefined,
  );
}

interface TravelStructureLegacyUsage {
  topLevelFields: LegacyTopLevelField[];
  structureVideoFields: LegacyStructureVideoField[];
}

export function collectTravelStructureLegacyUsage(
  value: unknown,
): TravelStructureLegacyUsage {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  const topLevelFields = LEGACY_TRAVEL_TOP_LEVEL_FIELDS.filter(
    (field) => record[field] !== undefined,
  );

  const structureVideos = Array.isArray(record.structure_videos)
    ? record.structure_videos
    : [];
  const structureVideoFields = LEGACY_TRAVEL_STRUCTURE_VIDEO_FIELDS.filter((field) =>
    structureVideos.some((entry) => hasLegacyField(entry, field)),
  );

  return { topLevelFields, structureVideoFields };
}

export function enforceTravelStructureLegacyPolicy(
  usage: TravelStructureLegacyUsage,
  options?: {
    context?: string;
    enforcement?: 'warn' | 'throw' | 'auto';
  },
): boolean {
  const usedFields = [...usage.topLevelFields, ...usage.structureVideoFields];
  if (usedFields.length === 0) {
    return false;
  }

  const details = usedFields.join(', ');
  return signalPastRemovalTargetUsage({
    alias: 'travel_between_images.legacy_structure_fields',
    policy: legacyStructurePolicy,
    remediation: `Migrate to structure_guidance + canonical structure_videos. Legacy fields seen: ${details}.` +
      (options?.context ? ` Context: ${options.context}.` : ''),
    enforcement: options?.enforcement ?? 'auto',
  });
}

/**
 * Canonical migration adapter for legacy structure-video settings.
 * Preserves explicit structure_type values and only falls back to defaults
 * when legacy payloads omit type information.
 */
export function migrateLegacyStructureVideos(
  value: unknown,
  options: LegacyStructureVideoMigrationOptions,
): MigratedLegacyStructureVideo[] {
  const settings = asRecord(value);
  if (!settings) {
    return [];
  }

  const topLevelStructureType = parseStructureType(
    settings.structure_video_type ?? settings.structureType,
  );
  const topLevelTreatment = parseTreatment(
    settings.structure_video_treatment ?? settings.treatment,
  );
  const topLevelMotionStrength = parseNumber(
    settings.structure_video_motion_strength ?? settings.motionStrength,
  );
  const topLevelCannyIntensity = parseNumber(
    settings.structure_canny_intensity ?? settings.cannyIntensity,
  );
  const topLevelDepthContrast = parseNumber(
    settings.structure_depth_contrast ?? settings.depthContrast,
  );
  const topLevelUni3cStartPercent = parseNumber(
    settings.uni3c_start_percent ?? settings.uni3cStartPercent,
  );
  const topLevelUni3cEndPercent = parseNumber(
    settings.uni3c_end_percent ?? settings.uni3cEndPercent,
  );

  const rawStructureVideos = Array.isArray(settings.structure_videos)
    ? settings.structure_videos
    : null;
  if (rawStructureVideos) {
    return rawStructureVideos
      .map((entry): MigratedLegacyStructureVideo | null => {
        const record = asRecord(entry);
        if (!record) {
          return null;
        }

        const path = parseString(record.path);
        if (!path) {
          return null;
        }

        const resourceId = parseString(record.resource_id ?? record.resourceId);
        return {
          path,
          start_frame: parseNumber(record.start_frame ?? record.startFrame) ?? 0,
          end_frame: parseNumber(record.end_frame ?? record.endFrame) ?? options.defaultEndFrame,
          treatment: parseTreatment(record.treatment) ?? topLevelTreatment ?? options.defaultVideoTreatment,
          motion_strength: parseNumber(record.motion_strength ?? record.motionStrength) ?? topLevelMotionStrength ?? options.defaultMotionStrength,
          structure_type: parseStructureType(record.structure_type ?? record.structureType) ?? topLevelStructureType ?? options.defaultStructureType,
          ...(parseNumber(record.canny_intensity ?? record.cannyIntensity) !== undefined || topLevelCannyIntensity !== undefined
            ? { canny_intensity: parseNumber(record.canny_intensity ?? record.cannyIntensity) ?? topLevelCannyIntensity }
            : {}),
          ...(parseNumber(record.depth_contrast ?? record.depthContrast) !== undefined || topLevelDepthContrast !== undefined
            ? { depth_contrast: parseNumber(record.depth_contrast ?? record.depthContrast) ?? topLevelDepthContrast }
            : {}),
          ...(parseNumber(record.uni3c_start_percent ?? record.uni3cStartPercent) !== undefined || topLevelUni3cStartPercent !== undefined
            ? { uni3c_start_percent: parseNumber(record.uni3c_start_percent ?? record.uni3cStartPercent) ?? topLevelUni3cStartPercent }
            : {}),
          uni3c_end_percent: parseNumber(record.uni3c_end_percent ?? record.uni3cEndPercent) ?? topLevelUni3cEndPercent ?? options.defaultUni3cEndPercent,
          ...(parseNumber(record.source_start_frame ?? record.sourceStartFrame) !== undefined
            ? { source_start_frame: parseNumber(record.source_start_frame ?? record.sourceStartFrame) }
            : {}),
          ...(record.source_end_frame === null || record.sourceEndFrame === null || parseNumber(record.source_end_frame ?? record.sourceEndFrame) !== undefined
            ? { source_end_frame: parseNumber(record.source_end_frame ?? record.sourceEndFrame) ?? null }
            : {}),
          metadata: parseAuthoredVideoMetadata(record.metadata),
          resource_id: resourceId ?? null,
        } satisfies MigratedLegacyStructureVideo;
      })
      .filter((entry): entry is MigratedLegacyStructureVideo => entry !== null);
  }

  const singlePath = parseString(settings.structure_video_path ?? settings.path);
  if (!singlePath) {
    return [];
  }

  const resourceId = parseString(settings.resource_id ?? settings.resourceId);
  return [{
    path: singlePath,
    start_frame: parseNumber(settings.start_frame ?? settings.startFrame) ?? 0,
    end_frame: parseNumber(settings.end_frame ?? settings.endFrame) ?? options.defaultEndFrame,
    treatment: topLevelTreatment ?? options.defaultVideoTreatment,
    motion_strength: topLevelMotionStrength ?? options.defaultMotionStrength,
    structure_type: topLevelStructureType ?? options.defaultStructureType,
    ...(topLevelCannyIntensity !== undefined ? { canny_intensity: topLevelCannyIntensity } : {}),
    ...(topLevelDepthContrast !== undefined ? { depth_contrast: topLevelDepthContrast } : {}),
    ...(topLevelUni3cStartPercent !== undefined ? { uni3c_start_percent: topLevelUni3cStartPercent } : {}),
    uni3c_end_percent: topLevelUni3cEndPercent ?? options.defaultUni3cEndPercent,
    ...(parseNumber(settings.source_start_frame ?? settings.sourceStartFrame) !== undefined
      ? { source_start_frame: parseNumber(settings.source_start_frame ?? settings.sourceStartFrame) }
      : {}),
    ...(settings.source_end_frame === null || settings.sourceEndFrame === null || parseNumber(settings.source_end_frame ?? settings.sourceEndFrame) !== undefined
      ? { source_end_frame: parseNumber(settings.source_end_frame ?? settings.sourceEndFrame) ?? null }
      : {}),
    metadata: parseAuthoredVideoMetadata(settings.metadata),
    resource_id: resourceId ?? null,
  }];
}
