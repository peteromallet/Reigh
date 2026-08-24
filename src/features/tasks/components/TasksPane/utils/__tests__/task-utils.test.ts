import { describe, it, expect, vi } from 'vitest';

const mockFetchProjectPlacements = vi.fn();

vi.mock('@/shared/lib/placement/placementService', () => ({
  fetchProjectPlacements: (...args: unknown[]) => mockFetchProjectPlacements(...args),
}));

vi.mock('@/shared/contexts/projectSelectionStore', () => ({
  getProjectSelectionFallbackId: vi.fn(() => 'demo-project'),
}));

import {
  deriveTaskInputImages,
  getAbbreviatedTaskName,
  parseTaskParamsForDisplay,
  extractShotId,
  extractSourceGenerationId,
  extractTaskParentGenerationId,
  extractPairShotGenerationId,
  isSegmentVideoTask,
  checkSegmentConnection,
} from '../task-utils';
import type { Task } from '@/types/tasks';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  taskType: 'image_generation',
  params: {},
  status: 'Complete',
  createdAt: '2025-01-01',
  projectId: 'proj-1',
  ...overrides,
});

describe('deriveTaskInputImages', () => {
  it('returns empty array for null task', () => {
    expect(deriveTaskInputImages(null)).toEqual([]);
  });

  it('returns empty array for task with no params', () => {
    expect(deriveTaskInputImages(makeTask({ params: {} }))).toEqual([]);
  });

  it('extracts from input_image string', () => {
    const task = makeTask({ params: { input_image: 'https://example.com/img.png' } });
    expect(deriveTaskInputImages(task)).toEqual(['https://example.com/img.png']);
  });

  it('extracts from image string', () => {
    const task = makeTask({ params: { image: 'https://example.com/img.png' } });
    expect(deriveTaskInputImages(task)).toEqual(['https://example.com/img.png']);
  });

  it('extracts from init_image string', () => {
    const task = makeTask({ params: { init_image: 'https://example.com/init.png' } });
    expect(deriveTaskInputImages(task)).toEqual(['https://example.com/init.png']);
  });

  it('extracts from control_image string', () => {
    const task = makeTask({ params: { control_image: 'https://example.com/ctrl.png' } });
    expect(deriveTaskInputImages(task)).toEqual(['https://example.com/ctrl.png']);
  });

  it('extracts from images array', () => {
    const task = makeTask({ params: { images: ['img1.png', 'img2.png'] } });
    expect(deriveTaskInputImages(task)).toEqual(['img1.png', 'img2.png']);
  });

  it('extracts from input_images array', () => {
    const task = makeTask({ params: { input_images: ['a.png', 'b.png'] } });
    expect(deriveTaskInputImages(task)).toEqual(['a.png', 'b.png']);
  });

  it('extracts from full_orchestrator_payload.input_image_paths_resolved', () => {
    const task = makeTask({
      params: {
        full_orchestrator_payload: {
          input_image_paths_resolved: ['resolved1.png', 'resolved2.png'],
        },
      },
    });
    expect(deriveTaskInputImages(task)).toEqual(['resolved1.png', 'resolved2.png']);
  });

  it('extracts from orchestrator_details.input_image_paths_resolved', () => {
    const task = makeTask({
      params: {
        orchestrator_details: {
          input_image_paths_resolved: ['orch1.png'],
        },
      },
    });
    expect(deriveTaskInputImages(task)).toEqual(['orch1.png']);
  });

  it('extracts from top-level input_image_paths_resolved', () => {
    const task = makeTask({
      params: {
        input_image_paths_resolved: ['top.png'],
      },
    });
    expect(deriveTaskInputImages(task)).toEqual(['top.png']);
  });

  it('handles individual_travel_segment with individual_segment_params', () => {
    const task = makeTask({
      taskType: 'individual_travel_segment',
      params: {
        segment_index: 0,
        individual_segment_params: {
          input_image_paths_resolved: ['seg1.png', 'seg2.png'],
        },
      },
    });
    expect(deriveTaskInputImages(task)).toEqual(['seg1.png', 'seg2.png']);
  });

  it('filters out falsy values', () => {
    const task = makeTask({
      params: {
        images: ['valid.png', '', null, undefined, 'also_valid.png'],
      },
    });
    expect(deriveTaskInputImages(task)).toEqual(['valid.png', 'also_valid.png']);
  });
});

