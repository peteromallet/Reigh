import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { SourceFrozenDataItem } from '@/tools/video-editor/data/typed/envelope.ts';
import { freezeSourceDataItem } from '@/tools/video-editor/data/typed/envelope.ts';
import { isLocalTestMode } from '@/app/localTestRuntime.ts';
import { BRIDGE_REQUEST_TIMEOUT_MS } from '@/tools/video-editor/data/bridgeContract.ts';
import {
  ASTRID_BRIDGE_PROTOCOL_HEADER,
  ASTRID_BRIDGE_PROTOCOL_VERSION,
} from '@/tools/video-editor/data/astridBridgeWire.ts';

export const RUNAWAY_SCHEMA_REF = 'reigh.runaway_transition/v1';
export const RUNAWAY_KIND_ID = 'reigh.runaway.transitions';
export const RUNAWAY_PROJECT_PARAM = 'runawayTimelineProject';
export const DEFAULT_RUNAWAY_PROJECT = 'runaway-piano-colour-demo';
export const RUNAWAY_SOURCE_ARTIFACT_PREFIX = 'astrid:runaway-timing:';
export const RUNAWAY_PAGE_LIMIT = 1_000;
export const RUNAWAY_MAX_PAGES = 100;
export const RUNAWAY_MAX_TRANSITIONS = RUNAWAY_PAGE_LIMIT * RUNAWAY_MAX_PAGES;

export interface RunawayTimingSummary {
  readonly evidenceId: string;
  readonly runId: string;
  readonly summary: string;
  readonly frameCount?: number;
  readonly transitionCount?: number;
  readonly fps?: number;
  readonly segmentCounts: Readonly<Record<string, number>>;
  readonly createdAt?: string;
}

export interface RunawayTransitionPayload {
  readonly id: string;
  readonly manifestId: string;
  readonly ordinal: number;
  readonly runId: string;
  readonly taskId: string | null;
  readonly startMs: number;
  readonly durationMs: number;
  readonly prompt: string;
  readonly segmentId: string;
  readonly segmentLabel: string;
  readonly timingMode: string;
  readonly colourName: string;
  readonly colourHex: string;
  readonly frame: number;
  readonly fps: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly timingSummary: RunawayTimingSummary | null;
}

export type RunawayLoadStatus = 'loading' | 'empty' | 'error';

export interface RunawayLoadStatusPayload {
  readonly kind: 'runaway-load-status';
  readonly status: RunawayLoadStatus;
  readonly projectSlug: string;
  readonly message: string;
}

export interface RunawayBridgeRequestObservation {
  readonly outcome: 'success' | 'failure';
  readonly durationMs: number;
  readonly errorClass?: 'bridge.timeout' | 'bridge.http_error' | 'bridge.invalid_response';
}

