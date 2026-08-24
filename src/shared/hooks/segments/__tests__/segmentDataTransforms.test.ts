import { describe, expect, it } from 'vitest';
import {
  coerceRawGenerationDbRows,
  extractExpectedSegmentData,
  getPairIdentifiers,
  isSegmentGeneration,
  transformToGenerationRow,
} from '../segmentDataTransforms';

describe('segmentDataTransforms', () => {
  it('extracts expected segment metadata from orchestrator details', () => {
    const expected = extractExpectedSegmentData({
      orchestrator_details: {
        num_new_segments_to_generate: 2,
        segment_frames_expanded: [12, 18],
        enhanced_prompts_expanded: ['first', 'second'],
        input_image_paths_resolved: ['a.png', 'b.png', 'c.png'],
        input_image_generation_ids: ['gen-a', 'gen-b', 'gen-c'],
        pair_shot_generation_ids: ['pair-1', 'pair-2'],
      },
    });

    expect(expected).toEqual({
      count: 2,
      frames: [12, 18],
      prompts: ['first', 'second'],
      inputImages: ['a.png', 'b.png', 'c.png'],
      inputImageGenIds: ['gen-a', 'gen-b', 'gen-c'],
      pairShotGenIds: ['pair-1', 'pair-2'],
    });
  });

  it('returns null when no segment count is present', () => {
    expect(extractExpectedSegmentData(null)).toBeNull();
    expect(extractExpectedSegmentData({ orchestrator_details: {} })).toBeNull();
  });

  it('reads pair identifiers from the generation row and segment params', () => {
    expect(
      getPairIdentifiers(
        { pair_shot_generation_id: 'pair-1' },
        {
          individual_segment_params: { start_image_generation_id: 'segment-start' },
          start_image_generation_id: 'root-start',
        },
      ),
    ).toEqual({
      pairShotGenId: 'pair-1',
      startGenId: 'segment-start',
    });

    expect(getPairIdentifiers(null, null)).toEqual({});
  });

  it('detects segment generations and maps db rows to generation rows', () => {
    expect(isSegmentGeneration({ segment_index: 1 })).toBe(true);
    expect(isSegmentGeneration({})).toBe(false);

    expect(
      transformToGenerationRow({
        id: 'gen-1',
        location: null,
        thumbnail_url: null,
        type: null,
        created_at: '2026-03-09T10:00:00Z',
        updated_at: '2026-03-09T12:00:00Z',
        params: { prompt: 'hello' },
        parent_generation_id: 'parent-1',
        child_order: 2,
        starred: true,
        pair_shot_generation_id: 'pair-1',
        primary_variant_id: 'variant-1',
      }),
    ).toEqual(
      expect.objectContaining({
        id: 'gen-1',
        location: '',
        imageUrl: '',
        thumbUrl: '',
        type: 'video',
        createdAt: '2026-03-09T12:00:00Z',
        parent_generation_id: 'parent-1',
        child_order: 2,
        starred: true,
        pair_shot_generation_id: 'pair-1',
        primary_variant_id: 'variant-1',
      }),
    );
  });

  it('validates raw generation rows before mapping', () => {
    expect(() => coerceRawGenerationDbRows([{ id: 'gen-1' }, { broken: true }])).toThrow(
      'Invalid generation row at index 1',
    );
  });
});
