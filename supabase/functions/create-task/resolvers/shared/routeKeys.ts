export type RouteBackend = "wgp" | "vibecomfy";
export type RouteSupportState = "wgp_only" | "vibecomfy_supported" | "vibecomfy_unsupported";

export const WORKER_ROUTE_CONTRACT_VERSION = 1;

export interface RouteSelectorEntry {
  route_key: string;
  support_state: RouteSupportState;
  template_id: string | null;
}

export interface RouteSnapshotFieldsInput {
  taskType: string;
  params?: Record<string, unknown> | null;
  selectedBackend?: RouteBackend | string | null;
  selectorNamespace?: string;
  selectorVersion?: number | string | null;
  taskId?: string | null;
  parentRouteKey?: string | null;
  profile?: string | null;
  runId?: string | null;
  workerContractVersion?: number | null;
  supportState?: RouteSupportState | null;
  selectedTemplateId?: string | null;
}

export interface RouteSelectionSnapshot {
  selector_namespace: string;
  route_key: string;
  selected_backend: RouteBackend;
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
  selected_backend: RouteBackend;
  selector_version: number | string | null;
  support_state: RouteSupportState;
  selected_profile: string;
  selected_template_id: string | null;
  route_run_id: string | null;
  worker_contract_version: number;
  route_selection_snapshot: RouteSelectionSnapshot;
}

const DIRECT_ROUTE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
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
});

const DIMENSIONAL_CHILD_TASK_TYPES = new Set([
  "travel_segment",
  "individual_travel_segment",
  "join_clips_segment",
]);

const ROUTE_SELECTOR_MAP: Readonly<Record<string, RouteSelectorEntry>> = Object.freeze({
  z_image_turbo: {
    route_key: "z_image_turbo",
    support_state: "vibecomfy_supported",
    template_id: "image/z_image",
  },
  z_image_turbo_i2i: {
    route_key: "z_image_turbo_i2i",
    support_state: "vibecomfy_supported",
    template_id: "image/z_image_img2img",
  },
  qwen_image_2512: {
    route_key: "qwen_image_2512",
    support_state: "vibecomfy_supported",
    template_id: "image/qwen_image_2512",
  },
  qwen_image: {
    route_key: "qwen_image",
    support_state: "vibecomfy_supported",
    template_id: "image/qwen_image_2512",
  },
  qwen_image_edit: {
    route_key: "qwen_image_edit",
    support_state: "vibecomfy_supported",
    template_id: "edit/qwen_image_edit",
  },
  qwen_image_style: {
    route_key: "qwen_image_style",
    support_state: "vibecomfy_supported",
    template_id: "edit/qwen_image_edit",
  },
  image_inpaint: {
    route_key: "image_inpaint",
    support_state: "vibecomfy_supported",
    template_id: "edit/qwen_image_edit",
  },
  annotated_image_edit: {
    route_key: "annotated_image_edit",
    support_state: "vibecomfy_supported",
    template_id: "edit/qwen_image_edit",
  },
  travel_orchestrator: { route_key: "travel_orchestrator", support_state: "wgp_only", template_id: null },
  join_clips_orchestrator: { route_key: "join_clips_orchestrator", support_state: "wgp_only", template_id: null },
  edit_video_orchestrator: { route_key: "edit_video_orchestrator", support_state: "wgp_only", template_id: null },
  travel_segment: { route_key: "travel_segment", support_state: "vibecomfy_unsupported", template_id: null },
  individual_travel_segment: {
    route_key: "individual_travel_segment",
    support_state: "vibecomfy_unsupported",
    template_id: null,
  },
  join_clips_segment: { route_key: "join_clips_segment", support_state: "vibecomfy_unsupported", template_id: null },
  travel_stitch: { route_key: "travel_stitch", support_state: "wgp_only", template_id: null },
  join_final_stitch: { route_key: "join_final_stitch", support_state: "wgp_only", template_id: null },
  wan_2_2_t2i: {
    route_key: "wan_2_2_t2i",
    support_state: "vibecomfy_supported",
    template_id: "video/wanvideo_wrapper_22_14b_t2i",
  },
  wan_2_2_i2v: { route_key: "wan_2_2_i2v", support_state: "vibecomfy_unsupported", template_id: null },
  "image-upscale": { route_key: "image-upscale", support_state: "vibecomfy_unsupported", template_id: null },
  image_upscale: { route_key: "image_upscale", support_state: "vibecomfy_unsupported", template_id: null },
  video_enhance: { route_key: "video_enhance", support_state: "vibecomfy_unsupported", template_id: null },
  animate_character: { route_key: "animate_character", support_state: "vibecomfy_unsupported", template_id: null },
  flux_klein_edit: { route_key: "flux_klein_edit", support_state: "vibecomfy_unsupported", template_id: null },
});

