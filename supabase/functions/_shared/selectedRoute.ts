export type WorkerBackend = "wgp" | "vibecomfy";
export type RouteSupportState = "wgp_only" | "vibecomfy_supported" | "vibecomfy_unsupported";

export const WORKER_ROUTE_CONTRACT_VERSION = 1;

export interface RouteSelectorEntry {
  route_key: string;
  support_state: RouteSupportState;
  template_id: string | null;
  default_resolution?: string | null;
}

export interface RouteSnapshotInput {
  task_type: string;
  params?: Record<string, unknown> | null;
  task_id?: string | null;
  backend?: WorkerBackend | string | null;
  selector_namespace?: string | null;
  selector_version?: number | string | null;
  parent_route_key?: string | null;
  profile?: string | null;
  run_id?: string | null;
  worker_contract_version?: number | null;
}

export interface RouteSelectionSnapshot {
  selector_namespace: string;
  route_key: string;
  selected_backend: WorkerBackend;
  selector_version: number | string | null;
  support_state: RouteSupportState;
  template_id: string | null;
  selected_profile: string;
  route_run_id: string | null;
  worker_contract_version: number;
  task_id?: string;
  parent_route_key?: string;
}

export interface RouteSnapshotFields {
  selector_namespace: string;
  route_key: string;
  selected_backend: WorkerBackend;
  selector_version: number | string | null;
  selected_profile: string;
  selected_template_id: string | null;
  route_run_id: string | null;
  worker_contract_version: number;
  route_selection_snapshot: RouteSelectionSnapshot;
}

export const DIRECT_ROUTE_ALIASES: Record<string, string> = {
  z_image: "z_image_turbo",
  z_image_turbo: "z_image_turbo",
  z_image_turbo_i2i: "z_image_turbo_i2i",
  qwen_image: "qwen_image",
  qwen_image_2512: "qwen_image_2512",
  optimised_t2i: "wan_2_2_t2i",
  wan_2_2_t2i: "wan_2_2_t2i",
  qwen_image_edit: "qwen_image_edit",
  qwen_image_style: "qwen_image_style",
  image_inpaint: "image_inpaint",
  annotated_image_edit: "annotated_image_edit",
};

export const SPRINT_2_SELECTOR_MAP: Record<string, RouteSelectorEntry> = {
  z_image_turbo: {
    route_key: "z_image_turbo",
    support_state: "vibecomfy_supported",
    template_id: "image/z_image",
    default_resolution: "1024x1024",
  },
  z_image_turbo_i2i: { route_key: "z_image_turbo_i2i", support_state: "wgp_only", template_id: null },
  qwen_image_2512: { route_key: "qwen_image_2512", support_state: "wgp_only", template_id: null },
  qwen_image: { route_key: "qwen_image", support_state: "wgp_only", template_id: null },
  qwen_image_edit: { route_key: "qwen_image_edit", support_state: "wgp_only", template_id: null },
  qwen_image_style: { route_key: "qwen_image_style", support_state: "wgp_only", template_id: null },
  image_inpaint: { route_key: "image_inpaint", support_state: "wgp_only", template_id: null },
  annotated_image_edit: { route_key: "annotated_image_edit", support_state: "wgp_only", template_id: null },
  travel_segment: { route_key: "travel_segment", support_state: "vibecomfy_unsupported", template_id: null },
  individual_travel_segment: {
    route_key: "individual_travel_segment",
    support_state: "vibecomfy_unsupported",
    template_id: null,
  },
  join_clips_segment: { route_key: "join_clips_segment", support_state: "vibecomfy_unsupported", template_id: null },
  wan_2_2_t2i: { route_key: "wan_2_2_t2i", support_state: "wgp_only", template_id: null },
};

const DIMENSIONAL_CHILD_TASK_TYPES = new Set([
  "travel_segment",
  "individual_travel_segment",
  "join_clips_segment",
]);

export function parseWorkerBackend(value?: string | null): WorkerBackend {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "wgp") return "wgp";
  if (normalized === "vibecomfy") return "vibecomfy";
  throw new Error(`Unsupported worker backend ${JSON.stringify(value)}; expected unset, 'wgp', or 'vibecomfy'`);
}

export function deriveRouteKey(taskType: string, params: Record<string, unknown> | null = {}): string {
  const taskParams = params ?? {};
  const sourceTaskType = taskParams._source_task_type;
  if (typeof sourceTaskType === "string" && DIMENSIONAL_CHILD_TASK_TYPES.has(sourceTaskType)) {
    return dimensionalChildRouteKey(sourceTaskType, taskParams);
  }
  if (DIMENSIONAL_CHILD_TASK_TYPES.has(taskType)) {
    return dimensionalChildRouteKey(taskType, taskParams);
  }
  return directRouteKey(taskType);
}

