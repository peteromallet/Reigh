/**
 * The Astrid local-bridge wire contract — the single written-down form of every
 * shape the editor exchanges with `astrid serve` (and with the committed stub in
 * `tests/e2e/timeline/astrid-bridge-stub.mjs`).
 *
 * This module is the **contract artifact**: the `astrid serve` repo should
 * consume or mirror it. Until it does, this file is the only place where the
 * assumptions are checkable, which is exactly the cross-repo drift CLAUDE.md's
 * "typed contracts at service boundaries" policy is aimed at.
 *
 * Two rules the parsers below exist to enforce:
 *
 * 1. **Never coerce a malformed payload into a plausible one.** A registry that
 *    fails to parse used to become `{assets: {}}`; the next save then PUT that
 *    emptied registry back at the bridge — a read-side parse quirk turning into
 *    a data-destroying write. Every parse failure throws instead, and the throw
 *    surfaces as the editor's load-error card.
 * 2. **Validate, don't rewrite.** The parsers check shape and return the caller's
 *    own value, so valid payloads reach `normalizeConfig`/`normalizeRegistry`
 *    byte-identical (extension-authored keys on clips, tracks and registry
 *    entries must survive a load/save round trip).
 */
import { z } from 'zod';

import { timelineBundleEnvelopeSchema } from '@/tools/video-editor/data/typed/timelineBundle.ts';
import { ASTRID_BRIDGE_REQUEST_TIMEOUT_MS } from '@/tools/video-editor/data/astridBridgeWire.ts';

/**
 * Transport deadline for every bridge request. A hung (as opposed to dead)
 * bridge used to park the save badge on `saving` forever, which also disabled
 * the App/Local switcher via `isSwitchBlockedBySave`. With a deadline the hang
 * becomes an ordinary transport failure and feeds the existing save backoff.
 */
export const BRIDGE_REQUEST_TIMEOUT_MS = ASTRID_BRIDGE_REQUEST_TIMEOUT_MS;

/** Error code the bridge must return (with HTTP 409) when `expected_version` is stale. */
export const BRIDGE_VERSION_CONFLICT_CODE = 'timeline_version_conflict';
/** Error code the bridge must return (with HTTP 404) for an unknown timeline. */
export const BRIDGE_TIMELINE_NOT_FOUND_CODE = 'timeline_not_found';
/** Error code the bridge returns with HTTP 422 for schema incompatibility. */
export const BRIDGE_SCHEMA_INCOMPATIBLE_CODE = 'schema_incompatible';

/** Thrown when a bridge response does not match this contract. */
export class BridgeContractError extends Error {
  code = 'bridge_contract_violation' as const;

  constructor(what: string, detail: string) {
    super(`Astrid bridge returned a malformed ${what}: ${detail}`);
    this.name = 'BridgeContractError';
  }
}

/** Any JSON object. Unknown keys are part of the payload, never stripped. */
const jsonObject = z.looseObject({});

export const bridgeTimelineConfigSchema = z.looseObject({
  output: jsonObject.optional(),
  clips: z.array(jsonObject).optional(),
  tracks: z.array(jsonObject).optional(),
});

export const bridgeAssetRegistryEntrySchema = z.looseObject({
  file: z.string().optional(),
  src: z.string().optional(),
  type: z.string().optional(),
  duration: z.number().optional(),
  generationId: z.string().optional(),
});

export const bridgeAssetRegistrySchema = z.looseObject({
  assets: z.record(z.string(), bridgeAssetRegistryEntrySchema),
});

/**
 * `GET /projects/:slug/timelines/:ref` and the `POST …/save` response.
 *
 * dataKind V2: an optional `bundle` — the schema-versioned TimelineBundle of
 * SOURCE data items (`data/typed/timelineBundle.ts`, the single parse
 * authority) — may ride the payload. Absent is legal. Present-but-invalid
 * fails the whole parse closed: a head that declares a bundle it cannot
 * explain must never load as if lanes were empty, because the next save would
 * persist that emptiness (the same read-side-quirk-becomes-data-loss rule as
 * the registry below).
 */
