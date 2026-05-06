import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildGenerationParams: vi.fn(),
  resolveBasedOn: vi.fn(),
  normalizeSegmentTaskParams: vi.fn(),
  insertGeneration: vi.fn(),
  createVariant: vi.fn(),
  derivePredecessorVariantId: vi.fn(),
  createVariantOnParent: vi.fn(),
  getChildVariantViewedAt: vi.fn(),
}));

vi.mock('./params.ts', () => ({
  extractShotAndPosition: vi.fn(() => ({ shotId: null, addInPosition: false })),
  buildGenerationParams: (...args: unknown[]) => mocks.buildGenerationParams(...args),
  resolveBasedOn: (...args: unknown[]) => mocks.resolveBasedOn(...args),
}));

vi.mock('./generation-core.ts', async () => {
  const actual = await vi.importActual<typeof import('./generation-core.ts')>('./generation-core.ts');
  return {
    ...actual,
    insertGeneration: (...args: unknown[]) => mocks.insertGeneration(...args),
    createVariant: (...args: unknown[]) => mocks.createVariant(...args),
    derivePredecessorVariantId: (...args: unknown[]) => mocks.derivePredecessorVariantId(...args),
  };
});

vi.mock('./generation-parent.ts', () => ({
  createVariantOnParent: (...args: unknown[]) => mocks.createVariantOnParent(...args),
  getChildVariantViewedAt: (...args: unknown[]) => mocks.getChildVariantViewedAt(...args),
}));

vi.mock('./taskParamNormalizer.ts', () => ({
  normalizeSegmentTaskParams: (...args: unknown[]) => mocks.normalizeSegmentTaskParams(...args),
}));

vi.mock('./generation-child-diagnostics.ts', () => ({
  buildSegmentMasterStateSnapshot: vi.fn(() => ({ status: 'ok' })),
}));

import {
  handleChildGeneration,
  createSingleItemVariant,
  findExistingGenerationAtPosition,
  createChildGenerationRecord,
} from './generation-child.ts';

function createQueryBuilder(result: {
  maybeSingle?: { data?: unknown; error?: { code?: string; message?: string } | null };
}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result.maybeSingle ?? { data: null, error: null }),
  };
}

