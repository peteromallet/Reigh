/**
 * @publicContract
 * Public video editor diagnostics contract.
 *
 * Defines the stable diagnostic shape, in-memory store, reporter interface,
 * and normalization helpers. Every diagnostic producer (extension loader,
 * runtime surface, render boundary, provider, materialization, perf) reports
 * through this single stream so the diagnostics UI (T12) and acceptance tests
 * (T14) have one source of truth.
 */

import type {
  ExtensionDiagnostic,
} from './extensionManifest.ts';
import type { DataProviderCapability } from '@/tools/video-editor/data/DataProvider.ts';
import type { RenderBlockerCode } from '@/tools/video-editor/lib/renderRouter.ts';

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

export type RenderBlockerDiagnosticCode = `render_${RenderBlockerCode}`;

export type ProviderCapabilityDiagnosticReason = 'absent' | 'unsupported' | 'degraded';

export type ProviderCapabilityDiagnosticCode =
  `provider_capability_${DataProviderCapability}_${ProviderCapabilityDiagnosticReason}`;

export type MaterializationDiagnosticReason = 'unresolvable' | 'download-failed' | 'refresh-required';

export type MaterializationDiagnosticCode = `materialization_${MaterializationDiagnosticReason}`;

export type VideoEditorDocumentedDiagnosticCode =
  | RenderBlockerDiagnosticCode
  | ProviderCapabilityDiagnosticCode
  | MaterializationDiagnosticCode
  | 'render_preview_only'
  | 'render_worker_unavailable'
  | 'render_failed'
  | 'render_pipeline_failed'
  | 'timeline_events_unavailable';

export interface VideoEditorDiagnosticCodeDoc {
  code: VideoEditorDocumentedDiagnosticCode;
  source: VideoEditorDiagnosticSource;
  severity: VideoEditorDiagnosticSeverity;
  message: string;
  remedy: string;
  detailKeys: readonly string[];
  stream: 'render-planner' | 'provider-collectDiagnostics' | 'asset-materialization' | 'render-runtime';
}

export interface VideoEditorGeneratedDiagnosticCodeDoc {
  codePattern: 'provider_capability_<capability>_<reason>';
  source: VideoEditorDiagnosticSource;
  severity: VideoEditorDiagnosticSeverity;
  message: string;
  remedy: string;
  detailKeys: readonly string[];
  stream: 'provider-collectDiagnostics';
}

export const VIDEO_EDITOR_RENDER_BLOCKER_DIAGNOSTIC_CODES = [
  'render_unknown_clip_type',
  'render_export_route_blocked',
  'render_preview_only_clip',
  'render_remotion_module_missing_artifact',
  'render_remotion_module_invalid_artifact',
  'render_worker_provider_unavailable',
  'render_external_provider_unavailable',
] as const satisfies readonly RenderBlockerDiagnosticCode[];

export const VIDEO_EDITOR_PROVIDER_CAPABILITY_DIAGNOSTIC_REASONS = [
  'absent',
  'unsupported',
  'degraded',
] as const satisfies readonly ProviderCapabilityDiagnosticReason[];

export const VIDEO_EDITOR_PROVIDER_CAPABILITY_DIAGNOSTIC_DOC = {
  codePattern: 'provider_capability_<capability>_<reason>',
  source: 'provider',
  severity: 'warning',
  message: 'Data provider capability metadata is absent, unsupported, or degraded for a required feature.',
  remedy: 'Declare provider.capabilities/getCapabilities(), gate unsupported features, or choose a provider that supports the required capability.',
  detailKeys: ['capability', 'supported', 'reason', 'providerId', 'remedy'],
  stream: 'provider-collectDiagnostics',
} as const satisfies VideoEditorGeneratedDiagnosticCodeDoc;

export const VIDEO_EDITOR_MATERIALIZATION_DIAGNOSTIC_CODES = [
  'materialization_unresolvable',
  'materialization_download-failed',
  'materialization_refresh-required',
] as const satisfies readonly MaterializationDiagnosticCode[];

