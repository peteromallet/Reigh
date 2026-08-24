import { AstridLocalClient } from './client.ts';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import type { Task } from '@/types/tasks';

export interface BridgeTaskOutputRecord extends Record<string, unknown> {
  id: string;
  location: string;
  thumbnail_url: string;
  type: string;
  created_at: string;
  project_id: string;
  task_id: string;
  params: Record<string, unknown>;
  _variant_id: string;
  _variant_is_primary: boolean;
}

/**
 * Resolve committed task outputs directly from the task detail route. The
 * output row is the authority for task→media association; no gallery scan or
 * location equality heuristic is needed.
 */
export async function readBridgeTaskOutputs(task: Task): Promise<BridgeTaskOutputRecord[]> {
  const detail = await new AstridLocalClient({ projectSlug: task.projectId }).tasks.get(task.id);
  return (detail.outputs ?? []).map((output) => {
    const params = typeof output.params_json === 'string'
      ? parseParams(output.params_json)
      : (output.params_json ?? {});
    const location = bridgeMediaUrl(task.projectId, output.media_id);
    return {
      id: `${task.id}:${output.ordinal}`,
      location,
      thumbnail_url: location,
      type: output.role.includes('video') ? 'video' : output.role.includes('image') ? 'image' : output.role,
      created_at: task.updatedAt ?? task.createdAt,
      project_id: task.projectId,
      task_id: task.id,
      params,
      _variant_id: output.media_id,
      _variant_is_primary: output.is_primary ?? output.ordinal === 0,
    };
  });
}

function parseParams(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
