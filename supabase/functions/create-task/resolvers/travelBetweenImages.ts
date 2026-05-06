import type { ResolverResult, TaskFamilyResolver, TaskInsertObject } from "./types.ts";
import { generateRunId, generateTaskId } from "./shared/ids.ts";
import { resolveProjectResolutionFromAspectRatio } from "./shared/resolution.ts";
import { resolveSeed32Bit } from "./shared/seed.ts";
import {
  buildTravelBetweenImagesFamilyContract,
  composeTaskFamilyPayload,
  TASK_FAMILY_CONTRACT_VERSION,
  type TravelBetweenImagesReadContract,
} from "./shared/taskContracts.ts";
import {
  TaskValidationError,
  validateRequiredFields,
} from "./shared/validation.ts";

interface TravelBetweenImagesTaskInput {
  image_urls: string[];
  base_prompts: string[];
  segment_frames: number[];
  frame_overlap: number[];
  continuation_config?: Record<string, unknown>;
  base_prompt?: string;
  negative_prompts?: string[];
  enhanced_prompts?: string[];
  enhance_prompt?: boolean;
  text_before_prompts?: string;
  text_after_prompts?: string;
  amount_of_motion?: number;
  motion_mode?: "basic" | "presets" | "advanced";
  advanced_mode?: boolean;
  phase_config?: Record<string, unknown>;
  selected_phase_preset_id?: string | null;
  model_name?: string;
  model_type?: "i2v" | "vace";
  seed?: number;
  steps?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
  random_seed?: boolean;
  turbo_mode?: boolean;
  debug?: boolean;
  shot_id?: string;
  parent_generation_id?: string;
  image_generation_ids?: string[];
  pair_shot_generation_ids?: string[];
  resolution?: string;
  main_output_dir_for_run?: string;
  show_input_images?: boolean;
  generation_mode?: "batch" | "timeline" | "by-pair";
  dimension_source?: "project" | "firstImage" | "custom";
  after_first_post_generation_saturation?: number;
  after_first_post_generation_brightness?: number;
  generation_name?: string;
  independent_segments?: boolean;
  chain_segments?: boolean;
  pair_phase_configs?: (Record<string, unknown> | null)[];
  pair_loras?: (Array<{ path: string; strength: number }> | null)[];
  loras?: Array<{ path: string; strength: number }>;
  pair_motion_settings?: (Record<string, unknown> | null)[];
  travel_guidance?: Record<string, unknown>;
  structure_guidance?: Record<string, unknown>;
  structure_videos?: Record<string, unknown>[];
  stitch_config?: Record<string, unknown>;
}

const DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES = {
  model_name: "wan_2_2_i2v_lightning_baseline_2_2_2",
  seed: 789,
  steps: 20,
  after_first_post_generation_saturation: 1,
  after_first_post_generation_brightness: 0,
  debug: false,
  enhance_prompt: false,
  show_input_images: true,
  generation_mode: "batch" as const,
  dimension_source: "project" as const,
  amount_of_motion: 0.5,
};

function buildQueuedTask(
  projectId: string,
  taskType: string,
  params: Record<string, unknown>,
): TaskInsertObject {
  return {
    project_id: projectId,
    task_type: taskType,
    params,
    status: "Queued",
    created_at: new Date().toISOString(),
    dependant_on: null,
  };
}

function expandArrayToCount<T>(values: T[] | undefined, count: number): T[] | undefined {
  if (!values || values.length === 0) return values;
  if (values.length === count) return values;
  if (values.length === 1) {
    return Array.from({ length: count }, () => values[0]);
  }
  return values;
}

async function ensureShotParentGenerationId(
  context: Parameters<TaskFamilyResolver>[1],
  input: TravelBetweenImagesTaskInput,
): Promise<string | undefined> {
  if (input.parent_generation_id) {
    return input.parent_generation_id;
  }
  if (!input.shot_id) {
    return undefined;
  }

  const { data, error } = await context.supabaseAdmin.rpc("ensure_shot_parent_generation", {
    p_shot_id: input.shot_id,
    p_project_id: context.projectId,
  });

  if (error) {
    throw new Error(`Failed to ensure parent generation for shot ${input.shot_id}: ${error.message}`);
  }
  if (!data || typeof data !== "string") {
    throw new Error(`ensure_shot_parent_generation returned invalid parent ID for shot ${input.shot_id}`);
  }
  return data;
}

function validateTravelBetweenImagesInput(input: TravelBetweenImagesTaskInput): void {
  validateRequiredFields(input, ["image_urls", "base_prompts", "segment_frames", "frame_overlap"]);

  if (input.image_urls.length === 0) {
    throw new TaskValidationError("At least one image_url is required", "image_urls");
  }
  if (input.base_prompts.length === 0) {
    throw new TaskValidationError("base_prompts is required (at least one prompt)", "base_prompts");
  }
  if (input.segment_frames.length === 0) {
    throw new TaskValidationError("segment_frames is required", "segment_frames");
  }
  if (input.frame_overlap.length === 0) {
    throw new TaskValidationError("frame_overlap is required", "frame_overlap");
  }
}

