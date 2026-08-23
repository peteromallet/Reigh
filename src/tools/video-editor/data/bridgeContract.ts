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

/**
 * Error body shared by every failing route. `config_version` is only populated
 * for the `409 timeline_version_conflict` response and carries the bridge's
 * current head version so the client can reload and retry.
 */
export const bridgeErrorEnvelopeSchema = z.looseObject({
  error: z.string().optional(),
  detail: z.string().optional(),
  config_version: z.number().optional(),
});

export type BridgeTimelinePayload = z.infer<typeof bridgeTimelinePayloadSchema>;
export type BridgeAssetRegistryPayload = z.infer<typeof bridgeAssetRegistrySchema>;
export type BridgeErrorEnvelope = z.infer<typeof bridgeErrorEnvelopeSchema>;
export type BridgeProjectsPayload = z.infer<typeof bridgeProjectsSchema>;
export type BridgeTimelinesPayload = z.infer<typeof bridgeTimelinesSchema>;
export type BridgeHealthPayload = z.infer<typeof bridgeHealthSchema>;

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
