import type { ResolverResult, TaskFamilyResolver, TaskInsertObject } from "./types.ts";
import { generateRunId, generateTaskId } from "./shared/ids.ts";
import {
  TaskValidationError,
  validateRequiredFields,
} from "./shared/validation.ts";
import { resolveSeed32Bit } from "./shared/seed.ts";

interface CharacterAnimateTaskInput {
  character_image_url: string;
  motion_video_url: string;
  prompt?: string;
  mode: "replace" | "animate";
  resolution: "480p" | "720p";
  num_frames?: number;
  seed?: number;
  random_seed?: boolean;
}

const DEFAULT_CHARACTER_ANIMATE_VALUES = {
  mode: "animate" as const,
  resolution: "480p" as const,
  prompt: "natural expression; preserve outfit details",
  seed: 111111,
  random_seed: true,
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

function validateCharacterAnimateInput(input: CharacterAnimateTaskInput): void {
  validateRequiredFields(input, ["character_image_url", "motion_video_url", "mode", "resolution"]);

  if (!["replace", "animate"].includes(input.mode)) {
    throw new TaskValidationError("mode must be 'replace' or 'animate'", "mode");
  }
  if (!["480p", "720p"].includes(input.resolution)) {
    throw new TaskValidationError("resolution must be '480p' or '720p'", "resolution");
  }
  if (
    input.num_frames !== undefined
    && (
      !Number.isInteger(input.num_frames)
      || input.num_frames < 1
      || input.num_frames > 337
      || (input.num_frames - 1) % 4 !== 0
    )
  ) {
    throw new TaskValidationError("num_frames must be an integer between 1 and 337 in 4N+1 form", "num_frames");
  }
}

export const characterAnimateResolver: TaskFamilyResolver = (request, context): ResolverResult => {
  const input = request.input as unknown as CharacterAnimateTaskInput;
  validateCharacterAnimateInput(input);

  return {
    tasks: [
      buildQueuedTask(context.projectId, "animate_character", {
        orchestrator_task_id: generateTaskId("character_animate"),
        run_id: generateRunId(),
        character_image_url: input.character_image_url,
        motion_video_url: input.motion_video_url,
        prompt: input.prompt ?? DEFAULT_CHARACTER_ANIMATE_VALUES.prompt,
        mode: input.mode ?? DEFAULT_CHARACTER_ANIMATE_VALUES.mode,
        resolution: input.resolution ?? DEFAULT_CHARACTER_ANIMATE_VALUES.resolution,
        ...(input.num_frames !== undefined ? { num_frames: input.num_frames } : {}),
        seed: resolveSeed32Bit({
          seed: input.seed,
          randomize: input.random_seed ?? DEFAULT_CHARACTER_ANIMATE_VALUES.random_seed,
          fallbackSeed: DEFAULT_CHARACTER_ANIMATE_VALUES.seed,
          field: "seed",
        }),
      }),
    ],
  };
};
