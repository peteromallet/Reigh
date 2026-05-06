import { describe, expect, it } from "vitest";

import { routeSnapshotFields } from "../_shared/selectedRoute.ts";
import type { TaskInsertObject } from "./resolvers/types.ts";
import { ROUTE_CONTRACT_PARAM_KEY, stampTaskRouteContract } from "./routeContract.ts";

function baseTask(params: Record<string, unknown>, taskType = "z_image_turbo"): TaskInsertObject {
  return {
    id: "task-1",
    project_id: "project-1",
    task_type: taskType,
    params,
    status: "Queued",
  };
}

describe("create-task route contract stamping", () => {
  it("stamps frontend/API tasks with a deterministic selected route contract", () => {
    const stamped = stampTaskRouteContract(baseTask({ prompt: "a lighthouse", profile: "fast" }));

    expect(stamped.params.prompt).toBe("a lighthouse");
    expect(stamped.params[ROUTE_CONTRACT_PARAM_KEY]).toEqual(
      routeSnapshotFields({
        task_type: "z_image_turbo",
        params: { prompt: "a lighthouse", profile: "fast" },
        task_id: "task-1",
        backend: "wgp",
      }),
    );
  });

  it("stamps explicit request route selection candidates", () => {
    const stamped = stampTaskRouteContract(
      baseTask({ prompt: "a lighthouse", profile: "fast" }),
      {
        backend: "vibecomfy",
        selector_namespace: "canary",
        selector_version: 8,
        profile: "production",
        run_id: "run-vc-1",
      },
    );

    expect(stamped.params[ROUTE_CONTRACT_PARAM_KEY]).toEqual(
      routeSnapshotFields({
        task_type: "z_image_turbo",
        params: { prompt: "a lighthouse", profile: "fast" },
        task_id: "task-1",
        backend: "vibecomfy",
        selector_namespace: "canary",
        selector_version: 8,
        profile: "production",
        run_id: "run-vc-1",
      }),
    );
  });

  it("normalizes valid worker-provided snapshots into the canonical nested param", () => {
    const params = {
      _source_task_type: "join_clips_segment",
      model_family: "wan22_vace",
      guidance_kind: "vace",
      continuity_case: "join_bridge",
      dependant_on: ["child-a"],
    };
    const workerRoute = routeSnapshotFields({
      task_type: "join_clips_segment",
      params,
      task_id: "task-worker-1",
      backend: "wgp",
      selector_namespace: "canary",
      selector_version: 7,
      parent_route_key: "join_clips_orchestrator",
      profile: "default",
      run_id: "run-1",
      worker_contract_version: 1,
    });

    const stamped = stampTaskRouteContract({
      ...baseTask({
        ...params,
        ...workerRoute,
      }, "join_clips_segment"),
      id: "task-worker-1",
    });

    expect(stamped.params[ROUTE_CONTRACT_PARAM_KEY]).toEqual(workerRoute);
    expect(stamped.params.route_key).toBeUndefined();
    expect(stamped.params.selected_backend).toBeUndefined();
    expect(stamped.params.route_selection_snapshot).toBeUndefined();
    expect(stamped.params.dependant_on).toEqual(["child-a"]);
  });

  it("preserves valid nested worker snapshots and removes stale legacy copies", () => {
    const cleanParams = { prompt: "cat", profile: "default" };
    const validRoute = routeSnapshotFields({
      task_type: "z_image_turbo",
      params: cleanParams,
      task_id: "task-1",
      backend: "vibecomfy",
      selector_namespace: "canary",
      selector_version: 3,
      run_id: "run-vc",
    });

    const stamped = stampTaskRouteContract(baseTask({
      ...cleanParams,
      [ROUTE_CONTRACT_PARAM_KEY]: validRoute,
      route_key: "stale-top-level",
      selected_backend: "wgp",
    }));

    expect(stamped.params[ROUTE_CONTRACT_PARAM_KEY]).toEqual(validRoute);
    expect(stamped.params.route_key).toBeUndefined();
    expect(stamped.params.selected_backend).toBeUndefined();
  });

  it("derives a safe default contract when worker metadata is malformed", () => {
    const stamped = stampTaskRouteContract(baseTask({
      prompt: "a city",
      route_key: "z_image_turbo",
      selected_backend: "not-a-backend",
      selector_namespace: "canary",
      selected_profile: "default",
      worker_contract_version: 1,
      route_selection_snapshot: { route_key: "stale-route" },
    }));

    expect(stamped.params[ROUTE_CONTRACT_PARAM_KEY]).toEqual(
      routeSnapshotFields({
        task_type: "z_image_turbo",
        params: { prompt: "a city" },
        task_id: "task-1",
        backend: "wgp",
      }),
    );
    expect(stamped.params.selected_backend).toBeUndefined();
    expect(stamped.params.route_selection_snapshot).toBeUndefined();
  });

  it("derives legacy missing-metadata task types without route field leakage", () => {
    const stamped = stampTaskRouteContract(baseTask({ prompt: "legacy" }, "legacy_custom_task"));

    expect(stamped.params[ROUTE_CONTRACT_PARAM_KEY]).toMatchObject({
      selector_namespace: "production",
      route_key: "legacy_custom_task",
      selected_backend: "wgp",
      selected_profile: "default",
      selected_template_id: null,
      route_run_id: null,
      worker_contract_version: 1,
    });
  });
});
