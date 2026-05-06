export type RouteBackend = "wgp" | "vibecomfy";

export interface RouteSnapshotFieldsInput {
  taskType: string;
  params?: Record<string, unknown> | null;
  selectedBackend: RouteBackend | string;
  selectorNamespace?: string;
  selectorVersion?: number | string | null;
  taskId?: string | null;
  parentRouteKey?: string | null;
}

export interface RouteSelectionSnapshot {
  selector_namespace: string;
  route_key: string;
  selected_backend: RouteBackend;
  selector_version: number | string | null;
  task_id?: string;
  parent_route_key?: string;
}

export interface RouteSnapshotFields {
  selector_namespace: string;
  route_key: string;
  selected_backend: RouteBackend;
  selector_version: number | string | null;
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
  const selectedBackend = parseRouteBackend(input.selectedBackend);
  const routeKey = deriveRouteKey(input.taskType, input.params);
  const selectorVersion = input.selectorVersion ?? null;

  const snapshot: RouteSelectionSnapshot = {
    selector_namespace: selectorNamespace,
    route_key: routeKey,
    selected_backend: selectedBackend,
    selector_version: selectorVersion,
  };

  if (input.taskId) snapshot.task_id = input.taskId;
  if (input.parentRouteKey) snapshot.parent_route_key = input.parentRouteKey;

  return {
    selector_namespace: selectorNamespace,
    route_key: routeKey,
    selected_backend: selectedBackend,
    selector_version: selectorVersion,
    route_selection_snapshot: snapshot,
  };
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
    `guidance-${slugRoutePart(routeGuidanceKind(taskType, params))}`,
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