describe('getAbbreviatedTaskName', () => {
  it('abbreviates known task names', () => {
    expect(getAbbreviatedTaskName('Travel Between Images')).toBe('Travel Video');
    expect(getAbbreviatedTaskName('Image Generation')).toBe('Image Gen');
  });

  it('returns unknown names as-is', () => {
    expect(getAbbreviatedTaskName('Some New Task')).toBe('Some New Task');
  });
});

describe('parseTaskParamsForDisplay', () => {
  it('parses object params', () => {
    const params = { prompt: 'a cat', seed: 42 };
    const { parsed, promptText } = parseTaskParamsForDisplay(params);
    expect(parsed).toEqual(params);
    expect(promptText).toBe('a cat');
  });

  it('parses JSON string params', () => {
    const params = JSON.stringify({ prompt: 'a dog' });
    const { parsed, promptText } = parseTaskParamsForDisplay(params);
    expect(parsed.prompt).toBe('a dog');
    expect(promptText).toBe('a dog');
  });

  it('extracts prompt from orchestrator_details', () => {
    const params = { orchestrator_details: { prompt: 'orchestrated prompt' } };
    const { promptText } = parseTaskParamsForDisplay(params);
    expect(promptText).toBe('orchestrated prompt');
  });

  it('handles null params', () => {
    const { parsed, promptText } = parseTaskParamsForDisplay(null);
    expect(parsed).toEqual({});
    expect(promptText).toBe('');
  });

  it('handles invalid JSON string', () => {
    const { parsed, promptText } = parseTaskParamsForDisplay('not valid json');
    expect(parsed).toEqual({});
    expect(promptText).toBe('');
  });
});

describe('extractShotId', () => {
  it('extracts from orchestrator_details.shot_id', () => {
    const task = makeTask({
      params: { orchestrator_details: { shot_id: 'shot-from-orch' } },
    });
    expect(extractShotId(task)).toBe('shot-from-orch');
  });

  it('extracts from full_orchestrator_payload.shot_id', () => {
    const task = makeTask({
      params: { full_orchestrator_payload: { shot_id: 'shot-from-payload' } },
    });
    expect(extractShotId(task)).toBe('shot-from-payload');
  });

  it('extracts from individual_segment_params.shot_id', () => {
    const task = makeTask({
      params: { individual_segment_params: { shot_id: 'shot-from-segment' } },
    });
    expect(extractShotId(task)).toBe('shot-from-segment');
  });

  it('extracts from top-level params.shot_id', () => {
    const task = makeTask({ params: { shot_id: 'shot-top' } });
    expect(extractShotId(task)).toBe('shot-top');
  });

  it('returns null when no shot_id found', () => {
    const task = makeTask({ params: { prompt: 'a cat' } });
    expect(extractShotId(task)).toBeNull();
  });
});

describe('extractSourceGenerationId', () => {
  it('extracts based_on', () => {
    expect(extractSourceGenerationId({ based_on: 'gen-1' })).toBe('gen-1');
  });

  it('extracts source_generation_id', () => {
    expect(extractSourceGenerationId({ source_generation_id: 'gen-2' })).toBe('gen-2');
  });

  it('extracts generation_id', () => {
    expect(extractSourceGenerationId({ generation_id: 'gen-3' })).toBe('gen-3');
  });

  it('extracts input_generation_id', () => {
    expect(extractSourceGenerationId({ input_generation_id: 'gen-4' })).toBe('gen-4');
  });

  it('extracts parent_generation_id', () => {
    expect(extractSourceGenerationId({ parent_generation_id: 'gen-5' })).toBe('gen-5');
  });

  it('returns undefined when none found', () => {
    expect(extractSourceGenerationId({ prompt: 'a cat' })).toBeUndefined();
  });

  it('prefers based_on over others', () => {
    expect(extractSourceGenerationId({
      based_on: 'preferred',
      source_generation_id: 'fallback',
    })).toBe('preferred');
  });
});

