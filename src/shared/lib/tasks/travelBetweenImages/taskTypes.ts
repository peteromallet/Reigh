import { PhaseConfig } from '@/shared/types/phaseConfig';
import type { PathLoraConfig } from '@/domains/lora/types/lora';

/**
 * Unified structure guidance contract for vace/uni3c.
 */
export interface StructureGuidanceVideoConfig {
  path: string;
  start_frame: number;
  end_frame: number | null;
  treatment?: 'adjust' | 'clip';
  metadata?: Record<string, unknown>;
  resource_id?: string;
}

export interface StructureGuidanceConfig {
  /** Target system for guidance. */
  target: 'vace' | 'uni3c';

  /**
   * Preprocessing method (VACE only).
   * `none` maps legacy `raw` behavior.
   */
  preprocessing?: 'flow' | 'canny' | 'depth' | 'none';

  /** Unified strength parameter. */
  strength?: number;

  /** Structure videos associated with this guidance configuration. */
  videos?: StructureGuidanceVideoConfig[];

  /** VACE-specific: canny edge detection intensity. */
  canny_intensity?: number;

  /** VACE-specific: depth contrast. */
  depth_contrast?: number;

  /** Uni3C-specific step window as [start_percent, end_percent]. */
  step_window?: [number, number];

  /** Uni3C-specific frame policy. */
  frame_policy?: 'fit' | 'clip';

  /** Uni3C-specific: zero out empty frames. */
  zero_empty_frames?: boolean;
}

export interface TravelGuidanceVideoConfig {
  path: string;
  start_frame?: number;
  end_frame?: number | null;
  treatment?: 'adjust' | 'clip';
  source_start_frame?: number;
  source_end_frame?: number | null;
}

export interface TravelGuidanceNone {
  kind: 'none';
}

export interface TravelGuidanceVace {
  kind: 'vace';
  mode: 'flow' | 'canny' | 'depth' | 'raw';
  videos: TravelGuidanceVideoConfig[];
  strength?: number;
  canny_intensity?: number;
  depth_contrast?: number;
}

export interface TravelGuidanceLtxControl {
  kind: 'ltx_control';
  mode: 'pose' | 'depth' | 'canny' | 'video' | 'cameraman';
  videos: TravelGuidanceVideoConfig[];
  strength?: number;
}

export interface TravelGuidanceUni3c {
  kind: 'uni3c';
  videos: TravelGuidanceVideoConfig[];
  strength?: number;
  step_window?: [number, number];
  frame_policy?: 'fit' | 'clip';
  zero_empty_frames?: boolean;
  keep_on_gpu?: boolean;
}

export type TravelGuidance =
  | TravelGuidanceNone
  | TravelGuidanceVace
  | TravelGuidanceLtxControl
  | TravelGuidanceUni3c;

export interface ContinuationConfig {
  strategy: 'guide_overlap_masked' | 'prefix_video_source' | 'svi_latent_chaining';
  overlap_frames: number;
}

/**
 * Single structure video mapping entry.
 * Frame ranges are half-open: `start_frame` inclusive, `end_frame` exclusive.
 */
export interface StructureVideoConfig {
  /** Path to structure video (S3/Storage URL). */
  path: string;

  /** Where in output timeline this video starts guiding (inclusive). */
  start_frame: number;

  /** Where in output timeline this video ends (exclusive). */
  end_frame: number;

  /**
   * Source/output frame mismatch policy.
   * `adjust` resamples to fit; `clip` applies 1:1 mapping.
   */
  treatment?: 'adjust' | 'clip';

  /** Optional source start frame (inclusive). */
  source_start_frame?: number;

  /** Optional source end frame (exclusive). */
  source_end_frame?: number | null;
}

export interface PromptConfig {
  base_prompt: string;
  enhance_prompt: boolean;
  text_before_prompts?: string;
  text_after_prompts?: string;
  default_negative_prompt: string;
}

