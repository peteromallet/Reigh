export type WorkerBackend = "wgp" | "vibecomfy";
export type RouteSupportState = "wgp_only" | "vibecomfy_supported" | "vibecomfy_unsupported";

export const WORKER_ROUTE_CONTRACT_VERSION = 1;

export interface RouteSelectorEntry {
  route_key: string;
  support_state: RouteSupportState;
  template_id: string | null;
  default_resolution?: string | null;
  vibecomfy_status?: "tested" | "untested" | "fallback";
}

export type VibeComfyRouteBlockerReason =
  | "wgp_only"
  | "unsupported"
  | "missing_template"
  | "fallback"
  | "untested"
  | "unknown"
  | "malformed";

export type RouteRequirementRole = "parent" | "child" | "control" | "nested_parent";

export interface SelectedRouteRequirement {
  task_type: string;
  route_key: string;
  support_state: RouteSupportState | null;
  template_id: string | null;
  role: RouteRequirementRole;
  required_by_route_key?: string;
  vibecomfy_blocker: VibeComfyRouteBlockerReason | null;
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
  support_state: RouteSupportState;
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
    vibecomfy_status: "tested",
  },
  z_image_turbo_i2i: {
    route_key: "z_image_turbo_i2i",
    support_state: "vibecomfy_supported",
    template_id: "image/z_image_img2img",
    default_resolution: "1024x1024",
    vibecomfy_status: "tested",
  },
  qwen_image_2512: {
    route_key: "qwen_image_2512",
    support_state: "vibecomfy_supported",
    template_id: "image/qwen_image_2512",
    vibecomfy_status: "tested",
  },
  qwen_image: { route_key: "qwen_image", support_state: "wgp_only", template_id: null },
  qwen_image_edit: {
    route_key: "qwen_image_edit",
    support_state: "vibecomfy_supported",
    template_id: "edit/qwen_image_edit",
    vibecomfy_status: "tested",
  },
  qwen_image_style: {
    route_key: "qwen_image_style",
    support_state: "vibecomfy_supported",
    template_id: "edit/qwen_image_edit",
    vibecomfy_status: "tested",
  },
  image_inpaint: {
    route_key: "image_inpaint",
    support_state: "vibecomfy_supported",
    template_id: "edit/qwen_image_edit",
    vibecomfy_status: "tested",
  },
  annotated_image_edit: {
    route_key: "annotated_image_edit",
    support_state: "vibecomfy_supported",
    template_id: "edit/qwen_image_edit",
    vibecomfy_status: "tested",
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
    default_resolution: "832x480",
    vibecomfy_status: "tested",
  },
};

const WAN_VACE_COCKTAIL_TEMPLATE = "video/wanvideo_wrapper_22_14b_vace_cocktail";

