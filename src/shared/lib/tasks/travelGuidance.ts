import type {
  StructureGuidanceConfig,
  StructureVideoConfig,
  TravelGuidance,
  TravelGuidanceVideoConfig,
} from './travelBetweenImages/taskTypes';
import { normalizeStructureGuidance } from './structureGuidance';
import { asNumber, asRecord, asString, type UnknownRecord } from './taskParamParsers';

export type TravelGuidanceMode = 'uni3c' | 'flow' | 'canny' | 'depth' | 'raw' | 'pose' | 'video' | 'cameraman';

export interface TravelGuidanceControls {
  mode: TravelGuidanceMode;
  strength: number;
  uni3cEndPercent: number;
  cannyIntensity?: number;
  depthContrast?: number;
}

interface NormalizeTravelGuidanceInput {
  modelName?: string;
  travelGuidance?: unknown;
  structureGuidance?: unknown;
  structureVideos?: unknown;
  defaultVideoTreatment?: 'adjust' | 'clip';
  defaultUni3cEndPercent?: number;
}

interface ResolvedTravelStructureState {
  travelGuidance?: TravelGuidance;
  structureGuidance?: StructureGuidanceConfig;
  structureVideos: StructureVideoConfig[];
}

interface ResolveTravelGuidanceControlsOptions {
  defaultMode?: TravelGuidanceMode;
  defaultStrength?: number;
  defaultUni3cEndPercent?: number;
}

interface BuildTravelGuidanceFromControlsInput {
  modelName?: string;
  controls: TravelGuidanceControls;
  structureVideos?: unknown;
  defaultVideoTreatment?: 'adjust' | 'clip';
}

const WAN_GUIDANCE_MODES: TravelGuidanceMode[] = ['flow', 'canny', 'depth', 'raw', 'uni3c'];
const DISTILLED_LTX_GUIDANCE_MODES: TravelGuidanceMode[] = ['video', 'pose', 'depth', 'canny', 'cameraman'];

function sanitizeTreatment(
  value: unknown,
  defaultVideoTreatment: 'adjust' | 'clip',
): 'adjust' | 'clip' {
  if (value === 'adjust' || value === 'clip') {
    return value;
  }

  return defaultVideoTreatment;
}

function sanitizeVideos(
  value: unknown,
  defaultVideoTreatment: 'adjust' | 'clip',
): TravelGuidanceVideoConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const record = asRecord(entry);
      const path = asString(record?.path);
      if (!record || !path) {
        return null;
      }

      const endFrame = asNumber(record.end_frame);
      const sourceEndFrame = record.source_end_frame === null
        ? null
        : asNumber(record.source_end_frame);

      const video: TravelGuidanceVideoConfig = {
        path,
        ...(asNumber(record.start_frame) !== undefined ? { start_frame: asNumber(record.start_frame) } : {}),
        ...(endFrame !== undefined || record.end_frame === null ? { end_frame: endFrame ?? null } : {}),
        treatment: sanitizeTreatment(record.treatment, defaultVideoTreatment),
        ...(asNumber(record.source_start_frame) !== undefined
          ? { source_start_frame: asNumber(record.source_start_frame) }
          : {}),
        ...(sourceEndFrame !== undefined || record.source_end_frame === null
          ? { source_end_frame: sourceEndFrame ?? null }
          : {}),
      };
      return video;
    })
    .filter((entry): entry is TravelGuidanceVideoConfig => entry !== null);
}

export function isLtxModelName(modelName?: string): boolean {
  return typeof modelName === 'string' && modelName.toLowerCase().includes('ltx');
}

export function isDistilledLtxModelName(modelName?: string): boolean {
  if (!isLtxModelName(modelName)) {
    return false;
  }

  const normalized = modelName?.toLowerCase() ?? '';
  return normalized.includes('distilled') || normalized.includes('fast');
}

export function getSupportedTravelGuidanceModes(modelName?: string): TravelGuidanceMode[] {
  if (isDistilledLtxModelName(modelName)) {
    return DISTILLED_LTX_GUIDANCE_MODES;
  }

  if (isLtxModelName(modelName)) {
    return [];
  }

  return WAN_GUIDANCE_MODES;
}

export function getDefaultTravelGuidanceMode(modelName?: string): TravelGuidanceMode {
  if (isDistilledLtxModelName(modelName)) {
    return 'video';
  }

  return 'flow';
}

export function getDefaultTravelGuidanceStrength(
  modelName?: string,
  mode?: TravelGuidanceMode,
): number {
  if (mode === 'uni3c') {
    return 1;
  }

  if (isDistilledLtxModelName(modelName)) {
    return mode === 'video' || mode === 'cameraman' ? 1 : 0.5;
  }

  return 1;
}

