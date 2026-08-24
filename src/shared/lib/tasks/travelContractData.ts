import type { TaskPayloadSnapshot } from './taskPayloadSnapshot';
import { createTravelPayloadReader, type TravelPayloadSource } from './travelPayloadReader';
import { asRecord, type UnknownRecord } from './taskParamParsers';
import {
  DEFAULT_STRUCTURE_GUIDANCE_CONTROLS,
  DEFAULT_STRUCTURE_VIDEO,
} from './travelBetweenImages/defaults';
import { resolvePrimaryStructureVideo } from './travelBetweenImages/primaryStructureVideo';
import { resolveTravelStructureState } from './travelBetweenImages/structureState';

const CONTRACT_SOURCES: TravelPayloadSource[] = [
  'taskViewContract',
  'individualSegmentParams',
  'familyContract',
];

const LEGACY_SOURCES: TravelPayloadSource[] = [
  'orchestratorDetails',
  'rawParams',
  'fullOrchestratorPayload',
];

const CONTRACT_THEN_LEGACY: TravelPayloadSource[] = [
  ...CONTRACT_SOURCES,
  ...LEGACY_SOURCES,
];

interface TravelContractData {
  inputImages?: string[];
  prompt?: string;
  enhancedPrompt?: string;
  negativePrompt?: string;
  modelName?: string;
  resolution?: string;
  motionMode?: string;
  selectedPhasePresetId?: string;
  advancedMode?: boolean;
  amountOfMotion?: number;
  phaseConfig?: UnknownRecord;
  additionalLoras?: UnknownRecord;
  continuationConfig?: UnknownRecord;
  travelGuidance?: UnknownRecord;
  structureGuidance?: UnknownRecord;
  segmentFramesExpanded?: number[];
  frameOverlapExpanded?: number[];
}

export interface ResolvedTravelStructureContractData {
  present: boolean;
  structureGuidance?: UnknownRecord;
  structureVideos: ReturnType<typeof resolveTravelStructureState>['structureVideos'];
  primaryStructureVideo: ReturnType<typeof resolvePrimaryStructureVideo>;
}

