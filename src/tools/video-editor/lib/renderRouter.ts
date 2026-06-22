// Sprint 8 (SD-027 + SD-034): render-button routing.
//
// Decides whether the user's "Render" click should:
//   * stay in the existing client-side WebCodecs path (`useClientRender`),
//     which handles pure-media + Reigh-native clipTypes ("text",
//     "effect-layer", "media", "hold").
//   * delegate to the new orchestrator `banodoco_render_timeline` task,
//     which the banodoco-worker pool services with Node + Chromium +
//     Remotion + the @banodoco/timeline-theme-* packages.
//
// Decision rule (per sprint brief):
//   * If ANY clip's clipType is in THEME_PACKAGE_REGISTRY → orchestrator.
//   * Mixed timelines (themed + media) → orchestrator (option (a)
//     in the architecture doc; uniform composition end-to-end inside
//     the worker, no cross-task ffmpeg-join).
//   * Pure-Reigh-native timelines → client-side render (untouched).
//
// The router is shape-driven — it inspects the resolved TimelineConfig
// and returns a tagged decision. The caller (UI hook) translates that
// decision into either a `useClientRender` invocation or an
// `enqueueBanodocoRenderTimeline` POST.
//
// We intentionally do NOT inspect `timeline.theme` — a timeline can
// declare a theme but only contain pure-media clips, and the existing
// client renderer can still handle that. The trigger is the clipType
// dispatch, not theme presence.

import type { TimelineRenderRequest } from '@/tools/video-editor/hooks/timeline-state-types.ts';
import { getRegisteredClipTypeDescriptor } from '@/tools/video-editor/clip-types/runtime.ts';
import {
  getGeneratedRemotionModuleStatus,
  type GeneratedRemotionModuleBlockReason,
  type GeneratedLaneClipShape,
} from '@/tools/video-editor/lib/generated-lanes.ts';
import { materializeSequenceConfig } from '@/tools/video-editor/sequences/materialize.ts';

/** Minimal clip shape we need from the resolved timeline. */
export interface RouterClipShape extends GeneratedLaneClipShape {
  clipType?: string;
}

/** Minimal timeline shape we need from the resolved config. */
export interface RouterTimelineShape {
  clips?: ReadonlyArray<RouterClipShape> | null;
}

/**
 * Sprint 8 (final): provider-id taxonomy used by the render pipeline +
 * `renderPipeline.ts`. Each route maps 1:1 onto a provider id so middleware
 * can dispatch on the route without a separate lookup table.
 *
 *   * `browser-remotion`  — client-side WebCodecs / Remotion path
 *                          (`useClientRender`, native + media clips).
 *   * `worker-banodoco`   — orchestrator `banodoco_render_timeline`
 *                          (themed + generated-remotion-module clips).
 *   * `preview-only`      — generated remotion_module clips with invalid /
 *                          missing artifact metadata. Cannot be rendered;
 *                          surfaces a hard "render blocked" message.
 *   * `external`          — reserved for future external render providers.
 *                          Currently unreachable from `decideRenderRoute`.
 */
export type RenderRoute =
  | 'browser-remotion'
  | 'worker-banodoco'
  | 'preview-only'
  | 'external';

export type RenderProviderId = RenderRoute;

export const RENDER_PROVIDER_REGISTRY: Readonly<Record<RenderRoute, RenderProviderId>> = {
  'browser-remotion': 'browser-remotion',
  'worker-banodoco': 'worker-banodoco',
  'preview-only': 'preview-only',
  external: 'external',
};

export interface RenderRouteDecision {
  route: RenderRoute;
  /** True iff at least one clip is themed (i.e. uses the registry). */
  hasThemedClip: boolean;
  /** True iff at least one clip is pure-media / Reigh-native. */
  hasMediaClip: boolean;
  reason:
    | 'no_clips'
    | 'pure_native_clips'
    | 'themed_only'
    | 'mixed_themed_and_media'
    | 'generated_remotion_module'
    | 'mixed_generated_module_and_other'
    | 'export_route_blocked'
    | 'preview_only_clip'
    | GeneratedRemotionModuleBlockReason;
}

export type RenderCapability =
  | 'browser-remotion'
  | 'worker-banodoco'
  | 'external-render'
  | 'artifact-materialization'
  | 'generated-remotion-module'
  | 'custom-render-module';

