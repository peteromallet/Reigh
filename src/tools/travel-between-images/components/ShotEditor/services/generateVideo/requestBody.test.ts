import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/lib/errorHandling/errors';
import { buildTravelRequestBodyV2 } from './requestBody';
import { getModelSpec, resolveGenerationPolicy } from '@/tools/travel-between-images/settings';
import type { PhaseConfig } from '@/shared/types/phaseConfig';
import type { BuildTravelRequestBodyParams } from './types';

function makePhaseConfig(overrides: Partial<PhaseConfig> = {}): PhaseConfig {
  return {
    num_phases: 2,
    steps_per_phase: [3, 3],
    flow_shift: 5,
    sample_solver: 'euler',
    model_switch_phase: 1,
    phases: [],
    ...overrides,
  };
}

function buildParams(): BuildTravelRequestBodyParams {
  return {
    projectId: 'project-1',
    selectedShot: { id: 'shot-1' } as never,
    imagePayload: {
      absoluteImageUrls: [
        'https://example.com/img-1.png',
        'https://example.com/img-2.png',
      ],
      imageGenerationIds: ['gen-1', 'gen-2'],
      imageVariantIds: [],
      pairShotGenerationIds: ['sg-1'],
    },
    pairConfig: {
      basePrompts: ['pair prompt'],
      segmentFrames: [61],
      frameOverlap: [10],
      negativePrompts: ['pair negative'],
      enhancedPromptsArray: ['enhanced'],
      pairPhaseConfigsArray: [makePhaseConfig({ mode: 'i2v' })],
      pairLorasArray: [[{ path: '/pair-lora', strength: 0.7 }]],
      pairMotionSettingsArray: [{ amount_of_motion: 0.8 }],
    },
    parentGenerationId: 'parent-1',
    actualModelName: 'wan-model',
    generationTypeMode: 'i2v',
    motionParams: {
      amountOfMotion: 50,
      motionMode: 'advanced',
      useAdvancedMode: true,
      effectivePhaseConfig: makePhaseConfig({ mode: 'vace' }),
      selectedPhasePresetId: 'preset-1',
    },
    generationParams: {
      generationMode: 'timeline',
      batchVideoPrompt: 'Base prompt',
      enhancePrompt: true,
      variantNameParam: '  Variant Name  ',
      textBeforePrompts: 'Before',
      textAfterPrompts: 'After',
    },
    seedParams: {
      seed: 123,
      randomSeed: false,
      turboMode: true,
      debug: true,
    },
  };
}

describe('requestBody', () => {
  it('builds the travel request with normalized motion, cardinality-checked ids, and optional fields', () => {
    const result = buildTravelRequestBodyV2(buildParams());

    expect(result.project_id).toBe('project-1');
    expect(result.shot_id).toBe('shot-1');
    expect(result.image_urls).toEqual([
      'https://example.com/img-1.png',
      'https://example.com/img-2.png',
    ]);
    expect(result.image_generation_ids).toEqual(['gen-1', 'gen-2']);
    expect(result.pair_shot_generation_ids).toEqual(['sg-1']);
    expect(result.parent_generation_id).toBe('parent-1');
    expect(result.base_prompt).toBe('Base prompt');
    expect(result.base_prompts).toEqual(['pair prompt']);
    expect(result.segment_frames).toEqual([61]);
    expect(result.negative_prompts).toEqual(['pair negative']);
    expect(result.enhanced_prompts).toEqual(['enhanced']);
    expect(result.pair_phase_configs).toEqual([makePhaseConfig({ mode: 'i2v' })]);
    expect(result.pair_loras).toEqual([[{ path: '/pair-lora', strength: 0.7 }]]);
    expect(result.pair_motion_settings).toEqual([{ amount_of_motion: 0.8 }]);
    expect(result.amount_of_motion).toBe(0.5);
    expect(result.motion_mode).toBe('advanced');
    expect(result.phase_config).toEqual({
      ...makePhaseConfig({ mode: 'vace' }),
      mode: undefined,
    });
    expect(result.selected_phase_preset_id).toBe('preset-1');
    expect(result.model_name).toBe('wan-model');
    expect(result.model_type).toBe('i2v');
    expect(result.generation_name).toBe('Variant Name');
    expect(result.text_before_prompts).toBe('Before');
    expect(result.text_after_prompts).toBe('After');
    expect(result.enhance_prompt).toBeUndefined();
    expect(result.advanced_mode).toBe(true);
    expect(result.debug).toBe(true);
    expect(result.turbo_mode).toBe(false);
    expect(result.num_inference_steps).toBeUndefined();
    expect(result.guidance_scale).toBeUndefined();
  });

  it('omits optional payload fields when the source arrays are empty or blank', () => {
    const result = buildTravelRequestBodyV2({
      ...buildParams(),
      imagePayload: {
        absoluteImageUrls: [
          'https://example.com/img-1.png',
          'https://example.com/img-2.png',
        ],
        imageGenerationIds: [],
        imageVariantIds: [],
        pairShotGenerationIds: [],
      },
      pairConfig: {
        basePrompts: [''],
        segmentFrames: [61],
        frameOverlap: [10],
        negativePrompts: ['neg'],
        enhancedPromptsArray: ['', ''],
        pairPhaseConfigsArray: [null],
        pairLorasArray: [null],
        pairMotionSettingsArray: [null],
      },
      generationParams: {
        ...buildParams().generationParams,
        variantNameParam: '   ',
        textBeforePrompts: undefined,
        textAfterPrompts: undefined,
      },
      parentGenerationId: undefined,
    });

    expect(result.image_generation_ids).toBeUndefined();
    expect(result.pair_shot_generation_ids).toBeUndefined();
    expect(result.parent_generation_id).toBeUndefined();
    expect(result.enhanced_prompts).toBeUndefined();
    expect(result.pair_phase_configs).toBeUndefined();
    expect(result.pair_loras).toBeUndefined();
    expect(result.pair_motion_settings).toBeUndefined();
    expect(result.generation_name).toBeUndefined();
    expect(result.text_before_prompts).toBeUndefined();
    expect(result.text_after_prompts).toBeUndefined();
    expect(result.enhance_prompt).toBe(true);
  });

  it('throws a validation error when mapped id cardinality does not match the image or pair counts', () => {
    expect(() =>
      buildTravelRequestBodyV2({
        ...buildParams(),
        imagePayload: {
          ...buildParams().imagePayload,
          imageGenerationIds: ['gen-1'],
        },
      }),
    ).toThrow(ValidationError);

    expect(() =>
      buildTravelRequestBodyV2({
        ...buildParams(),
        imagePayload: {
          ...buildParams().imagePayload,
          pairShotGenerationIds: ['sg-1', 'sg-2'],
        },
      }),
    ).toThrow('pair_shot_generation_ids');
  });

  it('includes SVI latent chaining continuation config when policy is resolved for WAN i2v', () => {
    const spec = getModelSpec('wan-2.2');
    const policy = resolveGenerationPolicy(spec, {
      smoothContinuations: true,
      requestedExecutionMode: 'i2v',
    });
    const result = buildTravelRequestBodyV2({
      ...buildParams(),
      selectedModel: 'wan-2.2',
      policy,
      generationTypeMode: 'i2v',
    });

    expect(result.continuation_config).toEqual({
      strategy: 'svi_latent_chaining',
      overlap_frames: 4,
    });
    expect(result.chain_segments).toBe(true);
    expect(result.independent_segments).toBe(false);
  });
});
