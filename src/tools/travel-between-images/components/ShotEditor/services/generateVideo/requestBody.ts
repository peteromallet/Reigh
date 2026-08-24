import { ValidationError } from '@/shared/lib/errorHandling/errors';
import { buildMotionTaskFields } from '@/shared/components/SegmentSettingsForm/segmentSettingsUtils';
import { DEFAULT_STEERABLE_MOTION_SETTINGS } from '../../state/types';
import type { BuildTravelRequestBodyParams, ImagePayload } from './types';
import type { TravelBetweenImagesRequestPayload } from '@/shared/lib/tasks/travelBetweenImages';
import {
  getModelSpec,
  resolveGenerationPolicy,
  resolveSelectedModelFromModelName,
} from '@/tools/travel-between-images/settings';

function assertMappedIdCardinality(
  imagePayload: ImagePayload,
  expectedImageCount: number,
): void {
  if (imagePayload.imageGenerationIds.length > 0 && imagePayload.imageGenerationIds.length !== expectedImageCount) {
    throw new ValidationError(
      'Travel payload integrity check failed: image_generation_ids count does not match image_urls count.',
      { field: 'image_generation_ids' },
    );
  }

  const expectedPairCount = Math.max(0, expectedImageCount - 1);
  if (imagePayload.pairShotGenerationIds.length > 0 && imagePayload.pairShotGenerationIds.length !== expectedPairCount) {
    throw new ValidationError(
      'Travel payload integrity check failed: pair_shot_generation_ids count does not match pair count.',
      { field: 'pair_shot_generation_ids' },
    );
  }
}

export function buildTravelRequestBodyV2(params: BuildTravelRequestBodyParams): TravelBetweenImagesRequestPayload {
  const {
    projectId,
    selectedShot,
    imagePayload,
    pairConfig,
    parentGenerationId,
    actualModelName,
    selectedModel,
    policy,
    generationTypeMode,
    motionParams,
    generationParams,
    seedParams,
  } = params;
  const {
    amountOfMotion,
    motionMode,
    useAdvancedMode,
    effectivePhaseConfig,
    selectedPhasePresetId,
    numInferenceSteps,
    guidanceScale,
  } = motionParams;
  const {
    generationMode,
    batchVideoPrompt,
    enhancePrompt,
    variantNameParam,
    textBeforePrompts,
    textAfterPrompts,
  } = generationParams;
  const {
    seed,
    randomSeed,
    turboMode,
    debug,
  } = seedParams;
  const imageCount = imagePayload.absoluteImageUrls.length;
  const expectedPairCount = Math.max(0, imageCount - 1);
  assertMappedIdCardinality(imagePayload, imageCount);
  const spec = getModelSpec(selectedModel ?? resolveSelectedModelFromModelName(actualModelName));
  const effectivePolicy = policy ?? resolveGenerationPolicy(spec, {
    smoothContinuations: false,
    requestedExecutionMode: generationTypeMode ?? 'i2v',
  });

  const motionFields = spec.supportsMotionFields
    ? buildMotionTaskFields({
      amountOfMotion,
      motionMode,
      phaseConfig: effectivePhaseConfig,
      selectedPhasePresetId,
      omitBasicPhaseConfig: true,
    })
    : {};

  const hasValidEnhancedPrompts = pairConfig.enhancedPromptsArray.some(prompt => prompt && prompt.trim().length > 0);
  const pairPhaseConfigsArray = spec.supportsPhaseConfig
    ? pairConfig.pairPhaseConfigsArray
    : pairConfig.pairPhaseConfigsArray.map(() => null);

  const continuationConfig = effectivePolicy.continuation.enabled && effectivePolicy.continuation.strategy
    ? {
      strategy: effectivePolicy.continuation.strategy,
      overlap_frames: effectivePolicy.continuation.overlapFrames,
    }
    : undefined;

  return {
    project_id: projectId,
    shot_id: selectedShot.id,
    image_urls: imagePayload.absoluteImageUrls,
    ...(imagePayload.imageGenerationIds.length > 0 && imagePayload.imageGenerationIds.length === imageCount
      ? { image_generation_ids: imagePayload.imageGenerationIds }
      : {}),
    ...(imagePayload.pairShotGenerationIds.length > 0 && imagePayload.pairShotGenerationIds.length === expectedPairCount
      ? { pair_shot_generation_ids: imagePayload.pairShotGenerationIds }
      : {}),
    ...(parentGenerationId ? { parent_generation_id: parentGenerationId } : {}),
    base_prompts: pairConfig.basePrompts,
    base_prompt: batchVideoPrompt,
    segment_frames: pairConfig.segmentFrames,
    frame_overlap: pairConfig.frameOverlap,
    ...(continuationConfig ? { continuation_config: continuationConfig } : {}),
    negative_prompts: pairConfig.negativePrompts,
    ...(hasValidEnhancedPrompts ? { enhanced_prompts: pairConfig.enhancedPromptsArray.map((prompt) => prompt ?? '') } : {}),
    ...(pairPhaseConfigsArray.some(config => config !== null) ? { pair_phase_configs: pairPhaseConfigsArray } : {}),
    ...(pairConfig.pairLorasArray.some(loras => loras !== null) ? { pair_loras: pairConfig.pairLorasArray } : {}),
    ...(pairConfig.pairMotionSettingsArray.some(settings => settings !== null) ? { pair_motion_settings: pairConfig.pairMotionSettingsArray } : {}),
    model_name: actualModelName,
    model_type: effectivePolicy.travelMode,
    seed,
    debug: debug ?? DEFAULT_STEERABLE_MOTION_SETTINGS.debug,
    show_input_images: DEFAULT_STEERABLE_MOTION_SETTINGS.show_input_images,
    ...(!hasValidEnhancedPrompts ? { enhance_prompt: enhancePrompt } : {}),
    generation_mode: generationMode,
    random_seed: randomSeed,
    turbo_mode: turboMode,
    ...(spec.ui.inferenceSteps && numInferenceSteps !== undefined ? { num_inference_steps: numInferenceSteps } : {}),
    ...(spec.ui.guidanceScale && guidanceScale !== undefined ? { guidance_scale: guidanceScale } : {}),
    ...motionFields,
    ...(spec.supportsPhaseConfig ? { advanced_mode: useAdvancedMode } : {}),
    generation_name: variantNameParam.trim() || undefined,
    ...(textBeforePrompts ? { text_before_prompts: textBeforePrompts } : {}),
    ...(textAfterPrompts ? { text_after_prompts: textAfterPrompts } : {}),
    independent_segments: !effectivePolicy.continuation.enabled,
    chain_segments: effectivePolicy.continuation.enabled,
  };
}
