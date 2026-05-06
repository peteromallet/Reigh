import {
  routeSnapshotFields,
  type RouteSnapshotFields,
  type WorkerBackend,
} from "../_shared/selectedRoute.ts";
import type { TaskInsertObject } from "./resolvers/types.ts";

export const ROUTE_CONTRACT_PARAM_KEY = "route_contract";

const LEGACY_ROUTE_FIELD_KEYS = new Set([
  "selector_namespace",
  "route_key",
  "selected_backend",
  "selector_version",
  "selected_profile",
  "selected_template_id",
  "route_run_id",
  "worker_contract_version",
  "route_selection_snapshot",
  "claimed_backend",
  "claimed_selector_namespace",
  "claimed_route_key",
  "claimed_selector_version",
  "claimed_capability_version",
  "claim_decision_reason",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || (left == null && right == null);
}

function sanitizeRouteParams(params: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === ROUTE_CONTRACT_PARAM_KEY || LEGACY_ROUTE_FIELD_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function extractRouteCandidate(params: Record<string, unknown>): Record<string, unknown> | null {
  const nested = params[ROUTE_CONTRACT_PARAM_KEY];
  if (isRecord(nested)) {
    return nested;
  }

  const legacyEntries = Object.entries(params).filter(([key]) => LEGACY_ROUTE_FIELD_KEYS.has(key));
  if (legacyEntries.length === 0) {
    return null;
  }
  return Object.fromEntries(legacyEntries);
}

function asBackend(value: unknown): WorkerBackend | null {
  return value === "wgp" || value === "vibecomfy" ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asSelectorVersion(value: unknown): number | string | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function validateCandidate(
  task: TaskInsertObject,
  sanitizedParams: Record<string, unknown>,
  candidate: Record<string, unknown> | null,
): RouteSnapshotFields | null {
  if (!candidate) {
    return null;
  }

  const selectedBackend = asBackend(candidate.selected_backend);
  const selectorNamespace = asStringOrNull(candidate.selector_namespace);
  const routeKey = asStringOrNull(candidate.route_key);
  const selectedProfile = asStringOrNull(candidate.selected_profile);
  const routeRunId = asStringOrNull(candidate.route_run_id);
  const workerContractVersion = asNumberOrNull(candidate.worker_contract_version);
  if (!selectedBackend || !selectorNamespace || !routeKey || !selectedProfile || workerContractVersion == null) {
    return null;
  }

  const snapshot = isRecord(candidate.route_selection_snapshot) ? candidate.route_selection_snapshot : null;
  if (!snapshot) {
    return null;
  }

  const parentRouteKey = asStringOrNull(snapshot.parent_route_key);
  const expected = routeSnapshotFields({
    task_type: task.task_type,
    params: sanitizedParams,
    task_id: task.id ?? asStringOrNull(snapshot.task_id),
    backend: selectedBackend,
    selector_namespace: selectorNamespace,
    selector_version: asSelectorVersion(candidate.selector_version),
    parent_route_key: parentRouteKey,
    profile: selectedProfile,
    run_id: routeRunId,
    worker_contract_version: workerContractVersion,
  });

  if (!sameValue(routeKey, expected.route_key)) return null;
  if (!sameValue(candidate.selected_template_id, expected.selected_template_id)) return null;
  if (!sameValue(snapshot.selector_namespace, expected.route_selection_snapshot.selector_namespace)) return null;
  if (!sameValue(snapshot.route_key, expected.route_selection_snapshot.route_key)) return null;
  if (!sameValue(snapshot.selected_backend, expected.route_selection_snapshot.selected_backend)) return null;
  if (!sameValue(snapshot.selector_version, expected.route_selection_snapshot.selector_version)) return null;
  if (!sameValue(snapshot.template_id, expected.route_selection_snapshot.template_id)) return null;
  if (!sameValue(snapshot.selected_profile, expected.route_selection_snapshot.selected_profile)) return null;
  if (!sameValue(snapshot.route_run_id, expected.route_selection_snapshot.route_run_id)) return null;
  if (!sameValue(snapshot.worker_contract_version, expected.route_selection_snapshot.worker_contract_version)) return null;
  if (!sameValue(snapshot.parent_route_key, expected.route_selection_snapshot.parent_route_key)) return null;

  return expected;
}

export function stampTaskRouteContract(task: TaskInsertObject): TaskInsertObject {
  const sanitizedParams = sanitizeRouteParams(task.params ?? {});
  const preservedContract = validateCandidate(
    task,
    sanitizedParams,
    extractRouteCandidate(task.params ?? {}),
  );
  const routeContract = preservedContract ?? routeSnapshotFields({
    task_type: task.task_type,
    params: sanitizedParams,
    task_id: task.id,
    backend: "wgp",
  });

  return {
    ...task,
    params: {
      ...sanitizedParams,
      [ROUTE_CONTRACT_PARAM_KEY]: routeContract,
    },
  };
}
