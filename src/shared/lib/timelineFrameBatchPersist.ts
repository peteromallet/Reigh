import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { placementEntryId } from '@/shared/lib/placement/documentPlacement';
import {
  batchUpdatePlacementFrames,
  fetchProjectPlacements,
} from '@/shared/lib/placement/placementService';
import {
  isTimelineWriteTimeoutError,
  runTimelineWriteWithTimeout,
} from '@/shared/lib/timelineWriteQueue';

interface TimelineFrameBatchUpdate {
  shotGenerationId: string;
  timelineFrame: number;
  metadata?: Record<string, unknown>;
}

interface PersistTimelineFrameBatchOptions {
  shotId: string;
  updates: TimelineFrameBatchUpdate[];
  operationLabel: string;
  timeoutOperationName: string;
  signal?: AbortSignal;
  timeoutFloorMs?: number;
  timeoutPerUpdateMs?: number;
  projectId?: string;
  logPrefix: string;
  log: (message: string, payload: Record<string, unknown>) => void;
}

interface PersistTimelineFrameBatchResult {
  updateCount: number;
  durationMs: number;
  skipped: boolean;
}

const DEFAULT_TIMEOUT_FLOOR_MS = 30_000;
const DEFAULT_TIMEOUT_PER_UPDATE_MS = 2_000;

function shortId(id: string | null | undefined): string | null {
  return id ? id.slice(0, 8) : null;
}

function dedupeLast(updates: TimelineFrameBatchUpdate[]): TimelineFrameBatchUpdate[] {
  const byId = new Map<string, TimelineFrameBatchUpdate>();
  for (const update of updates) {
    byId.set(update.shotGenerationId, update);
  }
  return Array.from(byId.values());
}

function formatUpdateSignature(
  updates: TimelineFrameBatchUpdate[],
): string {
  return updates
    .map((update) => `${shortId(update.shotGenerationId)}→${update.timelineFrame}`)
    .join(', ');
}

function getNetworkSnapshot(): Record<string, unknown> {
  if (typeof navigator === 'undefined') return {};
  const connection = (navigator as unknown as {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number };
  }).connection;
  return {
    online: navigator.onLine,
    effectiveType: connection?.effectiveType ?? null,
    downlink: connection?.downlink ?? null,
    rtt: connection?.rtt ?? null,
  };
}

/**
 * Bridge the write-timeout wrapper's abort signal into a signal-less promise
 * (the placement service exposes no AbortSignal): rejecting on abort is what
 * converts a hung bridge fetch into a `TimelineWriteTimeoutError` instead of
 * an unbounded wait.
 */
function abortable<T>(start: () => Promise<T>): (signal: AbortSignal) => Promise<T> {
  return (signal) =>
    new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      start().then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
}

/**
 * Persist a batch of timeline frame updates through the document placement
 * service (doc 24 Q1 — the timeline document is the ONLY placement authority;
 * the retired `batch_update_timeline_frames` RPC has no successor route).
 *
 * Callers identify entries either by the deterministic entry id
 * (`sg-<shotId>-<generationId>`, what placement reads surface as row id) or
 * by a bare generation id; both resolve to the document entry.
 *
 * Invariants preserved from the RPC era:
 * - last write per entry wins (`dedupeLast`);
 * - every requested entry must come back updated exactly once, else throw
 *   (never silently drop an update);
 * - timeouts surface as `TimelineWriteTimeoutError` with a read-model
 *   diagnostics snapshot, never as false success.
 */
