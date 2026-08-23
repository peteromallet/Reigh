/**
 * Source-map contracts for timeline objects.
 *
 * SourceMapEntry maps a timeline object (clip, track, etc.) to a source
 * range in extension-owned code or DSL.  SourceMapRuntime manages
 * SourceMapEntry records scoped to an extension provider, stored in
 * project-data under well-known keys.
 *
 * GeneratedObjectMeta is metadata attached to timeline objects that were
 * generated or managed by an extension, enabling the editor to surface
 * ownership, confirmation dialogs, and source-map navigation without
 * importing extension code.
 *
 * @publicContract
 */

import type { TimelineDiffGranularity } from './patch';

// ---------------------------------------------------------------------------
// SourceMapRuntime
// ---------------------------------------------------------------------------

/**
 * Provider-scoped runtime for managing SourceMapEntry records.
 *
 * Stores entries in extension project-data under well-known keys so they
 * are replayable, rollback-safe, and stale-aware.
 *
 * SourceMapEntry records are stored in the extension's project-data namespace
 * using the key pattern `__sm__:<entryId>`.  This keeps them alongside other
 * extension-owned data and makes them subject to the same limits.
 */
export interface SourceMapRuntime {
  /**
   * Create a new non-stale source-map entry and persist it via project-data.
   * Returns the created entry.
   */
  create(
    extensionId: string,
    targetId: string,
    targetGranularity: TimelineDiffGranularity,
    sourceUri: string,
    sourceStartLine: number,
    sourceStartColumn: number,
    sourceEndLine: number,
    sourceEndColumn: number,
    meta?: Record<string, unknown>,
  ): SourceMapEntry;

  /**
   * Retrieve a source-map entry by ID from project-data.
   * Returns undefined if not found.
   */
  get(extensionId: string, entryId: string): SourceMapEntry | undefined;

  /**
   * Retrieve all source-map entries for a given timeline target (clip, track, etc.).
   */
  getForTarget(extensionId: string, targetId: string): SourceMapEntry[];

  /**
   * Retrieve all source-map entries for a given source URI.
   */
  getForSource(extensionId: string, sourceUri: string): SourceMapEntry[];

  /**
   * Mark all source-map entries for a given source URI as stale.
   * Updates the stale flag in persisted project-data.
   * Returns the updated entries.
   */
  markStale(extensionId: string, sourceUri: string): SourceMapEntry[];

  /**
   * Mark all source-map entries for a given target as stale.
   */
  markStaleForTarget(extensionId: string, targetId: string): SourceMapEntry[];

  /**
   * Delete a source-map entry from project-data.
   * Returns true if the entry existed and was deleted.
   */
  delete(extensionId: string, entryId: string): boolean;

  /**
   * List all source-map entries for an extension.
   */
  list(extensionId: string): SourceMapEntry[];
}

// ---------------------------------------------------------------------------
// SourceMapEntry
// ---------------------------------------------------------------------------

/**
 * A bidirectional mapping between a timeline object and a source range
 * in extension-owned code or DSL.
 *
 * Source maps enable navigation from timeline objects to the code that
 * generated them and from source ranges back to affected timeline objects.
 */
export interface SourceMapEntry {
  /** Unique identifier for this mapping. */
  id: string;
  /** The extension that owns this mapping. */
  source: string;
  /** Timeline object identifier (clip ID, track ID, etc.). */
  targetId: string;
  /** Granularity of the mapped object. */
  targetGranularity: TimelineDiffGranularity;
  /** Source file path or virtual document URI. */
  sourceUri: string;
  /** 0-based start line in the source. */
  sourceStartLine: number;
  /** 0-based start column in the source. */
  sourceStartColumn: number;
  /** 0-based end line in the source (exclusive). */
  sourceEndLine: number;
  /** 0-based end column in the source (exclusive). */
  sourceEndColumn: number;
  /**
   * True when the mapping may be out of date because the source or the
   * timeline object has changed since the mapping was created.
   */
  stale: boolean;
  /** Opaque metadata attached by the mapping producer. */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Generated-object metadata
// ---------------------------------------------------------------------------

/**
 * Metadata attached to timeline objects that were generated or managed
 * by an extension. Stored in the clip/track/app record so the editor can
 * surface ownership, enable confirmation dialogs, and support source-map
 * navigation without importing extension code.
 */
export interface GeneratedObjectMeta {
  /** Extension ID that generated or manages this object. */
  extensionId: string;
  /** The contribution within the extension that produced this object. */
  contributionId?: string;
  /** Opaque generation provenance (source hash, prompt ID, etc.). */
  provenance?: Record<string, unknown>;
  /** Timestamp when the object was generated (epoch ms). */
  generatedAt?: number;
  /** Source-map entry ID that maps this object to its source, if any. */
  sourceMapEntryId?: string;
}

// ---------------------------------------------------------------------------
// Host-owned generation provenance
// ---------------------------------------------------------------------------

/** Current wire contract for provenance authored through the Reigh SDK. */
export const HOST_GENERATION_PROVENANCE_VERSION = 1 as const;

/** What should happen when source data and editable generated output diverge. */
export type GeneratedOutputConflictPolicy =
  | 'preserve-output'
  | 'regenerate-output'
  | 'propose-source-update';

/**
 * Stable, host-defined provenance carried in `GeneratedObjectMeta.provenance`.
 * Extensions supply facts; the SDK owns field names, canonicalization, and
 * fingerprint algorithm so generators cannot quietly invent incompatible
 * source-hash contracts.
 */
export interface HostGenerationProvenance {
  contractVersion: typeof HOST_GENERATION_PROVENANCE_VERSION;
  sourceSchemaRef: string;
  sourceItemId: string;
  sourceFingerprint: string;
  sourceRevision?: string | number;
  generatorVersion: string;
  outputFingerprint: string;
  conflictPolicy: GeneratedOutputConflictPolicy;
}

/** State of a generated output relative to its recorded source and output. */
export type GeneratedOutputSyncState =
  | 'in-sync'
  | 'source-changed'
  | 'output-edited'
  | 'source-and-output-changed'
  | 'untracked';

const canonicalizeForFingerprint = (value: unknown, seen: Set<unknown>): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return null;
  if (seen.has(value)) throw new TypeError('computeHostFingerprint: circular input');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => canonicalizeForFingerprint(entry, seen));
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue;
      result[key] = canonicalizeForFingerprint(entry, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
};