export const SECTION3A_ROUTE_SUPPORT_MAP: Record<string, RouteSelectorEntry> = {
  "travel_segment__model-wan22_vace__guidance-vace_flow__continuity-first_last__profile-default": {
    route_key: "travel_segment__model-wan22_vace__guidance-vace_flow__continuity-first_last__profile-default",
    support_state: "vibecomfy_supported",
    template_id: WAN_VACE_COCKTAIL_TEMPLATE,
    vibecomfy_status: "tested",
  },
  "travel_segment__model-wan22_vace__guidance-vace_canny__continuity-first_last__profile-default": {
    route_key: "travel_segment__model-wan22_vace__guidance-vace_canny__continuity-first_last__profile-default",
    support_state: "vibecomfy_supported",
    template_id: WAN_VACE_COCKTAIL_TEMPLATE,
    vibecomfy_status: "tested",
  },
  "travel_segment__model-wan22_vace__guidance-vace_depth__continuity-first_last__profile-default": {
    route_key: "travel_segment__model-wan22_vace__guidance-vace_depth__continuity-first_last__profile-default",
    support_state: "vibecomfy_supported",
    template_id: WAN_VACE_COCKTAIL_TEMPLATE,
    vibecomfy_status: "tested",
  },
  "travel_segment__model-wan22_vace__guidance-vace_raw__continuity-first_last__profile-default": {
    route_key: "travel_segment__model-wan22_vace__guidance-vace_raw__continuity-first_last__profile-default",
    support_state: "vibecomfy_supported",
    template_id: WAN_VACE_COCKTAIL_TEMPLATE,
    vibecomfy_status: "tested",
  },
  "travel_segment__model-wan22_vace__guidance-vace__continuity-video_source__profile-default": {
    route_key: "travel_segment__model-wan22_vace__guidance-vace__continuity-video_source__profile-default",
    support_state: "vibecomfy_supported",
    template_id: WAN_VACE_COCKTAIL_TEMPLATE,
    vibecomfy_status: "tested",
  },
  "individual_travel_segment__model-wan22_vace__guidance-vace__continuity-first_last__profile-default": {
    route_key: "individual_travel_segment__model-wan22_vace__guidance-vace__continuity-first_last__profile-default",
    support_state: "vibecomfy_supported",
    template_id: WAN_VACE_COCKTAIL_TEMPLATE,
    vibecomfy_status: "tested",
  },
  "individual_travel_segment__model-wan22_vace__guidance-vace_raw__continuity-first_last__profile-default": {
    route_key: "individual_travel_segment__model-wan22_vace__guidance-vace_raw__continuity-first_last__profile-default",
    support_state: "vibecomfy_supported",
    template_id: WAN_VACE_COCKTAIL_TEMPLATE,
    vibecomfy_status: "tested",
  },
  "join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default": {
    route_key: "join_clips_segment__model-wan22_vace__guidance-vace__continuity-join_bridge__profile-default",
    support_state: "vibecomfy_supported",
    template_id: WAN_VACE_COCKTAIL_TEMPLATE,
    vibecomfy_status: "tested",
  },
};

const ORCHESTRATED_PARENT_REQUIREMENTS: Record<string, Array<{ task_type: string; role: RouteRequirementRole }>> = {
  travel_orchestrator: [
    { task_type: "travel_segment", role: "child" },
    { task_type: "travel_stitch", role: "control" },
    { task_type: "join_clips_orchestrator", role: "nested_parent" },
  ],
  join_clips_orchestrator: [
    { task_type: "join_clips_segment", role: "child" },
    { task_type: "join_final_stitch", role: "control" },
  ],
  edit_video_orchestrator: [
    { task_type: "join_clips_segment", role: "child" },
    { task_type: "join_final_stitch", role: "control" },
  ],
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
    support_state: supportState,
    selected_profile: selectedProfile,
    selected_template_id: templateId,
    route_run_id: routeRunId,
    worker_contract_version: workerContractVersion,
    route_selection_snapshot: snapshot,
  };
}

export function selectorEntryForRouteKey(routeKey: string): RouteSelectorEntry | null {
  const selectorEntry = SPRINT_2_SELECTOR_MAP[routeKey];
  if (selectorEntry) return selectorEntry;
  const section3aEntry = SECTION3A_ROUTE_SUPPORT_MAP[routeKey];
  if (section3aEntry) return section3aEntry;
  if (
    routeKey.startsWith("travel_segment__") ||
    routeKey.startsWith("individual_travel_segment__") ||
    routeKey.startsWith("join_clips_segment__")
  ) {
    return { route_key: routeKey, support_state: "vibecomfy_unsupported", template_id: null };
  }
  return null;
}

export function classifyVibeComfyBlockerForEntry(
  routeKey: string,
  selectorEntry: RouteSelectorEntry | null,
): VibeComfyRouteBlockerReason | null {
  if (!selectorEntry) return "unknown";
  if (selectorEntry.route_key !== routeKey) return "malformed";
  if (selectorEntry.support_state === "wgp_only") return "wgp_only";
  if (selectorEntry.support_state === "vibecomfy_unsupported") return "unsupported";
  if (selectorEntry.vibecomfy_status === "fallback") return "fallback";
  if (selectorEntry.vibecomfy_status === "untested") return "untested";
  if (!selectorEntry.template_id) return "missing_template";
  return null;
}

export function routeRequirementForTask(input: {
  task_type: string;
  params?: Record<string, unknown> | null;
  role?: RouteRequirementRole;
  required_by_route_key?: string;
}): SelectedRouteRequirement {
  const routeKey = deriveRouteKey(input.task_type, input.params ?? {});
  return routeRequirementForRouteKey({
    task_type: input.task_type,
    route_key: routeKey,
    role: input.role ?? "child",
    required_by_route_key: input.required_by_route_key,
  });
}