describe('extractTaskParentGenerationId', () => {
  it('extracts from top-level parent_generation_id', () => {
    expect(extractTaskParentGenerationId({ parent_generation_id: 'parent-1' })).toBe('parent-1');
  });

  it('extracts from orchestrator_details', () => {
    expect(extractTaskParentGenerationId({
      orchestrator_details: { parent_generation_id: 'parent-orch' },
    })).toBe('parent-orch');
  });

  it('extracts from full_orchestrator_payload', () => {
    expect(extractTaskParentGenerationId({
      full_orchestrator_payload: { parent_generation_id: 'parent-payload' },
    })).toBe('parent-payload');
  });

  it('returns undefined when not found', () => {
    expect(extractTaskParentGenerationId({})).toBeUndefined();
  });
});

describe('extractPairShotGenerationId', () => {
  it('extracts from top-level pair_shot_generation_id', () => {
    const task = makeTask({ params: { pair_shot_generation_id: 'pair-1' } });
    expect(extractPairShotGenerationId(task)).toBe('pair-1');
  });

  it('extracts from individual_segment_params', () => {
    const task = makeTask({
      params: { individual_segment_params: { pair_shot_generation_id: 'pair-seg' } },
    });
    expect(extractPairShotGenerationId(task)).toBe('pair-seg');
  });

  it('extracts from pair_shot_generation_ids array using segment_index', () => {
    const task = makeTask({
      params: {
        segment_index: 1,
        orchestrator_details: {
          pair_shot_generation_ids: ['pair-0', 'pair-1', 'pair-2'],
        },
      },
    });
    expect(extractPairShotGenerationId(task)).toBe('pair-1');
  });

  it('returns null when not found', () => {
    const task = makeTask({ params: {} });
    expect(extractPairShotGenerationId(task)).toBeNull();
  });
});

describe('isSegmentVideoTask', () => {
  it('returns true for individual_travel_segment', () => {
    expect(isSegmentVideoTask(makeTask({ taskType: 'individual_travel_segment' }))).toBe(true);
  });

  it('returns false for other task types', () => {
    expect(isSegmentVideoTask(makeTask({ taskType: 'image_generation' }))).toBe(false);
    expect(isSegmentVideoTask(makeTask({ taskType: 'video_generation' }))).toBe(false);
  });
});

describe('checkSegmentConnection', () => {
  it('returns disconnected result for null pairShotGenerationId', async () => {
    expect(await checkSegmentConnection(null, 'shot-1')).toEqual({
      ok: true,
      connected: false,
    });
  });

  it('returns disconnected result when the shot has no such placement', async () => {
    mockFetchProjectPlacements.mockResolvedValue({ byShot: new Map([['shot-1', []]]) });

    const result = await checkSegmentConnection('pair-1', 'shot-1');
    expect(result).toEqual({
      ok: true,
      connected: false,
    });
  });

  it('returns connected result when the entry id matches with a valid frame', async () => {
    mockFetchProjectPlacements.mockResolvedValue({
      byShot: new Map([
        ['shot-1', [{ entryId: 'pair-1', generationId: 'gen-1', timelineFrame: 5 }]],
      ]),
    });

    const result = await checkSegmentConnection('pair-1', 'shot-1');
    expect(result).toEqual({
      ok: true,
      connected: true,
    });
  });

  it('also matches a bare generation id', async () => {
    mockFetchProjectPlacements.mockResolvedValue({
      byShot: new Map([
        ['shot-1', [{ entryId: 'sg-shot-1-gen-9', generationId: 'gen-9', timelineFrame: null }]],
      ]),
    });

    const result = await checkSegmentConnection('gen-9', 'shot-1');
    expect(result).toEqual({
      ok: true,
      connected: false, // pooled (null frame) is not a connected segment
    });
  });

  it('returns disconnected result when the placement lives in another shot', async () => {
    mockFetchProjectPlacements.mockResolvedValue({
      byShot: new Map([
        ['different-shot', [{ entryId: 'pair-1', generationId: 'gen-1', timelineFrame: 5 }]],
      ]),
    });

    const result = await checkSegmentConnection('pair-1', 'shot-1');
    expect(result).toEqual({
      ok: true,
      connected: false,
    });
  });

  it('returns error result when the read model fails', async () => {
    mockFetchProjectPlacements.mockRejectedValue(new Error('query failed'));

    const result = await checkSegmentConnection('pair-1', 'shot-1');
    expect(result).toEqual({
      ok: false,
      error: 'query failed',
    });
  });
});
