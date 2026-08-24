import type {
  AssetRegistry,
  AssetRegistryEntry,
  TimelineConfig,
} from '@/tools/video-editor/types/index.ts';
import type { Checkpoint } from '@/tools/video-editor/types/history.ts';
import {
  type DataProvider,
  type LoadedTimeline,
  TimelineNotFoundError,
  TimelineVersionConflictError,
} from '@/tools/video-editor/data/DataProvider.ts';
import {
  BRIDGE_TIMELINE_NOT_FOUND_CODE,
  BRIDGE_VERSION_CONFLICT_CODE,
  bridgeTimelinePayloadSchema,
} from '@/tools/video-editor/data/bridgeContract.ts';
import { AstridBridgeTransport, BridgeRouteError } from '@/integrations/astrid/transport.ts';
import type {
  AssetProfile,
  AssetResolveRequest,
  UploadedAssetResult,
  UploadAssetOptions,
} from '@/tools/video-editor/data/AssetResolver.ts';
import { extractAssetRegistryEntry } from '@/tools/video-editor/lib/mediaMetadata.ts';
import { resolveGenerationAsset } from '@/tools/video-editor/data/generationAssetResolver.ts';
import { enrichRegistryEntryWithParsers } from '@/tools/video-editor/lib/mediaMetadata';
import type { RegisteredParser } from '@/tools/video-editor/lib/assetParserRuntime';
import {
  ensurePermission,
  getDirectoryHandle,
  saveDirectoryHandle,
  type PersistedLocalDirectoryHandle,
} from '@/shared/lib/media/localHandleStore.ts';
import { generateUUID } from '@/shared/lib/taskCreation/ids.ts';
import { withDefaultTimelineOutput } from '@/tools/video-editor/lib/defaults.ts';

/**
 * The provider's internal view of a timeline payload. Deliberately looser than
 * the wire contract in `bridgeContract.ts`: cache patches fill these fields
 * with already normalized values. Everything arriving from the bridge is
 * validated by the shared transport before it reaches this type.
 */
type BridgeTimelinePayload = {
  timeline_id?: unknown;
  timeline_ulid?: unknown;
  slug?: unknown;
  name?: unknown;
  config?: unknown;
  config_version?: unknown;
  registry?: unknown;
};

type AstridBridgeDataProviderOptions = {
  projectSlug: string;
  timelineRef: string;
  timelineId?: string;
  apiBaseUrl?: string;
  assetBaseUrl?: string;
  registeredParsers?: readonly RegisteredParser[];
};

const DEFAULT_API_BASE_URL = '/api/astrid';
const DEFAULT_BRIDGE_PORT = '17333';
const LOCAL_DROP_DIRECTORY_NAME = 'local-drops';
const LOCAL_PROJECT_ROOT_HANDLE_PREFIX = 'astrid-project-root';
const LOCAL_ASSETS_DIRECTORY_NAME = 'assets';
const LOCAL_INCOMING_DIRECTORY_NAME = '.incoming';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const isHttpUrl = (value: string): boolean => /^https?:\/\//.test(value);

const getEnv = (key: string): string | undefined => {
  const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
  return meta.env?.[key];
};

export const defaultAstridBridgeAssetBaseUrl = (): string => {
  const port = getEnv('VITE_ASTRID_BRIDGE_PORT') ?? DEFAULT_BRIDGE_PORT;
  return `http://127.0.0.1:${port}`;
};

export class AstridBridgeReadOnlyError extends Error {
  code = 'astrid_bridge_read_only' as const;

  constructor(action: string) {
    super(`Astrid local bridge is read-only: ${action} is not supported`);
    this.name = 'AstridBridgeReadOnlyError';
  }
}

type FileSystemDirectoryHandleLike = PersistedLocalDirectoryHandle & {
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<FileSystemDirectoryHandleLike>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<FileSystemFileHandleLike>;
  removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>;
};

type FileSystemFileHandleLike = {
  getFile?: () => Promise<File>;
  createWritable: () => Promise<{
    write: (data: BlobPart) => Promise<void>;
    close: () => Promise<void>;
    abort?: () => Promise<void>;
  }>;
};

type ShowDirectoryPicker = () => Promise<FileSystemDirectoryHandleLike>;

type LocalAssetHandles = {
  projectRootHandle: FileSystemDirectoryHandleLike;
  sourcesHandle: FileSystemDirectoryHandleLike;
};

export type AssetMaterializationState =
  | { state: 'not-attempted' }
  | { state: 'materialized'; file: string }
  | { state: 'skipped-with-diagnostic'; diagnostic: AssetMaterializationDiagnostic };

