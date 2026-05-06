export const ORCHESTRATION_CONTRACT_VERSION = 3 as const;
export const TASK_VIEW_CONTRACT_VERSION = 1 as const;
export const TASK_PAYLOAD_CONTRACT_VERSION = 1 as const;
export const TASK_FAMILY_CONTRACT_VERSION = 1 as const;

type JoinClipsMode = "legacy_join" | "multi_clip_join" | "video_edit_join";

export interface OrchestrationContract {
  contract_version: typeof ORCHESTRATION_CONTRACT_VERSION;
  task_family: string;
  orchestrator_task_id?: string;
  run_id?: string;
  parent_generation_id?: string;
  child_generation_id?: string;
  child_order?: number;
  shot_id?: string;
  based_on?: string;
  create_as_generation?: boolean;
}

export interface TaskViewContract {
  contract_version: typeof TASK_VIEW_CONTRACT_VERSION;
  input_images: string[];
  prompt?: string;
  enhanced_prompt?: string;
  negative_prompt?: string;
  model_name?: string;
  resolution?: string;
}

export interface TravelBetweenImagesReadContract {
  contract_version: typeof TASK_FAMILY_CONTRACT_VERSION;
  prompt?: string;
  enhanced_prompt?: string;
  negative_prompt?: string;
  model_name?: string;
  resolution?: string;
  enhance_prompt?: boolean;
  motion_mode?: string;
  selected_phase_preset_id?: string | null;
  advanced_mode?: boolean;
  amount_of_motion?: number;
  phase_config?: unknown;
  additional_loras?: Record<string, number>;
  segment_frames_expanded?: number[];
  frame_overlap_expanded?: number[];
  continuation_config?: unknown;
  chain_segments?: boolean;
  travel_guidance?: unknown;
  structure_guidance?: unknown;
  structure_videos?: unknown;
}

interface OrchestrationContractInput {
  taskFamily: string;
  orchestratorTaskId?: string;
  runId?: string;
  parentGenerationId?: string;
  childGenerationId?: string;
  childOrder?: number;
  shotId?: string;
  basedOn?: string;
  createAsGeneration?: boolean;
}

interface TaskViewContractInput {
  inputImages: string[];
  prompt?: string;
  enhancedPrompt?: string;
  negativePrompt?: string;
  modelName?: string;
  resolution?: string;
}

interface JoinClipsFamilyContract {
  contract_version: typeof TASK_FAMILY_CONTRACT_VERSION;
  mode: JoinClipsMode;
  run_id: string;
  clips: string[];
  overrides_count: number;
  has_audio: boolean;
}

interface IndividualSegmentFamilyContract {
  contract_version: typeof TASK_FAMILY_CONTRACT_VERSION;
  segment_index: number;
  has_end_image: boolean;
  has_pair_shot_generation_id: boolean;
}

interface TravelBetweenImagesFamilyContract {
  contract_version: typeof TASK_FAMILY_CONTRACT_VERSION;
  image_count: number;
  segment_count: number;
  has_pair_ids: boolean;
  read_contract?: TravelBetweenImagesReadContract;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildOrchestrationContract(
  input: OrchestrationContractInput,
): OrchestrationContract {
  const contract: OrchestrationContract = {
    contract_version: ORCHESTRATION_CONTRACT_VERSION,
    task_family: input.taskFamily,
  };

  if (input.orchestratorTaskId) contract.orchestrator_task_id = input.orchestratorTaskId;
  if (input.runId) contract.run_id = input.runId;
  if (input.parentGenerationId) contract.parent_generation_id = input.parentGenerationId;
  if (input.childGenerationId) contract.child_generation_id = input.childGenerationId;
  if (typeof input.childOrder === "number") contract.child_order = input.childOrder;
  if (input.shotId) contract.shot_id = input.shotId;
  if (input.basedOn) contract.based_on = input.basedOn;
  if (typeof input.createAsGeneration === "boolean") contract.create_as_generation = input.createAsGeneration;
  return contract;
}

export function buildTaskViewContract(input: TaskViewContractInput): TaskViewContract {
  const contract: TaskViewContract = {
    contract_version: TASK_VIEW_CONTRACT_VERSION,
    input_images: input.inputImages.filter(isNonEmptyString),
  };

  if (isNonEmptyString(input.prompt)) contract.prompt = input.prompt;
  if (isNonEmptyString(input.enhancedPrompt)) contract.enhanced_prompt = input.enhancedPrompt;
  if (isNonEmptyString(input.negativePrompt)) contract.negative_prompt = input.negativePrompt;
  if (isNonEmptyString(input.modelName)) contract.model_name = input.modelName;
  if (isNonEmptyString(input.resolution)) contract.resolution = input.resolution;

  return contract;
}

export function composeTaskFamilyPayload<
  TOrchestratorDetails extends object,
  TFamilyContract extends object,
>(input: {
  taskFamily: string;
  orchestratorDetails: TOrchestratorDetails;
  orchestrationInput: OrchestrationContractInput;
  taskViewInput: TaskViewContractInput;
  familyContract: TFamilyContract;
}): TOrchestratorDetails & {
  contract_version: typeof TASK_PAYLOAD_CONTRACT_VERSION;
  task_family: string;
  orchestrator_details: TOrchestratorDetails;
  orchestration_contract: OrchestrationContract;
  task_view_contract: TaskViewContract;
  family_contract: TFamilyContract;
} {
  return {
    ...input.orchestratorDetails,
    contract_version: TASK_PAYLOAD_CONTRACT_VERSION,
    task_family: input.taskFamily,
    orchestrator_details: input.orchestratorDetails,
    orchestration_contract: buildOrchestrationContract(input.orchestrationInput),
    task_view_contract: buildTaskViewContract(input.taskViewInput),
    family_contract: input.familyContract,
  };
}

export function buildJoinClipsFamilyContract(input: {
  mode: JoinClipsMode;
  runId: string;
  clipUrls: string[];
  overridesCount: number;
  hasAudio: boolean;
}): JoinClipsFamilyContract {
  return {
    contract_version: TASK_FAMILY_CONTRACT_VERSION,
    mode: input.mode,
    run_id: input.runId,
    clips: input.clipUrls,
    overrides_count: input.overridesCount,
    has_audio: input.hasAudio,
  };
}

export function buildIndividualSegmentFamilyContract(input: {
  segmentIndex: number;
  hasEndImage: boolean;
  hasPairShotGenerationId: boolean;
}): IndividualSegmentFamilyContract {
  return {
    contract_version: TASK_FAMILY_CONTRACT_VERSION,
    segment_index: input.segmentIndex,
    has_end_image: input.hasEndImage,
    has_pair_shot_generation_id: input.hasPairShotGenerationId,
  };
}

export function buildTravelBetweenImagesFamilyContract(input: {
  imageCount: number;
  segmentCount: number;
  hasPairIds: boolean;
  readContract?: TravelBetweenImagesReadContract;
}): TravelBetweenImagesFamilyContract {
  const contract: TravelBetweenImagesFamilyContract = {
    contract_version: TASK_FAMILY_CONTRACT_VERSION,
    image_count: input.imageCount,
    segment_count: input.segmentCount,
    has_pair_ids: input.hasPairIds,
  };

  if (input.readContract) {
    contract.read_contract = input.readContract;
  }

  return contract;
}
