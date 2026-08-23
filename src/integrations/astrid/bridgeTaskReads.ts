/**
 * Bridge-backed task reads for the covered journey's J3/J4 steps (admit,
 * poll, cancel). Slice-A cutover of Batch C3: every consumer here used to
 * read `tasks` rows through supabase-js and now reads the frozen doc-27 §4.1
 * routes through `AstridLocalClient`.
 *
 * The bridge summary → app `Task` projection follows the
 * `GenerationRowDto` + coercer precedent (`generationRowMapper.ts`):
 * structural coercion of validated wire data, no second schema authority.
 */

import { AstridLocalClient } from './client.ts';
import type { BridgeTaskSummary } from '@/tools/video-editor/data/bridgeContract.ts';
import { asRecord } from '@/shared/lib/typeCoercion';
import { TASK_STATUS, type Task, type TaskStatus } from '@/types/tasks';

/** One client per project slug; transports are stateless fetch pipelines. */
const clientsBySlug = new Map<string, AstridLocalClient>();

export function getBridgeTaskClient(projectSlug: string): AstridLocalClient {
  let client = clientsBySlug.get(projectSlug);
  if (!client) {
    client = new AstridLocalClient({ projectSlug });
    clientsBySlug.set(projectSlug, client);
  }
  return client;
}

/**
 * Bridge kernel statuses → the app's display statuses. Unreachable for
 * schema-valid reads (the wire enum has exactly these five); the fallback
 * keeps an unknown future value from crashing a poll tick.
 */
export function mapBridgeTaskStatus(status: string): TaskStatus {
  switch (status) {
    case 'queued': return TASK_STATUS.QUEUED;
    case 'running': return TASK_STATUS.IN_PROGRESS;
    case 'succeeded': return TASK_STATUS.COMPLETE;
    case 'failed': return TASK_STATUS.FAILED;
    case 'cancelled': return TASK_STATUS.CANCELLED;
    default: return TASK_STATUS.QUEUED;
  }
}

/** App-facing task type: the admitted family, falling back to spec/capability. */
function bridgeTaskType(summary: BridgeTaskSummary): string {
  const spec = asRecord(summary.spec);
  // The app's task_type column historically held the concrete worker type
  // (`spec.source_task_type`); the coarse `family` is only a fallback.
  if (typeof spec?.source_task_type === 'string' && spec.source_task_type.length > 0) {
    return spec.source_task_type;
  }
  if (typeof spec?.family === 'string' && spec.family.length > 0) {
    return spec.family;
  }
  return summary.capability;
}

/** Project one validated polling summary onto the app's `Task` model. */
export function bridgeTaskSummaryToTask(summary: BridgeTaskSummary): Task {
  const spec = asRecord(summary.spec);
  const params = asRecord(spec?.params);

  return {
    id: summary.task_id,
    taskType: bridgeTaskType(summary),
    params: params ?? {},
    status: mapBridgeTaskStatus(summary.status),
    createdAt: summary.created_at,
    updatedAt: summary.updated_at,
    projectId: summary.project_id,
  };
}

/**
 * Root-task rule (was `.is('params->orchestrator_task_id_ref', null)`):
 * subtasks carry an orchestrator back-reference inside their params.
 */
export function isRootBridgeTask(params: Record<string, unknown>): boolean {
  const orchestratorRef = params.orchestrator_task_id_ref
    ?? asRecord(params.orchestration_contract)?.orchestrator_task_id
    ?? asRecord(params.orchestrator_details)?.orchestrator_task_id;
  return orchestratorRef === undefined || orchestratorRef === null;
}

/** All current tasks of a project as app `Task`s (one bounded list read). */
export async function listBridgeTasks(projectSlug: string): Promise<Task[]> {
  const client = getBridgeTaskClient(projectSlug);
  const page = await client.tasks.list();
  return page.tasks.map(bridgeTaskSummaryToTask);
}