function isGuidanceModeSupportedForModel(
  mode: TravelGuidanceMode,
  modelName?: string,
): boolean {
  return getSupportedTravelGuidanceModes(modelName).includes(mode);
}

function isTravelGuidanceAllowedForModel(
  guidance: TravelGuidance,
  modelName?: string,
): boolean {
  if (guidance.kind === 'none') {
    return true;
  }

  if (guidance.kind === 'uni3c') {
    return isGuidanceModeSupportedForModel('uni3c', modelName) || isDistilledLtxModelName(modelName);
  }

  if (guidance.kind === 'ltx_control') {
    return isDistilledLtxModelName(modelName)
      && isGuidanceModeSupportedForModel(guidance.mode, modelName);
  }

  if (guidance.kind === 'vace') {
    return !isLtxModelName(modelName)
      && isGuidanceModeSupportedForModel(guidance.mode, modelName);
  }

  return false;
}

function buildTravelGuidanceFromLegacy(
  structureGuidance: StructureGuidanceConfig | undefined,
  structureVideos: TravelGuidanceVideoConfig[],
  modelName?: string,
): TravelGuidance | undefined {
  if (!structureGuidance || structureVideos.length === 0) {
    return undefined;
  }

  if (structureGuidance.target === 'uni3c') {
    return {
      kind: 'uni3c',
      videos: structureVideos,
      ...(structureGuidance.strength !== undefined ? { strength: structureGuidance.strength } : {}),
      ...(Array.isArray(structureGuidance.step_window) ? { step_window: structureGuidance.step_window } : {}),
      ...(structureGuidance.frame_policy ? { frame_policy: structureGuidance.frame_policy } : {}),
      ...(structureGuidance.zero_empty_frames !== undefined ? { zero_empty_frames: structureGuidance.zero_empty_frames } : {}),
    };
  }

  if (isLtxModelName(modelName)) {
    if (!isDistilledLtxModelName(modelName)) {
      return undefined;
    }

    const mode = structureGuidance.preprocessing === 'canny'
      ? 'canny'
      : structureGuidance.preprocessing === 'depth'
        ? 'depth'
        : 'video';

    return {
      kind: 'ltx_control',
      mode,
      videos: structureVideos,
      ...(structureGuidance.strength !== undefined ? { strength: structureGuidance.strength } : {}),
    };
  }

  const mode = structureGuidance.preprocessing === 'canny'
    ? 'canny'
    : structureGuidance.preprocessing === 'depth'
      ? 'depth'
      : structureGuidance.preprocessing === 'none'
        ? 'raw'
        : 'flow';

  return {
    kind: 'vace',
    mode,
    videos: structureVideos,
    ...(structureGuidance.strength !== undefined ? { strength: structureGuidance.strength } : {}),
    ...(structureGuidance.canny_intensity !== undefined ? { canny_intensity: structureGuidance.canny_intensity } : {}),
    ...(structureGuidance.depth_contrast !== undefined ? { depth_contrast: structureGuidance.depth_contrast } : {}),
  };
}

function sanitizeTravelGuidance(
  input: unknown,
  defaultVideoTreatment: 'adjust' | 'clip',
  modelName?: string,
): TravelGuidance | undefined {
  const record = asRecord(input);
  const kind = asString(record?.kind);
  if (!record || !kind) {
    return undefined;
  }

  if (kind === 'none') {
    return { kind: 'none' };
  }

  const videos = sanitizeVideos(record.videos, defaultVideoTreatment);
  if (videos.length === 0) {
    return undefined;
  }

  if (kind === 'vace') {
    const mode = asString(record.mode);
    if (mode !== 'flow' && mode !== 'canny' && mode !== 'depth' && mode !== 'raw') {
      return undefined;
    }
    const guidance: TravelGuidance = {
      kind,
      mode,
      videos,
      ...(asNumber(record.strength) !== undefined ? { strength: asNumber(record.strength) } : {}),
      ...(asNumber(record.canny_intensity) !== undefined ? { canny_intensity: asNumber(record.canny_intensity) } : {}),
      ...(asNumber(record.depth_contrast) !== undefined ? { depth_contrast: asNumber(record.depth_contrast) } : {}),
    };
    return isTravelGuidanceAllowedForModel(guidance, modelName) ? guidance : undefined;
  }

  if (kind === 'ltx_control') {
    const mode = asString(record.mode);
    if (mode !== 'pose' && mode !== 'depth' && mode !== 'canny' && mode !== 'video' && mode !== 'cameraman') {
      return undefined;
    }
    const guidance: TravelGuidance = {
      kind,
      mode,
      videos,
      ...(asNumber(record.strength) !== undefined ? { strength: asNumber(record.strength) } : {}),
    };
    return isTravelGuidanceAllowedForModel(guidance, modelName) ? guidance : undefined;
  }

  if (kind === 'uni3c') {
    const rawStepWindow = record.step_window;
    const stepWindow = Array.isArray(rawStepWindow)
      && rawStepWindow.length >= 2
      && typeof rawStepWindow[0] === 'number'
      && typeof rawStepWindow[1] === 'number'
      ? [rawStepWindow[0], rawStepWindow[1]] as [number, number]
      : undefined;

    const guidance: TravelGuidance = {
      kind,
      videos,
      ...(asNumber(record.strength) !== undefined ? { strength: asNumber(record.strength) } : {}),
      ...(stepWindow ? { step_window: stepWindow } : {}),
      ...(record.frame_policy === 'fit' || record.frame_policy === 'clip'
        ? { frame_policy: record.frame_policy }
        : {}),
      ...(typeof record.zero_empty_frames === 'boolean' ? { zero_empty_frames: record.zero_empty_frames } : {}),
      ...(typeof record.keep_on_gpu === 'boolean' ? { keep_on_gpu: record.keep_on_gpu } : {}),
    };
    return isTravelGuidanceAllowedForModel(guidance, modelName) ? guidance : undefined;
  }

  return undefined;
}

