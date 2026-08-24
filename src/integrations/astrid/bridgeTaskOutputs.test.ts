import { afterEach, describe, expect, it, vi } from 'vitest';

import { readBridgeTaskOutputs } from './bridgeTaskOutputs';
import type { Task } from '@/types/tasks';

afterEach(() => vi.unstubAllGlobals());

describe('readBridgeTaskOutputs', () => {
  it('projects committed output rows to stable R9 media records', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      task: {
        task_id: 'task-1',
        project_id: 'demo',
        capability: 'render_export',
        status: 'succeeded',
        priority: 0,
        max_attempts: 1,
        created_at: '2026-08-24T00:00:00Z',
        updated_at: '2026-08-24T00:01:00Z',
        outputs: [{
          ordinal: 0,
          role: 'video',
          media_id: 'media-1',
          is_primary: true,
          params_json: '{"codec":"h264"}',
        }],
      },
    })));

    const task = {
      id: 'task-1',
      projectId: 'demo',
      taskType: 'render_export',
      status: 'Complete',
      params: {},
      createdAt: '2026-08-24T00:00:00Z',
    } satisfies Task;

    await expect(readBridgeTaskOutputs(task)).resolves.toEqual([
      expect.objectContaining({
        location: '/api/astrid/projects/demo/media/media-1/content',
        type: 'video',
        params: { codec: 'h264' },
        _variant_is_primary: true,
      }),
    ]);
  });
});