function buildAdditionalLorasRecord(
  loras: Array<{ path: string; strength: number }> | undefined,
): Record<string, number> | undefined {
  if (!loras || loras.length === 0) return undefined;
  return loras.reduce<Record<string, number>>((acc, lora) => {
    acc[lora.path] = lora.strength;
    return acc;
  }, {});
}

function appendTravelGuidancePayload(
  target: Record<string, unknown>,
  input: Pick<TravelBetweenImagesTaskInput, "travel_guidance" | "structure_guidance" | "structure_videos">,
): void {
  if (input.travel_guidance) {
    target.travel_guidance = input.travel_guidance;
    return;
  }
  if (input.structure_guidance) {
    target.structure_guidance = input.structure_guidance;
  }
  if (input.structure_videos?.length) {
    target.structure_videos = input.structure_videos;
  }
}

function buildTravelBetweenImagesPayload(
  input: TravelBetweenImagesTaskInput,
  finalResolution: string,
  taskId: string,
  runId: string,
  parentGenerationId?: string,
): Record<string, unknown> {
  const numSegments = Math.max(1, input.image_urls.length - 1);
  const basePromptsExpanded = expandArrayToCount(input.base_prompts, numSegments) ?? [];
  const negativePromptsExpanded = expandArrayToCount(input.negative_prompts, numSegments)
    ?? Array(numSegments).fill("");
  const enhancedPromptsExpanded = input.enhanced_prompts
    ? expandArrayToCount(input.enhanced_prompts, numSegments)
    : (input.enhance_prompt ? Array(numSegments).fill("") : undefined);
  const segmentFramesExpanded = expandArrayToCount(input.segment_frames, numSegments) ?? [];
  const frameOverlapExpanded = expandArrayToCount(input.frame_overlap, numSegments) ?? [];
  const chainSegments = input.chain_segments ?? Boolean(input.continuation_config);
  const finalSeed = resolveSeed32Bit({
    seed: input.seed,
    randomize: input.random_seed === true,
    fallbackSeed: DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.seed,
    field: "seed",
  });

  const orchestratorPayload: Record<string, unknown> = {
    generation_source: "batch",
    orchestrator_task_id: taskId,
    run_id: runId,
    input_image_paths_resolved: input.image_urls,
    ...(input.image_generation_ids?.length ? { input_image_generation_ids: input.image_generation_ids } : {}),
    ...(input.pair_shot_generation_ids?.length ? { pair_shot_generation_ids: input.pair_shot_generation_ids } : {}),
    num_new_segments_to_generate: numSegments,
    base_prompts_expanded: basePromptsExpanded,
    base_prompt: input.base_prompt,
    negative_prompts_expanded: negativePromptsExpanded,
    ...(enhancedPromptsExpanded !== undefined ? { enhanced_prompts_expanded: enhancedPromptsExpanded } : {}),
    ...(input.pair_phase_configs?.some((entry) => entry !== null)
      ? { phase_configs_expanded: input.pair_phase_configs.slice(0, numSegments) }
      : {}),
    ...(input.pair_loras?.some((entry) => entry !== null)
      ? { loras_per_segment_expanded: input.pair_loras.slice(0, numSegments) }
      : {}),
    ...(input.pair_motion_settings?.some((entry) => entry !== null)
      ? { motion_settings_expanded: input.pair_motion_settings.slice(0, numSegments) }
      : {}),
    segment_frames_expanded: segmentFramesExpanded,
    frame_overlap_expanded: frameOverlapExpanded,
    ...(input.continuation_config ? { continuation_config: input.continuation_config } : {}),
    parsed_resolution_wh: finalResolution,
    model_name: input.model_name ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.model_name,
    model_type: input.model_type,
    seed_base: finalSeed,
    ...(input.advanced_mode ? {} : { steps: input.steps ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.steps }),
    ...(input.num_inference_steps !== undefined ? { num_inference_steps: input.num_inference_steps } : {}),
    ...(input.guidance_scale !== undefined ? { guidance_scale: input.guidance_scale } : {}),
    after_first_post_generation_saturation:
      input.after_first_post_generation_saturation
      ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.after_first_post_generation_saturation,
    after_first_post_generation_brightness:
      input.after_first_post_generation_brightness
      ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.after_first_post_generation_brightness,
    debug_mode_enabled: input.debug ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.debug,
    shot_id: input.shot_id,
    ...(parentGenerationId ? { parent_generation_id: parentGenerationId } : {}),
    ...(input.main_output_dir_for_run ? { main_output_dir_for_run: input.main_output_dir_for_run } : {}),
    enhance_prompt: input.enhance_prompt ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.enhance_prompt,
    show_input_images: input.show_input_images ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.show_input_images,
    generation_mode: input.generation_mode ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.generation_mode,
    dimension_source: input.dimension_source ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.dimension_source,
    ...(input.advanced_mode
      ? {}
      : { amount_of_motion: input.amount_of_motion ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.amount_of_motion }),
    advanced_mode: input.advanced_mode ?? false,
    generation_name: input.generation_name,
    independent_segments: input.independent_segments ?? true,
    chain_segments: chainSegments,
    ...(input.text_before_prompts ? { text_before_prompts: input.text_before_prompts } : {}),
    ...(input.text_after_prompts ? { text_after_prompts: input.text_after_prompts } : {}),
    ...(input.motion_mode ? { motion_mode: input.motion_mode } : {}),
  };

  appendTravelGuidancePayload(orchestratorPayload, input);

  const additionalLoras = buildAdditionalLorasRecord(input.loras);
  if (additionalLoras) {
    orchestratorPayload.additional_loras = additionalLoras;
  }
  if (input.phase_config) {
    orchestratorPayload.phase_config = input.phase_config;
  }
  if (input.selected_phase_preset_id) {
    orchestratorPayload.selected_phase_preset_id = input.selected_phase_preset_id;
  }
  const hasPairIds = Boolean(input.pair_shot_generation_ids?.length);

  const travelReadContract: TravelBetweenImagesReadContract = {
    contract_version: TASK_FAMILY_CONTRACT_VERSION,
    prompt: input.base_prompt ?? input.base_prompts[0],
    enhanced_prompt: enhancedPromptsExpanded?.[0],
    negative_prompt: input.negative_prompts?.[0],
    model_name: input.model_name ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.model_name,
    resolution: finalResolution,
    enhance_prompt: input.enhance_prompt ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.enhance_prompt,
    motion_mode: input.motion_mode ?? "basic",
    selected_phase_preset_id: input.selected_phase_preset_id ?? null,
    advanced_mode: input.advanced_mode ?? false,
    amount_of_motion: input.amount_of_motion ?? DEFAULT_TRAVEL_BETWEEN_IMAGES_VALUES.amount_of_motion,
    phase_config: input.phase_config,
    additional_loras: additionalLoras,
    segment_frames_expanded: segmentFramesExpanded,
    frame_overlap_expanded: frameOverlapExpanded,
    continuation_config: input.continuation_config,
    chain_segments: chainSegments,
    ...(input.travel_guidance
      ? { travel_guidance: input.travel_guidance }
      : {
        structure_guidance: input.structure_guidance,
        structure_videos: input.structure_videos,
      }),
  };

  return composeTaskFamilyPayload({
    taskFamily: "travel_between_images",
    orchestratorDetails: orchestratorPayload,
    orchestrationInput: {
      taskFamily: "travel_between_images",
      orchestratorTaskId: taskId,
      runId,
      parentGenerationId,
      shotId: input.shot_id,
    },
    taskViewInput: {
      inputImages: input.image_urls,
      prompt: input.base_prompt ?? input.base_prompts[0],
      negativePrompt: input.negative_prompts?.[0],
      modelName: input.model_name,
      resolution: finalResolution,
    },
    familyContract: buildTravelBetweenImagesFamilyContract({
      imageCount: input.image_urls.length,
      segmentCount: numSegments,
      hasPairIds,
      readContract: travelReadContract,
    }),
  });
}