export function normalizeTravelGuidance({
  modelName,
  travelGuidance,
  structureGuidance,
  structureVideos,
  defaultVideoTreatment = 'adjust',
  defaultUni3cEndPercent = 0.1,
}: NormalizeTravelGuidanceInput): TravelGuidance | undefined {
  const direct = sanitizeTravelGuidance(travelGuidance, defaultVideoTreatment, modelName);
  if (direct) {
    return direct;
  }

  const normalizedStructureGuidance = normalizeStructureGuidance({
    structureGuidance,
    structureVideos,
    defaultVideoTreatment,
    defaultUni3cEndPercent,
  }) as StructureGuidanceConfig | undefined;
  const videos = sanitizeVideos(structureVideos, defaultVideoTreatment);

  return buildTravelGuidanceFromLegacy(normalizedStructureGuidance, videos, modelName);
}

export function resolveTravelGuidanceControls(
  travelGuidance: TravelGuidance | undefined,
  options: ResolveTravelGuidanceControlsOptions = {},
  modelName?: string,
): TravelGuidanceControls {
  const fallbackMode = options.defaultMode ?? getDefaultTravelGuidanceMode(modelName);
  const fallbackStrength = options.defaultStrength ?? getDefaultTravelGuidanceStrength(modelName, fallbackMode);
  const fallbackUni3cEndPercent = options.defaultUni3cEndPercent ?? 0.1;

  if (!travelGuidance || travelGuidance.kind === 'none') {
    return {
      mode: fallbackMode,
      strength: fallbackStrength,
      uni3cEndPercent: fallbackUni3cEndPercent,
    };
  }

  if (travelGuidance.kind === 'uni3c') {
    return {
      mode: 'uni3c',
      strength: travelGuidance.strength ?? getDefaultTravelGuidanceStrength(modelName, 'uni3c'),
      uni3cEndPercent: travelGuidance.step_window?.[1] ?? fallbackUni3cEndPercent,
    };
  }

  if (travelGuidance.kind === 'ltx_control') {
    return {
      mode: travelGuidance.mode,
      strength: travelGuidance.strength ?? getDefaultTravelGuidanceStrength(modelName, travelGuidance.mode),
      uni3cEndPercent: fallbackUni3cEndPercent,
    };
  }

  return {
    mode: travelGuidance.mode,
    strength: travelGuidance.strength ?? getDefaultTravelGuidanceStrength(modelName, travelGuidance.mode),
    uni3cEndPercent: fallbackUni3cEndPercent,
    cannyIntensity: travelGuidance.mode === 'canny' ? travelGuidance.canny_intensity : undefined,
    depthContrast: travelGuidance.mode === 'depth' ? travelGuidance.depth_contrast : undefined,
  };
}

