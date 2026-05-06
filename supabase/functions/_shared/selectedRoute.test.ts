import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseWorkerBackend, routeSnapshotFields, WORKER_ROUTE_CONTRACT_VERSION } from "./selectedRoute.ts";

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
});
