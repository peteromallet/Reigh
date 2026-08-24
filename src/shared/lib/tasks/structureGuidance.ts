import type {
  StructureGuidanceConfig,
  StructureGuidanceVideoConfig,
} from './travelBetweenImages/taskTypes';
import { asNumber, asRecord, asString, type UnknownRecord } from './taskParamParsers';

type GuidanceRecord = StructureGuidanceConfig & UnknownRecord;

const STRUCTURE_PREPROCESSING_MAP: Record<string, NonNullable<StructureGuidanceConfig['preprocessing']>> = {
  flow: 'flow',
  canny: 'canny',
  depth: 'depth',
  raw: 'none',
};

function normalizeTreatment(value: unknown, fallback: string): 'adjust' | 'clip' {
  if (value === 'clip' || fallback === 'clip') {
    return 'clip';
  }
  return 'adjust';
}

export interface StructureGuidanceControls {
  structureType: 'uni3c' | 'flow' | 'canny' | 'depth';
  motionStrength: number;
  uni3cStartPercent: number;
  uni3cEndPercent: number;
  cannyIntensity?: number;
  depthContrast?: number;
}

function asRecordArray(value: unknown): UnknownRecord[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const records = value
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => !!item);
  return records.length > 0 ? records : undefined;
}

function sanitizeStructureVideos(
  videos: UnknownRecord[],
  defaultVideoTreatment: string,
): StructureGuidanceVideoConfig[] {
  const fallbackTreatment = defaultVideoTreatment === 'clip' ? 'clip' : 'adjust';
  return videos
    .map((video): StructureGuidanceVideoConfig | null => {
      const path = asString(video.path);
      if (!path) {
        return null;
      }
      const metadata = asRecord(video.metadata);
      const resourceId = asString(video.resource_id);
      return {
        path,
        start_frame: asNumber(video.start_frame) ?? 0,
        end_frame: asNumber(video.end_frame) ?? null,
        treatment: asString(video.treatment) === 'clip' ? 'clip' : fallbackTreatment,
        ...(metadata ? { metadata } : {}),
        ...(resourceId ? { resource_id: resourceId } : {}),
      };
    })
    .filter((video): video is StructureGuidanceVideoConfig => video !== null);
}

function buildGuidanceFromVideos(
  videos: UnknownRecord[],
  options: {
    defaultVideoTreatment: string;
    defaultUni3cEndPercent: number;
  },
): GuidanceRecord | undefined {
  const cleanedVideos = sanitizeStructureVideos(
    videos,
    options.defaultVideoTreatment,
  );

  if (cleanedVideos.length === 0) {
    return undefined;
  }

  const firstVideo = videos[0];
  const structureType = asString(firstVideo.structure_type) ?? 'flow';
  const isUni3c = structureType === 'uni3c';

  const guidance: GuidanceRecord = {
    target: isUni3c ? 'uni3c' : 'vace',
    videos: cleanedVideos,
    strength: asNumber(firstVideo.motion_strength) ?? 1.0,
  };

  if (isUni3c) {
    guidance.step_window = [
      asNumber(firstVideo.uni3c_start_percent) ?? 0,
      asNumber(firstVideo.uni3c_end_percent) ?? options.defaultUni3cEndPercent,
    ];
    guidance.frame_policy = 'fit';
    guidance.zero_empty_frames = true;
    return guidance;
  }

  guidance.preprocessing = STRUCTURE_PREPROCESSING_MAP[structureType] ?? 'flow';
  const cannyIntensity = asNumber(firstVideo.canny_intensity);
  const depthContrast = asNumber(firstVideo.depth_contrast);
  if (cannyIntensity !== undefined) {
    guidance.canny_intensity = cannyIntensity;
  }
  if (depthContrast !== undefined) {
    guidance.depth_contrast = depthContrast;
  }
  return guidance;
}

function toStructureType(
  structureGuidance?: UnknownRecord,
): 'uni3c' | 'flow' | 'canny' | 'depth' {
  if (!structureGuidance) {
    return 'flow';
  }
  if (asString(structureGuidance.target) === 'uni3c') {
    return 'uni3c';
  }
  const preprocessing = asString(structureGuidance.preprocessing);
  if (preprocessing === 'canny' || preprocessing === 'depth') {
    return preprocessing;
  }
  return 'flow';
}

interface NormalizeStructureGuidanceInput {
  structureGuidance?: unknown;
  structureVideos?: unknown;
  structureVideoPath?: unknown;
  structureVideoTreatment?: unknown;
  structureVideoType?: unknown;
  structureVideoMotionStrength?: unknown;
  structureVideoCannyIntensity?: unknown;
  structureVideoDepthContrast?: unknown;
  useUni3c?: unknown;
  uni3cStartPercent?: unknown;
  uni3cEndPercent?: unknown;
  defaultVideoTreatment?: string;
  defaultUni3cEndPercent?: number;
}