interface RawTransition {
  id: string;
  run_id: string;
  task_id: string | null;
  ordinal: number;
  start_ms: number;
  duration_ms: number;
  prompt: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface RawBridgeResponse {
  project: string;
  count: number;
  timing_summary?: {
    evidence_id?: string;
    run_id?: string;
    summary?: string;
    created_at?: string;
    data?: Record<string, unknown>;
  } | null;
  transitions: RawTransition[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function cssHexColour(value: unknown): string | null {
  const text = nonEmptyString(value);
  return text && /^#[0-9a-f]{6}$/i.test(text) ? text : null;
}

function parseSummary(raw: RawBridgeResponse['timing_summary']): RunawayTimingSummary | null {
  if (!raw) return null;
  const data = asRecord(raw.data) ?? {};
  const rawCounts = asRecord(data.segment_counts) ?? {};
  const segmentCounts: Record<string, number> = {};
  for (const [segment, count] of Object.entries(rawCounts)) {
    const parsed = finiteNumber(count);
    if (parsed !== null && parsed >= 0) segmentCounts[segment] = parsed;
  }
  return Object.freeze({
    evidenceId: nonEmptyString(raw.evidence_id) ?? '',
    runId: nonEmptyString(raw.run_id) ?? '',
    summary: nonEmptyString(raw.summary) ?? 'Runaway timing migration',
    frameCount: finiteNumber(data.frame_count) ?? undefined,
    transitionCount: finiteNumber(data.transition_count) ?? undefined,
    fps: finiteNumber(data.fps) ?? undefined,
    segmentCounts: Object.freeze(segmentCounts),
    createdAt: nonEmptyString(raw.created_at) ?? undefined,
  });
}

export function parseRunawayBridgeResponse(value: unknown): readonly SourceFrozenDataItem[] {
  const root = asRecord(value);
  const project = nonEmptyString(root?.project);
  if (!root || !project || !Array.isArray(root.transitions)) {
    throw new Error('Runaway bridge response must contain transitions[]');
  }
  const summary = parseSummary(root.timing_summary as RawBridgeResponse['timing_summary']);
  const seenIds = new Set<string>();
  const seenManifestIds = new Set<string>();
  const seenOrdinals = new Set<number>();
  const items: SourceFrozenDataItem[] = [];
  for (const [index, candidate] of root.transitions.entries()) {
    const row = asRecord(candidate);
    const metadata = asRecord(row?.metadata);
    const id = nonEmptyString(row?.id);
    const runId = nonEmptyString(row?.run_id);
    const ordinal = nonNegativeSafeInteger(row?.ordinal);
    const startMs = finiteNumber(row?.start_ms);
    const durationMs = finiteNumber(row?.duration_ms);
    const prompt = nonEmptyString(row?.prompt);
    if (!row || !metadata || !id || !runId || ordinal === null || ordinal < 0
      || startMs === null || startMs < 0 || durationMs === null || durationMs <= 0 || !prompt) {
      throw new Error(`Invalid Runaway transition at index ${index}`);
    }
    const manifestId = nonEmptyString(metadata.manifest_id) ?? `T${String(ordinal + 1).padStart(4, '0')}`;
    if (seenIds.has(id)) throw new Error(`Duplicate Runaway transition id: ${id}`);
    if (seenManifestIds.has(manifestId)) throw new Error(`Duplicate Runaway manifest id: ${manifestId}`);
    if (seenOrdinals.has(ordinal)) throw new Error(`Duplicate Runaway ordinal: ${ordinal}`);
    seenIds.add(id);
    seenManifestIds.add(manifestId);
    seenOrdinals.add(ordinal);
    const start = startMs / 1000;
    const end = (startMs + durationMs) / 1000;
    const payload: RunawayTransitionPayload = Object.freeze({
      id,
      manifestId,
      ordinal,
      runId,
      taskId: nonEmptyString(row.task_id),
      startMs,
      durationMs,
      prompt,
      segmentId: nonEmptyString(metadata.segment_id) ?? 'unassigned',
      segmentLabel: nonEmptyString(metadata.segment_label) ?? 'Unassigned region',
      timingMode: nonEmptyString(metadata.timing_mode) ?? 'unknown',
      colourName: nonEmptyString(metadata.colour_name) ?? 'unknown',
      colourHex: cssHexColour(metadata.colour_hex) ?? '#8b5cf6',
      frame: finiteNumber(metadata.frame) !== null && Number(metadata.frame) >= 0
        ? Number(metadata.frame)
        : Math.round(start * ((finiteNumber(metadata.fps) ?? summary?.fps ?? 48) || 48)),
      fps: finiteNumber(metadata.fps) !== null && Number(metadata.fps) > 0
        ? Number(metadata.fps)
        : (summary?.fps && summary.fps > 0 ? summary.fps : 48),
      metadata: Object.freeze({ ...metadata }),
      timingSummary: summary,
    });
    items.push(freezeSourceDataItem({
      id: manifestId,
      shape: 'interval',
      domain: 'timeline_seconds',
      extent: { start, end },
      schemaRef: RUNAWAY_SCHEMA_REF,
      payload,
      sourceArtifactRef: { assetId: `${RUNAWAY_SOURCE_ARTIFACT_PREFIX}${project}` },
      provenance: {
        adapterId: 'astrid.runaway.bridge',
        adapterVersion: '1',
        recordedAt: nonEmptyString(row.created_at) ?? undefined,
      },
    }));
  }
  items.sort((a, b) => (a.extent.start - b.extent.start) || a.id.localeCompare(b.id));
  const advertisedCount = nonNegativeSafeInteger(root.count);
  if (advertisedCount === null) {
    throw new Error('Runaway bridge response must contain a non-negative integer count');
  }
  if (advertisedCount !== items.length) {
    throw new Error(`Runaway bridge count mismatch: advertised ${advertisedCount}, received ${items.length}`);
  }
  return Object.freeze(items);
}

interface ValidatedRunawayPage {
  readonly project: string;
  readonly count: number;
  readonly totalCount: number;
  readonly snapshot: string;
  readonly nextCursor: string | null;
  readonly timingSummary: RawBridgeResponse['timing_summary'];
  readonly timingSummaryFingerprint: string;
  readonly transitions: readonly RawTransition[];
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalJsonValue(record[key])]),
  );
}