export const travelBetweenImagesResolver: TaskFamilyResolver = async (
  request,
  context,
): Promise<ResolverResult> => {
  const input = request.input as unknown as TravelBetweenImagesTaskInput;
  validateTravelBetweenImagesInput(input);

  const finalResolution = resolveProjectResolutionFromAspectRatio({
    aspectRatio: context.aspectRatio,
    customResolution: input.resolution,
  }).resolution;
  const parentGenerationId = await ensureShotParentGenerationId(context, input);
  const orchestratorTaskId = generateTaskId("sm_travel_orchestrator");
  const runId = generateRunId();
  const isTurboMode = input.turbo_mode === true;
  const taskType = isTurboMode ? "wan_2_2_i2v" : "travel_orchestrator";

  return {
    tasks: [
      buildQueuedTask(context.projectId, taskType, {
        tool_type: "travel-between-images",
        orchestrator_details: buildTravelBetweenImagesPayload(
          input,
          finalResolution,
          orchestratorTaskId,
          runId,
          parentGenerationId,
        ),
        ...(parentGenerationId ? { parent_generation_id: parentGenerationId } : {}),
        ...(input.generation_name ? { generation_name: input.generation_name } : {}),
      }),
    ],
    meta: parentGenerationId ? { parentGenerationId } : undefined,
  };
};
