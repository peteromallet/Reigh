import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveGenerationProjectScope,
  resolveGenerationTaskMapping,
  resolveGenerationTaskMappings,
  resolveVariantProjectScope,
} from '../tasks/generationTaskRepository';

const IDS = {
  one: '11111111-1111-4111-8111-111111111111',
  two: '22222222-2222-4222-8222-222222222222',
  missing: '55555555-5555-4555-8555-555555555555',
} as const;

function detail(id: string, projectId: string, taskId: string | null, variantId = `variant-${id}`) {
  return {
    generation: {
      generation_id: id,
      project_id: projectId,
      task_id: taskId,
      type: 'image',
      starred: false,
      created_at: '2026-08-24T00:00:00Z',
      updated_at: '2026-08-24T00:00:00Z',
      variants: [{
        id: variantId,
        generation_id: id,
        media_id: `media-${id}`,
        is_primary: true,
        starred: false,
        created_at: '2026-08-24T00:00:00Z',
      }],
    },
  };
}

function installBridge(options: { fail?: boolean; mismatch?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (options.fail) return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    const url = new URL(String(input), 'http://bridge.fake');
    const parts = url.pathname.split('/').filter(Boolean);
    const generationId = parts.at(-1)!;
    if (parts.at(-1) === 'generations') {
      return Response.json({
        generations: [
          { generation_id: IDS.one, name: null, type: 'image', starred: false, created_at: '2026-08-24T00:00:00Z', updated_at: '2026-08-24T00:00:00Z', primary: null, variant_count: 1 },
        ],
        next_cursor: null,
      });
    }
    if (generationId === IDS.missing) {
      return new Response(JSON.stringify({ error: 'not_found', detail: 'missing' }), { status: 404 });
    }
    const projectId = options.mismatch ? 'project-other' : 'project-1';
    return Response.json(detail(generationId, projectId, `task-${generationId}`));
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('generationTaskRepository bridge cutover', () => {
  it('maps generation detail task_id and missing rows', async () => {
    installBridge();
    const result = await resolveGenerationTaskMappings([IDS.one, IDS.two, IDS.missing], { projectId: 'project-1' });
    expect(result.get(IDS.one)).toMatchObject({ status: 'ok', taskId: `task-${IDS.one}` });
    expect(result.get(IDS.two)).toMatchObject({ status: 'ok', taskId: `task-${IDS.two}` });
    expect(result.get(IDS.missing)).toMatchObject({ status: 'missing_generation', taskId: null });
  });

  it('does not fetch temporary generation ids', async () => {
    installBridge();
    const result = await resolveGenerationTaskMappings(['temp-generation-id'], { projectId: 'project-1' });
    expect(result.get('temp-generation-id')).toMatchObject({ status: 'not_loaded', taskId: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps single lookup and project scope on the bridge detail authority', async () => {
    installBridge();
    await expect(resolveGenerationTaskMapping(IDS.one, { projectId: 'project-1' }))
      .resolves.toMatchObject({ status: 'ok', taskId: `task-${IDS.one}` });
    await expect(resolveGenerationProjectScope(IDS.one, 'project-1'))
      .resolves.toMatchObject({ status: 'ok', projectId: 'project-1' });
  });

  it('reports scope mismatch and transport failures explicitly', async () => {
    installBridge({ mismatch: true });
    await expect(resolveGenerationProjectScope(IDS.one, 'project-1'))
      .resolves.toMatchObject({ status: 'scope_mismatch', projectId: 'project-other' });
    vi.unstubAllGlobals();
    installBridge({ fail: true });
    await expect(resolveGenerationProjectScope(IDS.one, 'project-1'))
      .resolves.toMatchObject({ status: 'query_failed', projectId: null });
  });

  it('finds a variant by traversing bridge gallery detail', async () => {
    installBridge();
    await expect(resolveVariantProjectScope(`variant-${IDS.one}`, 'project-1'))
      .resolves.toMatchObject({ status: 'ok', generationId: IDS.one, projectId: 'project-1' });
  });
});