export function buildTravelGuidanceFromControls({
  modelName,
  controls,
  structureVideos,
  defaultVideoTreatment = 'adjust',
}: BuildTravelGuidanceFromControlsInput): TravelGuidance | undefined {
  const videos = sanitizeVideos(structureVideos, defaultVideoTreatment);
  if (videos.length === 0) {
    return undefined;
  }

  if (!isGuidanceModeSupportedForModel(controls.mode, modelName)) {
    return undefined;
  }

  if (controls.mode === 'uni3c') {
    return {
      kind: 'uni3c',
      videos,
      strength: controls.strength,
      step_window: [0, controls.uni3cEndPercent],
      frame_policy: 'fit',
      zero_empty_frames: true,
    };
  }

  if (isDistilledLtxModelName(modelName)) {
    if (controls.mode !== 'video' && controls.mode !== 'pose' && controls.mode !== 'depth' && controls.mode !== 'canny' && controls.mode !== 'cameraman') {
      return undefined;
    }

    return {
      kind: 'ltx_control',
      mode: controls.mode,
      videos,
      strength: controls.strength,
    };
  }

  if (controls.mode !== 'flow' && controls.mode !== 'canny' && controls.mode !== 'depth' && controls.mode !== 'raw') {
    return undefined;
  }

  return {
    kind: 'vace',
    mode: controls.mode,
    videos,
    strength: controls.strength,
    ...(controls.mode === 'canny' && controls.cannyIntensity !== undefined
      ? { canny_intensity: controls.cannyIntensity }
      : {}),
    ...(controls.mode === 'depth' && controls.depthContrast !== undefined
      ? { depth_contrast: controls.depthContrast }
      : {}),
  };
}

export function resolveTravelGuidanceState({
  modelName,
  travelGuidance,
  structureGuidance,
  structureVideos,
  defaultVideoTreatment = 'adjust',
  defaultUni3cEndPercent = 0.1,
}: NormalizeTravelGuidanceInput): ResolvedTravelStructureState {
  const normalizedTravelGuidance = normalizeTravelGuidance({
    modelName,
    travelGuidance,
    structureGuidance,
    structureVideos,
    defaultVideoTreatment,
    defaultUni3cEndPercent,
  });

  if (!normalizedTravelGuidance || normalizedTravelGuidance.kind === 'none') {
    return { structureVideos: [] };
  }

  const resolvedVideos = normalizedTravelGuidance.videos.map((video) => ({
    path: video.path,
    start_frame: video.start_frame ?? 0,
    end_frame: video.end_frame ?? 0,
    treatment: video.treatment ?? defaultVideoTreatment,
    ...(video.source_start_frame !== undefined ? { source_start_frame: video.source_start_frame } : {}),
    ...(video.source_end_frame !== undefined ? { source_end_frame: video.source_end_frame } : {}),
  })) satisfies StructureVideoConfig[];

  if (normalizedTravelGuidance.kind === 'ltx_control') {
    return {
      travelGuidance: normalizedTravelGuidance,
      structureVideos: resolvedVideos,
    };
  }

  if (normalizedTravelGuidance.kind === 'uni3c') {
    const structureConfig: StructureGuidanceConfig = {
      target: 'uni3c',
      ...(normalizedTravelGuidance.strength !== undefined ? { strength: normalizedTravelGuidance.strength } : {}),
      ...(normalizedTravelGuidance.step_window ? { step_window: normalizedTravelGuidance.step_window } : {}),
      ...(normalizedTravelGuidance.frame_policy ? { frame_policy: normalizedTravelGuidance.frame_policy } : {}),
      ...(normalizedTravelGuidance.zero_empty_frames !== undefined ? { zero_empty_frames: normalizedTravelGuidance.zero_empty_frames } : {}),
    };

    return {
      travelGuidance: normalizedTravelGuidance,
      structureGuidance: structureConfig,
      structureVideos: resolvedVideos,
    };
  }

  const preprocessing = normalizedTravelGuidance.mode === 'raw'
    ? 'none'
    : normalizedTravelGuidance.mode;

  const structureConfig: StructureGuidanceConfig = {
    target: 'vace',
    preprocessing,
    ...(normalizedTravelGuidance.strength !== undefined ? { strength: normalizedTravelGuidance.strength } : {}),
    ...(normalizedTravelGuidance.canny_intensity !== undefined ? { canny_intensity: normalizedTravelGuidance.canny_intensity } : {}),
    ...(normalizedTravelGuidance.depth_contrast !== undefined ? { depth_contrast: normalizedTravelGuidance.depth_contrast } : {}),
  };

  return {
    travelGuidance: normalizedTravelGuidance,
    structureGuidance: structureConfig,
    structureVideos: resolvedVideos,
  };
}

export function buildTravelGuidanceViewMode(value: TravelGuidance | undefined): 'none' | 'vace' | 'uni3c' | 'ltx_control' {
  return value?.kind ?? 'none';
}

export function asTravelGuidanceRecord(value: unknown): UnknownRecord | undefined {
  return asRecord(value) ?? undefined;
}