export const bridgeTimelinePayloadSchema = z.looseObject({
  timeline_id: z.string().optional(),
  timeline_ulid: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  config: bridgeTimelineConfigSchema,
  config_version: z.number().optional(),
  registry: bridgeAssetRegistrySchema.optional(),
  bundle: timelineBundleEnvelopeSchema.optional(),
});

export const bridgeHealthSchema = z.looseObject({
  ok: z.boolean(),
});

export const bridgeProjectsSchema = z.looseObject({
  projects: z.array(z.looseObject({
    slug: z.string(),
    name: z.string(),
  })).optional(),
});

export const bridgeTimelinesSchema = z.looseObject({
  timelines: z.array(z.looseObject({
    timeline_id: z.string(),
    timeline_ulid: z.string().optional(),
    slug: z.string().optional(),
    name: z.string(),
    is_default: z.boolean().optional(),
  })).optional(),
});

// ---------------------------------------------------------------------------
// doc-27 §4.1 route set: tasks, generations, media content. Frozen against
// the phase-b `astrid serve` implementation (`ReighTaskBridge` DTOs), which
// is the wire truth this contract mirrors.
// ---------------------------------------------------------------------------

/** Kernel task status vocabulary (`tasks.status`, lowercase kernel forms). */
export const bridgeTaskStatusSchema = z.enum([
  'queued',
  'blocked',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

/** The admitted spec (`spec_json` parsed): family, provenance, output policy. */
export const bridgeTaskSpecSchema = z.looseObject({
  schema_version: z.number().optional(),
  family: z.string().optional(),
  source_task_type: z.string().optional(),
  params: jsonObject.optional(),
  output_policy: jsonObject.optional(),
});

/**
 * Bounded current-attempt read model — also the only extra a fence `409`
 * may carry (doc-27 §4.6: minimal resync data, never the full model).
 */
export const bridgeTaskAttemptSchema = z.looseObject({
  attempt_id: z.string(),
  attempt_no: z.number(),
  status: z.string(),
  status_version: z.number(),
  lease_id: z.string(),
  lease_expires_at: z.string(),
  heartbeat_counter: z.number(),
  last_heartbeat_at: z.string().nullable(),
});

/**
 * Polling task summary (`ReighTaskBridge._task_summary`): the shape returned
 * by `GET /projects/:slug/tasks[/:task_id]` and cancel's terminal replay.
 */
export const bridgeTaskSummarySchema = z.looseObject({
  task_id: z.string(),
  project_id: z.string(),
  capability: z.string(),
  status: bridgeTaskStatusSchema,
  spec: bridgeTaskSpecSchema.optional(),
  priority: z.number(),
  max_attempts: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  finished_at: z.string().nullable().optional(),
  winning_attempt_id: z.string().nullable().optional(),
});

/**
 * Admission response task: the kernel `TaskReadModel` — note it keys its
 * identity as `id`, unlike the polling summary's `task_id`.
 */
export const bridgeAdmittedTaskSchema = z.looseObject({
  id: z.string(),
  project_id: z.string(),
  capability: z.string(),
  spec: bridgeTaskSpecSchema,
  spec_hash: z.string(),
  input_manifest: z.array(jsonObject),
  status: bridgeTaskStatusSchema,
  priority: z.number(),
  available_at: z.string(),
  max_attempts: z.number(),
  run_id: z.string().nullable().optional(),
  run_ordinal: z.number().nullable().optional(),
  winning_attempt_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  finished_at: z.string().nullable().optional(),
});

/** `POST /projects/:slug/tasks` request body (public R1 admission). */
export const bridgeMaterializedInputSchema = z.looseObject({
  media_id: z.string().optional(),
  generation_id: z.string().optional(),
  kind: z.enum(['file', 'remote']).optional(),
  target: z.string().optional(),
  url: z.string().optional(),
});

export const bridgeTaskAdmissionRequestSchema = z.looseObject({
  family: z.string().min(1),
  input: jsonObject,
  materialized_inputs: z.array(bridgeMaterializedInputSchema).optional(),
  priority: z.number().int().optional(),
});

/** `201` first commit / `200` idempotent replay share this body. */
export const bridgeTaskAdmissionResponseSchema = z.looseObject({
  task: bridgeAdmittedTaskSchema,
});

/** `GET /projects/:slug/tasks?limit&offset`. */
export const bridgeTaskListSchema = z.looseObject({
  tasks: z.array(bridgeTaskSummarySchema),
  next_offset: z.number().nullable(),
});

/** One committed output row on the task detail read. */
export const bridgeTaskOutputRowSchema = z.looseObject({
  ordinal: z.number(),
  role: z.string(),
  media_id: z.string(),
  is_primary: z.boolean().optional(),
  params_json: z.union([z.string(), jsonObject]).optional(),
});

/** `GET /projects/:slug/tasks/:task_id` → `{task: summary + attempts + outputs}`. */
export const bridgeTaskDetailPayloadSchema = z.looseObject({
  task: bridgeTaskSummarySchema.extend({
    attempts: z.array(bridgeTaskAttemptSchema).optional(),
    outputs: z.array(bridgeTaskOutputRowSchema).optional(),
  }),
});

/**
 * `POST /projects/:slug/tasks/:task_id/cancel`. A fresh cancel returns the
 * kernel read model (`id`) plus the fenced attempt; cancelling an already
 * terminal task replays `{task: summary}` with no attempt. Either way the
 * consumer reads `status`.
 */
export const bridgeCancelRequestSchema = z.looseObject({
  attempt_id: z.string().min(1).optional(),
  lease_id: z.string().min(1).optional(),
  status_version: z.number().int().positive().optional(),
});

export const bridgeCancelResponseSchema = z.looseObject({
  task: z.union([bridgeAdmittedTaskSchema, bridgeTaskSummarySchema]),
  attempt: bridgeTaskAttemptSchema.nullable().optional(),
});

/** Gallery list row: primary-variant summary only (detail carries variants). */
export const bridgeGenerationPrimarySchema = z.looseObject({
  media_id: z.string(),
  variant_type: z.string().nullable().optional(),
});

export const bridgeGenerationSummarySchema = z.looseObject({
  generation_id: z.string(),
  name: z.string().nullable(),
  type: z.string(),
  starred: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  primary: bridgeGenerationPrimarySchema.nullable(),
  variant_count: z.number(),
});

/** `GET /projects/:slug/generations?limit&cursor&starred`. */
export const bridgeGenerationListSchema = z.looseObject({
  generations: z.array(bridgeGenerationSummarySchema),
  next_cursor: z.string().nullable().optional(),
});

export const bridgeGenerationVariantSchema = z.looseObject({
  id: z.string(),
  generation_id: z.string(),
  media_id: z.string(),
  variant_type: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  params: jsonObject.optional(),
  is_primary: z.boolean(),
  starred: z.boolean(),
  viewed_at: z.string().nullable().optional(),
  created_at: z.string(),
});

/** `GET /projects/:slug/generations/:generation_id` → `{generation: …}`. */
export const bridgeGenerationDetailPayloadSchema = z.looseObject({
  generation: z.looseObject({
    generation_id: z.string(),
    project_id: z.string(),
    task_id: z.string().nullable().optional(),
    type: z.string(),
    name: z.string().nullable().optional(),
    based_on_generation_id: z.string().nullable().optional(),
    parent_generation_id: z.string().nullable().optional(),
    child_order: z.number().nullable().optional(),
    params: jsonObject.optional(),
    starred: z.boolean(),
    deleted_at: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    variants: z.array(bridgeGenerationVariantSchema),
    items: z.array(jsonObject).optional(),
  }),
});

/**
 * `GET|HEAD /projects/:slug/media/:media_id/content` is a byte route
 * (Range/ETag, frozen asset-serving semantics) — there is no JSON body to
 * parse, so the contract fixes only the address form.
 */
export function bridgeMediaContentUrl(baseUrl: string, projectSlug: string, mediaId: string): string {
  return `${trimTrailingSlash(baseUrl)}/projects/${encodeURIComponent(projectSlug)}/media/${encodeURIComponent(mediaId)}/content`;
}

/** Any JSON object. Unknown keys are part of the payload, never stripped. */
const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');
/**
 * The five public error categories every *new* build-facing bridge route
 * (doc-27 §4.1 set below) may answer with (doc-27 §4.6). The frozen timeline
 * codes above are preserved unchanged alongside them; internal lease/fence
 * reasons never cross the wire.
 */
export const BRIDGE_ERROR_CATEGORIES = [
  'invalid_body',
  'not_found',
  'conflict',
  'capability_unavailable',
  'payload_too_large',
] as const;

export type BridgeErrorCategory = (typeof BRIDGE_ERROR_CATEGORIES)[number];

/**
 * Error body shared by every failing route. Status-specific extras:
 * `config_version` only on `409 timeline_version_conflict` (the current head,
 * so the client can reload and retry), `limit_bytes` only on
 * `413 payload_too_large`, and `attempt` only on a fence `409 conflict`
 * carrying the bounded current-attempt read model.
 */
export const bridgeErrorEnvelopeSchema = z.looseObject({
  error: z.string().optional(),
  detail: z.string().optional(),
  config_version: z.number().optional(),
  limit_bytes: z.number().optional(),
  attempt: bridgeTaskAttemptSchema.optional(),
  issues: z.array(z.looseObject({
    pointer: z.string().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
  })).optional(),
});
export type BridgeTimelinePayload = z.infer<typeof bridgeTimelinePayloadSchema>;
export type BridgeAssetRegistryPayload = z.infer<typeof bridgeAssetRegistrySchema>;
export type BridgeErrorEnvelope = z.infer<typeof bridgeErrorEnvelopeSchema>;
export type BridgeProjectsPayload = z.infer<typeof bridgeProjectsSchema>;
export type BridgeTimelinesPayload = z.infer<typeof bridgeTimelinesSchema>;
export type BridgeHealthPayload = z.infer<typeof bridgeHealthSchema>;

export type BridgeTaskStatus = z.infer<typeof bridgeTaskStatusSchema>;
export type BridgeTaskSpec = z.infer<typeof bridgeTaskSpecSchema>;
export type BridgeTaskAttempt = z.infer<typeof bridgeTaskAttemptSchema>;
export type BridgeTaskSummary = z.infer<typeof bridgeTaskSummarySchema>;
export type BridgeAdmittedTask = z.infer<typeof bridgeAdmittedTaskSchema>;
export type BridgeTaskAdmissionRequest = z.infer<typeof bridgeTaskAdmissionRequestSchema>;
export type BridgeTaskAdmissionResponse = z.infer<typeof bridgeTaskAdmissionResponseSchema>;
export type BridgeTaskList = z.infer<typeof bridgeTaskListSchema>;
export type BridgeTaskDetailPayload = z.infer<typeof bridgeTaskDetailPayloadSchema>;
export type BridgeCancelRequest = z.infer<typeof bridgeCancelRequestSchema>;
export type BridgeCancelResponse = z.infer<typeof bridgeCancelResponseSchema>;
export type BridgeGenerationSummary = z.infer<typeof bridgeGenerationSummarySchema>;
export type BridgeGenerationList = z.infer<typeof bridgeGenerationListSchema>;
export type BridgeGenerationVariant = z.infer<typeof bridgeGenerationVariantSchema>;
export type BridgeGenerationDetailPayload = z.infer<typeof bridgeGenerationDetailPayloadSchema>;

const describeIssues = (issues: readonly z.core.$ZodIssue[]): string => {

  return issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
};

/**
 * Validate `value` against `schema` and hand the caller back its own value.
 *
 * The returned reference is the *input*, not zod's output, so no key is dropped
 * or defaulted on the way through — see rule 2 in the module doc comment.
 */
export function parseBridgePayload<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  what: string,
): z.infer<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BridgeContractError(what, describeIssues(result.error.issues));
  }
  return value as z.infer<Schema>;
}