function pickFirstDefinedValue(
  reader: ReturnType<typeof createTravelPayloadReader>,
  keys: string[],
  sources: TravelPayloadSource[],
): unknown {
  for (const key of keys) {
    const value = reader.read(key, sources);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function pickRecord(reader: ReturnType<typeof createTravelPayloadReader>, key: string): UnknownRecord | undefined {
  const contractRecord = reader.pickRecord(key, CONTRACT_SOURCES);
  if (contractRecord) {
    return contractRecord;
  }
  const legacyRecord = reader.pickRecord(key, LEGACY_SOURCES);
  return legacyRecord;
}

/** Field descriptors for structure source: [outputKey, lookupKeys, sources] */
const STRUCTURE_FIELDS: [string, string[], TravelPayloadSource[]][] = [
  ['travel_guidance', ['travel_guidance', 'travelGuidance'], CONTRACT_THEN_LEGACY],
  ['structure_guidance', ['structure_guidance', 'structureGuidance'], CONTRACT_THEN_LEGACY],
  ['structure_videos', ['structure_videos', 'structureVideos'], CONTRACT_THEN_LEGACY],
  ['structure_video_path', ['structure_video_path', 'structureVideoPath'], LEGACY_SOURCES],
  ['structure_video_treatment', ['structure_video_treatment', 'structureVideoTreatment'], LEGACY_SOURCES],
  ['structure_video_type', ['structure_video_type', 'structure_type', 'structureVideoType', 'structureType'], LEGACY_SOURCES],
  ['structure_video_motion_strength', ['structure_video_motion_strength', 'structureVideoMotionStrength'], LEGACY_SOURCES],
  ['structure_canny_intensity', ['structure_canny_intensity', 'structureCannyIntensity'], LEGACY_SOURCES],
  ['structure_depth_contrast', ['structure_depth_contrast', 'structureDepthContrast'], LEGACY_SOURCES],
  ['uni3c_start_percent', ['uni3c_start_percent', 'uni3cStartPercent'], LEGACY_SOURCES],
  ['uni3c_end_percent', ['uni3c_end_percent', 'uni3cEndPercent'], LEGACY_SOURCES],
  ['use_uni3c', ['use_uni3c', 'useUni3c'], LEGACY_SOURCES],
];

export function buildTravelStructureSource(
  snapshot: TaskPayloadSnapshot,
): Record<string, unknown> {
  const reader = createTravelPayloadReader(snapshot);
  const result: Record<string, unknown> = {};

  for (const [outputKey, lookupKeys, sources] of STRUCTURE_FIELDS) {
    const value = pickFirstDefinedValue(reader, lookupKeys, sources);
    if (value !== undefined) {
      result[outputKey] = value;
    }
  }

  // Fallback: if structure_videos wasn't found, check for videos array inside the canonical or legacy guidance object
  if (result.structure_videos === undefined) {
    const guidanceVideos = asRecord(result.travel_guidance)?.videos
      ?? asRecord(result.structure_guidance)?.videos;
    if (Array.isArray(guidanceVideos)) {
      result.structure_videos = guidanceVideos;
    }
  }

  return result;
}

export function readResolvedTravelStructure(
  snapshot: TaskPayloadSnapshot,
): ResolvedTravelStructureContractData {
  const source = buildTravelStructureSource(snapshot);
  const resolved = resolveTravelStructureState(source, {
    defaultEndFrame: 0,
    defaultVideoTreatment: DEFAULT_STRUCTURE_VIDEO.treatment,
    defaultMotionStrength: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.motionStrength,
    defaultStructureType: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.structureType,
    defaultUni3cEndPercent: DEFAULT_STRUCTURE_GUIDANCE_CONTROLS.uni3cEndPercent,
  });

  return {
    present: Object.keys(source).length > 0,
    structureGuidance: asRecord(resolved.structureGuidance),
    structureVideos: resolved.structureVideos,
    primaryStructureVideo: resolvePrimaryStructureVideo(
      resolved.structureVideos,
      resolved.structureGuidance,
    ),
  };
}

export function readTravelContractData(snapshot: TaskPayloadSnapshot): TravelContractData {
  const reader = createTravelPayloadReader(snapshot);
  const travelGuidance = pickRecord(reader, 'travel_guidance');
  const structureGuidance = pickRecord(reader, 'structure_guidance');
  const phaseConfig = pickRecord(reader, 'phase_config');
  const continuationConfig = pickRecord(reader, 'continuation_config');

  return {
    inputImages: reader.pickStringArray('input_images', CONTRACT_THEN_LEGACY)
      ?? reader.pickStringArray('input_image_paths_resolved', LEGACY_SOURCES),
    prompt: reader.pickString('prompt', CONTRACT_THEN_LEGACY)
      ?? reader.pickString('base_prompt', LEGACY_SOURCES),
    enhancedPrompt: reader.pickString('enhanced_prompt', CONTRACT_THEN_LEGACY),
    negativePrompt: reader.pickString('negative_prompt', CONTRACT_THEN_LEGACY),
    modelName: reader.pickString('model_name', CONTRACT_THEN_LEGACY),
    resolution: reader.pickString('resolution', CONTRACT_THEN_LEGACY)
      ?? reader.pickString('parsed_resolution_wh', LEGACY_SOURCES),
    motionMode: reader.pickString('motion_mode', CONTRACT_THEN_LEGACY),
    selectedPhasePresetId: reader.pickString('selected_phase_preset_id', CONTRACT_THEN_LEGACY),
    advancedMode: reader.pickBoolean('advanced_mode', CONTRACT_THEN_LEGACY),
    amountOfMotion: reader.pickNumber('amount_of_motion', CONTRACT_THEN_LEGACY),
    phaseConfig,
    additionalLoras: pickRecord(reader, 'additional_loras'),
    continuationConfig,
    travelGuidance,
    structureGuidance,
    segmentFramesExpanded: reader.pickNumberArray('segment_frames_expanded', CONTRACT_THEN_LEGACY),
    frameOverlapExpanded: reader.pickNumberArray('frame_overlap_expanded', CONTRACT_THEN_LEGACY),
  };
}
