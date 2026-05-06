import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleVariantCreation,
  handleVariantOnParent,
  handleVariantOnChild,
  handleStandaloneGeneration,
  handleChildGeneration,
} from './generation-handlers.ts';
import { CompletionError } from './errors.ts';

const mocks = vi.hoisted(() => ({
  insertGeneration: vi.fn(),
  createVariant: vi.fn(),
  derivePredecessorVariantId: vi.fn(),
  getOrCreateParentGeneration: vi.fn(),
  createVariantOnParent: vi.fn(),
  getChildVariantViewedAt: vi.fn(),
}));

vi.mock('./params.ts', () => ({
  extractShotAndPosition: vi.fn(() => ({ shotId: null, addInPosition: false })),
  buildGenerationParams: vi.fn(() => ({})),
  resolveBasedOn: vi.fn(() => null),
}));

vi.mock('./generation-child.ts', () => ({
  handleChildGeneration: vi.fn(),
  createSingleItemVariant: vi.fn(),
  findExistingGenerationAtPosition: vi.fn(),
  createChildGenerationRecord: vi.fn(),
}));

vi.mock('./generation-core.ts', async () => {
  const actual = await vi.importActual<typeof import('./generation-core.ts')>('./generation-core.ts');
  return {
    ...actual,
    insertGeneration: (...args: unknown[]) => mocks.insertGeneration(...args),
    createVariant: (...args: unknown[]) => mocks.createVariant(...args),
    derivePredecessorVariantId: (...args: unknown[]) => mocks.derivePredecessorVariantId(...args),
    linkGenerationToShot: actual.linkGenerationToShot,
  };
});

vi.mock('./generation-parent.ts', async () => {
  const actual = await vi.importActual<typeof import('./generation-parent.ts')>('./generation-parent.ts');
  return {
    ...actual,
    getOrCreateParentGeneration: (...args: unknown[]) => mocks.getOrCreateParentGeneration(...args),
    createVariantOnParent: (...args: unknown[]) => mocks.createVariantOnParent(...args),
    getChildVariantViewedAt: (...args: unknown[]) => mocks.getChildVariantViewedAt(...args),
  };
});

