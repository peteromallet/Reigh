import { describe, expect, it } from "vitest";

import {
  deriveRouteKey,
  parseRouteBackend,
  routeSnapshotFields,
  slugRoutePart,
} from "./routeKeys.ts";

describe("create-task route key serialization", () => {
  it("canonicalizes audited direct route aliases and preserves unknown direct task types", () => {
    expect(deriveRouteKey("z_image")).toBe("z_image_turbo");
    expect(deriveRouteKey("z_image_turbo_i2i")).toBe("z_image_turbo_i2i");
    expect(deriveRouteKey("optimised_t2i")).toBe("wan_2_2_t2i");
    expect(deriveRouteKey("qwen_image")).toBe("qwen_image");
    expect(deriveRouteKey("image-upscale")).toBe("image-upscale");
  });

  it("derives travel and individual travel dimensional keys with Python slug parity", () => {
    const params = {
      model_name: "LTX2 Distilled 13B",
      travel_guidance: { kind: "LTX+Anchor" },
      video_source: "https://example.com/guide.mp4",
      override_profile: 3,
    };

    expect(deriveRouteKey("travel_segment", params)).toBe(
      "travel_segment__model-ltx2_distilled__guidance-ltx_plus_anchor__continuity-video_source__profile-3",
    );
    expect(deriveRouteKey("individual_travel_segment", params)).toBe(
      "individual_travel_segment__model-ltx2_distilled__guidance-ltx_plus_anchor__continuity-video_source__profile-3",
    );
  });

  it("honors _source_task_type for direct worker child payloads", () => {
    expect(
      deriveRouteKey("run_model", {
        _source_task_type: "individual_travel_segment",
        model_family: "wan22_i2v",
        continuity_case: "first_last",
      }),
    ).toBe(
      "individual_travel_segment__model-wan22_i2v__guidance-none__continuity-first_last__profile-default",
    );
  });

  it("derives Wan VACE join keys with default join guidance and continuity", () => {
    expect(
      deriveRouteKey("join_clips_segment", {
        model_name: "Wan 2.2 VACE",
      }),
    ).toBe(
      "join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default",
    );
  });

  it("serializes route snapshot fields for later child row pinning", () => {
    expect(
      routeSnapshotFields({
        taskType: "join_clips_segment",
        params: { model_name: "Wan 2.2 VACE" },
        selectedBackend: "wgp",
        selectorVersion: 7,
        taskId: "task-1",
        parentRouteKey: "join_clips_orchestrator",
      }),
    ).toEqual({
      selector_namespace: "production",
      route_key: "join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default",
      selected_backend: "wgp",
      selector_version: 7,
      route_selection_snapshot: {
        selector_namespace: "production",
        route_key: "join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default",
        selected_backend: "wgp",
        selector_version: 7,
        task_id: "task-1",
        parent_route_key: "join_clips_orchestrator",
      },
    });
  });

  it("rejects comfy as a backend alias", () => {
    expect(parseRouteBackend("wgp")).toBe("wgp");
    expect(parseRouteBackend("vibecomfy")).toBe("vibecomfy");
    expect(() => parseRouteBackend("comfy")).toThrow("Unsupported route backend");
  });

  it("matches Python slugging for pluses, punctuation, and empty values", () => {
    expect(slugRoutePart("LTX+Anchor")).toBe("ltx_plus_anchor");
    expect(slugRoutePart(" Wan 2.2 VACE ")).toBe("wan_2_2_vace");
    expect(slugRoutePart("")).toBe("none");
  });
});
