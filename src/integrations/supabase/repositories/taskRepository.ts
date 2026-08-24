import type { Task } from '@/types/tasks';
import { BridgeRouteError } from '@/integrations/astrid/transport';
import { bridgeTaskSummaryToTask, getBridgeTaskClient } from '@/integrations/astrid/bridgeTaskReads';

/**
 * One task's poll read via the frozen `GET /projects/:slug/tasks/:task_id`
 * route. A missing task is a `null`, never an error — same contract the
 * supabase-js `.maybeSingle()` path had.
 */
export async function fetchTaskInProject(taskId: string, projectId: string): Promise<Task | null> {
  const client = getBridgeTaskClient(projectId);
  try {
    const summary = await client.tasks.get(taskId);
    return bridgeTaskSummaryToTask(summary);
  } catch (error) {
    if (error instanceof BridgeRouteError && error.category === 'not_found') {
      return null;
    }
    throw error;
  }
}