describe('complete_task/generation-handlers exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertGeneration.mockResolvedValue({ id: 'gen-standalone' });
    mocks.createVariant.mockResolvedValue({ id: 'variant-1' });
    mocks.derivePredecessorVariantId.mockResolvedValue(null);
    mocks.getChildVariantViewedAt.mockResolvedValue(null);
  });

  it('exports generation handlers', () => {
    expect(handleVariantCreation).toBeTypeOf('function');
    expect(handleVariantOnParent).toBeTypeOf('function');
    expect(handleVariantOnChild).toBeTypeOf('function');
    expect(handleStandaloneGeneration).toBeTypeOf('function');
    expect(handleChildGeneration).toBeTypeOf('function');
  });

  it('throws CompletionError when variant source generation lookup fails', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'missing' } });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = {
      from: vi.fn().mockReturnValue({ select }),
    };

    await expect(handleVariantCreation(
      supabase as never,
      'task-1',
      { params: {}, variant_type: 'image' },
      'gen-source',
      'https://example.com/out.png',
      null,
    )).rejects.toBeInstanceOf(CompletionError);
  });

  it('throws CompletionError when a stitched task cannot resolve its parent generation', async () => {
    mocks.getOrCreateParentGeneration.mockResolvedValue(null);
    const logger = { info: vi.fn() };

    await expect(handleVariantOnParent({
      supabase: {} as never,
      taskId: 'task-1',
      taskData: {
        task_type: 'join_final_stitch',
        project_id: 'project-1',
        params: {
          orchestrator_task_id: 'orch-1',
        },
      },
      publicUrl: 'https://example.com/out.mp4',
      thumbnailUrl: null,
      logger,
    } as never)).rejects.toBeInstanceOf(CompletionError);
  });

  it('creates a stitched parent variant when parent_generation_id is provided directly', async () => {
    mocks.createVariantOnParent.mockResolvedValue({ id: 'parent-1' });
    const logger = { info: vi.fn() };

    const result = await handleVariantOnParent({
      supabase: {} as never,
      taskId: 'task-2',
      taskData: {
        task_type: 'travel_stitch',
        project_id: 'project-1',
        params: {
          parent_generation_id: 'parent-1',
        },
      },
      publicUrl: 'https://example.com/out.mp4',
      thumbnailUrl: null,
      logger,
    } as never);

    expect(result).toEqual({ id: 'parent-1' });
    expect(mocks.getOrCreateParentGeneration).not.toHaveBeenCalled();
    expect(mocks.createVariantOnParent).toHaveBeenCalledWith(
      expect.anything(),
      'parent-1',
      'https://example.com/out.mp4',
      null,
      expect.objectContaining({
        task_type: 'travel_stitch',
      }),
      'task-2',
      expect.any(String),
      expect.objectContaining({
        created_from: 'travel_stitch_completion',
      }),
    );
  });

  it('returns completion asset identity for source-derived variant creation', async () => {
    const taskUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const taskUpdate = vi.fn().mockReturnValue({ eq: taskUpdateEq });
    const sourceSingle = vi.fn().mockResolvedValue({
      data: { id: 'gen-source', project_id: 'project-1' },
      error: null,
    });
    const sourceEq = vi.fn().mockReturnValue({ single: sourceSingle });
    const sourceSelect = vi.fn().mockReturnValue({ eq: sourceEq });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'generations') {
          return { select: sourceSelect };
        }
        if (table === 'tasks') {
          return { update: taskUpdate };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    await expect(handleVariantCreation(
      supabase as never,
      'task-image-upscale',
      {
        params: { is_primary: true, source_variant_id: 'source-variant-1' },
        variant_type: 'magic-edit',
        task_type: 'image-upscale',
        tool_type: 'image-upscale',
        content_type: 'image',
      },
      'gen-source',
      'https://example.com/out.png',
      'https://example.com/thumb.png',
    )).resolves.toEqual({
      generation_id: 'gen-source',
      variant_id: 'variant-1',
      location: 'https://example.com/out.png',
      thumbnail_url: 'https://example.com/thumb.png',
      media_type: 'image',
      created_as: 'variant',
    });
    expect(mocks.createVariant).toHaveBeenCalledWith(
      supabase,
      'gen-source',
      'https://example.com/out.png',
      'https://example.com/thumb.png',
      expect.objectContaining({
        source_task_id: 'task-image-upscale',
        source_variant_id: 'source-variant-1',
        created_from: 'image-upscale',
        tool_type: 'image-upscale',
      }),
      true,
      'magic-edit',
      null,
    );
    expect(taskUpdate).toHaveBeenCalledWith({ generation_created: true });
    expect(taskUpdateEq).toHaveBeenCalledWith('id', 'task-image-upscale');
  });

  it('returns completion asset identity for standalone generation originals', async () => {
    const taskUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const taskUpdate = vi.fn().mockReturnValue({ eq: taskUpdateEq });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'tasks') {
          return { update: taskUpdate };
        }
        if (table === 'shots') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await handleStandaloneGeneration({
      supabase: supabase as never,
      taskId: 'task-animate-character',
      taskData: {
        task_type: 'animate_character',
        project_id: 'project-1',
        params: {},
        tool_type: 'animate_character',
        content_type: 'video',
      },
      publicUrl: 'https://example.com/generated.mp4',
      thumbnailUrl: 'https://example.com/generated-thumb.jpg',
      logger: { info: vi.fn() },
    } as never) as {
      id: string;
      completionAsset: {
        generation_id: string;
        variant_id?: string;
        location: string;
        thumbnail_url?: string;
        media_type: string;
        created_as: 'generation' | 'variant';
      };
    };

    expect(result).toMatchObject({
      id: 'gen-standalone',
      completionAsset: {
        generation_id: 'gen-standalone',
        variant_id: 'variant-1',
        location: 'https://example.com/generated.mp4',
        thumbnail_url: 'https://example.com/generated-thumb.jpg',
        media_type: 'video',
        created_as: 'generation',
      },
    });
    expect(mocks.insertGeneration).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        id: expect.any(String),
        tasks: ['task-animate-character'],
        project_id: 'project-1',
        type: 'video',
        parent_generation_id: null,
        is_child: false,
        child_order: null,
      }),
    );
    expect(mocks.createVariant).toHaveBeenCalledWith(
      supabase,
      'gen-standalone',
      'https://example.com/generated.mp4',
      'https://example.com/generated-thumb.jpg',
      expect.objectContaining({
        source_task_id: 'task-animate-character',
        created_from: 'generation_original',
      }),
      true,
      'original',
      null,
      null,
    );
    expect(taskUpdate).toHaveBeenCalledWith({ generation_created: true });
    expect(taskUpdateEq).toHaveBeenCalledWith('id', 'task-animate-character');
  });

  it('creates the variant on the child generation and auto-marks viewed_at for single-segment cases', async () => {
    const taskUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const taskUpdate = vi.fn().mockReturnValue({ eq: taskUpdateEq });
    const childGeneration = {
      id: 'child-1',
      parent_generation_id: 'parent-1',
      child_order: 0,
    };
    const generationSingle = vi.fn().mockResolvedValue({
      data: childGeneration,
      error: null,
    });
    const generationEq = vi.fn().mockReturnValue({ single: generationSingle });
    const generationSelect = vi.fn().mockReturnValue({ eq: generationEq });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'generations') {
          return { select: generationSelect };
        }
        if (table === 'tasks') {
          return { update: taskUpdate };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    mocks.getChildVariantViewedAt.mockResolvedValue('2026-04-14T00:00:00.000Z');

    const result = await handleVariantOnChild({
      supabase: supabase as never,
      taskId: 'task-child-variant',
      taskData: {
        task_type: 'individual_travel_segment',
        project_id: 'project-1',
        params: {
          _isSingleSegmentCase: true,
        },
        tool_type: 'wan',
        variant_type: 'travel_segment',
      },
      publicUrl: 'https://example.com/segment.mp4',
      thumbnailUrl: 'https://example.com/segment.jpg',
      childGenerationId: 'child-1',
      logger: { info: vi.fn() },
    } as never);

    expect(result).toEqual(childGeneration);
    expect(mocks.getChildVariantViewedAt).toHaveBeenCalledWith(supabase, {
      taskParams: {
        _isSingleSegmentCase: true,
      },
      childGeneration,
    });
    expect(mocks.createVariant).toHaveBeenCalledWith(
      supabase,
      'child-1',
      'https://example.com/segment.mp4',
      'https://example.com/segment.jpg',
      expect.objectContaining({
        source_task_id: 'task-child-variant',
        created_from: 'individual_segment_regeneration',
        tool_type: 'wan',
      }),
      true,
      'travel_segment',
      null,
      '2026-04-14T00:00:00.000Z',
    );
    expect(mocks.createVariantOnParent).not.toHaveBeenCalled();
    expect(taskUpdate).toHaveBeenCalledWith({ generation_created: true });
    expect(taskUpdateEq).toHaveBeenCalledWith('id', 'task-child-variant');
  });
});