function validateRunawayPage(
  value: unknown,
  expectedProject: string,
): ValidatedRunawayPage {
  const root = asRecord(value);
  if (!root || root.api_version !== ASTRID_BRIDGE_PROTOCOL_VERSION) {
    throw new Error(
      `Runaway bridge protocol mismatch: expected ${ASTRID_BRIDGE_PROTOCOL_VERSION}`,
    );
  }
  const project = nonEmptyString(root.project);
  if (project !== expectedProject) {
    throw new Error(`Runaway bridge project mismatch: expected ${expectedProject}`);
  }
  if (!Array.isArray(root.transitions)) {
    throw new Error('Runaway bridge response must contain transitions[]');
  }
  const count = nonNegativeSafeInteger(root.count);
  if (count === null || count !== root.transitions.length) {
    throw new Error(
      `Runaway bridge page count mismatch: advertised ${String(root.count)}, received ${root.transitions.length}`,
    );
  }
  const totalCount = nonNegativeSafeInteger(root.total_count);
  if (totalCount === null || totalCount > RUNAWAY_MAX_TRANSITIONS) {
    throw new Error(
      `Runaway bridge total_count must be between 0 and ${RUNAWAY_MAX_TRANSITIONS}`,
    );
  }
  const snapshot = nonEmptyString(root.snapshot);
  if (!snapshot) throw new Error('Runaway bridge response must contain a snapshot');
  const page = asRecord(root.page);
  const pageLimit = nonNegativeSafeInteger(page?.limit);
  if (!page || pageLimit !== RUNAWAY_PAGE_LIMIT || count > pageLimit
    || !Object.prototype.hasOwnProperty.call(page, 'next_cursor')) {
    throw new Error(`Runaway bridge page must declare limit ${RUNAWAY_PAGE_LIMIT}`);
  }
  const nextCursor = page.next_cursor === null ? null : nonEmptyString(page.next_cursor);
  if (page.next_cursor !== null && !nextCursor) {
    throw new Error('Runaway bridge page.next_cursor must be a non-empty string or null');
  }
  const timingSummary = root.timing_summary;
  if (timingSummary !== null && !asRecord(timingSummary)) {
    throw new Error('Runaway bridge timing_summary must be an object or null');
  }
  return {
    project,
    count,
    totalCount,
    snapshot,
    nextCursor,
    timingSummary: timingSummary as RawBridgeResponse['timing_summary'],
    timingSummaryFingerprint: JSON.stringify(canonicalJsonValue(timingSummary)),
    transitions: root.transitions as RawTransition[],
  };
}

const requestCache = new Map<string, Promise<readonly SourceFrozenDataItem[]>>();
const retryRevisions = new Map<string, number>();
const retryListeners = new Map<string, Set<() => void>>();
const reportedErrors = new Set<string>();

function retryRevision(projectSlug: string): number {
  return retryRevisions.get(projectSlug) ?? 0;
}

function subscribeToRetry(projectSlug: string, listener: () => void): () => void {
  const listeners = retryListeners.get(projectSlug) ?? new Set<() => void>();
  listeners.add(listener);
  retryListeners.set(projectSlug, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) retryListeners.delete(projectSlug);
  };
}

/** Clear the rejected request and wake every mounted viewer for this project. */
export function retryRunawayTimeline(projectSlug: string): void {
  requestCache.delete(projectSlug);
  for (const key of reportedErrors) {
    if (key.startsWith(`${projectSlug}\u0000`)) reportedErrors.delete(key);
  }
  retryRevisions.set(projectSlug, retryRevision(projectSlug) + 1);
  retryListeners.get(projectSlug)?.forEach((listener) => listener());
}

function statusItem(
  projectSlug: string,
  status: RunawayLoadStatus,
  message: string,
): SourceFrozenDataItem {
  return freezeSourceDataItem({
    id: `runaway-status:${status}`,
    shape: 'interval',
    domain: 'timeline_seconds',
    extent: { start: 0, end: 0.001 },
    schemaRef: RUNAWAY_SCHEMA_REF,
    payload: Object.freeze({
      kind: 'runaway-load-status',
      status,
      projectSlug,
      message,
    } satisfies RunawayLoadStatusPayload),
    sourceArtifactRef: { assetId: `${RUNAWAY_SOURCE_ARTIFACT_PREFIX}${projectSlug}` },
    provenance: {
      adapterId: 'astrid.runaway.bridge.status',
      adapterVersion: '1',
    },
  });
}