export interface CapabilityFinding {
  capability: RenderCapability;
  status: 'satisfied' | 'required' | 'unavailable';
  providerId?: RenderProviderId;
  clipId?: string;
  clipType?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export type RenderBlockerCode =
  | 'unknown_clip_type'
  | 'export_route_blocked'
  | 'preview_only_clip'
  | 'remotion_module_missing_artifact'
  | 'remotion_module_invalid_artifact'
  | 'worker_provider_unavailable'
  | 'external_provider_unavailable';

export interface RenderBlocker {
  code: RenderBlockerCode;
  route: RenderRoute;
  capability: RenderCapability;
  clipId?: string;
  clipType?: string;
  message: string;
  remedy: string;
  detail?: Record<string, unknown>;
}

export interface RenderMaterial {
  kind: 'asset-registry' | 'generated-artifact' | 'worker-package' | 'custom-render-module';
  requiredBy: RenderCapability;
  clipId?: string;
  clipType?: string;
  artifactId?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface RenderArtifactManifest {
  route: RenderRoute;
  providerId: RenderProviderId;
  materials: readonly RenderMaterial[];
}

export interface RenderPlan {
  decision: RenderRouteDecision;
  providerId: RenderProviderId;
  capabilities: readonly CapabilityFinding[];
  blockers: readonly RenderBlocker[];
  artifactManifest: RenderArtifactManifest;
}

export interface PlanRenderOptions {
  /**
   * Worker dispatch is available by default to preserve existing
   * decideRenderRoute compatibility. Callers that know render startup cannot
   * reach a worker can request a stable blocker without changing the route.
   */
  workerAvailable?: boolean;
  externalAvailable?: boolean;
}

const NATIVE_BUILTIN_CLIP_TYPES: ReadonlySet<string> = new Set([
  'media',
  'text',
  'effect-layer',
  'hold',
]);

const isNativeBuiltinClipType = (value: unknown): boolean => {
  // Treat undefined/null clipType as media-equivalent (pre-clipType
  // legacy clips). They route to the client renderer.
  if (typeof value !== 'string') return true;
  return NATIVE_BUILTIN_CLIP_TYPES.has(value);
};

const getDescriptorExportRoute = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const descriptor = getRegisteredClipTypeDescriptor(value);
  return descriptor?.renderCapabilities.exportRoute;
};

const isWorkerExportRoute = (value: unknown): boolean => {
  const exportRoute = getDescriptorExportRoute(value);
  return exportRoute === 'banodoco' || exportRoute === 'custom';
};

const isBlockedExportRoute = (value: unknown): boolean => {
  const exportRoute = getDescriptorExportRoute(value);
  return exportRoute === 'blocked'
    || (exportRoute !== undefined
      && exportRoute !== 'client'
      && exportRoute !== 'banodoco'
      && exportRoute !== 'custom');
};

function createRenderRouteDecision(
  timeline: RouterTimelineShape | null | undefined,
): RenderRouteDecision {
  const clips = (timeline?.clips ?? []) as ReadonlyArray<RouterClipShape>;

  if (clips.length === 0) {
    return {
      route: 'browser-remotion',
      hasThemedClip: false,
      hasMediaClip: false,
      reason: 'no_clips',
    };
  }

  let hasThemedClip = false;
  let hasMediaClip = false;
  let hasGeneratedModuleClip = false;
  let hasOtherClip = false;
  for (const clip of clips) {
    const moduleStatus = getGeneratedRemotionModuleStatus(clip);
    if (moduleStatus.kind === 'blocked_module') {
      return {
        route: 'preview-only',
        hasThemedClip: false,
        hasMediaClip: false,
        reason: moduleStatus.reason,
      };
    }
    if (moduleStatus.kind === 'valid_module') {
      hasGeneratedModuleClip = true;
      continue;
    }

    hasOtherClip = true;
    if (isWorkerExportRoute(clip?.clipType)) {
      hasThemedClip = true;
    } else if (isBlockedExportRoute(clip?.clipType)) {
      return {
        route: 'preview-only',
        hasThemedClip: false,
        hasMediaClip: false,
        reason: getDescriptorExportRoute(clip?.clipType) === 'blocked'
          ? 'export_route_blocked'
          : 'preview_only_clip',
      };
    } else if (getDescriptorExportRoute(clip?.clipType) === 'client') {
      hasMediaClip = true;
    } else if (isNativeBuiltinClipType(clip?.clipType)) {
      hasMediaClip = true;
    } else {
      // Unknown clipType (theme package not installed, typo). Treat as
      // media so the existing render path's loud-placeholder fallback
      // surfaces — orchestrator wouldn't be able to render it either
      // without the theme package, and the sprint scopes us to
      // registered themes.
      hasMediaClip = true;
    }
  }

  if (hasGeneratedModuleClip) {
    return {
      route: 'worker-banodoco',
      hasThemedClip,
      hasMediaClip,
      reason: hasOtherClip ? 'mixed_generated_module_and_other' : 'generated_remotion_module',
    };
  }

  if (hasThemedClip && hasMediaClip) {
    return {
      route: 'worker-banodoco',
      hasThemedClip,
      hasMediaClip,
      reason: 'mixed_themed_and_media',
    };
  }
  if (hasThemedClip) {
    return {
      route: 'worker-banodoco',
      hasThemedClip,
      hasMediaClip,
      reason: 'themed_only',
    };
  }
  return {
    route: 'browser-remotion',
    hasThemedClip,
    hasMediaClip,
    reason: 'pure_native_clips',
  };
}

const getClipId = (clip: RouterClipShape): string | undefined => {
  const id = (clip as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id : undefined;
};

const getClipType = (clip: RouterClipShape): string | undefined => {
  return typeof clip.clipType === 'string' ? clip.clipType : undefined;
};

function describeClip(clip: RouterClipShape): Pick<RenderBlocker, 'clipId' | 'clipType'> {
  return {
    clipId: getClipId(clip),
    clipType: getClipType(clip),
  };
}

function buildRoutePlan(
  decision: RenderRouteDecision,
  clips: ReadonlyArray<RouterClipShape>,
  options: PlanRenderOptions,
): Pick<RenderPlan, 'capabilities' | 'blockers' | 'artifactManifest'> {
  const capabilities: CapabilityFinding[] = [];
  const blockers: RenderBlocker[] = [];
  const materials: RenderMaterial[] = [];

  if (clips.length === 0) {
    capabilities.push({
      capability: 'browser-remotion',
      status: 'satisfied',
      providerId: 'browser-remotion',
      message: 'Empty timelines can use the browser Remotion renderer.',
    });
    return {
      capabilities,
      blockers,
      artifactManifest: {
        route: decision.route,
        providerId: RENDER_PROVIDER_REGISTRY[decision.route],
        materials,
      },
    };
  }

  for (const clip of clips) {
    const clipRef = describeClip(clip);
    const moduleStatus = getGeneratedRemotionModuleStatus(clip);
    if (moduleStatus.kind === 'blocked_module') {
      blockers.push({
        code: moduleStatus.reason,
        route: 'preview-only',
        capability: 'generated-remotion-module',
        ...clipRef,
        message: moduleStatus.reason === 'remotion_module_missing_artifact'
          ? 'Generated Remotion module clips require an artifact id before export.'
          : 'Generated Remotion module clips require a non-empty string artifact id before export.',
        remedy: 'Regenerate the clip or attach the generated module artifact before rendering.',
        detail: { reason: moduleStatus.reason },
      });
      continue;
    }
    if (moduleStatus.kind === 'valid_module') {
      capabilities.push({
        capability: 'generated-remotion-module',
        status: 'required',
        providerId: 'worker-banodoco',
        ...clipRef,
        message: 'Generated Remotion module clips require worker rendering.',
        detail: { artifactId: moduleStatus.artifactId },
      });
      materials.push({
        kind: 'generated-artifact',
        requiredBy: 'generated-remotion-module',
        ...clipRef,
        artifactId: moduleStatus.artifactId,
        message: 'Generated Remotion module artifact must be available to the worker.',
      });
      continue;
    }

    const clipType = getClipType(clip);
    const descriptor = clipType ? getRegisteredClipTypeDescriptor(clipType) : null;
    const exportRoute = descriptor?.renderCapabilities.exportRoute;

    if (isNativeBuiltinClipType(clip.clipType)) {
      capabilities.push({
        capability: 'browser-remotion',
        status: 'satisfied',
        providerId: 'browser-remotion',
        ...clipRef,
        message: 'Built-in clip content is supported by the browser Remotion renderer.',
      });
      continue;
    }

    if (!descriptor) {
      blockers.push({
        code: 'unknown_clip_type',
        route: 'browser-remotion',
        capability: 'browser-remotion',
        ...clipRef,
        message: `Clip type '${clipType ?? 'unknown'}' is not registered for export.`,
        remedy: 'Install/register the clip type or replace the clip with a supported clip type before rendering.',
      });
      continue;
    }

    if (exportRoute === 'client') {
      capabilities.push({
        capability: 'browser-remotion',
        status: 'satisfied',
        providerId: 'browser-remotion',
        ...clipRef,
        message: 'Clip type declares browser export support.',
      });
      continue;
    }

    if (exportRoute === 'banodoco') {
      capabilities.push({
        capability: 'worker-banodoco',
        status: 'required',
        providerId: 'worker-banodoco',
        ...clipRef,
        message: 'Clip type declares Banodoco worker export support.',
      });
      materials.push({
        kind: 'worker-package',
        requiredBy: 'worker-banodoco',
        ...clipRef,
        message: 'Worker package and timeline assets must be available to the Banodoco worker.',
      });
      continue;
    }

    if (exportRoute === 'custom') {
      capabilities.push({
        capability: 'custom-render-module',
        status: 'required',
        providerId: 'worker-banodoco',
        ...clipRef,
        message: 'Custom clip type requires a worker/custom render module.',
      });
      materials.push({
        kind: 'custom-render-module',
        requiredBy: 'custom-render-module',
        ...clipRef,
        message: 'Custom render module and referenced assets must be available to the worker.',
      });
      continue;
    }

    if (exportRoute === 'blocked') {
      blockers.push({
        code: 'export_route_blocked',
        route: 'preview-only',
        capability: 'browser-remotion',
        ...clipRef,
        message: `Clip type '${clipType}' is marked as blocked for export.`,
        remedy: 'Replace this clip or update its clip-type renderCapabilities when export support is implemented.',
      });
      continue;
    }

    blockers.push({
      code: 'preview_only_clip',
      route: 'preview-only',
      capability: 'browser-remotion',
      ...clipRef,
      message: `Clip type '${clipType}' declares unsupported export route '${String(exportRoute)}'.`,
      remedy: 'Use a clip type with client, banodoco, or custom export support before rendering.',
      detail: { exportRoute },
    });
  }

  if (decision.route === 'worker-banodoco' && options.workerAvailable === false) {
    capabilities.push({
      capability: 'worker-banodoco',
      status: 'unavailable',
      providerId: 'worker-banodoco',
      message: 'Banodoco worker rendering is required but unavailable in the current runtime.',
    });
    blockers.push({
      code: 'worker_provider_unavailable',
      route: decision.route,
      capability: 'worker-banodoco',
      message: 'This timeline requires worker rendering, but the worker provider is unavailable.',
      remedy: 'Configure worker render dispatch or use only browser-renderable clips.',
    });
  }

  if (decision.route === 'external' && options.externalAvailable === false) {
    capabilities.push({
      capability: 'external-render',
      status: 'unavailable',
      providerId: 'external',
      message: 'External render provider is unavailable in the current runtime.',
    });
    blockers.push({
      code: 'external_provider_unavailable',
      route: decision.route,
      capability: 'external-render',
      message: 'This timeline requires an external render provider, but none is available.',
      remedy: 'Configure an external render provider or use browser/worker-renderable clips.',
    });
  }

  return {
    capabilities,
    blockers,
    artifactManifest: {
      route: decision.route,
      providerId: RENDER_PROVIDER_REGISTRY[decision.route],
      materials,
    },
  };
}

export function planRender(
  timeline: RouterTimelineShape | null | undefined,
  options: PlanRenderOptions = {},
): RenderPlan {
  const decision = createRenderRouteDecision(timeline);
  const clips = (timeline?.clips ?? []) as ReadonlyArray<RouterClipShape>;
  const routePlan = buildRoutePlan(decision, clips, options);
  return {
    decision,
    providerId: RENDER_PROVIDER_REGISTRY[decision.route],
    capabilities: routePlan.capabilities,
    blockers: routePlan.blockers,
    artifactManifest: routePlan.artifactManifest,
  };
}

/** Pure-decision routing — call this from a hook or test. */
export function decideRenderRoute(
  timeline: RouterTimelineShape | null | undefined,
): RenderRouteDecision {
  return planRender(timeline).decision;
}

// ---------------------------------------------------------------------------
// Orchestrator dispatch (banodoco_render_timeline)
// ---------------------------------------------------------------------------

export interface BanodocoRenderTimelinePayload {
  timeline_id: string;
  timeline: unknown;
  assets: unknown;
  theme_id: string;
  output_filename: string;
  user_jwt: string;
  project_id: string;
  correlation_id: string;
}

export interface BuildRenderPayloadInput {
  /**
   * The TimelineRenderRequest the UI/hook composed for this render.
   * `renderRuntime.projectId` and `assetRegistry` are read from here,
   * keeping caller call-sites aligned with the rest of the pipeline.
   */
  request: Pick<TimelineRenderRequest, 'timelineId' | 'assetRegistry' | 'resolvedConfig' | 'renderRuntime'> & {
    outputFilename?: string;
  };
  userJwt: string;
  /** Tests inject a deterministic UUID; production uses crypto.randomUUID. */
  correlationId?: string;
}

const FALLBACK_THEME_ID = '2rp';

function defaultThemeId(config: { theme?: string } | null | undefined): string {
  const value = config?.theme;
  return typeof value === 'string' && value.trim() ? value : FALLBACK_THEME_ID;
}

function defaultOutputFilename(timelineId: string): string {
  // Suggested filename — the worker may suffix with task_id.
  return `timeline-${timelineId}.mp4`;
}

function newCorrelationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Defensive non-prod fallback (e.g. test envs without the crypto API);
  // the sprint's prod path has crypto everywhere.
  return `corr-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

export function buildRenderTimelinePayload(
  input: BuildRenderPayloadInput,
): { payload?: BanodocoRenderTimelinePayload; error?: string } {
  const { request } = input;
  if (!request?.timelineId) return { error: 'timelineId is required' };
  if (!request?.renderRuntime?.projectId) return { error: 'projectId is required' };
  if (!input.userJwt) return { error: 'user JWT is required (SD-022)' };
  if (!request.resolvedConfig) return { error: 'resolved timeline config is required' };

  return {
    payload: {
      timeline_id: request.timelineId,
      timeline: materializeSequenceConfig(request.resolvedConfig as Parameters<typeof materializeSequenceConfig>[0]),
      assets: request.assetRegistry ?? { assets: {} },
      theme_id: defaultThemeId(request.resolvedConfig),
      output_filename: request.outputFilename ?? defaultOutputFilename(request.timelineId),
      user_jwt: input.userJwt,
      project_id: request.renderRuntime.projectId,
      correlation_id: input.correlationId ?? newCorrelationId(),
    },
  };
}

export interface EnqueueRenderResult {
  status: 'queued' | 'error';
  task_id?: string;
  correlation_id?: string;
  message: string;
}

interface OrchestratorEnqueueResponse {
  task_id?: string;
}

/** POST `banodoco_render_timeline` to the orchestrator's enqueue endpoint.
 *
 * Mirrors `delegateToBanodocoAgent.enqueueBanodocoTask` to keep the
 * agent + UI dispatch on one paper trail.
 */
export async function enqueueBanodocoRenderTimeline(
  payload: BanodocoRenderTimelinePayload,
  options: {
    fetchImpl?: typeof fetch;
    orchestratorBaseUrl: string;
  },
): Promise<EnqueueRenderResult> {
  if (!options.orchestratorBaseUrl) {
    return {
      status: 'error',
      message: 'orchestratorBaseUrl is required for banodoco_render_timeline.',
    };
  }
  const base = options.orchestratorBaseUrl.replace(/\/$/, '');
  const enqueueUrl = base.includes('/functions/v1/')
    ? base
    : `${base}/functions/v1/enqueue-task`;

  const fetchImpl = options.fetchImpl ?? fetch;

  const body = {
    task_type: 'banodoco_render_timeline',
    params: payload,
    project_id: payload.project_id,
    run_type: 'banodoco-worker',
    worker_pool: 'banodoco',
  };

  let resp: Response;
  try {
    resp = await fetchImpl(enqueueUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${payload.user_jwt}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      status: 'error',
      message: `Failed to reach orchestrator: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (resp.status >= 400) {
    let errBody = '';
    try {
      errBody = (await resp.text()).slice(0, 500);
    } catch {
      // ignore
    }
    return {
      status: 'error',
      message: `Orchestrator rejected enqueue (HTTP ${resp.status}): ${errBody}`,
    };
  }

  let parsed: OrchestratorEnqueueResponse | null = null;
  try {
    parsed = (await resp.json()) as OrchestratorEnqueueResponse;
  } catch {
    // 2xx with no body is acceptable.
  }

  return {
    status: 'queued',
    task_id: parsed?.task_id,
    correlation_id: payload.correlation_id,
    message:
      'Themed render queued — the editor will surface the download URL when the worker finishes.',
  };
}
