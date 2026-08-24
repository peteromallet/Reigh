import { useMemo } from 'react';
import { parseTaskParams, deriveInputImages, derivePrompt } from '@/shared/lib/taskParamsUtils';
import { buildTaskPayloadSnapshot } from '@/shared/lib/tasks/taskPayloadSnapshot';
import {
  readTravelContractData,
  readResolvedTravelStructure,
} from '@/shared/lib/tasks/travelContractData';
import {
  asRecord,
  asString,
  asNumber,
  asStringArray,
  type UnknownRecord,
} from '@/shared/lib/tasks/taskParamParsers';
import type { TaskDetailsProps } from '@/shared/types/taskDetailsTypes';

const BUILTIN_PRESET_NAMES: Record<string, string> = {
  __builtin_default_i2v__: 'Basic',
  __builtin_default_vace__: 'Basic',
};

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = asString(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function parseNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parsed = value
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((item) => Number.isFinite(item));
  return parsed.length > 0 ? parsed : undefined;
}

export function formatTravelModelName(name: string): string {
  return name
    .replace(
      /wan_2_2_i2v_lightning_baseline_(\d+)_(\d+)_(\d+)/,
      'Wan 2.2 I2V Lightning ($1.$2.$3)',
    )
    .replace(
      /wan_2_2_i2v_baseline_(\d+)_(\d+)_(\d+)/,
      'Wan 2.2 I2V Baseline ($1.$2.$3)',
    )
    .replace(/wan_2_2_i2v_lightning/, 'Wan 2.2 I2V Lightning')
    .replace(/wan_2_2_i2v/, 'Wan 2.2 I2V')
    .replace(/_/g, ' ');
}

export function resolveTravelPresetName(
  presetId: string | undefined,
  dbPresetName: string | null | undefined,
): string | null {
  if (!presetId) {
    return null;
  }
  return BUILTIN_PRESET_NAMES[presetId] || dbPresetName || null;
}

interface UseVideoTravelTaskDataArgs {
  taskParams: TaskDetailsProps['task']['params'];
  inputImages: string[];
  variant: TaskDetailsProps['variant'];
}

interface VideoTravelTaskData {
  isSegmentTask: boolean;
  isAdvancedMode: boolean;
  showPhaseContentInRightColumn: boolean;
  effectiveInputImages: string[];
  phaseConfig: UnknownRecord | undefined;
  phaseStepsDisplay: string | null;
  additionalLoras: UnknownRecord | undefined;
  prompt: string | undefined;
  enhancePrompt: string | undefined;
  negativePrompt: string | undefined;
  structureGuidance: UnknownRecord | undefined;
  videoPath: string | undefined;
  videoTreatment: string | undefined;
  motionStrength: number | undefined;
  styleImage: string | undefined;
  styleStrength: number | undefined;
  presetId: string | undefined;
  isDbPreset: boolean;
  modelName: string | undefined;
  resolution: string | undefined;
  frames: number | undefined;
}