export function normalizeStructureGuidance(
  input: NormalizeStructureGuidanceInput,
): UnknownRecord | undefined {
  const existingGuidance = asRecord(input.structureGuidance);
  if (existingGuidance) {
    return existingGuidance;
  }

  const defaultVideoTreatment = input.defaultVideoTreatment ?? 'adjust';
  const defaultUni3cEndPercent = input.defaultUni3cEndPercent ?? 0.1;

  const videos = asRecordArray(input.structureVideos);
  if (videos?.length) {
    return buildGuidanceFromVideos(videos, { defaultVideoTreatment, defaultUni3cEndPercent });
  }

  const structureVideoPath = asString(input.structureVideoPath);
  if (!structureVideoPath) {
    return undefined;
  }

  const structureType = asString(input.structureVideoType) ?? (input.useUni3c ? 'uni3c' : 'flow');
  const isUni3c = structureType === 'uni3c';
  const guidance: GuidanceRecord = {
    target: isUni3c ? 'uni3c' : 'vace',
    videos: [{
      path: structureVideoPath,
      start_frame: 0,
      end_frame: null,
      treatment: normalizeTreatment(input.structureVideoTreatment, defaultVideoTreatment),
    }],
    strength: asNumber(input.structureVideoMotionStrength) ?? 1.0,
  };

  if (isUni3c) {
    guidance.step_window = [
      asNumber(input.uni3cStartPercent) ?? 0,
      asNumber(input.uni3cEndPercent) ?? defaultUni3cEndPercent,
    ];
    guidance.frame_policy = 'fit';
    guidance.zero_empty_frames = true;
    return guidance;
  }

  guidance.preprocessing = STRUCTURE_PREPROCESSING_MAP[structureType] ?? 'flow';
  const cannyIntensity = asNumber(input.structureVideoCannyIntensity);
  const depthContrast = asNumber(input.structureVideoDepthContrast);
  if (cannyIntensity !== undefined) {
    guidance.canny_intensity = cannyIntensity;
  }
  if (depthContrast !== undefined) {
    guidance.depth_contrast = depthContrast;
  }
  return guidance;
}

interface ResolveStructureGuidanceControlsOptions {
  defaultStructureType?: 'uni3c' | 'flow' | 'canny' | 'depth';
  defaultMotionStrength?: number;
  defaultUni3cEndPercent?: number;
}

export function resolveStructureGuidanceControls(
  structureGuidance: unknown,
  options: ResolveStructureGuidanceControlsOptions = {},
): StructureGuidanceControls {
  const guidance = asRecord(structureGuidance);
  const defaultStructureType = options.defaultStructureType ?? 'flow';
  const structureType = guidance ? toStructureType(guidance) : defaultStructureType;
  const stepWindow = Array.isArray(guidance?.step_window) ? guidance?.step_window : [];

  return {
    structureType,
    motionStrength: asNumber(guidance?.strength) ?? options.defaultMotionStrength ?? 1,
    uni3cStartPercent: typeof stepWindow[0] === 'number' ? stepWindow[0] : 0,
    uni3cEndPercent: typeof stepWindow[1] === 'number'
      ? stepWindow[1]
      : (options.defaultUni3cEndPercent ?? 0.1),
    cannyIntensity: structureType === 'canny' ? asNumber(guidance?.canny_intensity) : undefined,
    depthContrast: structureType === 'depth' ? asNumber(guidance?.depth_contrast) : undefined,
  };
}

interface BuildStructureGuidanceFromControlsInput {
  structureVideos?: unknown;
  controls: StructureGuidanceControls;
  defaultVideoTreatment?: string;
  defaultUni3cEndPercent?: number;
}

export function buildStructureGuidanceFromControls(
  input: BuildStructureGuidanceFromControlsInput,
): StructureGuidanceConfig | undefined {
  const videos = asRecordArray(input.structureVideos);
  if (!videos?.length) {
    return undefined;
  }

  const cleanedVideos = sanitizeStructureVideos(
    videos,
    input.defaultVideoTreatment ?? 'adjust',
  );
  if (cleanedVideos.length === 0) {
    return undefined;
  }

  const guidance: GuidanceRecord = {
    target: input.controls.structureType === 'uni3c' ? 'uni3c' : 'vace',
    videos: cleanedVideos,
    strength: input.controls.motionStrength,
  };

  if (input.controls.structureType === 'uni3c') {
    guidance.step_window = [
      input.controls.uni3cStartPercent,
      input.controls.uni3cEndPercent,
    ];
    guidance.frame_policy = 'fit';
    guidance.zero_empty_frames = true;
    return guidance;
  }

  guidance.preprocessing = STRUCTURE_PREPROCESSING_MAP[input.controls.structureType] ?? 'flow';
  if (input.controls.structureType === 'canny' && input.controls.cannyIntensity !== undefined) {
    guidance.canny_intensity = input.controls.cannyIntensity;
  }
  if (input.controls.structureType === 'depth' && input.controls.depthContrast !== undefined) {
    guidance.depth_contrast = input.controls.depthContrast;
  }

  return guidance;
}

export function pickFirstStructureGuidance(...candidates: unknown[]): UnknownRecord | undefined {
  for (const candidate of candidates) {
    const parsed = asRecord(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}
