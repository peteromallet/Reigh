import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  classifyVibeComfyBlockerForEntry,
  parseWorkerBackend,
  requiredRouteRequirementsForParent,
  routeRequirementForRouteKey,
  routeRequirementForTask,
  routeSnapshotFields,
  selectedRouteRequirementFromContract,
  WORKER_ROUTE_CONTRACT_VERSION,
} from "./selectedRoute.ts";

interface Fixture {
  name: string;
  input: Parameters<typeof routeSnapshotFields>[0];
  expected: ReturnType<typeof routeSnapshotFields>;
}

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL("./selectedRoute.fixtures.json", import.meta.url)), "utf-8"),
) as Fixture[];

describe("selected route contract", () => {
  it("matches the shared fixture snapshots used by Python", () => {
    for (const fixture of fixtures) {
      expect(routeSnapshotFields(fixture.input), fixture.name).toEqual(fixture.expected);
    }
  });

  it("defaults unknown legacy tasks to WGP with contract version labels", () => {
    const fields = routeSnapshotFields({ task_type: "custom_task", params: {} });

    expect(fields).toMatchObject({
      selector_namespace: "production",
      route_key: "custom_task",
      selected_backend: "wgp",
      selected_profile: "default",
      selected_template_id: null,
      route_run_id: null,
      worker_contract_version: WORKER_ROUTE_CONTRACT_VERSION,
    });
    expect(fields.route_selection_snapshot.support_state).toBe("vibecomfy_unsupported");
  });

  it("parses worker backends strictly", () => {
    expect(parseWorkerBackend(null)).toBe("wgp");
    expect(parseWorkerBackend("vibecomfy")).toBe("vibecomfy");
    expect(() => parseWorkerBackend("comfy")).toThrow(/Unsupported worker backend/);
  });

  it("enumerates travel parent child and control route requirements", () => {
    expect(requiredRouteRequirementsForParent({ task_type: "travel_orchestrator" })).toEqual([
      expect.objectContaining({
        task_type: "travel_segment",
        route_key: "travel_segment__model-unknown__guidance-none__continuity-first_last__profile-default",
        role: "child",
        required_by_route_key: "travel_orchestrator",
        vibecomfy_blocker: "unsupported",
      }),
      expect.objectContaining({
        task_type: "travel_stitch",
        route_key: "travel_stitch",
        role: "control",
        required_by_route_key: "travel_orchestrator",
        vibecomfy_blocker: "wgp_only",
      }),
      expect.objectContaining({
        task_type: "join_clips_orchestrator",
        route_key: "join_clips_orchestrator",
        role: "nested_parent",
        required_by_route_key: "travel_orchestrator",
        vibecomfy_blocker: "wgp_only",
      }),
    ]);
  });

  it("enumerates join and edit-video child/control route requirements", () => {
    expect(requiredRouteRequirementsForParent({ task_type: "join_clips_orchestrator" })).toEqual([
      expect.objectContaining({
        task_type: "join_clips_segment",
        role: "child",
        required_by_route_key: "join_clips_orchestrator",
        vibecomfy_blocker: "unsupported",
      }),
      expect.objectContaining({
        task_type: "join_final_stitch",
        route_key: "join_final_stitch",
        role: "control",
        required_by_route_key: "join_clips_orchestrator",
        vibecomfy_blocker: "wgp_only",
      }),
    ]);

    expect(requiredRouteRequirementsForParent({ task_type: "edit_video_orchestrator" })).toEqual([
      expect.objectContaining({
        task_type: "join_clips_segment",
        role: "child",
        required_by_route_key: "edit_video_orchestrator",
        vibecomfy_blocker: "unsupported",
      }),
      expect.objectContaining({
        task_type: "join_final_stitch",
        route_key: "join_final_stitch",
        role: "control",
        required_by_route_key: "edit_video_orchestrator",
        vibecomfy_blocker: "wgp_only",
      }),
    ]);
  });

  it("classifies dimensional child routes and direct VibeComfy-supported routes", () => {
    expect(routeRequirementForTask({
      task_type: "join_clips_segment",
      params: {
        model_family: "wan22_vace",
        guidance_kind: "vace",
        continuity_case: "join_bridge",
      },
    })).toMatchObject({
      route_key: "join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default",
      support_state: "vibecomfy_unsupported",
      vibecomfy_blocker: "unsupported",
    });

    expect(routeRequirementForRouteKey({ route_key: "z_image_turbo" })).toMatchObject({
      support_state: "vibecomfy_supported",
      template_id: "image/z_image",
      vibecomfy_blocker: null,
    });
  });

  it("derives mode-aware WAN VACE and LTX control keys", () => {
    const wanBase = {
      model_name: "wan_2_2_vace_lightning_baseline_2_2_2",
      continuity_case: "first_last",
      profile: "default",
    };
    const ltxBase = {
      model_name: "ltx2_22B_distilled_1_1",
      continuity_case: "first_last",
      profile: "default",
      guidance_kind: "ltx_control",
    };

    expect(
      ["flow", "canny", "depth", "raw"].map((mode) =>
        routeRequirementForTask({
          task_type: "travel_segment",
          params: { ...wanBase, travel_guidance: { kind: "vace", mode } },
        }).route_key
      ),
    ).toEqual([
      "travel_segment__model-wan22_vace__guidance-vace_flow__continuity-first_last__profile-default",
      "travel_segment__model-wan22_vace__guidance-vace_canny__continuity-first_last__profile-default",
      "travel_segment__model-wan22_vace__guidance-vace_depth__continuity-first_last__profile-default",
      "travel_segment__model-wan22_vace__guidance-vace_raw__continuity-first_last__profile-default",
    ]);

    expect(
      ["video", "pose", "depth", "canny", "cameraman"].map((guidance_mode) =>
        routeRequirementForTask({
          task_type: "travel_segment",
          params: { ...ltxBase, guidance_mode },
        }).route_key
      ),
    ).toEqual([
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_video__continuity-first_last__profile-default",
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_pose__continuity-first_last__profile-default",
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_depth__continuity-first_last__profile-default",
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_canny__continuity-first_last__profile-default",
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_cameraman__continuity-first_last__profile-default",
    ]);
  });

  it("classifies VibeComfy blocker reasons consistently", () => {
    expect(routeRequirementForRouteKey({ route_key: "unknown_route" }).vibecomfy_blocker).toBe("unknown");
    expect(routeRequirementForRouteKey({ route_key: "travel_stitch" }).vibecomfy_blocker).toBe("wgp_only");
    expect(routeRequirementForRouteKey({ route_key: "travel_segment" }).vibecomfy_blocker).toBe("unsupported");
    expect(selectedRouteRequirementFromContract({
      route_selection_snapshot: {
        route_key: "future_supported_route",
        support_state: "vibecomfy_supported",
        template_id: null,
      },
    }).vibecomfy_blocker).toBe("missing_template");
    expect(classifyVibeComfyBlockerForEntry("fallback_route", {
      route_key: "fallback_route",
      support_state: "vibecomfy_supported",
      template_id: "video/fallback",
      vibecomfy_status: "fallback",
    })).toBe("fallback");
    expect(classifyVibeComfyBlockerForEntry("untested_route", {
      route_key: "untested_route",
      support_state: "vibecomfy_supported",
      template_id: "video/untested",
      vibecomfy_status: "untested",
    })).toBe("untested");
    expect(selectedRouteRequirementFromContract({
      route_selection_snapshot: {
        route_key: "broken_route",
        support_state: "bad_state",
        template_id: null,
      },
    }).vibecomfy_blocker).toBe("malformed");
  });
});
