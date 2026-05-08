import { describe, expect, it } from "vitest";
import { imageGenerationResolver } from "../imageGeneration.ts";
import { imageUpscaleResolver } from "../imageUpscale.ts";
import { joinClipsResolver } from "../joinClips.ts";
import { magicEditResolver } from "../magicEdit.ts";
import { travelBetweenImagesResolver } from "../travelBetweenImages.ts";
import { zImageTurboI2IResolver } from "../zImageTurboI2I.ts";
import { createWorkerPassthroughResolver } from "../workerPassthrough.ts";
import type { ResolveRequest, ResolverContext, ResolverResult } from "../types.ts";

const timelinePlacement = {
  timeline_id: "timeline-1",
  source_clip_id: "clip-1",
  target_track: "V1",
  insertion_time: 12.5,
  intent: "after_source" as const,
};

const placementIntent = {
  timeline_id: "timeline-1",
  anchor_clip_id: "clip-1",
  anchor_generation_id: "gen-1",
  anchor_variant_id: "variant-1",
  relation: "after" as const,
  preferred_track_id: "V1",
  fallback_at: 12.5,
  fallback_track_id: "V1",
};

const context: ResolverContext = {
  supabaseAdmin: {} as ResolverContext["supabaseAdmin"],
  projectId: "project-1",
  aspectRatio: "16:9",
  logger: {} as ResolverContext["logger"],
};

function expectPlacement(result: ResolverResult) {
  expect(result.tasks).toHaveLength(1);
  expect(result.tasks[0]?.params.timeline_placement).toEqual(timelinePlacement);
}

function expectPlacementIntent(result: ResolverResult) {
  expect(result.tasks).toHaveLength(1);
  expect(result.tasks[0]?.params.placement_intent).toEqual(placementIntent);
}

describe("resolver timeline placement persistence", () => {
  it("keeps timeline_placement in params for the real imageGenerationResolver", () => {
    const result = imageGenerationResolver({
      family: "image-generation",
      project_id: "project-1",
      input: {
        prompts: [{ id: "prompt-1", fullPrompt: "cinematic skyline at dusk" }],
        imagesPerPrompt: 1,
        model_name: "qwen-image",
        timeline_placement: timelinePlacement,
      },
    } satisfies ResolveRequest, context);

    expectPlacement(result);
  });

  it("keeps timeline_placement in params for the real magicEditResolver", () => {
    const result = magicEditResolver({
      family: "magic-edit",
      project_id: "project-1",
      input: {
        prompt: "extend the clouds",
        image_url: "https://example.com/source.png",
        timeline_placement: timelinePlacement,
      },
    } satisfies ResolveRequest, context);

    expectPlacement(result);
  });

  it("keeps timeline_placement in params for the real zImageTurboI2IResolver", () => {
    const result = zImageTurboI2IResolver({
      family: "z-image-turbo-i2i",
      project_id: "project-1",
      input: {
        image_url: "https://example.com/source.png",
        prompt: "more dramatic lighting",
        timeline_placement: timelinePlacement,
      },
    } satisfies ResolveRequest, context);

    expectPlacement(result);
  });

  it("keeps placement_intent in params for the real magicEditResolver", () => {
    const result = magicEditResolver({
      family: "magic-edit",
      project_id: "project-1",
      input: {
        prompt: "extend the clouds",
        image_url: "https://example.com/source.png",
        placement_intent: placementIntent,
      },
    } satisfies ResolveRequest, context);

    expectPlacementIntent(result);
  });

  it("keeps placement_intent in params for the real zImageTurboI2IResolver", () => {
    const result = zImageTurboI2IResolver({
      family: "z-image-turbo-i2i",
      project_id: "project-1",
      input: {
        image_url: "https://example.com/source.png",
        prompt: "more dramatic lighting",
        placement_intent: placementIntent,
      },
    } satisfies ResolveRequest, context);

    expectPlacementIntent(result);
  });

  it("keeps placement_intent in params for the real imageUpscaleResolver", () => {
    const result = imageUpscaleResolver({
      family: "image-upscale",
      project_id: "project-1",
      input: {
        image_url: "https://example.com/source.png",
        generation_id: "gen-1",
        source_variant_id: "variant-1",
        placement_intent: placementIntent,
      },
    } satisfies ResolveRequest, context);

    expectPlacementIntent(result);
  });
});