export type AssetMaterializationDiagnostic = {
  assetId: string;
  generationId: string;
  reason: 'unresolvable' | 'download-failed' | 'refresh-required';
  message: string;
};

export type AssetMaterializationSummary = {
  states: Record<string, AssetMaterializationState>;
  diagnostics: AssetMaterializationDiagnostic[];
};

/**
 * `undefined` means "the payload carried no registry" (a legal shape); anything
 * present has already been schema-checked by the contract parsers, so a
 * malformed registry throws there rather than collapsing to `{assets: {}}`
 * here — see `bridgeContract.ts`.
 */
const normalizeRegistry = (value: unknown): AssetRegistry => {
  if (value === undefined || value === null) {
    return { assets: {} };
  }
  return clone(value as AssetRegistry);
};

const normalizeConfig = (value: unknown): TimelineConfig => {
  if (!value || typeof value !== 'object') {
    throw new Error('Astrid bridge timeline payload is missing config');
  }
  return withDefaultTimelineOutput(clone(value as TimelineConfig));
};

const normalizeConfigVersion = (value: unknown): number => {
  return typeof value === 'number' ? value : 1;
};

const inferContentType = (file: File): string => {
  if (file.type) {
    return file.type;
  }

  const lowercaseName = file.name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|avif|svg)$/.test(lowercaseName)) {
    return 'image/png';
  }
  if (/\.(mp4|mov|webm|m4v|avi)$/.test(lowercaseName)) {
    return 'video/mp4';
  }
  if (/\.(mp3|wav|aac|m4a|ogg|flac)$/.test(lowercaseName)) {
    return 'audio/mpeg';
  }
  return 'application/octet-stream';
};

const sanitizeFilename = (filename: string): string => {
  const trimmed = filename.trim();
  const fallback = trimmed.length > 0 ? trimmed : 'asset';
  const sanitized = fallback
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '');
  return sanitized.length > 0 ? sanitized : 'asset';
};

const filenameFromUrl = (url: string, fallback: string): string => {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment) {
      return sanitizeFilename(decodeURIComponent(lastSegment));
    }
  } catch {
    // Fall through to the deterministic fallback.
  }
  return sanitizeFilename(fallback);
};

const getProjectRootHandleStorageKey = (projectSlug: string): string => {
  return `${LOCAL_PROJECT_ROOT_HANDLE_PREFIX}:${projectSlug}`;
};

const getShowDirectoryPicker = (): ShowDirectoryPicker | null => {
  const picker = (globalThis as typeof globalThis & {
    showDirectoryPicker?: ShowDirectoryPicker;
  }).showDirectoryPicker;
  return typeof picker === 'function' ? picker : null;
};

export class AstridBridgeDataProvider implements DataProvider {
  readonly persistenceEnabled = true;
  /** No cloud sync in local mode: sync UI stays hidden. */
  readonly supportsEditorSync = false;
  /** Direct all-file asset upload is the Local provider's core surface. */
  readonly supportsDirectAssetUpload = true;
  readonly apiBaseUrl: string;
  readonly assetBaseUrl: string;

  private selectedTimelineRef: string;
  private canonicalTimelineId: string | null;
  /**
   * The identity the caller supplied at construction (`options.timelineId`):
   * either the canonical UUID or its ULID alias. It is a *candidate*, never a
   * trusted canonical — the first bridge payload must confirm it (its
   * `timeline_id` or `timeline_ulid` must equal the supplied value) before it
   * is adopted, otherwise a wrong timeline's payload would silently become
   * this provider's identity (the hole that let a mismatched first response
   * through and later redirected callers to the cached ULID).
   */
  private callerTimelineId: string | null;
  /**
   * Routable address captured from the first bridge payload's
   * `timeline_ulid` (when present). The bridge resolves the ULID directly to
   * the timeline directory — addressing requests with the canonical UUID
   * instead forces a project-wide identity scan per save. This stays an
   * address, never an identity: `canonicalTimelineId` remains the only
   * identity check.
   */
  private timelineUlidRef: string | null = null;
  private cachedPayload: BridgeTimelinePayload | null = null;
  /** In-flight `fresh` read, shared by concurrent callers (see fetchTimelinePayload). */
  private inFlightFreshFetch: Promise<BridgeTimelinePayload> | null = null;
  private assetKeyToFile = new Map<string, string>();
  private fileToAssetKey = new Map<string, string>();
  private localObjectUrls = new Map<string, string>();
  private materializationStates = new Map<string, AssetMaterializationState>();
  private localAssetHandles: LocalAssetHandles | null = null;
  private readonly registeredParsers: readonly RegisteredParser[] | undefined;
  /** The one shared bridge fetch pipeline (timeout + envelope parsing). */
  private readonly transport: AstridBridgeTransport;