export function routeRequirementForRouteKey(input: {
  task_type?: string;
  route_key: string;
  role?: RouteRequirementRole;
  required_by_route_key?: string;
}): SelectedRouteRequirement {
  const selectorEntry = selectorEntryForRouteKey(input.route_key);
  return {
    task_type: input.task_type ?? input.route_key,
    route_key: input.route_key,
    support_state: selectorEntry?.support_state ?? null,
    template_id: selectorEntry?.template_id ?? null,
    role: input.role ?? "child",
    ...(input.required_by_route_key ? { required_by_route_key: input.required_by_route_key } : {}),
    vibecomfy_blocker: classifyVibeComfyBlockerForEntry(input.route_key, selectorEntry),
  };
}

export function selectedRouteRequirementFromContract(candidate: unknown): SelectedRouteRequirement {
  if (!isRecord(candidate)) {
    return malformedRouteRequirement();
  }

  const snapshot = isRecord(candidate.route_selection_snapshot)
    ? candidate.route_selection_snapshot
    : candidate;
  const routeKey = typeof snapshot.route_key === "string" ? snapshot.route_key : null;
  const supportState = snapshot.support_state;
  const templateId = snapshot.template_id;

  if (
    !routeKey ||
    (supportState !== "wgp_only" &&
      supportState !== "vibecomfy_supported" &&
      supportState !== "vibecomfy_unsupported") ||
    (templateId !== null && typeof templateId !== "string")
  ) {
    return malformedRouteRequirement();
  }

  const selectorEntry: RouteSelectorEntry = {
    route_key: routeKey,
    support_state: supportState,
    template_id: templateId,
  };

  return {
    task_type: routeKey,
    route_key: routeKey,
    support_state: supportState,
    template_id: templateId,
    role: "child",
    vibecomfy_blocker: classifyVibeComfyBlockerForEntry(routeKey, selectorEntry),
  };
}

export function requiredRouteRequirementsForParent(input: {
  task_type: string;
  params?: Record<string, unknown> | null;
}): SelectedRouteRequirement[] {
  const parentRouteKey = deriveRouteKey(input.task_type, input.params ?? {});
  const required = ORCHESTRATED_PARENT_REQUIREMENTS[parentRouteKey] ?? [];
  return required.map((requirement) =>
    routeRequirementForTask({
      task_type: requirement.task_type,
      role: requirement.role,
      required_by_route_key: parentRouteKey,
    })
  );
}

export function isOrchestratedParentRouteKey(routeKey: string): boolean {
  return routeKey in ORCHESTRATED_PARENT_REQUIREMENTS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformedRouteRequirement(): SelectedRouteRequirement {
  return {
    task_type: "malformed",
    route_key: "malformed",
    support_state: null,
    template_id: null,
    role: "child",
    vibecomfy_blocker: "malformed",
  };
}

function directRouteKey(taskType: string): string {
  const slugged = slug(taskType);
  return DIRECT_ROUTE_ALIASES[slugged] ?? taskType;
}

function dimensionalChildRouteKey(taskType: string, params: Record<string, unknown>): string {
  return [
    slug(taskType),
    `model-${slug(routeModelFamily(params))}`,
    `guidance-${slug(routeGuidanceKey(taskType, params))}`,
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

function routeGuidanceMode(params: Record<string, unknown>): string {
  const explicitMode = params.guidance_mode ?? params.travel_guidance_mode;
  if (explicitMode) return String(explicitMode);

  const travelGuidance = params.travel_guidance;
  if (travelGuidance && typeof travelGuidance === "object" && "mode" in travelGuidance) {
    const mode = (travelGuidance as { mode?: unknown }).mode;
    if (mode) return String(mode);
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
  if (params.continuity_case) return String(params.continuity_case);
  if (taskType === "join_clips_segment") return "join_bridge";
  if (params.video_source) return "video_source";
  return "first_last";
}

function routeProfile(params: Record<string, unknown>): string {
  return String(params.profile ?? params.wgp_profile ?? params.override_profile ?? "default");
}