/**
 * Reigh-owned synchronous fingerprint. The prefix makes the algorithm
 * explicit and leaves room for a future cryptographic contract version.
 */
export function computeHostFingerprint(value: unknown): string {
  const canonical = JSON.stringify(canonicalizeForFingerprint(value, new Set()));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return `reigh-fnv1a64-v1:${hash.toString(16).padStart(16, '0')}`;
}

/** Editable clip fields covered by the host's generated-output fingerprint. */
export interface TimelineClipOutputFingerprintInput {
  track: string;
  at: number;
  duration: number;
  clipType?: string;
  label?: string;
  text?: unknown;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * Fingerprint only the user-editable output surface shared by patch payloads
 * and reader snapshots. Runtime-only app data and generation metadata are
 * intentionally excluded, preventing the fingerprint from hashing itself.
 */
export function computeTimelineClipOutputFingerprint(
  input: TimelineClipOutputFingerprintInput,
): string {
  return computeHostFingerprint(input);
}

export interface CreateHostGeneratedObjectMetaInput {
  extensionId: string;
  contributionId?: string;
  extensionVersion: string;
  sourceSchemaRef: string;
  sourceItemId: string;
  sourceValue: unknown;
  outputValue: unknown;
  sourceRevision?: string | number;
  conflictPolicy?: GeneratedOutputConflictPolicy;
  generatedAt?: number;
  sourceMapEntryId?: string;
}

/** Build generated-object metadata using the one host-owned provenance shape. */
export function createHostGeneratedObjectMeta(
  input: CreateHostGeneratedObjectMetaInput,
): GeneratedObjectMeta {
  const provenance: HostGenerationProvenance = {
    contractVersion: HOST_GENERATION_PROVENANCE_VERSION,
    sourceSchemaRef: input.sourceSchemaRef,
    sourceItemId: input.sourceItemId,
    sourceFingerprint: computeHostFingerprint(input.sourceValue),
    ...(input.sourceRevision !== undefined ? { sourceRevision: input.sourceRevision } : {}),
    generatorVersion: input.extensionVersion,
    outputFingerprint: computeHostFingerprint(input.outputValue),
    conflictPolicy: input.conflictPolicy ?? 'preserve-output',
  };
  return {
    extensionId: input.extensionId,
    ...(input.contributionId ? { contributionId: input.contributionId } : {}),
    provenance: provenance as unknown as Record<string, unknown>,
    ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
    ...(input.sourceMapEntryId ? { sourceMapEntryId: input.sourceMapEntryId } : {}),
  };
}

/** Parse only the exact Reigh-owned provenance contract; legacy blobs stay untracked. */
export function readHostGenerationProvenance(
  meta: GeneratedObjectMeta | undefined,
): HostGenerationProvenance | undefined {
  const value = meta?.provenance;
  if (!value || value.contractVersion !== HOST_GENERATION_PROVENANCE_VERSION) return undefined;
  if (
    typeof value.sourceSchemaRef !== 'string'
    || typeof value.sourceItemId !== 'string'
    || typeof value.sourceFingerprint !== 'string'
    || typeof value.generatorVersion !== 'string'
    || typeof value.outputFingerprint !== 'string'
    || !['preserve-output', 'regenerate-output', 'propose-source-update'].includes(
      String(value.conflictPolicy),
    )
  ) return undefined;
  return value as unknown as HostGenerationProvenance;
}

/** Classify source/output drift without deciding the user's conflict policy. */
export function classifyGeneratedOutputSync(input: {
  meta: GeneratedObjectMeta | undefined;
  currentSourceValue: unknown;
  currentOutputValue: unknown;
}): GeneratedOutputSyncState {
  const provenance = readHostGenerationProvenance(input.meta);
  if (!provenance) return 'untracked';
  const sourceChanged = computeHostFingerprint(input.currentSourceValue) !== provenance.sourceFingerprint;
  const outputEdited = computeHostFingerprint(input.currentOutputValue) !== provenance.outputFingerprint;
  if (sourceChanged && outputEdited) return 'source-and-output-changed';
  if (sourceChanged) return 'source-changed';
  if (outputEdited) return 'output-edited';
  return 'in-sync';
}