function hasRoutingValue(value: unknown): boolean {
  return Boolean(value);
}

function valueToString(value: unknown): string {
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function slugRoutePart(value: unknown): string {
  const text = String(value || "none").trim().toLowerCase();
  const slugged = text
    .replace(/\+/g, "_plus_")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slugged || "none";
}

export function parseRouteBackend(value: unknown): RouteBackend {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "wgp") return "wgp";
  if (normalized === "vibecomfy") return "vibecomfy";
  throw new Error("Unsupported route backend; expected 'wgp' or 'vibecomfy'");
}

export function deriveRouteKey(
  taskType: string,
  params?: Record<string, unknown> | null,
): string {
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

export function routeSnapshotFields(input: RouteSnapshotFieldsInput): RouteSnapshotFields {
  const selectorNamespace = input.selectorNamespace ?? "production";
  const selectedBackend = parseRouteBackend(input.selectedBackend ?? "wgp");
  const routeKey = deriveRouteKey(input.taskType, input.params);
  const selectorVersion = input.selectorVersion ?? null;
  const selectorEntry = selectorEntryForRouteKey(routeKey);
  const supportState = input.supportState ?? selectorEntry?.support_state ?? "vibecomfy_unsupported";
  const templateId = input.selectedTemplateId ?? selectorEntry?.template_id ?? null;
  const selectedProfile = String(input.profile ?? routeProfile(input.params ?? {}));
  const routeRunId = input.runId ?? null;
  const workerContractVersion = input.workerContractVersion ?? WORKER_ROUTE_CONTRACT_VERSION;

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

  if (input.taskId) snapshot.task_id = input.taskId;
  if (input.parentRouteKey) snapshot.parent_route_key = input.parentRouteKey;

  return {
    selector_namespace: selectorNamespace,
    route_key: routeKey,
    selected_backend: selectedBackend,
    selector_version: selectorVersion,
    support_state: supportState,
    selected_profile: selectedProfile,
    selected_template_id: templateId,
    route_run_id: routeRunId,
    worker_contract_version: workerContractVersion,
    route_selection_snapshot: snapshot,
  };
}

export function normalizeRouteSnapshotFields(
  candidate: Record<string, unknown> | null | undefined,
  fallback: RouteSnapshotFieldsInput,
): RouteSnapshotFields {
  const base = routeSnapshotFields(fallback);
  const record = isRecord(candidate) ? candidate : {};
  const snapshot = isRecord(record.route_selection_snapshot) ? record.route_selection_snapshot : {};
  const routeKey = asNonEmptyString(record.route_key) ?? asNonEmptyString(snapshot.route_key) ?? base.route_key;
  const selectedBackend = parseRouteBackend(
    record.selected_backend ?? snapshot.selected_backend ?? fallback.selectedBackend ?? base.selected_backend,
  );
  const selectorNamespace = asNonEmptyString(record.selector_namespace)
    ?? asNonEmptyString(snapshot.selector_namespace)
    ?? base.selector_namespace;
  const selectorVersion = asSelectorVersion(record.selector_version ?? snapshot.selector_version) ?? base.selector_version;
  const supportState = parseSupportState(record.support_state ?? snapshot.support_state) ?? base.support_state;
  const selectedProfile = asNonEmptyString(record.selected_profile)
    ?? asNonEmptyString(snapshot.selected_profile)
    ?? base.selected_profile;
  const selectedTemplateId = asNullableString(record.selected_template_id ?? snapshot.template_id)
    ?? base.selected_template_id;
  const routeRunId = asNullableString(record.route_run_id ?? snapshot.route_run_id) ?? base.route_run_id;
  const workerContractVersion = asWorkerContractVersion(record.worker_contract_version ?? snapshot.worker_contract_version)
    ?? base.worker_contract_version;

  const normalizedSnapshot: RouteSelectionSnapshot = {
    selector_namespace: selectorNamespace,
    route_key: routeKey,
    selected_backend: selectedBackend,
    selector_version: selectorVersion,
    support_state: supportState,
    template_id: selectedTemplateId,
    selected_profile: selectedProfile,
    route_run_id: routeRunId,
    worker_contract_version: workerContractVersion,
  };
  const taskId = asNonEmptyString(snapshot.task_id) ?? fallback.taskId ?? null;
  const parentRouteKey = asNonEmptyString(snapshot.parent_route_key) ?? fallback.parentRouteKey ?? null;
  if (taskId) normalizedSnapshot.task_id = taskId;
  if (parentRouteKey) normalizedSnapshot.parent_route_key = parentRouteKey;

  return {
    selector_namespace: selectorNamespace,
    route_key: routeKey,
    selected_backend: selectedBackend,
    selector_version: selectorVersion,
    support_state: supportState,
    selected_profile: selectedProfile,
    selected_template_id: selectedTemplateId,
    route_run_id: routeRunId,
    worker_contract_version: workerContractVersion,
    route_selection_snapshot: normalizedSnapshot,
  };
}

export function selectorEntryForRouteKey(routeKey: string): RouteSelectorEntry | null {
  const selectorEntry = ROUTE_SELECTOR_MAP[routeKey];
  if (selectorEntry) return selectorEntry;
  if (
    routeKey.startsWith("travel_segment__") ||
    routeKey.startsWith("individual_travel_segment__") ||
    routeKey.startsWith("join_clips_segment__")
  ) {
    if (isWanVaceCocktailRoute(routeKey)) {
      return {
        route_key: routeKey,
        support_state: "vibecomfy_supported",
        template_id: "video/wanvideo_wrapper_22_14b_vace_cocktail",
      };
    }
    return { route_key: routeKey, support_state: "vibecomfy_unsupported", template_id: null };
  }
  return null;
}

function isWanVaceCocktailRoute(routeKey: string): boolean {
  if (!routeKey.includes("__model-wan22_vace__")) return false;
  if (routeKey.includes("__guidance-uni3c__")) return false;
  return (
    routeKey.includes("__guidance-vace__") ||
    routeKey.includes("__guidance-vace_flow__") ||
    routeKey.includes("__guidance-vace_canny__") ||
    routeKey.includes("__guidance-vace_depth__") ||
    routeKey.includes("__guidance-vace_raw__")
  );
}

function directRouteKey(taskType: string): string {
  const slugged = slugRoutePart(taskType);
  return DIRECT_ROUTE_ALIASES[slugged] ?? taskType;
}

function dimensionalChildRouteKey(
  taskType: string,
  params: Record<string, unknown>,
): string {
  return [
    slugRoutePart(taskType),
    `model-${slugRoutePart(routeModelFamily(params))}`,
    `guidance-${slugRoutePart(routeGuidanceKey(taskType, params))}`,
    `continuity-${slugRoutePart(routeContinuityCase(taskType, params))}`,
    `profile-${slugRoutePart(routeProfile(params))}`,
  ].join("__");
}

function routeModelFamily(params: Record<string, unknown>): string {
  if (hasRoutingValue(params.model_family)) {
    return valueToString(params.model_family);
  }

  const normalized = slugRoutePart(params.model_name || params.model);
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
  const explicitKind = params.guidance_kind || params.travel_guidance_kind;
  if (hasRoutingValue(explicitKind)) return valueToString(explicitKind);

  const travelGuidance = params.travel_guidance;
  if (isRecord(travelGuidance) && hasRoutingValue(travelGuidance.kind)) {
    return valueToString(travelGuidance.kind);
  }

  if (params.use_uni3c || params.uni3c_guide_video) return "uni3c";
  if (params.svi2pro) return "vace";
  if (params.video_guide || params.video_mask) return "vace";
  if (taskType === "join_clips_segment" && routeModelFamily(params) === "wan22_vace") {
    return "vace";
  }

  return "none";
}

function routeGuidanceMode(params: Record<string, unknown>): string {
  const explicitMode = params.guidance_mode || params.travel_guidance_mode;
  if (hasRoutingValue(explicitMode)) return valueToString(explicitMode);

  const travelGuidance = params.travel_guidance;
  if (isRecord(travelGuidance) && hasRoutingValue(travelGuidance.mode)) {
    return valueToString(travelGuidance.mode);
  }

  return "none";
}

function routeGuidanceKey(taskType: string, params: Record<string, unknown>): string {
  const kind = routeGuidanceKind(taskType, params);
  const mode = routeGuidanceMode(params);
  if ((kind === "vace" || kind === "ltx_control") && mode && mode !== "none") {
    return `${kind}_${mode}`;
  }
  return kind;
}

function routeContinuityCase(taskType: string, params: Record<string, unknown>): string {
  if (hasRoutingValue(params.continuity_case)) return valueToString(params.continuity_case);
  if (taskType === "join_clips_segment") return "join_bridge";
  if (params.video_source) return "video_source";
  return "first_last";
}

function routeProfile(params: Record<string, unknown>): string {
  return valueToString(
    params.profile
    || params.wgp_profile
    || params.override_profile
    || "default",
  );
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNullableString(value: unknown): string | null {
  return value === null || typeof value === "string" ? value : null;
}

function asSelectorVersion(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function asWorkerContractVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseSupportState(value: unknown): RouteSupportState | null {
  if (
    value === "wgp_only" ||
    value === "vibecomfy_supported" ||
    value === "vibecomfy_unsupported"
  ) {
    return value;
  }
  return null;
}
