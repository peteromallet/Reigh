import {
  routeSnapshotFields,
  type RouteSnapshotFields,
  type WorkerBackend,
} from "./selectedRoute.ts";

export interface RouteDemandEntry {
  selected_backend: WorkerBackend;
  selected_profile: string;
  selector_namespace: string;
  selector_version: number | string | null;
  route_key: string;
  selected_template_id: string | null;
  route_run_id: string | null;
  worker_contract_version: number;
  queued_only: number;
  active_only: number;
  queued_plus_active: number;
  blocked_by_capacity: number;
  potentially_claimable: number;
}

export interface WorkerRouteRequest {
  worker_backend: WorkerBackend;
  worker_profile: string;
  selector_namespace: string;
  selector_version: number | string | null;
  worker_contract_version: number;
  worker_pool: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkerBackend(value: unknown): value is WorkerBackend {
  return value === "wgp" || value === "vibecomfy";
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asSelectorVersion(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function asWorkerContractVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readRouteContractFromParams(
  taskType: string,
  params: Record<string, unknown> | null | undefined,
  taskId?: string | null,
): RouteSnapshotFields | null {
  const rawParams = params ?? {};
  const candidate = rawParams.route_contract;
  if (isRecord(candidate)) {
    const selectedBackend = isWorkerBackend(candidate.selected_backend) ? candidate.selected_backend : null;
    const selectorNamespace = asNonEmptyString(candidate.selector_namespace);
    const routeKey = asNonEmptyString(candidate.route_key);
    const selectedProfile = asNonEmptyString(candidate.selected_profile);
    const workerContractVersion = asWorkerContractVersion(candidate.worker_contract_version);
    const snapshot = isRecord(candidate.route_selection_snapshot) ? candidate.route_selection_snapshot : null;
    if (!selectedBackend || !selectorNamespace || !routeKey || !selectedProfile || workerContractVersion == null || !snapshot) {
      return null;
    }
    return {
      selector_namespace: selectorNamespace,
      route_key: routeKey,
      selected_backend: selectedBackend,
      selector_version: asSelectorVersion(candidate.selector_version),
      selected_profile: selectedProfile,
      selected_template_id: typeof candidate.selected_template_id === "string" ? candidate.selected_template_id : null,
      route_run_id: typeof candidate.route_run_id === "string" ? candidate.route_run_id : null,
      worker_contract_version: workerContractVersion,
      route_selection_snapshot: {
        selector_namespace: selectorNamespace,
        route_key: routeKey,
        selected_backend: selectedBackend,
        selector_version: asSelectorVersion(candidate.selector_version),
        support_state: snapshot.support_state === "wgp_only" ||
            snapshot.support_state === "vibecomfy_supported" ||
            snapshot.support_state === "vibecomfy_unsupported"
          ? snapshot.support_state
          : "vibecomfy_unsupported",
        template_id: typeof candidate.selected_template_id === "string" ? candidate.selected_template_id : null,
        selected_profile: selectedProfile,
        route_run_id: typeof candidate.route_run_id === "string" ? candidate.route_run_id : null,
        worker_contract_version: workerContractVersion,
        ...(typeof snapshot.task_id === "string" ? { task_id: snapshot.task_id } : {}),
        ...(typeof snapshot.parent_route_key === "string" ? { parent_route_key: snapshot.parent_route_key } : {}),
      },
    };
  }

  return routeSnapshotFields({
    task_type: taskType,
    params: rawParams,
    task_id: taskId,
    backend: "wgp",
  });
}

export function parseWorkerRouteRequest(body: unknown): WorkerRouteRequest {
  const record = isRecord(body) ? body : {};
  const workerBackend = isWorkerBackend(record.worker_backend) ? record.worker_backend : "wgp";
  const selectorNamespace = asNonEmptyString(record.selector_namespace) ?? "production";
  const workerProfile = asNonEmptyString(record.worker_profile) ?? "default";
  const workerContractVersion = asWorkerContractVersion(record.worker_contract_version) ?? 1;
  return {
    worker_backend: workerBackend,
    worker_profile: workerProfile,
    selector_namespace: selectorNamespace,
    selector_version: asSelectorVersion(record.selector_version),
    worker_contract_version: workerContractVersion,
    worker_pool: asNonEmptyString(record.worker_pool),
  };
}

function demandKey(route: RouteSnapshotFields): string {
  return [
    route.selected_backend,
    route.selected_profile,
    route.selector_namespace,
    route.selector_version ?? "",
    route.route_key,
    route.worker_contract_version,
  ].join("\u001f");
}

export function addRouteDemand(
  demand: Map<string, RouteDemandEntry>,
  route: RouteSnapshotFields | null,
  field: "queued_only" | "active_only" | "blocked_by_capacity" | "potentially_claimable",
): void {
  if (!route) {
    return;
  }
  const key = demandKey(route);
  const current = demand.get(key) ?? {
    selected_backend: route.selected_backend,
    selected_profile: route.selected_profile,
    selector_namespace: route.selector_namespace,
    selector_version: route.selector_version,
    route_key: route.route_key,
    selected_template_id: route.selected_template_id,
    route_run_id: route.route_run_id,
    worker_contract_version: route.worker_contract_version,
    queued_only: 0,
    active_only: 0,
    queued_plus_active: 0,
    blocked_by_capacity: 0,
    potentially_claimable: 0,
  };
  current[field] += 1;
  current.queued_plus_active = current.queued_only + current.active_only;
  if (field === "queued_only" && current.potentially_claimable < current.queued_only) {
    current.potentially_claimable = current.queued_only;
  } else if (field === "blocked_by_capacity") {
    current.potentially_claimable += 1;
  }
  demand.set(key, current);
}
