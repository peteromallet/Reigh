import { ServerError } from '@/shared/lib/errorHandling/errors';
import type { TaskCreationResult } from './types';

interface TaskCreationContext {
  requestId: string;
  taskType: string;
  projectId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractTaskIds(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.task_ids)) {
    return [];
  }

  return payload.task_ids
    .map((taskId) => typeof taskId === 'string' ? taskId.trim() : '')
    .filter((taskId): taskId is string => taskId.length > 0);
}

export function parseTaskCreationResponse(
  payload: unknown,
  context: TaskCreationContext,
): TaskCreationResult {
  if (!isRecord(payload)) {
    throw new ServerError('Task creation returned an invalid response', {
      context: { ...context },
    });
  }

  const taskIds = extractTaskIds(payload);
  const singleTaskId = typeof payload.task_id === 'string' ? payload.task_id.trim() : '';
  const taskId = singleTaskId || taskIds[0] || '';
  if (!taskId) {
    const inlineError = typeof payload.error === 'string' ? payload.error.trim() : '';
    throw new ServerError(inlineError || 'Task creation failed before returning a task id', {
      context: {
        ...context,
        responseStatus: typeof payload.status === 'string' ? payload.status : 'unknown',
      },
    });
  }

  const status = typeof payload.status === 'string' && payload.status.trim().length > 0
    ? payload.status.trim()
    : 'pending';
  const meta = isRecord(payload.meta) ? payload.meta : undefined;

  return {
    task_id: taskId,
    ...(taskIds.length > 0 ? { task_ids: taskIds } : {}),
    status,
    ...(meta ? { meta } : {}),
  };
}
