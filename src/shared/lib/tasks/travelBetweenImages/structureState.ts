import { normalizeStructureGuidance } from '@/shared/lib/tasks/structureGuidance';
import { resolveTravelGuidanceState } from '@/shared/lib/tasks/travelGuidance';
import type { StructureGuidanceConfig } from './taskTypes';
import type {
  StructureVideoConfigWithLegacyGuidance,
  StructureVideoConfigWithMetadata,
} from './uiTypes';
import { migrateLegacyStructureVideos } from './legacyStructureVideo';
import type { VideoMetadata } from '@/shared/lib/media/videoMetadata';

type StructureType = 'uni3c' | 'flow' | 'canny' | 'depth';

interface ResolveTravelStructureStateOptions {
  defaultEndFrame: number;
  defaultVideoTreatment: 'adjust' | 'clip';
  defaultMotionStrength: number;
  defaultStructureType: StructureType;
  defaultUni3cEndPercent: number;
}

export interface ResolvedTravelStructureState {
  structureVideos: StructureVideoConfigWithMetadata[];
  structureGuidance?: StructureGuidanceConfig;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseTreatment(value: unknown): 'adjust' | 'clip' | undefined {
  return value === 'adjust' || value === 'clip' ? value : undefined;
}

function parseVideoMetadata(value: unknown): VideoMetadata | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const durationSeconds = parseNumber(record.duration_seconds);
  const frameRate = parseNumber(record.frame_rate);
  const totalFrames = parseNumber(record.total_frames);
  const width = parseNumber(record.width);
  const height = parseNumber(record.height);
  const fileSize = parseNumber(record.file_size);
  if (
    durationSeconds === undefined
    || frameRate === undefined
    || totalFrames === undefined
    || width === undefined
    || height === undefined
    || fileSize === undefined
  ) {
    return null;
  }

  return {
    duration_seconds: durationSeconds,
    frame_rate: frameRate,
    total_frames: totalFrames,
    width,
    height,
    file_size: fileSize,
  };
}

function buildMigrationInput(value: Record<string, unknown>): Record<string, unknown> {
  const structureVideos = value.structure_videos ?? value.structureVideos;
  if (Array.isArray(structureVideos)) {
    return {
      ...value,
      structure_videos: structureVideos,
    };
  }

  const structureVideo = asRecord(value.structureVideo);
  if (structureVideo) {
    return structureVideo;
  }

  return value;
}

function mergeStructureVideos(
  rawVideos: StructureVideoConfigWithLegacyGuidance[],
  structureGuidance: StructureGuidanceConfig | undefined,
  options: ResolveTravelStructureStateOptions,
): StructureVideoConfigWithMetadata[] {
  const guidanceRecord = asRecord(structureGuidance);
  const guidanceVideos = Array.isArray(guidanceRecord?.videos)
    ? guidanceRecord.videos
        .map((video) => asRecord(video))
        .filter((video): video is Record<string, unknown> => !!video)
    : [];
  const sourceVideos = guidanceVideos.length > 0 ? guidanceVideos : rawVideos;

  return sourceVideos
    .map((video, index): StructureVideoConfigWithMetadata | null => {
      const path = parseString(video.path);
      if (!path) {
        return null;
      }

      const rawVideo = rawVideos[index];
      return {
        path,
        start_frame: parseNumber(video.start_frame) ?? rawVideo?.start_frame ?? 0,
        end_frame: parseNumber(video.end_frame) ?? rawVideo?.end_frame ?? options.defaultEndFrame,
        treatment: parseTreatment(video.treatment) ?? rawVideo?.treatment ?? options.defaultVideoTreatment,
        ...(parseNumber(video.source_start_frame) !== undefined || rawVideo?.source_start_frame !== undefined
          ? { source_start_frame: parseNumber(video.source_start_frame) ?? rawVideo?.source_start_frame }
          : {}),
        ...(video.source_end_frame === null || rawVideo?.source_end_frame === null || parseNumber(video.source_end_frame) !== undefined || rawVideo?.source_end_frame !== undefined
          ? { source_end_frame: parseNumber(video.source_end_frame) ?? rawVideo?.source_end_frame ?? null }
          : {}),
        metadata: rawVideo?.metadata ?? null,
        resource_id: rawVideo?.resource_id ?? null,
      } satisfies StructureVideoConfigWithMetadata;
    })
    .filter((video): video is StructureVideoConfigWithMetadata => video !== null);
}

export function resolveTravelStructureState(
  value: unknown,
  options: ResolveTravelStructureStateOptions,
): ResolvedTravelStructureState {
  const settings = asRecord(value);
  if (!settings) {
    return { structureVideos: [] };
  }

  // structure_videos: [] is an explicit removal — don't reconstruct from stale guidance
  if (Array.isArray(settings.structure_videos) && settings.structure_videos.length === 0) {
    return { structureVideos: [] };
  }

  const modelName = parseString(settings.model_name) ?? parseString(settings.modelName);
  const directTravelState = resolveTravelGuidanceState({
    modelName,
    travelGuidance: settings.travel_guidance ?? settings.travelGuidance,
    defaultVideoTreatment: options.defaultVideoTreatment,
    defaultUni3cEndPercent: options.defaultUni3cEndPercent,
  });
  if (directTravelState.travelGuidance) {
    // Merge metadata/resource_id from the raw structure_videos array back onto
    // the travel-guidance-derived videos (travel_guidance strips these fields).
    const rawStructureVideos = Array.isArray(settings.structure_videos)
      ? settings.structure_videos
          .map((video) => asRecord(video))
          .filter((video): video is Record<string, unknown> => !!video)
      : [];
    const enrichedVideos: StructureVideoConfigWithMetadata[] = directTravelState.structureVideos.map((video) => {
      const rawMatch = rawStructureVideos.find((raw) => raw.path === video.path);
      return {
        ...video,
        metadata: parseVideoMetadata(rawMatch?.metadata),
        resource_id: parseString(rawMatch?.resource_id) ?? null,
      };
    });

    return {
      structureVideos: enrichedVideos,
      ...(directTravelState.structureGuidance ? { structureGuidance: directTravelState.structureGuidance } : {}),
    };
  }

  const migratedStructureVideos = migrateLegacyStructureVideos(
    buildMigrationInput(settings),
    {
      defaultEndFrame: options.defaultEndFrame,
      defaultVideoTreatment: options.defaultVideoTreatment,
      defaultMotionStrength: options.defaultMotionStrength,
      defaultStructureType: options.defaultStructureType,
      defaultUni3cEndPercent: options.defaultUni3cEndPercent,
    },
  );

  const structureGuidance = normalizeStructureGuidance({
    structureGuidance: settings.structure_guidance ?? settings.structureGuidance,
    structureVideos: migratedStructureVideos,
    defaultVideoTreatment: options.defaultVideoTreatment,
    defaultUni3cEndPercent: options.defaultUni3cEndPercent,
  }) as StructureGuidanceConfig | undefined;

  const structureVideos = mergeStructureVideos(
    migratedStructureVideos,
    structureGuidance,
    options,
  );

  return {
    structureVideos,
    ...(structureGuidance ? { structureGuidance } : {}),
  };
}
