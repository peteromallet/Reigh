/**
 * @publicContract
 * Public video editor diagnostics contract.
 *
 * Defines the stable diagnostic shape, in-memory store, internal reporter
 * interface, and normalization helpers. Loader/runtime producers report
 * through this single stream so the diagnostics UI and acceptance tests have
 * one source of truth.
 */

import type {
  ExtensionDiagnostic,
  ExtensionDiagnosticCode,
} from './extensionManifest.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Severity ordered for display priority. */
export type VideoEditorDiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Logical owner of a diagnostic.
 *
 * - `extension-loader`: produced during package validation / loading (T1-T2)
 * - `extension-runtime`: duplicate contribution IDs, merge failures (T3)
 * - `extension-render`: render boundary exceptions, visibility predicate throws (T5-T7)
 * - `asset-materialization`: materialization/download failures from the data provider (T8)
 * - `asset-generation`: generation asset resolver failures (T8)
 * - `render`: render blockers, pipeline failures (T10)
 * - `provider`: data provider degradation (T8-T9)
 * - `perf`: opt-in performance diagnostics (T11)
 */
export type VideoEditorDiagnosticSource =
  | 'extension-loader'
  | 'extension-runtime'
  | 'extension-render'
  | 'asset-materialization'
  | 'asset-generation'
  | 'render'
  | 'provider'
  | 'perf';

/**
 * Stable diagnostic emitted by the video editor runtime.
 *
 * Every diagnostic carries a deterministic `id` derived from its
 * `(source, code, extensionId, detail_key)` so the store can deduplicate
 * without surprises.
 */