class RunawayBridgeInvalidResponseError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'RunawayBridgeInvalidResponseError';
    this.cause = cause;
  }
}

function invalidResponse(cause: unknown): never {
  throw cause instanceof RunawayBridgeInvalidResponseError
    ? cause
    : new RunawayBridgeInvalidResponseError(cause);
}

async function fetchRunawaySnapshot(
  projectSlug: string,
  signal: AbortSignal,
): Promise<readonly SourceFrozenDataItem[]> {
  const transitions: RawTransition[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let expectedSnapshot: string | null = null;
  let expectedTotalCount: number | null = null;
  let expectedTimingSummaryFingerprint: string | null = null;
  let timingSummary: RawBridgeResponse['timing_summary'] = null;

  for (let pageIndex = 0; pageIndex < RUNAWAY_MAX_PAGES; pageIndex += 1) {
    const query = new URLSearchParams({ limit: String(RUNAWAY_PAGE_LIMIT) });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(
      `/api/astrid/v1/projects/${encodeURIComponent(projectSlug)}/runaway-transitions?${query}`,
      { signal },
    );
    if (response.headers.get(ASTRID_BRIDGE_PROTOCOL_HEADER) !== ASTRID_BRIDGE_PROTOCOL_VERSION) {
      invalidResponse(new Error(
        `Runaway bridge protocol mismatch: expected ${ASTRID_BRIDGE_PROTOCOL_VERSION}`,
      ));
    }
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const detail = asRecord(body);
      throw new Error(
        nonEmptyString(detail?.detail)
        ?? nonEmptyString(detail?.message)
        ?? nonEmptyString(detail?.error)
        ?? `Astrid bridge returned ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      invalidResponse(cause);
    }

    let page: ValidatedRunawayPage;
    try {
      page = validateRunawayPage(body, projectSlug);
    } catch (cause) {
      invalidResponse(cause);
    }

    if (expectedSnapshot === null) {
      expectedSnapshot = page.snapshot;
      expectedTotalCount = page.totalCount;
      expectedTimingSummaryFingerprint = page.timingSummaryFingerprint;
      timingSummary = page.timingSummary;
    } else if (page.snapshot !== expectedSnapshot
      || page.totalCount !== expectedTotalCount
      || page.timingSummaryFingerprint !== expectedTimingSummaryFingerprint) {
      invalidResponse(new Error('Runaway bridge snapshot metadata changed between pages'));
    }

    transitions.push(...page.transitions);
    if (transitions.length > page.totalCount) {
      invalidResponse(new Error(
        `Runaway bridge total_count mismatch: expected ${page.totalCount}, received more rows`,
      ));
    }

    if (page.nextCursor === null) {
      if (transitions.length !== page.totalCount) {
        invalidResponse(new Error(
          `Runaway bridge traversal truncated: expected ${page.totalCount}, received ${transitions.length}`,
        ));
      }
      try {
        return parseRunawayBridgeResponse({
          project: page.project,
          count: transitions.length,
          timing_summary: timingSummary,
          transitions,
        });
      } catch (cause) {
        invalidResponse(cause);
      }
    }

    if (page.count === 0) {
      invalidResponse(new Error('Runaway bridge cursor page made no progress'));
    }
    if (transitions.length === page.totalCount) {
      invalidResponse(new Error('Runaway bridge returned a cursor after the declared total_count'));
    }
    if (seenCursors.has(page.nextCursor)) {
      invalidResponse(new Error(`Runaway bridge repeated cursor: ${page.nextCursor}`));
    }
    if (pageIndex + 1 >= RUNAWAY_MAX_PAGES) {
      invalidResponse(new Error(`Runaway bridge exceeded ${RUNAWAY_MAX_PAGES} pages`));
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return invalidResponse(new Error(`Runaway bridge exceeded ${RUNAWAY_MAX_PAGES} pages`));
}

export function loadRunawayTimeline(
  projectSlug: string,
  onBridgeRequest?: (observation: RunawayBridgeRequestObservation) => void,
): Promise<readonly SourceFrozenDataItem[]> {
  const cached = requestCache.get(projectSlug);
  if (cached) return cached;
  const startedAt = performance.now();
  let observed = false;
  const observe = (observation: Omit<RunawayBridgeRequestObservation, 'durationMs'>) => {
    if (observed || !onBridgeRequest) return;
    observed = true;
    try {
      onBridgeRequest(Object.freeze({
        ...observation,
        durationMs: Math.max(0, performance.now() - startedAt),
      }));
    } catch {
      // Analytics availability must never affect source loading.
    }
  };
  const signal = AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS);
  const request = fetchRunawaySnapshot(projectSlug, signal)
    .then((items) => {
      observe({ outcome: 'success' });
      return items;
    })
    .catch((cause: unknown) => {
      if (!observed) {
        observe({
          outcome: 'failure',
          errorClass: (cause instanceof DOMException && cause.name === 'TimeoutError')
            || (signal.aborted && signal.reason instanceof DOMException
              && signal.reason.name === 'TimeoutError')
            ? 'bridge.timeout'
            : cause instanceof RunawayBridgeInvalidResponseError
              ? 'bridge.invalid_response'
              : 'bridge.http_error',
        });
      }
      throw cause;
    });
  requestCache.set(projectSlug, request);
  return request;
}

/**
 * Load the optional DEV bridge fixture only while the deployment-owned
 * Runaway gate is effective.  The URL parameter is an authoring selector, not
 * an enablement override: when the gate is false this hook performs zero
 * bridge IO even if a stale/bookmarked URL still contains the parameter.
 */
export function useRunawayTimelineItems(
  releaseEnabled: boolean,
  onBridgeRequest?: (observation: RunawayBridgeRequestObservation) => void,
): Readonly<Record<string, readonly SourceFrozenDataItem[]>> | undefined {
  const projectSlug = useMemo(() => {
    if (!releaseEnabled || !import.meta.env.DEV || typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(RUNAWAY_PROJECT_PARAM)) return null;
    return params.get(RUNAWAY_PROJECT_PARAM)?.trim() || DEFAULT_RUNAWAY_PROJECT;
  }, [releaseEnabled]);
  const revision = useSyncExternalStore(
    (listener) => projectSlug ? subscribeToRetry(projectSlug, listener) : () => {},
    () => projectSlug ? retryRevision(projectSlug) : 0,
    () => 0,
  );
  const [result, setResult] = useState<{
    readonly projectSlug: string;
    readonly status: 'ready' | RunawayLoadStatus;
    readonly items: readonly SourceFrozenDataItem[];
    readonly message: string;
  } | null>(null);

  useEffect(() => {
    if (!projectSlug) return;
    let active = true;
    setResult({
      projectSlug,
      status: 'loading',
      items: [],
      message: `Loading Runaway transitions for ${projectSlug}…`,
    });
    void loadRunawayTimeline(projectSlug, onBridgeRequest).then((next) => {
      if (!active) return;
      reportedErrors.forEach((key) => {
        if (key.startsWith(`${projectSlug}\u0000`)) reportedErrors.delete(key);
      });
      setResult({
        projectSlug,
        status: next.length === 0 ? 'empty' : 'ready',
        items: next,
        message: next.length === 0
          ? `No Runaway transitions were found for ${projectSlug}.`
          : '',
      });
    }).catch((error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : String(error);
      const errorKey = `${projectSlug}\u0000${message}`;
      if (!isLocalTestMode() && !reportedErrors.has(errorKey)) {
        reportedErrors.add(errorKey);
        console.error('[Runaway Timeline Viewer]', error);
      }
      setResult({ projectSlug, status: 'error', items: [], message });
    });
    return () => { active = false; };
  }, [onBridgeRequest, projectSlug, revision]);

  useEffect(() => {
    if (!projectSlug || typeof window === 'undefined') return;
    const recoverWhenOnline = () => retryRunawayTimeline(projectSlug);
    window.addEventListener('online', recoverWhenOnline);
    return () => window.removeEventListener('online', recoverWhenOnline);
  }, [projectSlug]);

  return useMemo(() => {
    if (!projectSlug) return undefined;
    const current = result?.projectSlug === projectSlug
      ? result
      : {
          projectSlug,
          status: 'loading' as const,
          items: [],
          message: `Loading Runaway transitions for ${projectSlug}…`,
        };
    const items = current.status === 'ready'
      ? current.items
      : [statusItem(projectSlug, current.status, current.message)];
    return Object.freeze({ [RUNAWAY_SCHEMA_REF]: Object.freeze(items) });
  }, [projectSlug, result]);
}