describe('complete_task/generation-child exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildGenerationParams.mockReturnValue({ normalized: true });
    mocks.resolveBasedOn.mockResolvedValue(null);
    mocks.normalizeSegmentTaskParams.mockImplementation(({ taskData, isSingleItem }: {
      taskData: unknown;
      isSingleItem: boolean;
    }) => ({
      taskData,
      params: taskData.params ?? {},
      pairShotGenerationId: null,
      isSingleItem,
    }));
    mocks.insertGeneration.mockImplementation(async (_supabase: unknown, record: { id: string }) => ({
      id: record.id,
    }));
    mocks.createVariant.mockResolvedValue({ id: 'variant-child-original' });
    mocks.derivePredecessorVariantId.mockResolvedValue(null);
    mocks.createVariantOnParent.mockImplementation(async (_supabase: unknown, generationId: string) => ({
      id: generationId,
      variant_id: `variant-${generationId}`,
    }));
    mocks.getChildVariantViewedAt.mockResolvedValue(new Date().toISOString());
  });

  it('exports child generation handlers', () => {
    expect(handleChildGeneration).toBeTypeOf('function');
    expect(createSingleItemVariant).toBeTypeOf('function');
    expect(findExistingGenerationAtPosition).toBeTypeOf('function');
    expect(createChildGenerationRecord).toBeTypeOf('function');
  });

  it('creates a child original variant for single-item completions', async () => {
    const taskUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const taskUpdate = vi.fn().mockReturnValue({ eq: taskUpdateEq });
    const parentVariantEq = vi.fn().mockResolvedValue({ count: 0, error: null });
    const parentVariantSelect = vi.fn().mockReturnValue({ eq: parentVariantEq });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'tasks') {
          return { update: taskUpdate };
        }
        if (table === 'generation_variants') {
          return { select: parentVariantSelect };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await handleChildGeneration({
      supabase: supabase as never,
      taskId: 'task-child',
      taskData: {
        task_type: 'individual_travel_segment',
        project_id: 'project-1',
        params: { segment_length_frames: 24 },
        content_type: 'video',
        tool_type: 'wan',
      },
      publicUrl: 'https://example.com/segment.mp4',
      thumbnailUrl: 'https://example.com/segment.jpg',
      parentGenerationId: 'parent-1',
      childOrder: null,
      isSingleItem: true,
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
    } as never);

    expect(result).toMatchObject({ id: expect.any(String) });
    expect(mocks.normalizeSegmentTaskParams).toHaveBeenCalledWith(expect.objectContaining({
      childOrder: null,
      isSingleItem: true,
    }));
    expect(mocks.insertGeneration).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        parent_generation_id: 'parent-1',
        is_child: true,
        child_order: null,
      }),
    );
    expect(mocks.createVariant).toHaveBeenCalledWith(
      supabase,
      expect.any(String),
      'https://example.com/segment.mp4',
      'https://example.com/segment.jpg',
      expect.objectContaining({
        source_task_id: 'task-child',
        created_from: 'single_segment_child_original',
      }),
      true,
      'original',
      null,
      expect.any(String),
    );
    expect(mocks.createVariantOnParent).toHaveBeenCalledWith(
      supabase,
      'parent-1',
      'https://example.com/segment.mp4',
      'https://example.com/segment.jpg',
      expect.objectContaining({
        task_type: 'individual_travel_segment',
      }),
      'task-child',
      expect.any(String),
      expect.objectContaining({
        created_from: 'single_item_completion',
        is_single_item: true,
      }),
      null,
      true,
    );
    expect(taskUpdate).toHaveBeenCalledWith({ generation_created: true });
    expect(taskUpdateEq).toHaveBeenCalledWith('id', 'task-child');
  });

  it('syncs single-item reruns onto the parent when reusing an existing child generation', async () => {
    const generationEq = vi.fn()
      .mockReturnThis();
    const generationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: generationEq,
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'child-existing' }, error: null }),
    };
    const parentVariantEq = vi.fn().mockResolvedValue({ count: 0, error: null });
    const parentVariantSelect = vi.fn().mockReturnValue({ eq: parentVariantEq });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'generations') {
          return generationQuery;
        }
        if (table === 'generation_variants') {
          return { select: parentVariantSelect };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await handleChildGeneration({
      supabase: supabase as never,
      taskId: 'task-rerun',
      taskData: {
        task_type: 'travel_segment',
        project_id: 'project-1',
        params: { pair_shot_generation_id: 'pair-shot-1' },
        content_type: 'video',
        tool_type: 'travel-between-images',
        variant_type: 'travel_segment',
      },
      publicUrl: 'https://example.com/rerun.mp4',
      thumbnailUrl: 'https://example.com/rerun.jpg',
      parentGenerationId: 'parent-1',
      childOrder: 0,
      isSingleItem: true,
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
    } as never);

    expect(result).toMatchObject({ id: 'child-existing' });
    expect(mocks.createVariantOnParent).toHaveBeenNthCalledWith(
      1,
      supabase,
      'child-existing',
      'https://example.com/rerun.mp4',
      'https://example.com/rerun.jpg',
      expect.objectContaining({
        task_type: 'travel_segment',
      }),
      'task-rerun',
      'travel_segment',
      expect.objectContaining({
        created_from: 'segment_variant_at_position',
        segment_index: 0,
      }),
      null,
      false,
      expect.any(String),
    );
    expect(mocks.createVariantOnParent).toHaveBeenNthCalledWith(
      2,
      supabase,
      'parent-1',
      'https://example.com/rerun.mp4',
      'https://example.com/rerun.jpg',
      expect.objectContaining({
        task_type: 'travel_segment',
      }),
      'task-rerun',
      'travel_segment',
      expect.objectContaining({
        created_from: 'single_item_completion',
        is_single_item: true,
      }),
      null,
      true,
    );
  });

  it('creates travel child records with completion shape fields', async () => {
    const taskUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const taskUpdate = vi.fn().mockReturnValue({ eq: taskUpdateEq });
    const shotGenQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'pair-shot-1' }, error: null }),
    };
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'tasks') {
          return { update: taskUpdate };
        }
        if (table === 'shot_generations') {
          return shotGenQuery;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    mocks.buildGenerationParams.mockReturnValue({ pair_shot_generation_id: 'pair-shot-1' });
    mocks.getChildVariantViewedAt.mockResolvedValueOnce(null);

    const result = await createChildGenerationRecord(
      {
        supabase: supabase as never,
        taskId: 'task-travel-child',
        taskData: {
          task_type: 'travel_segment',
          project_id: 'project-1',
          params: {
            pair_shot_generation_id: 'pair-shot-1',
            orchestrator_details: { run_id: 'run-1' },
          },
          content_type: 'video',
          tool_type: 'travel-between-images',
          variant_type: 'travel_segment',
        },
        publicUrl: 'https://example.com/travel-child.mp4',
        thumbnailUrl: 'https://example.com/travel-child.jpg',
        logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
      } as never,
      'parent-1',
      2,
      false,
      'pair-shot-1',
    );

    expect(result).toMatchObject({ id: expect.any(String) });
    expect(mocks.insertGeneration).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        parent_generation_id: 'parent-1',
        child_order: 2,
        is_child: true,
        pair_shot_generation_id: 'pair-shot-1',
      }),
    );
    expect(mocks.createVariant).toHaveBeenCalledWith(
      supabase,
      expect.any(String),
      'https://example.com/travel-child.mp4',
      'https://example.com/travel-child.jpg',
      expect.objectContaining({
        source_task_id: 'task-travel-child',
        created_from: 'child_generation_original',
        pair_shot_generation_id: 'pair-shot-1',
      }),
      true,
      'original',
      null,
      null,
    );
    expect(mocks.createVariantOnParent).not.toHaveBeenCalled();
    expect(taskUpdate).toHaveBeenCalledWith({ generation_created: true });
  });
});