export interface MotionConfig {
  amount_of_motion: number;
  motion_mode: 'basic' | 'presets' | 'advanced';
  advanced_mode: boolean;
  phase_config?: PhaseConfig;
  selected_phase_preset_id?: string;
}

export interface ModelConfig {
  seed: number;
  random_seed: boolean;
  turbo_mode: boolean;
  debug: boolean;
  generation_type_mode: 'i2v' | 'vace';
}

/**
 * Canonical API request payload for new travel-between-images task creation.
 * This contract intentionally excludes legacy structure-guidance write aliases.
 */
export interface TravelBetweenImagesRequestPayload {
  project_id: string;
  image_urls: string[];
  base_prompts: string[];
  segment_frames: number[];
  frame_overlap: number[];
  continuation_config?: ContinuationConfig;

  base_prompt?: string;
  negative_prompts?: string[];
  enhanced_prompts?: string[];
  enhance_prompt?: boolean;
  text_before_prompts?: string;
  text_after_prompts?: string;

  amount_of_motion?: number;
  motion_mode?: 'basic' | 'presets' | 'advanced';
  advanced_mode?: boolean;
  phase_config?: PhaseConfig;
  selected_phase_preset_id?: string | null;

  model_name?: string;
  model_type?: 'i2v' | 'vace';
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
  generation_mode?: 'batch' | 'timeline' | 'by-pair';
  dimension_source?: 'project' | 'firstImage' | 'custom';
  after_first_post_generation_saturation?: number;
  after_first_post_generation_brightness?: number;
  generation_name?: string;
  independent_segments?: boolean;
  // TODO: wire through to orchestrator_details.
  chain_segments?: boolean;

  // null entry means "use shot default" for that pair.
  pair_phase_configs?: (PhaseConfig | null)[];
  pair_loras?: (PathLoraConfig[] | null)[];
  loras?: PathLoraConfig[];
  pair_motion_settings?: (Record<string, unknown> | null)[];

  travel_guidance?: TravelGuidance;

  // TODO: wire through to orchestrator_details.
  // Optional join config for automatic stitch-after-generation.
  stitch_config?: StitchConfig;
}

/**
 * Internal compatibility input accepted by task builders while older call-sites
 * are still being normalized at the boundary.
 */
interface TravelBetweenImagesLegacyCompatInput {
  // TODO: wire through to orchestrator_details.
  /** @deprecated New writes should use `travel_guidance`. */
  structure_guidance?: StructureGuidanceConfig;
  /** @deprecated New writes should use `travel_guidance.videos`. */
  structure_videos?: StructureVideoConfig[];
}

/**
 * Canonical create-task input for travel-between-images.
 * Internal builders still accept legacy structure aliases for normalization, but
 * exported write APIs should prefer `TravelBetweenImagesRequestPayload`.
 */
export type TravelBetweenImagesTaskInput =
  TravelBetweenImagesRequestPayload
  & TravelBetweenImagesLegacyCompatInput;

export interface StitchConfig {
  context_frame_count: number;
  gap_frame_count: number;
  replace_mode: boolean;
  keep_bridging_images: boolean;

  prompt: string;
  negative_prompt: string;
  enhance_prompt: boolean;

  model: string;
  num_inference_steps: number;
  guidance_scale: number;
  // -1 indicates random seed.
  seed: number;
  random_seed: boolean;

  motion_mode: 'basic' | 'advanced';
  phase_config?: PhaseConfig;
  selected_phase_preset_id?: string | null;
  loras?: PathLoraConfig[];

  priority?: number;
  use_input_video_resolution?: boolean;
  use_input_video_fps?: boolean;
  vid2vid_init_strength?: number;
  loop_first_clip?: boolean;
}

export interface TravelBetweenImagesTaskWithParentGenerationResult {
  task: import("../../taskCreation").TaskCreationResult;
  parentGenerationId: string | undefined;
}
