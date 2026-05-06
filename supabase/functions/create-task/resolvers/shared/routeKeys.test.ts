import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  deriveRouteKey,
  normalizeRouteSnapshotFields,
  parseRouteBackend,
  routeSnapshotFields,
  WORKER_ROUTE_CONTRACT_VERSION,
  slugRoutePart,
} from "./routeKeys.ts";

interface SharedFixture {
  name: string;
  input: {
    task_type: string;
    params?: Record<string, unknown> | null;
    task_id?: string | null;
    backend?: string | null;
    selector_namespace?: string | null;
    selector_version?: number | string | null;
    parent_route_key?: string | null;
    profile?: string | null;
    run_id?: string | null;
    worker_contract_version?: number | null;
  };
  expected: ReturnType<typeof routeSnapshotFields>;
}

const sharedFixtures = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "../reigh-app/supabase/functions/_shared/selectedRoute.fixtures.json"),
    "utf8",
  ),
) as SharedFixture[];

function fromSharedInput(input: SharedFixture["input"]): Parameters<typeof routeSnapshotFields>[0] {
  return {
    taskType: input.task_type,
    params: input.params,
    taskId: input.task_id,
    selectedBackend: input.backend,
    selectorNamespace: input.selector_namespace ?? undefined,
    selectorVersion: input.selector_version,
    parentRouteKey: input.parent_route_key,
    profile: input.profile,
    runId: input.run_id,
    workerContractVersion: input.worker_contract_version,
  };
}

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

  it("keeps WAN VACE control modes distinct for identical model continuity and profile", () => {
    const base = {
      model_name: "wan_2_2_vace_lightning_baseline_2_2_2",
      continuity_case: "first_last",
      profile: "default",
    };

    expect(
      ["flow", "canny", "depth", "raw"].map((mode) =>
        deriveRouteKey("travel_segment", {
          ...base,
          travel_guidance: { kind: "vace", mode },
        })
      ),
    ).toEqual([
      "travel_segment__model-wan22_vace__guidance-vace_flow__continuity-first_last__profile-default",
      "travel_segment__model-wan22_vace__guidance-vace_canny__continuity-first_last__profile-default",
      "travel_segment__model-wan22_vace__guidance-vace_depth__continuity-first_last__profile-default",
      "travel_segment__model-wan22_vace__guidance-vace_raw__continuity-first_last__profile-default",
    ]);
  });

  it("keeps LTX control modes distinct for identical model continuity and profile", () => {
    const base = {
      model_name: "ltx2_22B_distilled_1_1",
      continuity_case: "first_last",
      profile: "default",
      guidance_kind: "ltx_control",
    };

    expect(
      ["video", "pose", "depth", "canny", "cameraman"].map((guidance_mode) =>
        deriveRouteKey("travel_segment", { ...base, guidance_mode })
      ),
    ).toEqual([
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_video__continuity-first_last__profile-default",
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_pose__continuity-first_last__profile-default",
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_depth__continuity-first_last__profile-default",
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_canny__continuity-first_last__profile-default",
      "travel_segment__model-ltx2_distilled__guidance-ltx_control_cameraman__continuity-first_last__profile-default",
    ]);
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
      support_state: "vibecomfy_unsupported",
      selected_profile: "default",
      selected_template_id: null,
      route_run_id: null,
      worker_contract_version: WORKER_ROUTE_CONTRACT_VERSION,
      route_selection_snapshot: {
        selector_namespace: "production",
        route_key: "join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default",
        selected_backend: "wgp",
        selector_version: 7,
        support_state: "vibecomfy_unsupported",
        template_id: null,
        selected_profile: "default",
        route_run_id: null,
        worker_contract_version: WORKER_ROUTE_CONTRACT_VERSION,
        task_id: "task-1",
        parent_route_key: "join_clips_orchestrator",
      },
    });
  });

  it("matches the shared TypeScript/Python route snapshot fixtures", () => {
    for (const fixture of sharedFixtures) {
      expect(routeSnapshotFields(fromSharedInput(fixture.input)), fixture.name).toEqual(fixture.expected);
    }
  });

  it("normalizes legacy partial snapshots into the full route contract", () => {
    expect(
      normalizeRouteSnapshotFields(
        {
          selector_namespace: "canary",
          route_key: "join_final_stitch",
          selected_backend: "wgp",
          selector_version: 12,
          route_selection_snapshot: {
            parent_route_key: "join_clips_orchestrator",
          },
        },
        {
          taskType: "join_final_stitch",
          params: {},
          selectedBackend: "wgp",
          profile: "production",
          runId: "run-legacy",
        },
      ),
    ).toEqual({
      selector_namespace: "canary",
      route_key: "join_final_stitch",
      selected_backend: "wgp",
      selector_version: 12,
      support_state: "wgp_only",
      selected_profile: "production",
      selected_template_id: null,
      route_run_id: "run-legacy",
      worker_contract_version: WORKER_ROUTE_CONTRACT_VERSION,
      route_selection_snapshot: {
        selector_namespace: "canary",
        route_key: "join_final_stitch",
        selected_backend: "wgp",
        selector_version: 12,
        support_state: "wgp_only",
        template_id: null,
        selected_profile: "production",
        route_run_id: "run-legacy",
        worker_contract_version: WORKER_ROUTE_CONTRACT_VERSION,
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