describe('complete_task/generation-child findExistingGenerationAtPosition', () => {
  it('returns the latest pair-shot match by created_at desc', async () => {
    const generationsQuery = createQueryBuilder({
      maybeSingle: { data: { id: 'gen-pair-match' }, error: null },
    });
    const supabase = {
      from: vi.fn().mockReturnValue(generationsQuery),
    } as unknown as Parameters<typeof findExistingGenerationAtPosition>[0];

    const result = await findExistingGenerationAtPosition(
      supabase,
      'parent-1',
      3,
      'pair-shot-1',
    );

    expect(generationsQuery.eq).toHaveBeenCalledWith('pair_shot_generation_id', 'pair-shot-1');
    expect(generationsQuery.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(generationsQuery.limit).toHaveBeenCalledWith(1);
    expect(result).toBe('gen-pair-match');
  });

  it('returns null when the pair-shot lookup finds no row', async () => {
    const generationsQuery = createQueryBuilder({
      maybeSingle: { data: null, error: null },
    });
    const supabase = {
      from: vi.fn().mockReturnValue(generationsQuery),
    } as unknown as Parameters<typeof findExistingGenerationAtPosition>[0];

    const result = await findExistingGenerationAtPosition(
      supabase,
      'parent-1',
      3,
      'pair-shot-missing',
    );

    expect(generationsQuery.eq).toHaveBeenCalledWith('pair_shot_generation_id', 'pair-shot-missing');
    expect(generationsQuery.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(generationsQuery.limit).toHaveBeenCalledWith(1);
    expect(result).toBeNull();
  });
});
