import { describe, expect, it } from "vitest";

import { getTaskFamilyResolver } from "../registry.ts";
import type { ResolveRequest, ResolverContext, ResolverResult } from "../types.ts";
import { routeSnapshotFields, type RouteSupportState } from "../shared/routeKeys.ts";

type ActiveFamilyCase = {
  name: string;
  family: string;
  input: Record<string, unknown>;
  expectedTaskTypes: string[];
  expectedSupport: Record<string, RouteSupportState>;
};

const context: ResolverContext = {
  supabaseAdmin: {
    rpc: async () => ({ data: "parent-generation-1", error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as ResolverContext["supabaseAdmin"],
  projectId: "project-1",
  aspectRatio: "16:9",
  logger: {} as ResolverContext["logger"],
};

async function resolveFamily(candidate: ActiveFamilyCase): Promise<ResolverResult> {
  const resolver = getTaskFamilyResolver(candidate.family);
  expect(resolver, `${candidate.family} should be registered`).toBeDefined();
  return await resolver!({
    family: candidate.family,
    project_id: "project-1",
    input: candidate.input,
  } satisfies ResolveRequest, context);
}

const activeFamilyCases: ActiveFamilyCase[] = [
  {
    name: "image generation qwen alias",
    family: "image_generation",
    input: { prompts: [{ id: "p1", fullPrompt: "cinematic still" }], imagesPerPrompt: 1, model_name: "qwen-image" },
    expectedTaskTypes: ["qwen_image"],
    expectedSupport: { qwen_image: "vibecomfy_supported" },
  },
  {
    name: "image generation wan t2i",
    family: "image_generation",
    input: { prompts: [{ id: "p1", fullPrompt: "cinematic still" }], imagesPerPrompt: 1, model_name: "optimised-t2i" },
    expectedTaskTypes: ["wan_2_2_t2i"],
    expectedSupport: { wan_2_2_t2i: "vibecomfy_supported" },
  },
  {
    name: "image generation z image",
    family: "image_generation",
    input: { prompts: [{ id: "p1", fullPrompt: "cinematic still" }], imagesPerPrompt: 1, model_name: "z-image" },
    expectedTaskTypes: ["z_image_turbo"],
    expectedSupport: { z_image_turbo: "vibecomfy_supported" },
  },
  {
    name: "magic edit",
    family: "magic_edit",
    input: { prompt: "edit", image_url: "https://example.com/source.png" },
    expectedTaskTypes: ["qwen_image_edit"],
    expectedSupport: { qwen_image_edit: "vibecomfy_supported" },
  },
  {
    name: "masked inpaint",
    family: "masked_edit",
    input: {
      task_type: "image_inpaint",
      image_url: "https://example.com/source.png",
      mask_url: "https://example.com/mask.png",
      prompt: "fill",
      num_generations: 1,
    },
    expectedTaskTypes: ["image_inpaint"],
    expectedSupport: { image_inpaint: "vibecomfy_supported" },
  },
  {
    name: "annotated masked edit",
    family: "masked_edit",
    input: {
      task_type: "annotated_image_edit",
      image_url: "https://example.com/source.png",
      mask_url: "https://example.com/mask.png",
      prompt: "fill",
      num_generations: 1,
    },
    expectedTaskTypes: ["annotated_image_edit"],
    expectedSupport: { annotated_image_edit: "vibecomfy_supported" },
  },
  {
    name: "z image i2i",
    family: "z_image_turbo_i2i",
    input: { image_url: "https://example.com/source.png", prompt: "rework", numImages: 1 },
    expectedTaskTypes: ["z_image_turbo_i2i"],
    expectedSupport: { z_image_turbo_i2i: "vibecomfy_supported" },
  },
  {
    name: "image upscale",
    family: "image_upscale",
    input: { image_url: "https://example.com/source.png" },
    expectedTaskTypes: ["image-upscale"],
    expectedSupport: { "image-upscale": "vibecomfy_supported" },
  },
  {
    name: "video enhance",
    family: "video_enhance",
    input: { video_url: "https://example.com/source.mp4", enable_interpolation: true, enable_upscale: true },
    expectedTaskTypes: ["video_enhance"],
    expectedSupport: { video_enhance: "vibecomfy_supported" },
  },
  {
    name: "character animate",
    family: "character_animate",
    input: {
      character_image_url: "https://example.com/character.png",
      motion_video_url: "https://example.com/motion.mp4",
      mode: "animate",
      resolution: "480p",
    },
    expectedTaskTypes: ["animate_character"],
    expectedSupport: { animate_character: "vibecomfy_supported" },
  },
  {
    name: "klein edit",
    family: "klein_edit",
    input: { prompt: "edit", image_url: "https://example.com/source.png", klein_model: "flux-klein-4b" },
    expectedTaskTypes: ["flux_klein_edit"],
    expectedSupport: { flux_klein_edit: "vibecomfy_supported" },
  },
  {
    name: "travel between images parent",
    family: "travel_between_images",
    input: {
      parent_generation_id: "parent-generation-1",
      shot_id: "shot-1",
      image_urls: ["https://example.com/start.png", "https://example.com/end.png"],
      base_prompts: ["travel"],
      segment_frames: [49],
      frame_overlap: [0],
    },
    expectedTaskTypes: ["travel_orchestrator"],
    expectedSupport: { travel_orchestrator: "wgp_only" },
  },
  {
    name: "individual VACE segment",
    family: "individual_travel_segment",
    input: {
      parent_generation_id: "parent-generation-1",
      segment_index: 0,
      start_image_url: "https://example.com/start.png",
      end_image_url: "https://example.com/end.png",
      model_name: "wan_2_2_vace_lightning_baseline_2_2_2",
      model_type: "vace",
      travel_guidance: { kind: "vace", mode: "raw" },
      continuity_case: "first_last",
      num_frames: 49,
    },
    expectedTaskTypes: ["individual_travel_segment"],
    expectedSupport: {
      "individual_travel_segment__model-wan22_vace__guidance-vace_raw__continuity-first_last__profile-default": "vibecomfy_supported",
    },
  },
  {
    name: "join clips parent",
    family: "join_clips",
    input: {
      mode: "multi_clip",
      clip_source: { kind: "clips", clips: [{ url: "https://example.com/a.mp4" }, { url: "https://example.com/b.mp4" }] },
    },
    expectedTaskTypes: ["join_clips_orchestrator"],
    expectedSupport: { join_clips_orchestrator: "wgp_only" },
  },
  {
    name: "crossfade join",
    family: "crossfade_join",
    input: {
      clip_urls: ["https://example.com/a.mp4", "https://example.com/b.mp4"],
      frame_overlap_settings_expanded: [8],
    },
    expectedTaskTypes: ["travel_stitch"],
    expectedSupport: { travel_stitch: "wgp_only" },
  },
  {
    name: "edit video orchestrator",
    family: "edit_video_orchestrator",
    input: { orchestrator_details: { mode: "replace", source: "test" } },
    expectedTaskTypes: ["edit_video_orchestrator"],
    expectedSupport: { edit_video_orchestrator: "wgp_only" },
  },
];

describe("active app create-task families", () => {
  it.each(activeFamilyCases)("$name emits a registered task type with explicit route support", async (candidate) => {
    const result = await resolveFamily(candidate);
    expect(result.tasks.map((task) => task.task_type)).toEqual(candidate.expectedTaskTypes);

    for (const task of result.tasks) {
      const snapshot = routeSnapshotFields({
        taskType: task.task_type,
        params: task.params,
        selectedBackend: "vibecomfy",
      });
      expect(snapshot.support_state).toBe(candidate.expectedSupport[snapshot.route_key]);
      expect(candidate.expectedSupport).toHaveProperty(snapshot.route_key);
    }
  });
});