describe("Wan/VACE child contract resolver coverage", () => {
  it("passes worker-created Wan/VACE travel child ids and dependencies through", () => {
    const resolver = createWorkerPassthroughResolver("travel_segment");
    const result = resolver({
      family: "travel_segment",
      project_id: "project-1",
      input: {
        task_id: "travel-child-worker-id",
        dependant_on: ["previous-child-id"],
        model_name: "wan_2_2_vace_lightning_baseline_2_2_2",
        model_type: "vace",
        selected_phase_preset_id: "__builtin_vace_default__",
        phase_config: {
          num_phases: 3,
          steps_per_phase: [2, 2, 2],
          flow_shift: 5,
          model_switch_phase: 2,
          phases: [
            { guidance_scale: 3 },
            { guidance_scale: 1 },
            { guidance_scale: 1 },
          ],
        },
        parent_generation_id: "parent-generation-1",
        child_order: 1,
        pair_shot_generation_id: "pair-shot-1",
      },
    } satisfies ResolveRequest, context) as ResolverResult;

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      id: "travel-child-worker-id",
      task_type: "travel_segment",
      dependant_on: ["previous-child-id"],
    });
    expect(result.tasks[0]?.params).toMatchObject({
      model_type: "vace",
      selected_phase_preset_id: "__builtin_vace_default__",
      parent_generation_id: "parent-generation-1",
      child_order: 1,
      pair_shot_generation_id: "pair-shot-1",
    });
  });

  it("passes worker-created Wan/VACE join child overrides and dependency arrays through", () => {
    const resolver = createWorkerPassthroughResolver("join_clips_segment");
    const routeSnapshot = {
      selector_namespace: "production",
      route_key: "join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default",
      selected_backend: "vibecomfy",
      selector_version: 12,
    };
    const result = resolver({
      family: "join_clips_segment",
      project_id: "project-1",
      input: {
        task_id: "join-child-worker-id",
        dependant_on: ["clip-a-task", "clip-b-task"],
        route_key: routeSnapshot.route_key,
        selected_backend: "vibecomfy",
        selector_version: 12,
        route_selection_snapshot: routeSnapshot,
        model: "wan_2_2_vace_lightning_baseline_2_2_2",
        selected_phase_preset_id: "__builtin_vace_default__",
        prompt: "bridge two clips",
        negative_prompt: "warped",
        num_inference_steps: 6,
        guidance_scale: 3,
        guidance2_scale: 1,
        guidance3_scale: 1,
        parent_generation_id: "parent-generation-join",
        child_order: 0,
        pair_shot_generation_id: "join-pair-shot-1",
      },
    } satisfies ResolveRequest, context) as ResolverResult;

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      id: "join-child-worker-id",
      task_type: "join_clips_segment",
      dependant_on: ["clip-a-task", "clip-b-task"],
      route_key: routeSnapshot.route_key,
      selected_backend: "vibecomfy",
      selector_version: 12,
      route_selection_snapshot: routeSnapshot,
    });
    expect(result.tasks[0]?.params).toMatchObject({
      route_key: routeSnapshot.route_key,
      selected_backend: "vibecomfy",
      selector_version: 12,
      route_selection_snapshot: routeSnapshot,
      selected_phase_preset_id: "__builtin_vace_default__",
      num_inference_steps: 6,
      guidance_scale: 3,
      guidance2_scale: 1,
      guidance3_scale: 1,
      parent_generation_id: "parent-generation-join",
      child_order: 0,
      pair_shot_generation_id: "join-pair-shot-1",
    });
  });

  it("rejects worker-created route fields with malformed backend or snapshot shape", () => {
    const resolver = createWorkerPassthroughResolver("travel_segment");

    expect(() => resolver({
      family: "travel_segment",
      project_id: "project-1",
      input: {
        task_id: "bad-backend-child",
        route_key: "travel_segment",
        selected_backend: "comfy",
      },
    } satisfies ResolveRequest, context)).toThrow(/Unsupported route backend/);

    expect(() => resolver({
      family: "travel_segment",
      project_id: "project-1",
      input: {
        task_id: "bad-snapshot-child",
        route_key: "travel_segment",
        selected_backend: "wgp",
        route_selection_snapshot: ["not", "an", "object"],
      },
    } satisfies ResolveRequest, context)).toThrow(/route_selection_snapshot must be an object/);
  });

  it("keeps Wan/VACE join defaults and per-join overrides in the task contract", () => {
    const result = joinClipsResolver({
      family: "join_clips",
      project_id: "project-1",
      input: {
        mode: "multi_clip",
        parent_generation_id: "parent-generation-join",
        clip_source: {
          kind: "clips",
          clips: [
            { url: "https://example.com/a.mp4" },
            { url: "https://example.com/b.mp4" },
            { url: "https://example.com/c.mp4" },
          ],
        },
        per_join_settings: [
          { prompt: "first bridge", guidance_scale: 2.5 },
          { prompt: "second bridge", seed: 333 },
        ],
      },
    } satisfies ResolveRequest, context) as ResolverResult;

    const params = result.tasks[0]?.params;
    expect(result.tasks[0]?.task_type).toBe("join_clips_orchestrator");
    expect(params).toMatchObject({
      model: "wan_2_2_vace_lightning_baseline_2_2_2",
      selected_phase_preset_id: "__builtin_vace_default__",
      parent_generation_id: "parent-generation-join",
    });
    expect(params?.phase_config).toMatchObject({
      num_phases: 3,
      flow_shift: 5,
      model_switch_phase: 2,
      mode: "vace",
    });
    expect(params?.per_join_settings).toEqual([
      { prompt: "first bridge", guidance_scale: 2.5 },
      { prompt: "second bridge", seed: 333 },
    ]);
    expect(params?.orchestration_contract).toMatchObject({
      task_family: "join_clips",
      parent_generation_id: "parent-generation-join",
    });
  });

  it("keeps Wan/VACE travel orchestrator contract inputs without sibling completion assertions", async () => {
    const supabaseAdmin = {
      rpc: async () => ({ data: "parent-generation-travel", error: null }),
    };
    const result = await travelBetweenImagesResolver({
      family: "travel_between_images",
      project_id: "project-1",
      input: {
        shot_id: "shot-1",
        image_urls: ["https://example.com/start.png", "https://example.com/end.png"],
        image_generation_ids: ["start-gen", "end-gen"],
        pair_shot_generation_ids: ["pair-shot-travel"],
        base_prompts: ["travel bridge"],
        segment_frames: [49],
        frame_overlap: [0],
        model_name: "wan_2_2_vace_lightning_baseline_2_2_2",
        model_type: "vace",
        selected_phase_preset_id: "__builtin_vace_default__",
        travel_guidance: { kind: "vace", mode: "raw" },
        structure_guidance: { type: "depth" },
        structure_videos: [{ url: "https://example.com/depth.mp4" }],
        chain_segments: true,
      },
    } satisfies ResolveRequest, { ...context, supabaseAdmin } as ResolverContext);

    const params = result.tasks[0]?.params;
    expect(result.meta).toEqual({ parentGenerationId: "parent-generation-travel" });
    expect(result.tasks[0]?.task_type).toBe("travel_orchestrator");
    expect(params?.parent_generation_id).toBe("parent-generation-travel");
    expect(params?.orchestrator_details).toMatchObject({
      model_name: "wan_2_2_vace_lightning_baseline_2_2_2",
      model_type: "vace",
      selected_phase_preset_id: "__builtin_vace_default__",
      travel_guidance: { kind: "vace", mode: "raw" },
      chain_segments: true,
      parent_generation_id: "parent-generation-travel",
      input_image_generation_ids: ["start-gen", "end-gen"],
      pair_shot_generation_ids: ["pair-shot-travel"],
    });
    expect(params?.orchestrator_details?.structure_guidance).toBeUndefined();
    expect(params?.orchestrator_details?.structure_videos).toBeUndefined();
  });

  it("passes legacy structure guidance when travel_guidance is absent", async () => {
    const supabaseAdmin = {
      rpc: async () => ({ data: "parent-generation-structure", error: null }),
    };
    const result = await travelBetweenImagesResolver({
      family: "travel_between_images",
      project_id: "project-1",
      input: {
        shot_id: "shot-1",
        image_urls: ["https://example.com/start.png", "https://example.com/end.png"],
        base_prompts: ["uni3c bridge"],
        segment_frames: [49],
        frame_overlap: [0],
        model_name: "wan_2_2_i2v_lightning_baseline_2_2_2",
        structure_guidance: { type: "uni3c", strength: 0.75 },
        structure_videos: [{ url: "https://example.com/uni3c.mp4" }],
        chain_segments: false,
      },
    } satisfies ResolveRequest, { ...context, supabaseAdmin } as ResolverContext);

    const params = result.tasks[0]?.params;
    expect(params?.orchestrator_details).toMatchObject({
      structure_guidance: { type: "uni3c", strength: 0.75 },
      structure_videos: [{ url: "https://example.com/uni3c.mp4" }],
      chain_segments: false,
    });
    expect(params?.orchestrator_details?.travel_guidance).toBeUndefined();
  });

  it("keeps turbo-mode Wan I2V travel requests on the owned orchestrator path", async () => {
    const supabaseAdmin = {
      rpc: async () => ({ data: "parent-generation-turbo", error: null }),
    };
    const result = await travelBetweenImagesResolver({
      family: "travel_between_images",
      project_id: "project-1",
      input: {
        shot_id: "shot-1",
        image_urls: ["https://example.com/start.png", "https://example.com/end.png"],
        base_prompts: ["turbo bridge"],
        segment_frames: [49],
        frame_overlap: [0],
        model_name: "wan_2_2_i2v_lightning_baseline_2_2_2",
        turbo_mode: true,
      },
    } satisfies ResolveRequest, { ...context, supabaseAdmin } as ResolverContext);

    expect(result.tasks[0]?.task_type).toBe("travel_orchestrator");
    expect(result.tasks[0]?.params?.orchestrator_details).toMatchObject({
      model_name: "wan_2_2_i2v_lightning_baseline_2_2_2",
      parent_generation_id: "parent-generation-turbo",
    });
  });

  it("routes default non-Qwen non-Z image generation to Wan T2I without app frame fields", () => {
    const result = imageGenerationResolver({
      family: "image_generation",
      project_id: "project-1",
      input: {
        prompts: [{ id: "prompt-1", fullPrompt: "single-frame image" }],
        imagesPerPrompt: 1,
        model_name: "optimised-t2i",
        seed: 42,
      },
    } satisfies ResolveRequest, context);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.task_type).toBe("wan_2_2_t2i");
    expect(result.tasks[0]?.params.model).toBe("optimised-t2i");
    expect(result.tasks[0]?.params.video_length).toBeUndefined();
    expect(result.tasks[0]?.params.num_frames).toBeUndefined();
  });
});