  constructor(options: AstridBridgeDataProviderOptions) {
    this.apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? DEFAULT_API_BASE_URL);
    this.transport = new AstridBridgeTransport({ baseUrl: this.apiBaseUrl });
    // Media asset URLs must travel the same (proxied) base as config/registry
    // requests so <video>/<img>/<audio> fetches are same-origin and reach the
    // bridge the dev proxy targets. A direct cross-origin default port (17333)
    // 404s in the browser. Fall back to the resolved apiBaseUrl unless an
    // explicit assetBaseUrl is supplied.
    this.assetBaseUrl = trimTrailingSlash(options.assetBaseUrl ?? this.apiBaseUrl);
    this.selectedTimelineRef = options.timelineRef;
    // Capture the caller-supplied identity (canonical UUID or its ULID alias)
    // as a *candidate*: the first bridge payload must confirm it (its
    // `timeline_id` or `timeline_ulid` must equal this value) before it is
    // adopted as canonical. Seeding `canonicalTimelineId` here would make the
    // identity guard reject the very first (legitimate) ULID-keyed load,
    // whose payload's canonical `timeline_id` is a distinct UUID.
    this.callerTimelineId = options.timelineId ?? null;
    this.canonicalTimelineId = null;
    this.timelineUlidRef = null;
    this.projectSlug = options.projectSlug;
    this.registeredParsers = options.registeredParsers;
  }

  private readonly projectSlug: string;

  async loadTimeline(timelineId: string): Promise<LoadedTimeline> {
    const payload = await this.fetchTimelinePayload(timelineId, { fresh: true });
    return {
      config: normalizeConfig(payload.config),
      configVersion: normalizeConfigVersion(payload.config_version),
    };
  }

  async loadAssetRegistry(timelineId: string): Promise<AssetRegistry> {
    const payload = await this.fetchTimelinePayload(timelineId, { fresh: true });
    const registry = normalizeRegistry(payload.registry);
    this.rebuildAssetMaps(registry);
    return registry;
  }

  getMaterializationSummary(): AssetMaterializationSummary {
    const states: Record<string, AssetMaterializationState> = {};
    const diagnostics: AssetMaterializationDiagnostic[] = [];
    for (const [assetId, state] of this.materializationStates) {
      states[assetId] = clone(state);
      if (state.state === 'skipped-with-diagnostic') {
        diagnostics.push(clone(state.diagnostic));
      }
    }
    return { states, diagnostics };
  }

  async resolveAssetUrl(file: string): Promise<string> {
    const candidate = file.trim();
    if (!candidate) {
      throw new Error('Cannot resolve asset URL for an empty file path');
    }
    if (isHttpUrl(candidate)) {
      return candidate;
    }

    if (this.localAssetHandles !== null) {
      const resolved = await this.resolveLocalAssetUrl(candidate);
      return resolved;
    }

    const assetKey = this.fileToAssetKey.get(candidate);
    if (!assetKey) {
      return candidate;
    }
    const url = this.buildAssetUrl(assetKey);
    return url;
  }

  async onResolve(request: AssetResolveRequest): Promise<string> {
    const assetKey = this.getPreferredAssetKey(request);
    if (this.localAssetHandles !== null) {
      const file = request.entry?.file ?? (assetKey ? this.assetKeyToFile.get(assetKey) : undefined) ?? request.file;
      if (file && !isHttpUrl(file)) {
        const resolved = await this.resolveLocalAssetUrl(file);
        return resolved;
      }
    }
    if (assetKey) {
      const url = this.buildAssetUrl(assetKey);
      return url;
    }
    const resolved = await this.resolveAssetUrl(request.file);
    return resolved;
  }

  /**
   * Compare-and-swap save.
   *
   * The POST body carries `expected_version` (the version this client believes
   * the bridge is at). A bridge that implements the check answers `409
   * {error: 'timeline_version_conflict', config_version}` when it is stale,
   * which becomes a {@link TimelineVersionConflictError} and engages the
   * reload-and-retry ladder in `useTimelinePersistence`.
   *
   * **Backward compatibility contract:** a bridge that ignores the extra field
   * behaves exactly as it does today — last write wins, no conflict is ever
   * reported. Nothing here depends on the bridge understanding the field, so
   * `astrid serve` can adopt it independently of this repo.
   */
  async saveTimeline(
    timelineId: string,
    config: TimelineConfig,
    expectedVersion: number,
    registry?: AssetRegistry,
  ): Promise<number> {
    const existingPayload = await this.fetchTimelinePayload(timelineId);
    const nextRegistry = registry ?? normalizeRegistry(existingPayload.registry);
    const timelineRef = this.getTimelineRequestRef(timelineId);

    // Browser File System Access is an asset-byte plane only. Materialization
    // may write sources/assets and .incoming, but assembly/registry documents
    // always travel through this versioned bridge save (one writer, one file).
    await this.ensureLocalAssetHandles();
    const materializedRegistry = await this.materializeGenerationAssets(timelineId, nextRegistry);

    let savePayload: BridgeTimelinePayload;
    try {
      savePayload = await this.transport.requestJson(
        `/projects/${encodeURIComponent(this.projectSlug)}/timelines/${encodeURIComponent(timelineRef)}/save`,
        {
          method: 'POST',
          body: { config, registry: materializedRegistry, expected_version: expectedVersion },
        },
        bridgeTimelinePayloadSchema,
        'save timeline',
      );
    } catch (error) {
      throw this.toBridgeError(error, timelineId, 'save timeline', expectedVersion);
    }

    const payload = savePayload;
    const cached = this.cachePayload(payload, timelineId);
    return cached.configVersion;
  }

  async saveCheckpoint(
    timelineId: string,
    _checkpoint: Omit<Checkpoint, 'id'>,
  ): Promise<string> {
    return `${timelineId}-checkpoint-local-${Date.now()}`;
  }

  async loadCheckpoints(_timelineId: string): Promise<Checkpoint[]> {
    return [];
  }

  async registerAsset(
    timelineId: string,
    assetId: string,
    entry: AssetRegistryEntry,
  ): Promise<void> {
    // B5: the bridge exposes exactly three routes — no PUT /registry. Asset
    // registration rides the combined save (config + registry + expected
    // version in one POST), which appends one config event and advances the
    // CAS version exactly like a timeline save. The merge is based on the
    // cached payload, so the version saveTimeline posts is the same one the
    // merge read; a concurrent writer still gets a 409.
    const existingPayload = await this.fetchTimelinePayload(timelineId);
    const registry = normalizeRegistry(existingPayload.registry);
    const expectedVersion = normalizeConfigVersion(existingPayload.config_version);
    await this.saveTimeline(timelineId, normalizeConfig(existingPayload.config), expectedVersion, {
      assets: {
        ...registry.assets,
        [assetId]: clone(entry),
      },
    });
  }

  async uploadAsset(
    file: File,
    options: UploadAssetOptions,
  ): Promise<UploadedAssetResult> {
    const projectRootHandle = await this.getProjectRootHandle();
    const permission = await ensurePermission(projectRootHandle, 'readwrite');
    if (permission !== 'granted') {
      throw new Error('Astrid local asset drop requires read/write access to the selected project folder');
    }

    const sourcesHandle = await this.requireProjectSourcesDirectory(projectRootHandle);
    const localDropsHandle = await sourcesHandle.getDirectoryHandle(LOCAL_DROP_DIRECTORY_NAME, { create: true });
    const relativePath = await this.writeLocalDropFile(localDropsHandle, file);
    let entry = await extractAssetRegistryEntry(file, relativePath);
    if (!entry.type) {
      entry.type = inferContentType(file);
    }

    const assetId = generateUUID();

    // Enrich with parser metadata when registered parsers are configured.
    // Providers that do not opt into parser execution leave
    // registeredParsers undefined and follow the exact same code path
    // as before.
    if (this.registeredParsers && this.registeredParsers.length > 0) {
      const enriched = await enrichRegistryEntryWithParsers(
        file,
        entry,
        assetId,
        this.registeredParsers,
      );
      entry = enriched.entry;
    }

    await this.registerAsset(options.timelineId, assetId, entry);
    return { assetId, entry };
  }

  async onUpload(): Promise<UploadedAssetResult> {
    throw new AstridBridgeReadOnlyError('onUpload');
  }

  async loadWaveform(): Promise<null> {
    return null;
  }

  async loadAssetProfile(): Promise<AssetProfile | null> {
    return null;
  }

  /**
   * @param options.fresh bypass `cachedPayload` and go back to the bridge.
   *   Genuine loads — `loadTimeline` / `loadAssetRegistry`, and therefore the
   *   shell's 30s poll — must pass this:
   *   an unconditional cache made the poll a no-op, so cross-tab sync and
   *   bridge-restart detection never happened. The cache stays for the
   *   *incidental* reads (`saveTimeline`'s registry default, `registerAsset`'s
   *   merge base), which only want "the payload this provider last saw".
   */
  private async fetchTimelinePayload(
    timelineId: string,
    options?: { fresh?: boolean },
  ): Promise<BridgeTimelinePayload> {
    if (
      options?.fresh !== true
      && this.cachedPayload !== null
      && (
        this.canonicalTimelineId === null
        || timelineId === this.canonicalTimelineId
        || timelineId === this.timelineUlidRef
      )
    ) {
      return this.cachedPayload;
    }

    // `loadTimeline` and `loadAssetRegistry` are issued as a pair by every poll
    // tick. Coalescing them onto one request halves the traffic and — the part
    // that matters — guarantees the config and the registry come from the same
    // bridge revision instead of straddling a concurrent write.
    if (this.inFlightFreshFetch !== null) {
      return await this.inFlightFreshFetch;
    }
    const request = this.fetchTimelinePayloadUncached(timelineId);
    this.inFlightFreshFetch = request;
    try {
      return await request;
    } finally {
      if (this.inFlightFreshFetch === request) {
        this.inFlightFreshFetch = null;
      }
    }
  }

  private async fetchTimelinePayloadUncached(timelineId: string): Promise<BridgeTimelinePayload> {
    // Prime persisted FSA handles only for local asset bytes. A stale
    // assembly.json/registry.json beside those bytes must never shadow the
    // bridge document or bypass its CAS/event history.
    await this.ensureLocalAssetHandles();

    let response: BridgeTimelinePayload;
    try {
      response = await this.transport.requestJson(
        `/projects/${encodeURIComponent(this.projectSlug)}/timelines/${encodeURIComponent(this.getTimelineRequestRef(timelineId))}`,
        {},
        bridgeTimelinePayloadSchema,
        'timeline payload',
      );
    } catch (error) {
      throw this.toBridgeError(error, timelineId, 'load timeline');
    }
    const materializedRegistry = await this.materializeGenerationAssets(
      timelineId,
      normalizeRegistry(response.registry),
    );
    return this.cachePayload({ ...response, registry: materializedRegistry }, timelineId).payload;
  }

  /**
   * Resolve the address used on the wire for every timeline route (GET/POST/
   * asset). The cached `timeline_ulid` wins once known — the bridge resolves
   * it to the timeline directory directly, avoiding the per-save project-wide
   * identity scan that addressing by the canonical UUID triggers. The UUID is
   * kept as the *identity* (`canonicalTimelineId`) and is only used as an
   * address when the payload never carried a ULID.
   */
  private getTimelineRequestRef(timelineId?: string): string {
    return this.timelineUlidRef ?? this.canonicalTimelineId ?? timelineId ?? this.selectedTimelineRef;
  }

  private cachePayload(
    payload: BridgeTimelinePayload,
    timelineId: string,
  ): {
    payload: BridgeTimelinePayload;
    config: TimelineConfig;
    registry: AssetRegistry;
    configVersion: number;
  } {
    const payloadTimelineId = typeof payload.timeline_id === 'string' ? payload.timeline_id : null;
    const payloadUlid = typeof payload.timeline_ulid === 'string' && payload.timeline_ulid.length > 0
      ? payload.timeline_ulid
      : null;
    // The caller's `timelineId` key may be a ULID/slug that differs from the
    // bridge's canonical id (real Astrid timelines live under a ULID directory
    // with a distinct canonical identity). Identity is verified by comparing
    // the CANONICAL ids — the payload's timeline_id against the known
    // canonical — never the caller's address key.
    if (
      this.canonicalTimelineId !== null
      && payloadTimelineId !== null
      && payloadTimelineId !== this.canonicalTimelineId
    ) {
      throw new Error(`Astrid bridge timeline mismatch: expected ${this.canonicalTimelineId}, got ${payloadTimelineId}`);
    }

    // First payload: the caller-supplied identity (if any) must be confirmed
    // before it is adopted as canonical. The page-level selection validates
    // the URL key against both the canonical id and its ULID alias, so the
    // provider mirrors that: either field matching the supplied value is a
    // confirmation. A payload matching NEITHER belongs to a different
    // timeline — reject instead of silently adopting it (the constructor used
    // to discard the supplied identity, so a wrong UUID in the first response
    // was accepted and a later caller could be redirected to the cached ULID).
    if (
      this.canonicalTimelineId === null
      && this.callerTimelineId !== null
      && payloadTimelineId !== this.callerTimelineId
      && payloadUlid !== this.callerTimelineId
    ) {
      throw new Error(
        `Astrid bridge timeline identity mismatch: requested ${this.callerTimelineId}, `
        + `got timeline_id ${payloadTimelineId ?? '(none)'} / timeline_ulid ${payloadUlid ?? '(none)'}`,
      );
    }

    // The ULID is an address (routing) key, not an identity: remember the
    // first known value and never overwrite it with a different one —
    // identity verification stays canonical-UUID based above.
    if (payloadUlid !== null && (this.timelineUlidRef === null || payloadUlid === this.timelineUlidRef)) {
      this.timelineUlidRef = payloadUlid;
    }

    const normalizedConfig = normalizeConfig(payload.config);
    const normalizedRegistry = normalizeRegistry(payload.registry);
    const normalizedVersion = normalizeConfigVersion(payload.config_version);

    this.canonicalTimelineId = payloadTimelineId ?? this.canonicalTimelineId ?? timelineId;
    this.selectedTimelineRef = this.canonicalTimelineId ?? this.selectedTimelineRef;
    this.cachedPayload = {
      ...payload,
      timeline_id: this.canonicalTimelineId,
      config: normalizedConfig,
      registry: normalizedRegistry,
      config_version: normalizedVersion,
    };
    this.rebuildAssetMaps(normalizedRegistry);

    return {
      payload: this.cachedPayload,
      config: normalizedConfig,
      registry: normalizedRegistry,
      configVersion: normalizedVersion,
    };
  }

  /**
   * Map a transport failure from the shared {@link AstridBridgeTransport}
   * onto this provider's public error surface. Route answers with the frozen
   * timeline codes keep their typed errors; everything else propagates as-is
   * (the transport already produced the `Astrid bridge … failed` message).
   */
  private toBridgeError(
    error: unknown,
    timelineId: string,
    action: string,
    expectedVersion?: number,
  ): Error {
    if (!(error instanceof BridgeRouteError)) {
      return error instanceof Error ? error : new Error(String(error));
    }

    if (error.status === 404 && error.code === BRIDGE_TIMELINE_NOT_FOUND_CODE) {
      return new TimelineNotFoundError(timelineId);
    }

    if (error.status === 409 && error.code === BRIDGE_VERSION_CONFLICT_CODE) {
      return new TimelineVersionConflictError(
        error.detail ?? `Astrid bridge ${action} rejected a stale expected_version`,
        expectedVersion,
        error.envelope?.config_version,
      );
    }

    return error;
  }



  private rebuildAssetMaps(registry: AssetRegistry): void {
    this.assetKeyToFile.clear();
    this.fileToAssetKey.clear();
    for (const [assetKey, entry] of Object.entries(registry.assets ?? {})) {
      if (!entry || typeof entry.file !== 'string' || entry.file.length === 0) {
        continue;
      }
      this.assetKeyToFile.set(assetKey, entry.file);
      if (!this.fileToAssetKey.has(entry.file)) {
        this.fileToAssetKey.set(entry.file, assetKey);
      }
    }
  }

  private async ensureLocalAssetHandles(): Promise<void> {
    if (this.localAssetHandles !== null) {
      return;
    }
    const projectRootHandle = await this.getProjectRootHandleOptional({ prompt: false });
    if (projectRootHandle === null) {
      return;
    }
    try {
      const sourcesHandle = await this.requireProjectSourcesDirectory(projectRootHandle);
      this.localAssetHandles = { projectRootHandle, sourcesHandle };
    } catch {
      // A stale persisted handle is non-authoritative. Leave the asset plane
      // disconnected and continue through the bridge document plane.
    }
  }

  private async resolveLocalAssetUrl(file: string): Promise<string> {
    if (this.localAssetHandles === null) {
      return file;
    }

    const cached = this.localObjectUrls.get(file);
    if (cached) {
      return cached;
    }

    const fileHandle = await this.resolveLocalAssetFileHandle(file);
    if (!fileHandle || typeof fileHandle.getFile !== 'function') {
      return file;
    }

    const blob = await fileHandle.getFile();
    const url = URL.createObjectURL(blob);
    this.localObjectUrls.set(file, url);
    return url;
  }

  private async resolveLocalAssetFileHandle(file: string): Promise<FileSystemFileHandleLike | null> {
    if (this.localAssetHandles === null) {
      return null;
    }

    const segments = file.split('/').filter(Boolean);
    if (
      segments.length === 0
      || file.startsWith('/')
      || segments.some((segment) => segment === '.' || segment === '..')
    ) {
      return null;
    }

    let directoryHandle = this.localAssetHandles.sourcesHandle;
    for (const segment of segments.slice(0, -1)) {
      try {
        directoryHandle = await directoryHandle.getDirectoryHandle(segment);
      } catch {
        return null;
      }
    }

    try {
      return await directoryHandle.getFileHandle(segments[segments.length - 1]);
    } catch {
      return null;
    }
  }

  private getPreferredAssetKey(request: AssetResolveRequest): string | null {
    if (request.assetId && this.assetKeyToFile.has(request.assetId)) {
      return request.assetId;
    }
    if (request.entry?.file) {
      const assetKey = this.fileToAssetKey.get(request.entry.file);
      if (assetKey) {
        return assetKey;
      }
    }
    if (request.file) {
      const assetKey = this.fileToAssetKey.get(request.file);
      if (assetKey) {
        return assetKey;
      }
    }
    return null;
  }

  private buildAssetUrl(assetKey: string): string {
    return `${this.assetBaseUrl}/projects/${encodeURIComponent(this.projectSlug)}/timelines/${encodeURIComponent(this.getTimelineRequestRef())}/assets/${encodeURIComponent(assetKey)}`;
  }

  private async getProjectRootHandle(): Promise<FileSystemDirectoryHandleLike> {
    const handle = await this.getProjectRootHandleOptional({ prompt: true });
    if (handle === null) {
      throw new Error('Local asset drop requires a browser with File System Access support');
    }
    return handle;
  }

  private async getProjectRootHandleOptional({
    prompt,
  }: {
    prompt: boolean;
  }): Promise<FileSystemDirectoryHandleLike | null> {
    const storageKey = getProjectRootHandleStorageKey(this.projectSlug);
    const persistedHandle = await getDirectoryHandle(storageKey);

    if (persistedHandle && this.isDirectoryHandleLike(persistedHandle)) {
      try {
        await this.requireProjectSourcesDirectory(persistedHandle);
        return persistedHandle;
      } catch {
        // Fall through to re-pick the directory when the persisted handle no longer matches the project layout.
      }
    }

    if (!prompt) {
      return null;
    }

    const showDirectoryPicker = getShowDirectoryPicker();
    if (!showDirectoryPicker) {
      return null;
    }

    const pickedHandle = await showDirectoryPicker();
    await this.requireProjectSourcesDirectory(pickedHandle);
    await saveDirectoryHandle(storageKey, pickedHandle);
    return pickedHandle;
  }

  private isDirectoryHandleLike(handle: PersistedLocalDirectoryHandle): handle is FileSystemDirectoryHandleLike {
    return typeof (handle as FileSystemDirectoryHandleLike).getDirectoryHandle === 'function'
      && typeof (handle as FileSystemDirectoryHandleLike).getFileHandle === 'function';
  }

  private async requireProjectSourcesDirectory(
    projectRootHandle: FileSystemDirectoryHandleLike,
  ): Promise<FileSystemDirectoryHandleLike> {
    try {
      await projectRootHandle.getFileHandle('project.json');
    } catch {
      throw new Error('Select the Astrid project root that contains project.json');
    }

    try {
      return await projectRootHandle.getDirectoryHandle('sources');
    } catch {
      throw new Error('Selected Astrid project root is missing its sources directory');
    }
  }

  private async writeFile(
    directoryHandle: FileSystemDirectoryHandleLike,
    filename: string,
    data: BlobPart,
  ): Promise<void> {
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (error) {
      if (typeof writable.abort === 'function') {
        try {
          await writable.abort();
        } catch {
          // Ignore abort failures and surface the original write error.
        }
      }
      throw error;
    }
  }

  private async removeEntryBestEffort(
    directoryHandle: FileSystemDirectoryHandleLike,
    name: string,
  ): Promise<void> {
    if (typeof directoryHandle.removeEntry !== 'function') {
      return;
    }
    try {
      await directoryHandle.removeEntry(name, { recursive: true });
    } catch {
      // Temp cleanup is best effort.
    }
  }

  private async materializeGenerationAssets(
    timelineId: string,
    registry: AssetRegistry,
  ): Promise<AssetRegistry> {
    if (this.localAssetHandles === null) {
      return registry;
    }

    const nextRegistry = clone(registry);
    let changed = false;

    for (const [assetId, entry] of Object.entries(nextRegistry.assets ?? {})) {
      if (!entry?.generationId || this.hasLocalFile(entry) || this.materializationStates.get(assetId)?.state === 'skipped-with-diagnostic') {
        if (!this.materializationStates.has(assetId)) {
          this.materializationStates.set(assetId, { state: 'not-attempted' });
        }
        continue;
      }

      this.materializationStates.set(assetId, { state: 'not-attempted' });
      const result = await this.materializeGenerationAsset(timelineId, assetId, entry);
      if (result.ok) {
        nextRegistry.assets[assetId] = result.entry;
        this.materializationStates.set(assetId, { state: 'materialized', file: result.entry.file });
        changed = true;
      } else {
        this.materializationStates.set(assetId, {
          state: 'skipped-with-diagnostic',
          diagnostic: result.diagnostic,
        });
      }
    }

    return changed ? nextRegistry : registry;
  }

  private hasLocalFile(entry: AssetRegistryEntry): boolean {
    const file = entry.file?.trim();
    return Boolean(file && !isHttpUrl(file));
  }

  private async materializeGenerationAsset(
    timelineId: string,
    assetId: string,
    entry: AssetRegistryEntry,
  ): Promise<
    | { ok: true; entry: AssetRegistryEntry }
    | { ok: false; diagnostic: AssetMaterializationDiagnostic }
  > {
    if (this.localAssetHandles === null || !entry.generationId) {
      throw new Error('Generation materialization requires local asset handles and a generationId');
    }

    const resolved = await resolveGenerationAsset({
      generationId: entry.generationId,
      assetId,
      entry,
      projectSlug: this.projectSlug,
    });

    if (!resolved.ok) {
      return {
        ok: false,
        diagnostic: {
          assetId,
          generationId: entry.generationId,
          reason: 'unresolvable',
          message: resolved.diagnostic.message,
        },
      };
    }

    let response: Response;
    try {
      response = await fetch(resolved.asset.url);
    } catch (error) {
      return {
        ok: false,
        diagnostic: {
          assetId,
          generationId: entry.generationId,
          reason: 'download-failed',
          message: error instanceof Error ? error.message : `Failed to download generation ${entry.generationId}`,
        },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        diagnostic: {
          assetId,
          generationId: entry.generationId,
          reason: 'download-failed',
          message: `Generation download failed with ${response.status} ${response.statusText}`,
        },
      };
    }

    const blob = await response.blob();
    if (blob.size <= 0) {
      return {
        ok: false,
        diagnostic: {
          assetId,
          generationId: entry.generationId,
          reason: 'download-failed',
          message: 'Generation download returned an empty file',
        },
      };
    }

    const assetsHandle = await this.localAssetHandles.sourcesHandle.getDirectoryHandle(LOCAL_ASSETS_DIRECTORY_NAME, { create: true });
    const incomingHandle = await assetsHandle.getDirectoryHandle(LOCAL_INCOMING_DIRECTORY_NAME, { create: true });
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stageHandle = await incomingHandle.getDirectoryHandle(nonce, { create: true });
    const filename = await this.getUniqueLocalDropFilename(
      assetsHandle,
      filenameFromUrl(resolved.asset.url, `${assetId}.bin`),
    );

    await this.writeFile(stageHandle, filename, blob);
    await this.writeFile(assetsHandle, filename, blob);
    await this.removeEntryBestEffort(incomingHandle, nonce);

    return {
      ok: true,
      entry: {
        ...resolved.asset.entry,
        file: `${LOCAL_ASSETS_DIRECTORY_NAME}/${filename}`,
        url: resolved.asset.url,
      },
    };
  }

  private async writeLocalDropFile(
    localDropsHandle: FileSystemDirectoryHandleLike,
    file: File,
  ): Promise<string> {
    const uniqueFilename = await this.getUniqueLocalDropFilename(localDropsHandle, file.name);
    const fileHandle = await localDropsHandle.getFileHandle(uniqueFilename, { create: true });
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(file);
      await writable.close();
    } catch (error) {
      if (typeof writable.abort === 'function') {
        try {
          await writable.abort();
        } catch {
          // Ignore abort failures and surface the original write error.
        }
      }
      throw error;
    }

    return `${LOCAL_DROP_DIRECTORY_NAME}/${uniqueFilename}`;
  }

  private async getUniqueLocalDropFilename(
    localDropsHandle: FileSystemDirectoryHandleLike,
    originalName: string,
  ): Promise<string> {
    const sanitizedName = sanitizeFilename(originalName);
    const extensionIndex = sanitizedName.lastIndexOf('.');
    const baseName = extensionIndex > 0 ? sanitizedName.slice(0, extensionIndex) : sanitizedName;
    const extension = extensionIndex > 0 ? sanitizedName.slice(extensionIndex) : '';

    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
      const candidate = `${baseName}${suffix}${extension}`;
      try {
        await localDropsHandle.getFileHandle(candidate);
      } catch {
        return candidate;
      }
    }

    return `${baseName}-${Date.now()}${extension}`;
  }
}