export function routeSnapshotFields(input: RouteSnapshotInput): RouteSnapshotFields {
  const params = { ...(input.params ?? {}) };
  const selectedBackend = parseWorkerBackend(input.backend ?? "wgp");
  const selectorNamespace = input.selector_namespace ?? "production";
  const selectorVersion = input.selector_version ?? null;
  const routeKey = deriveRouteKey(input.task_type, params);
  const selectorEntry = selectorEntryForRouteKey(routeKey);
  const supportState = selectorEntry?.support_state ?? "vibecomfy_unsupported";
  const templateId = selectorEntry?.template_id ?? null;
  const selectedProfile = String(input.profile ?? routeProfile(params));
  const routeRunId = input.run_id ?? null;
  const workerContractVersion = input.worker_contract_version ?? WORKER_ROUTE_CONTRACT_VERSION;

  const snapshot: RouteSelectionSnapshot = {
    selector_namespace: selectorNamespace,
    route_key: routeKey,
    selected_backend: selectedBackend,
    selector_version: selectorVersion,
    support_state: supportState,
    template_id: templateId,
    selected_profile: selectedProfile,
    route_run_id: routeRunId,
    worker_contract_version: workerContractVersion,
  };
  if (input.task_id) snapshot.task_id = input.task_id;
  if (input.parent_route_key) snapshot.parent_route_key = input.parent_route_key;

  return {
    selector_namespace: selectorNamespace,
    route_key: routeKey,
    selected_backend: selectedBackend,
    selector_version: selectorVersion,
    selected_profile: selectedProfile,
    selected_template_id: templateId,
    route_run_id: routeRunId,
    worker_contract_version: workerContractVersion,
    route_selection_snapshot: snapshot,
  };
}

function selectorEntryForRouteKey(routeKey: string): RouteSelectorEntry | null {
  const selectorEntry = SPRINT_2_SELECTOR_MAP[routeKey];
  if (selectorEntry) return selectorEntry;
  if (
    routeKey.startsWith("travel_segment__") ||
    routeKey.startsWith("individual_travel_segment__") ||
    routeKey.startsWith("join_clips_segment__")
  ) {
    return { route_key: routeKey, support_state: "vibecomfy_unsupported", template_id: null };
  }
  return null;
}

function directRouteKey(taskType: string): string {
  const slugged = slug(taskType);
  return DIRECT_ROUTE_ALIASES[slugged] ?? taskType;
}

function dimensionalChildRouteKey(taskType: string, params: Record<string, unknown>): string {
  return [
    slug(taskType),
    `model-${slug(routeModelFamily(params))}`,
    `guidance-${slug(routeGuidanceKind(taskType, params))}`,
    `continuity-${slug(routeContinuityCase(taskType, params))}`,
    `profile-${slug(routeProfile(params))}`,
  ].join("__");
}

function slug(value: unknown): string {
  const text = String(value || "none").trim().toLowerCase().replace(/\+/g, "_plus_");
  return text.replace(/[^a-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "none";
}

function routeModelFamily(params: Record<string, unknown>): string {
  const explicitFamily = params.model_family;
  if (explicitFamily) return String(explicitFamily);

  const normalized = slug(params.model_name ?? params.model);
  if (!normalized || normalized === "none") return "unknown";
  if (normalized.includes("wan_2_2") || normalized.includes("wan22")) {
    return normalized.includes("vace") ? "wan22_vace" : "wan22_i2v";
  }
  if (normalized.includes("ltx2")) {
    return normalized.includes("distilled") ? "ltx2_distilled" : "ltx2";
  }
  if (normalized.includes("qwen")) return "qwen";
  if (normalized.includes("z_image")) return "z_image";
  return normalized;
}

function routeGuidanceKind(taskType: string, params: Record<string, unknown>): string {
  const explicitKind = params.guidance_kind ?? params.travel_guidance_kind;
  if (explicitKind) return String(explicitKind);

  const travelGuidance = params.travel_guidance;
  if (travelGuidance && typeof travelGuidance === "object" && "kind" in travelGuidance) {
    const kind = (travelGuidance as { kind?: unknown }).kind;
    if (kind) return String(kind);
  }
  if (params.use_uni3c || params.uni3c_guide_video) return "uni3c";
  if (params.svi2pro) return "vace";
  if (params.video_guide || params.video_mask) return "vace";
  if (taskType === "join_clips_segment" && routeModelFamily(params) === "wan22_vace") return "vace";
  return "none";
}

function routeContinuityCase(taskType: string, params: Record<string, unknown>): string {
  if (params.continuity_case) return String(params.continuity_case);
  if (taskType === "join_clips_segment") return "join_bridge";
  if (params.video_source) return "video_source";
  return "first_last";
}

function routeProfile(params: Record<string, unknown>): string {
  return String(params.profile ?? params.wgp_profile ?? params.override_profile ?? "default");
}