export function useVideoTravelTaskData({
  taskParams,
  inputImages,
  variant,
}: UseVideoTravelTaskDataArgs): VideoTravelTaskData {
  const parsedParams = useMemo(() => parseTaskParams(taskParams), [taskParams]);

  return useMemo(() => {
    const payloadSnapshot = buildTaskPayloadSnapshot(parsedParams);
    const travelContractData = readTravelContractData(payloadSnapshot);
    const structureData = readResolvedTravelStructure(payloadSnapshot);
    const rawParams = payloadSnapshot.rawParams;
    const individualSegmentParams = payloadSnapshot.individualSegmentParams;
    const derivedImages = deriveInputImages(rawParams);
    const isSegmentTask = rawParams.segment_index !== undefined;
    const contractInputImages = travelContractData.inputImages || [];

    const effectiveInputImages = contractInputImages.length > 0
      ? contractInputImages
      : (isSegmentTask && derivedImages.length > 0)
        ? derivedImages
        : (inputImages.length > 0 ? inputImages : derivedImages);

    const phaseConfig = asRecord(individualSegmentParams.phase_config)
      || travelContractData.phaseConfig;
    const phaseSteps = parseNumberArray(phaseConfig?.steps_per_phase);
    const phaseStepsDisplay = phaseSteps && phaseSteps.length > 0
      ? `${phaseSteps.join(' -> ')} (${phaseSteps.reduce((sum, current) => sum + current, 0)} total)`
      : null;

    const advancedMode = individualSegmentParams.advanced_mode
      ?? travelContractData.advancedMode;
    const motionMode = individualSegmentParams.motion_mode
      ?? travelContractData.motionMode;
    const hasPhaseConfig = Array.isArray(phaseConfig?.phases)
      && phaseConfig.phases.length > 0;

    const isAdvancedMode = advancedMode === false || motionMode === 'basic'
      ? false
      : advancedMode === true || motionMode === 'advanced' || motionMode === 'presets' || hasPhaseConfig;

    const additionalLoras = asRecord(individualSegmentParams.additional_loras)
      || travelContractData.additionalLoras;
    const prompt = travelContractData.prompt || derivePrompt(rawParams) || undefined;
    const orchestratorNegativePrompts = asStringArray(payloadSnapshot.orchestratorDetails.negative_prompts_expanded);
    const negativePrompt = asString(individualSegmentParams.negative_prompt)
      || travelContractData.negativePrompt
      || (
        isSegmentTask
          ? asString(rawParams.negative_prompt)
          : (orchestratorNegativePrompts?.[0] || asString(rawParams.negative_prompt))
      );

    const enhancePrompt = pickString(
      asString(payloadSnapshot.orchestratorDetails.enhance_prompt),
      travelContractData.enhancedPrompt,
      asString(rawParams.enhanced_prompt),
    );

    const structureGuidance = structureData.structureGuidance ?? undefined;
    const hasStructureVideo = Boolean(structureData.primaryStructureVideo.path);
    const videoPath = structureData.primaryStructureVideo.path ?? undefined;
    const videoTreatment = hasStructureVideo
      ? structureData.primaryStructureVideo.treatment
      : undefined;
    const motionStrength = hasStructureVideo
      ? structureData.primaryStructureVideo.motionStrength
      : undefined;

    const styleImage = pickString(
      asString(rawParams.style_reference_image),
      asString(payloadSnapshot.orchestratorDetails.style_reference_image),
    );
    const styleStrength = asNumber(rawParams.style_reference_strength)
      ?? asNumber(payloadSnapshot.orchestratorDetails.style_reference_strength);

    const presetId = pickString(
      individualSegmentParams.selected_phase_preset_id,
      travelContractData.selectedPhasePresetId,
    );
    const isDbPreset = Boolean(presetId && !presetId.startsWith('__builtin_'));

    const modelName = pickString(travelContractData.modelName);
    const resolution = pickString(
      travelContractData.resolution,
      asString(payloadSnapshot.orchestratorDetails.parsed_resolution_wh),
      asString(rawParams.parsed_resolution_wh),
    );
    const parsedSegmentFrames = parseNumberArray(rawParams.segment_frames_expanded);
    const frames = isSegmentTask
      ? (
        asNumber(individualSegmentParams.num_frames)
        || asNumber(rawParams.num_frames)
        || asNumber(rawParams.segment_frames_target)
      )
      : (travelContractData.segmentFramesExpanded?.[0] ?? parsedSegmentFrames?.[0]);

    return {
      isSegmentTask,
      isAdvancedMode,
      showPhaseContentInRightColumn: isAdvancedMode && hasPhaseConfig && variant === 'panel',
      effectiveInputImages,
      phaseConfig,
      phaseStepsDisplay,
      additionalLoras,
      prompt,
      enhancePrompt,
      negativePrompt,
      structureGuidance,
      videoPath,
      videoTreatment,
      motionStrength,
      styleImage,
      styleStrength,
      presetId,
      isDbPreset,
      modelName,
      resolution,
      frames,
    };
  }, [inputImages, parsedParams, variant]);
}