export interface VideoEditorDiagnostic {
  /** Deterministic stable ID — derived from source+code+extensionId+detail_id. */
  readonly id: string;
  /** Machine-readable code, e.g. `manifest_schema_invalid`. */
  readonly code: string;
  /** Severity for display and ordering. */
  readonly severity: VideoEditorDiagnosticSeverity;
  /** Logical source component. */
  readonly source: VideoEditorDiagnosticSource;
  /** Human-readable diagnostic message. */
  readonly message: string;
  /** Extension ID when the diagnostic is tied to a known extension. */
  readonly extensionId?: string;
  /** Structured detail payload (arbitrary JSON-serialisable). */
  readonly detail?: Record<string, unknown>;
  /** ISO-8601 timestamp of when the diagnostic was created (millisecond precision). */
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Reporter contract
// ---------------------------------------------------------------------------

/**
 * Diagnostic reporter — the write side of the store.
 *
 * This is an internal loader/runtime bridge. It is not a public
 * extension-authored diagnostics API.
 */
export interface VideoEditorDiagnosticReporter {
  report(diagnostic: Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>): void;
  reportMany(diagnostics: ReadonlyArray<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>): void;
  /** Atomically replace all diagnostics for `source`, preventing stale entries. */
  replaceBySource(
    source: VideoEditorDiagnosticSource,
    diagnostics: ReadonlyArray<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>,
  ): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Listener callback for `subscribe`. */
export type DiagnosticsStoreListener = () => void;

/**
 * In-memory diagnostics store compatible with React `useSyncExternalStore`.
 *
 * ## Usage
 *
 * ```ts
 * const store = createVideoEditorDiagnosticsStore();
 * store.report({ severity:'error', source:'extension-loader', code:'E001', message:'boom' });
 * const snapshot = store.getSnapshot(); // VideoEditorDiagnostic[]
 * ```
 */
export interface VideoEditorDiagnosticsStore extends VideoEditorDiagnosticReporter {
  /** Current snapshot (stable reference when unchanged). */
  getSnapshot(): readonly VideoEditorDiagnostic[];
  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(listener: DiagnosticsStoreListener): () => void;
  /** Remove all diagnostics. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// Deterministic ID
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic, collision-resistant diagnostic ID from its
 * distinguishing fields.
 *
 * The ID is stable across rerenders and reloads for the same logical
 * diagnostic, which lets the store deduplicate and React shallow-compare
 * snapshots.
 */
function diagnosticId(
  source: VideoEditorDiagnosticSource,
  code: string,
  extensionId: string | undefined,
  detailId: string | undefined,
): string {
  const parts = [source, code];
  if (extensionId) parts.push(extensionId);
  if (detailId) parts.push(detailId);
  // Simple djb2-like hash for deterministic, short hex IDs
  let hash = 5381;
  const joined = parts.join('::');
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  }
  return 'diag_' + (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

class DiagnosticsStoreImpl implements VideoEditorDiagnosticsStore {
  private listeners = new Set<DiagnosticsStoreListener>();
  private snapshot: readonly VideoEditorDiagnostic[] = [];
  private seen = new Set<string>();

  /** @internal mutate and notify */
  private commit(next: readonly VideoEditorDiagnostic[]): void {
    this.snapshot = Object.freeze([...next]);
    this.seen = new Set(this.snapshot.map((d) => d.id));
    // Notify synchronously
    this.listeners.forEach((listener) => {
      try { listener(); } catch { /* don't let one listener break others */ }
    });
  }

  // -- Reporter methods --

  report(raw: Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>): void {
    const normalized = normalizeReporterDiagnostic(raw);
    const id = diagnosticId(normalized.source, normalized.code, normalized.extensionId, undefined);
    if (this.seen.has(id)) return;
    const diagnostic: VideoEditorDiagnostic = {
      ...normalized,
      id,
      timestamp: new Date().toISOString(),
    };
    this.commit([...this.snapshot, diagnostic]);
  }

  reportMany(raws: ReadonlyArray<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>): void {
    if (!Array.isArray(raws)) {
      this.report(createInvalidReporterDiagnostic(raws, 'reportMany diagnostics must be an array.'));
      return;
    }

    const next = [...this.snapshot];
    const batchSeen = new Set(this.seen);
    let changed = false;
    for (const raw of raws) {
      const normalized = normalizeReporterDiagnostic(raw);
      const id = diagnosticId(normalized.source, normalized.code, normalized.extensionId, undefined);
      if (batchSeen.has(id)) continue;
      batchSeen.add(id);
      next.push({ ...normalized, id, timestamp: new Date().toISOString() });
      changed = true;
    }
    if (changed) this.commit(next);
  }

  replaceBySource(
    source: VideoEditorDiagnosticSource,
    raws: ReadonlyArray<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>,
  ): void {
    if (!isVideoEditorDiagnosticSource(source)) {
      this.report(createInvalidReporterDiagnostic(
        { source, raws },
        'replaceBySource source must be a supported diagnostics source.',
      ));
      return;
    }

    if (!Array.isArray(raws)) {
      this.report(createInvalidReporterDiagnostic(
        { source, raws },
        'replaceBySource diagnostics must be an array.',
      ));
      return;
    }

    const keep = this.snapshot.filter((d) => d.source !== source);
    const batchSeen = new Set(keep.map((d) => d.id));
    const now = new Date().toISOString();
    const added: VideoEditorDiagnostic[] = [];
    for (const raw of raws) {
      const normalized = normalizeReporterDiagnostic(raw, source);
      const id = diagnosticId(normalized.source, normalized.code, normalized.extensionId, undefined);
      if (batchSeen.has(id)) continue;
      batchSeen.add(id);
      added.push({ ...normalized, id, timestamp: now });
    }
    this.commit([...keep, ...added]);
  }

  clear(): void {
    this.commit([]);
  }

  // -- Subscriber methods --

  getSnapshot(): readonly VideoEditorDiagnostic[] {
    return this.snapshot;
  }

  subscribe(listener: DiagnosticsStoreListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new in-memory diagnostics store.
 *
 * The store is self-contained; callers can inject it into runtime context
 * or use it standalone for testing.
 */
export function createVideoEditorDiagnosticsStore(): VideoEditorDiagnosticsStore {
  return new DiagnosticsStoreImpl();
}

const VALID_DIAGNOSTIC_SEVERITIES = new Set<VideoEditorDiagnosticSeverity>([
  'error',
  'warning',
  'info',
]);

const VALID_DIAGNOSTIC_SOURCES = new Set<VideoEditorDiagnosticSource>([
  'extension-loader',
  'extension-runtime',
  'extension-render',
  'asset-materialization',
  'asset-generation',
  'render',
  'provider',
  'perf',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVideoEditorDiagnosticSource(value: unknown): value is VideoEditorDiagnosticSource {
  return typeof value === 'string' && VALID_DIAGNOSTIC_SOURCES.has(value as VideoEditorDiagnosticSource);
}

function createInvalidReporterDiagnostic(
  raw: unknown,
  reason: string,
): Omit<VideoEditorDiagnostic, 'id' | 'timestamp'> {
  const detail: Record<string, unknown> = { reason };
  if (isRecord(raw)) {
    if (typeof raw.source === 'string') detail.attemptedSource = raw.source;
    if (typeof raw.code === 'string') detail.attemptedCode = raw.code;
    if (typeof raw.extensionId === 'string') detail.extensionId = raw.extensionId;
  } else {
    detail.receivedType = raw === null ? 'null' : typeof raw;
  }

  return {
    code: 'diagnostic_report_invalid',
    severity: 'warning',
    source: 'extension-runtime',
    message: 'Ignored invalid diagnostics report attempt.',
    detail,
  };
}

function normalizeReporterDiagnostic(
  raw: unknown,
  expectedSource?: VideoEditorDiagnosticSource,
): Omit<VideoEditorDiagnostic, 'id' | 'timestamp'> {
  if (!isRecord(raw)) {
    return createInvalidReporterDiagnostic(raw, 'Diagnostic must be an object.');
  }

  if (!VALID_DIAGNOSTIC_SEVERITIES.has(raw.severity as VideoEditorDiagnosticSeverity)) {
    return createInvalidReporterDiagnostic(raw, 'Diagnostic severity must be error, warning, or info.');
  }

  if (!isVideoEditorDiagnosticSource(raw.source)) {
    return createInvalidReporterDiagnostic(raw, 'Diagnostic source is not supported.');
  }

  if (expectedSource && raw.source !== expectedSource) {
    return createInvalidReporterDiagnostic(raw, `Diagnostic source must match replacement source "${expectedSource}".`);
  }

  if (typeof raw.code !== 'string' || raw.code.trim().length === 0) {
    return createInvalidReporterDiagnostic(raw, 'Diagnostic code must be a non-empty string.');
  }

  if (typeof raw.message !== 'string' || raw.message.trim().length === 0) {
    return createInvalidReporterDiagnostic(raw, 'Diagnostic message must be a non-empty string.');
  }

  const normalized: Omit<VideoEditorDiagnostic, 'id' | 'timestamp'> = {
    code: raw.code,
    severity: raw.severity as VideoEditorDiagnosticSeverity,
    source: raw.source as VideoEditorDiagnosticSource,
    message: raw.message,
  };

  if (typeof raw.extensionId === 'string' && raw.extensionId.trim().length > 0) {
    normalized.extensionId = raw.extensionId;
  }

  if (isRecord(raw.detail)) {
    normalized.detail = raw.detail;
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Map an internal `ExtensionDiagnostic` (from extensionManifest/extensionLoader)
 * to the public `VideoEditorDiagnostic` shape.
 */
export function normalizeExtensionDiagnostic(
  d: ExtensionDiagnostic,
): Omit<VideoEditorDiagnostic, 'id' | 'timestamp'> {
  return {
    code: d.code,
    severity: d.kind, // 'error' | 'warning' maps directly
    source: 'extension-loader',
    message: d.message,
    extensionId: d.extensionId,
    detail: d.detail,
  };
}

/**
 * Map many `ExtensionDiagnostic` objects.
 */
export function normalizeExtensionDiagnostics(
  diagnostics: readonly ExtensionDiagnostic[],
): Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> {
  return diagnostics.map(normalizeExtensionDiagnostic);
}

/**
 * Map a generation asset diagnostic (from generationAssetResolver.ts)
 * to the public shape.
 */
export function normalizeGenerationAssetDiagnostic(
  d: {
    code: string;
    message: string;
    generationId: string;
    assetId?: string;
    url?: string;
    bucket?: string;
    path?: string;
  },
): Omit<VideoEditorDiagnostic, 'id' | 'timestamp'> {
  const detail: Record<string, unknown> = { generationId: d.generationId };
  if (d.assetId) detail.assetId = d.assetId;
  if (d.url) detail.url = d.url;
  if (d.bucket) detail.bucket = d.bucket;
  if (d.path) detail.path = d.path;

  return {
    code: d.code,
    severity: 'error',
    source: 'asset-generation',
    message: d.message,
    detail,
  };
}

/**
 * Map a materialization diagnostic (from AstridBridgeDataProvider) to the
 * public shape.
 */
export function normalizeMaterializationDiagnostic(
  d: {
    assetId: string;
    generationId: string;
    reason: string;
    message: string;
  },
): Omit<VideoEditorDiagnostic, 'id' | 'timestamp'> {
  return {
    code: `materialization_${d.reason}`,
    severity: 'warning',
    source: 'asset-materialization',
    message: d.message,
    detail: {
      assetId: d.assetId,
      generationId: d.generationId,
      reason: d.reason,
    },
  };
}

/**
 * Map many materialization diagnostics.
 */
export function normalizeMaterializationDiagnostics(
  diagnostics: ReadonlyArray<{
    assetId: string;
    generationId: string;
    reason: string;
    message: string;
  }>,
): Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> {
  return diagnostics.map(normalizeMaterializationDiagnostic);
}

/**
 * Create a render diagnostic.
 */
export function createRenderDiagnostic(
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): Omit<VideoEditorDiagnostic, 'id' | 'timestamp'> {
  return {
    code,
    severity: 'error',
    source: 'render',
    message,
    detail,
  };
}

/**
 * Create a perf diagnostic (only called when perf diagnostics gate is enabled).
 */
export function createPerfDiagnostic(
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): Omit<VideoEditorDiagnostic, 'id' | 'timestamp'> {
  return {
    code,
    severity: 'info',
    source: 'perf',
    message,
    detail,
  };
}