export async function persistTimelineFrameBatch({
  shotId,
  updates,
  operationLabel,
  timeoutOperationName,
  signal,
  timeoutFloorMs = DEFAULT_TIMEOUT_FLOOR_MS,
  timeoutPerUpdateMs = DEFAULT_TIMEOUT_PER_UPDATE_MS,
  projectId,
  logPrefix,
  log,
}: PersistTimelineFrameBatchOptions): Promise<PersistTimelineFrameBatchResult> {
  const canonicalUpdates = dedupeLast(updates);
  if (canonicalUpdates.length === 0) {
    log(`${logPrefix} ${operationLabel} skipped (no updates)`, {
      shotId: shortId(shotId),
      updateCount: 0,
    });
    return {
      updateCount: 0,
      durationMs: 0,
      skipped: true,
    };
  }

  const projectSlug = projectId || getProjectSelectionFallbackId();
  if (!projectSlug) {
    throw new Error('No project selected — cannot persist timeline frame updates.');
  }

  // Entry ids: accept the deterministic entry id or resolve a bare generation
  // id against this shot (mirrors useShotGenerationMutations.resolveEntryParts).
  const entryPrefix = `sg-${shotId}-`;
  const docUpdates = canonicalUpdates.map((update) => ({
    entryId: update.shotGenerationId.startsWith(entryPrefix)
      ? update.shotGenerationId
      : placementEntryId(shotId, update.shotGenerationId),
    timelineFrame: update.timelineFrame,
    metadata: update.metadata,
  }));
  const rpcTimeoutMs = Math.max(timeoutFloorMs, docUpdates.length * timeoutPerUpdateMs);
  const updateSignature = formatUpdateSignature(canonicalUpdates);

  // Validate payload before sending — invalid data must fail loudly here,
  // not strand entries silently un-updated on the document.
  const validationIssues: string[] = [];
  for (const update of docUpdates) {
    if (!update.entryId || update.entryId === entryPrefix) {
      validationIssues.push(`bad_entry: "${update.entryId}"`);
    }
    if (
      typeof update.timelineFrame !== 'number'
      || !Number.isInteger(update.timelineFrame)
      || update.timelineFrame < 0
    ) {
      validationIssues.push(
        `bad_frame: ${shortId(update.entryId)} → ${update.timelineFrame} (type:${typeof update.timelineFrame})`,
      );
    }
  }
  if (validationIssues.length > 0) {
    throw new Error(
      `Timeline batch update rejected — invalid payload: ${validationIssues.join('; ')}`,
    );
  }

  const startedAt = Date.now();
  log(`${logPrefix} doc placement batch update start`, {
    shotId: shortId(shotId),
    operation: operationLabel,
    updateCount: docUpdates.length,
    timeoutMs: rpcTimeoutMs,
    updateSignature,
    network: getNetworkSnapshot(),
  });

  const watchdog = setTimeout(() => {
    log(`${logPrefix} doc placement batch update still pending`, {
      shotId: shortId(shotId),
      operation: operationLabel,
      updateCount: docUpdates.length,
      pendingMs: Date.now() - startedAt,
      updateSignature,
      network: getNetworkSnapshot(),
    });
  }, 8000);

  let saveError: { code?: string; message?: string } | null = null;
  let savedEntries: Array<{ entryId: string }> = [];
  try {
    savedEntries = await runTimelineWriteWithTimeout(
      timeoutOperationName,
      abortable(() =>
        batchUpdatePlacementFrames({
          projectSlug,
          shotId,
          updates: docUpdates.map(({ entryId, timelineFrame }) => ({ entryId, timelineFrame })),
        }),
      ),
      {
        timeoutMs: rpcTimeoutMs,
        upstreamSignal: signal,
        onTimeout: ({ pendingMs, timeoutMs }) => {
          log(`${logPrefix} doc placement batch update timed out`, {
            shotId: shortId(shotId),
            operation: operationLabel,
            updateCount: docUpdates.length,
            timeoutMs,
            pendingMs,
            updateSignature,
            network: getNetworkSnapshot(),
          });
        },
      },
    );
    log(`${logPrefix} doc placement batch update returned`, {
      shotId: shortId(shotId),
      operation: operationLabel,
      updateCount: docUpdates.length,
      durationMs: Date.now() - startedAt,
      errorCode: null,
      errorMessage: null,
      updateSignature,
    });
  } catch (error) {
    saveError = error as { code?: string; message?: string };
    log(`${logPrefix} doc placement batch update returned`, {
      shotId: shortId(shotId),
      operation: operationLabel,
      updateCount: docUpdates.length,
      durationMs: Date.now() - startedAt,
      errorCode: saveError.code ?? null,
      errorMessage: saveError.message ?? null,
      updateSignature,
    });
  } finally {
    clearTimeout(watchdog);
  }

  const requestedIds = new Set(docUpdates.map((update) => update.entryId));

  if (saveError) {
    if (isTimelineWriteTimeoutError(saveError)) {
      try {
        const diagnosticRows = await runTimelineWriteWithTimeout(
          `${timeoutOperationName}-timeout-diagnostics`,
          abortable(async () => {
            const { byShot } = await fetchProjectPlacements(projectSlug);
            return byShot.get(shotId) ?? [];
          }),
          { timeoutMs: 5000, upstreamSignal: signal },
        );
        const metadataByEntry = new Map(
          docUpdates.map((update) => [update.entryId, update.metadata ?? {}]),
        );

        log(`${logPrefix} timeout diagnostics snapshot`, {
          shotId: shortId(shotId),
          operation: operationLabel,
          updateSignature,
          requestedCount: requestedIds.size,
          snapshotCount: diagnosticRows.length,
          snapshot: diagnosticRows
            .filter((row) => requestedIds.has(row.entryId))
            .map((row) => ({
              entryId: shortId(row.entryId),
              generationId: shortId(row.generationId),
              timelineFrame: row.timelineFrame,
              dragSource: metadataByEntry.get(row.entryId)?.drag_source ?? null,
            })),
        });
      } catch (diagnosticError) {
        log(`${logPrefix} timeout diagnostics failed`, {
          shotId: shortId(shotId),
          operation: operationLabel,
          updateSignature,
          diagnosticError: (diagnosticError as { message?: string })?.message ?? String(diagnosticError),
        });
      }
    }

    throw saveError;
  }

  const returnedIds = new Set(
    savedEntries
      .map((row) => row.entryId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const missingRequestedIds = Array.from(requestedIds).filter((id) => !returnedIds.has(id));
  if (missingRequestedIds.length > 0 || returnedIds.size !== requestedIds.size) {
    log(`${logPrefix} doc placement batch update row mismatch`, {
      shotId: shortId(shotId),
      operation: operationLabel,
      requestedCount: requestedIds.size,
      returnedCount: returnedIds.size,
      missingRequestedIds: missingRequestedIds.map((id) => shortId(id)),
      requestedIds: Array.from(requestedIds).map((id) => shortId(id)),
      returnedIds: Array.from(returnedIds).map((id) => shortId(id)),
      updateSignature,
    });
    throw new Error(
      `Timeline batch update mismatch: requested ${requestedIds.size}, updated ${returnedIds.size}`,
    );
  }

  log(`${logPrefix} doc placement batch update succeeded`, {
    shotId: shortId(shotId),
    operation: operationLabel,
    updateCount: docUpdates.length,
    returnedFrames: savedEntries.slice(0, 8).map((row) => ({
      id: shortId(row.entryId),
      frame: docUpdates.find((update) => update.entryId === row.entryId)?.timelineFrame ?? null,
    })),
  });
  return {
    updateCount: docUpdates.length,
    durationMs: Date.now() - startedAt,
    skipped: false,
  };
}