export const VIDEO_EDITOR_DIAGNOSTIC_CODE_DOCS = [
  {
    code: 'render_unknown_clip_type',
    source: 'render',
    severity: 'error',
    message: 'A timeline clip uses a clip type that is not registered for export.',
    remedy: 'Install/register the clip type or replace the clip with a supported clip type before rendering.',
    detailKeys: ['blocker', 'decision', 'providerId'],
    stream: 'render-planner',
  },
  {
    code: 'render_export_route_blocked',
    source: 'render',
    severity: 'error',
    message: 'A clip type explicitly marks export as blocked.',
    remedy: 'Replace the clip or update its clip-type renderCapabilities when export support is implemented.',
    detailKeys: ['blocker', 'decision', 'providerId'],
    stream: 'render-planner',
  },
  {
    code: 'render_preview_only_clip',
    source: 'render',
    severity: 'error',
    message: 'A clip type declares a preview-only or otherwise unsupported export route.',
    remedy: 'Use a clip type with client, banodoco, or custom export support before rendering.',
    detailKeys: ['blocker', 'decision', 'providerId', 'exportRoute'],
    stream: 'render-planner',
  },
  {
    code: 'render_remotion_module_missing_artifact',
    source: 'render',
    severity: 'error',
    message: 'A generated Remotion module clip is missing artifact metadata.',
    remedy: 'Regenerate the clip or attach the generated module artifact before rendering.',
    detailKeys: ['blocker', 'decision', 'providerId', 'reason'],
    stream: 'render-planner',
  },
  {
    code: 'render_remotion_module_invalid_artifact',
    source: 'render',
    severity: 'error',
    message: 'A generated Remotion module clip has invalid artifact metadata.',
    remedy: 'Regenerate the clip or attach a non-empty string artifact id before rendering.',
    detailKeys: ['blocker', 'decision', 'providerId', 'reason'],
    stream: 'render-planner',
  },
  {
    code: 'render_worker_provider_unavailable',
    source: 'render',
    severity: 'error',
    message: 'The render plan requires the Banodoco worker provider, but it is unavailable.',
    remedy: 'Configure worker render dispatch or use only browser-renderable clips.',
    detailKeys: ['blocker', 'decision', 'providerId'],
    stream: 'render-planner',
  },
  {
    code: 'render_external_provider_unavailable',
    source: 'render',
    severity: 'error',
    message: 'The render plan requires an external render provider, but none is available.',
    remedy: 'Configure an external render provider or use browser/worker-renderable clips.',
    detailKeys: ['blocker', 'decision', 'providerId'],
    stream: 'render-planner',
  },
  {
    code: 'render_preview_only',
    source: 'render',
    severity: 'error',
    message: 'Compatibility render startup reached a preview-only route.',
    remedy: 'Attach valid worker artifact metadata or replace unsupported preview-only clips.',
    detailKeys: ['reason'],
    stream: 'render-runtime',
  },
  {
    code: 'render_worker_unavailable',
    source: 'render',
    severity: 'error',
    message: 'Compatibility render startup reached a worker/external route without a runtime provider.',
    remedy: 'Configure worker render dispatch or use only browser-renderable clips.',
    detailKeys: ['route', 'reason'],
    stream: 'render-runtime',
  },
  {
    code: 'render_failed',
    source: 'render',
    severity: 'error',
    message: 'The browser render path failed after startup.',
    remedy: 'Inspect the structured error detail and retry after fixing the reported runtime failure.',
    detailKeys: ['error'],
    stream: 'render-runtime',
  },
  {
    code: 'render_pipeline_failed',
    source: 'render',
    severity: 'error',
    message: 'The render pipeline failed while preparing or dispatching render work.',
    remedy: 'Inspect pipeline detail, provider configuration, and asset materialization state.',
    detailKeys: ['error'],
    stream: 'render-runtime',
  },
  {
    code: 'timeline_events_unavailable',
    source: 'provider',
    severity: 'warning',
    message: 'Supabase could not read the timeline_events infrastructure.',
    remedy: 'Apply or repair timeline_events access/migration before relying on sync history.',
    detailKeys: ['table', 'reason', 'timelineId', 'projectId'],
    stream: 'provider-collectDiagnostics',
  },
  {
    code: 'materialization_unresolvable',
    source: 'asset-materialization',
    severity: 'warning',
    message: 'Astrid bridge could not resolve a generation asset for local materialization.',
    remedy: 'Refresh or replace the listed generation asset, then reload the local timeline.',
    detailKeys: ['assetId', 'generationId', 'reason'],
    stream: 'asset-materialization',
  },
  {
    code: 'materialization_download-failed',
    source: 'asset-materialization',
    severity: 'warning',
    message: 'Astrid bridge resolved a generation asset but failed to download it.',
    remedy: 'Check the asset URL/access and retry materialization.',
    detailKeys: ['assetId', 'generationId', 'reason'],
    stream: 'asset-materialization',
  },
  {
    code: 'materialization_refresh-required',
    source: 'asset-materialization',
    severity: 'warning',
    message: 'Astrid bridge needs a refreshed generation asset URL before local materialization can continue.',
    remedy: 'Refresh the generation asset, then retry materialization.',
    detailKeys: ['assetId', 'generationId', 'reason'],
    stream: 'asset-materialization',
  },
] as const satisfies readonly VideoEditorDiagnosticCodeDoc[];

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
 * Extension authors and test harnesses can obtain a reporter from
 * the diagnostics store or from runtime context and use it to
 * inject custom diagnostics.
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
    const id = diagnosticId(raw.source, raw.code, raw.extensionId, undefined);
    if (this.seen.has(id)) return;
    const diagnostic: VideoEditorDiagnostic = {
      ...raw,
      id,
      timestamp: new Date().toISOString(),
    };
    this.commit([...this.snapshot, diagnostic]);
  }

  reportMany(raws: ReadonlyArray<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>): void {
    const next = [...this.snapshot];
    const batchSeen = new Set(this.seen);
    let changed = false;
    for (const raw of raws) {
      const id = diagnosticId(raw.source, raw.code, raw.extensionId, undefined);
      if (batchSeen.has(id)) continue;
      batchSeen.add(id);
      next.push({ ...raw, id, timestamp: new Date().toISOString() });
      changed = true;
    }
    if (changed) this.commit(next);
  }

  replaceBySource(
    source: VideoEditorDiagnosticSource,
    raws: ReadonlyArray<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>,
  ): void {
    const keep = this.snapshot.filter((d) => d.source !== source);
    const now = new Date().toISOString();
    const added: VideoEditorDiagnostic[] = [];
    for (const raw of raws) {
      const id = diagnosticId(raw.source, raw.code, raw.extensionId, undefined);
      added.push({ ...raw, id, timestamp: now });
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
