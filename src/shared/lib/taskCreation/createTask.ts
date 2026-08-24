import { getBridgeTaskClient, mapBridgeTaskStatus } from '@/integrations/astrid/bridgeTaskReads';
import { fetchGenerationRecordById } from '@/integrations/supabase/repositories/generationRepository';
import { BridgeTransportFailure } from '@/integrations/astrid/transport';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { normalizeAndPresentAndRethrow } from '@/shared/lib/errorHandling/runtimeError';
import { NetworkError } from '@/shared/lib/errorHandling/errors';
import { materializeLocalGeneration } from '@/shared/lib/media/materializeLocalGeneration';
import { generateUUID } from './ids';
import type { LocalWorkerSession } from './localWorkerSession';
import { parseTaskCreationResponse } from './parseTaskCreationResponse';
import type { BaseTaskParams, TaskCreationResult } from './types';

const MAX_ATTEMPTS = 2;
const DIRECT_GENERATION_ID_KEYS = new Set([
  'based_on',
  'source_generation_id',
  'generation_id',
  'input_generation_id',
  'parent_generation_id',
  'start_image_generation_id',
  'end_image_generation_id',
  'pair_shot_generation_id',
]);
const ARRAY_GENERATION_ID_KEYS = new Set([
  'input_image_generation_ids',
  'pair_shot_generation_ids',
]);

interface CreateTaskOptions {
  signal?: AbortSignal;
  localWorkerSession?: LocalWorkerSession;
  onMaterializeProgress?: (event: {
    generationId: string;
    progress: number;
    index: number;
    total: number;
  }) => void;
}

function getNetworkDiagnostics(): Record<string, unknown> {
  const diag: Record<string, unknown> = {
    online: navigator.onLine,
  };
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection;
  if (conn) {
    diag.effectiveType = conn.effectiveType;
    diag.downlink = conn.downlink;
    diag.rtt = conn.rtt;
  }
  return diag;
}


function addGenerationId(target: Set<string>, value: unknown): void {
  if (typeof value !== 'string') {
    return;
  }

  const trimmed = value.trim();
  if (trimmed) {
    target.add(trimmed);
  }
}

function addGenerationIdsFromArray(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }

  value.forEach((item) => addGenerationId(target, item));
}

function collectGenerationIds(value: unknown, target: Set<string>): void {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectGenerationIds(item, target));
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, nestedValue] of Object.entries(record)) {
    if (DIRECT_GENERATION_ID_KEYS.has(key)) {
      addGenerationId(target, nestedValue);
      continue;
    }

    if (ARRAY_GENERATION_ID_KEYS.has(key)) {
      addGenerationIdsFromArray(target, nestedValue);
      continue;
    }

    collectGenerationIds(nestedValue, target);
  }
}

async function materializeTaskInputGenerations(
  input: Record<string, unknown>,
  options?: CreateTaskOptions,
): Promise<void> {
  const generationIds = new Set<string>();
  collectGenerationIds(input, generationIds);

  if (generationIds.size === 0) {
    return;
  }

  let announcedUpload = false;
  const ids = Array.from(generationIds);

  for (const [index, generationId] of ids.entries()) {
    const record = await fetchGenerationRecordById(generationId) as Record<string, unknown> | null;
    if (record?.storage_mode === 'remote' || !record?.storage_mode) {
      continue;
    }

    if (!announcedUpload) {
      toast.info('Uploading original before sending to worker…');
      announcedUpload = true;
    }

    await materializeLocalGeneration(generationId, {
      signal: options?.signal,
      onProgress: (progress) => options?.onMaterializeProgress?.({
        generationId,
        progress,
        index,
        total: ids.length,
      }),
    });
  }
}

/**
 * Creates a task through the frozen R1 admission route
 * (`POST /projects/:slug/tasks`, Idempotency-Key header).
 * Retries once on transport failure since admission is receipted: replaying
 * the same key either dedups or 409s, never double-admits.
 */
export async function createTask(
  taskParams: BaseTaskParams,
  options?: CreateTaskOptions,
): Promise<TaskCreationResult> {
  const startTime = Date.now();
  const requestId = `${startTime}-${Math.random().toString(36).slice(2, 8)}`;
  const requestContext = {
    requestId,
    taskType: taskParams.family,
    projectId: taskParams.project_id,
  };

  // Idempotency key stays the same across retries so the bridge
  // deduplicates if the first attempt actually landed.
  const idempotency_key = generateUUID();

  // Legacy safety net: callers not migrated to the per-input resolver still
  // rely on this scan to upload local-only generations before the worker
  // tries to fetch them. Migrated callers (with localWorkerSession) get the
  // spec-conformant per-input behavior; their local generations are already
  // resolved into materialized_inputs and this scan is a no-op for them.
  await materializeTaskInputGenerations(taskParams.input, options);

  // Plain-object copies: the wire schema's materialized-input rows are
  // structurally compatible with MaterializedInputRecord but not with the
  // interface itself (no implicit index signature).
  const materializations = (options?.localWorkerSession?.records() ?? [])
    .map((record) => ({ ...record }));
  const client = getBridgeTaskClient(taskParams.project_id);
  const admissionRequest = {
    family: taskParams.family,
    input: taskParams.input,
    ...(materializations.length > 0 ? { materialized_inputs: materializations } : {}),
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.tasks.admit(admissionRequest, idempotency_key);

      return parseTaskCreationResponse(
        {
          task_id: response.task.id,
          status: mapBridgeTaskStatus(response.task.status),
        },
        requestContext,
      );
    } catch (err: unknown) {
      lastError = err;
      const durationMs = Date.now() - startTime;
      const isTimeout = err instanceof BridgeTransportFailure;

      if (isTimeout && attempt < MAX_ATTEMPTS) {
        console.error('[createTask] attempt %d/%d failed after %dms, retrying', attempt, MAX_ATTEMPTS, durationMs, {
          ...requestContext,
          network: getNetworkDiagnostics(),
        });
        continue;
      }

      const context = {
        ...requestContext,
        attempt,
        durationMs,
        network: getNetworkDiagnostics(),
        errorType: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
      };

      console.error('[createTask] FAILED after %d attempt(s), %dms', attempt, durationMs, context);

      if (isTimeout) {
        throw new NetworkError('Task creation timed out. Please try again.', {
          isTimeout: true,
          context,
          cause: err instanceof Error ? err : undefined,
        });
      }

      normalizeAndPresentAndRethrow(err, {
        context: 'TaskCreation',
        showToast: false,
        logData: context,
      });
    }
  }

  // Unreachable, but TypeScript needs it
  throw lastError;
}
