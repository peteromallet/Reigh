import { describe, expect, it } from 'vitest';
import {
  ASSET_SLOT_BINDINGS_PARAM,
  ASSET_SLOTS_PARAM,
  collectLooseGeneratedMediaParamErrors,
  inferAssetSlotMediaType,
  materializeAssetSlots,
  normalizeAssetSlotBindings,
  normalizeAssetSlots,
  validateAssetSlotBindings,
} from '@/tools/video-editor/sequences/assetSlots';

describe('asset slot contract helpers', () => {
  it('normalizes declared slots and binding key arrays', () => {
    const slots = normalizeAssetSlots([
      {
        id: 'hero',
        label: 'Hero asset',
        mediaType: 'image/png',
        required: true,
        minItems: 1,
        maxItems: 2,
      },
      {
        id: 'background_video',
        mediaType: 'video',
      },
    ]);

    expect(slots.errors).toEqual([]);
    expect(slots.slots).toEqual([
      {
        id: 'hero',
        label: 'Hero asset',
        mediaType: 'image',
        required: true,
        minItems: 1,
        maxItems: 2,
      },
      {
        id: 'background_video',
        label: 'background_video',
        mediaType: 'video',
        required: false,
        minItems: 0,
        maxItems: 1,
      },
    ]);

    expect(normalizeAssetSlotBindings({ hero: [' asset-a '] })).toEqual({
      bindings: { hero: ['asset-a'] },
      errors: [],
    });
  });

  it('infers media type from MIME strings and URL extensions', () => {
    expect(inferAssetSlotMediaType('image/webp')).toBe('image');
    expect(inferAssetSlotMediaType('https://example.com/render.MP4?download=1')).toBe('video');
    expect(inferAssetSlotMediaType({ type: 'video/quicktime', src: 'https://example.com/still.png' })).toBe('video');
    expect(inferAssetSlotMediaType({ file: 'https://example.com/still.avif' })).toBe('image');
  });

  it('validates slot required, cardinality, duplicate, unknown, and media constraints', () => {
    const { slots } = normalizeAssetSlots([
      { id: 'hero', mediaType: 'image', required: true, minItems: 1, maxItems: 2 },
      { id: 'clip', mediaType: 'video', maxItems: 1 },
    ]);

    const result = validateAssetSlotBindings({
      slots,
      bindings: {
        hero: ['image-a', 'image-a', 'video-a'],
        clip: ['missing-a', 'video-a'],
        extra: ['image-a'],
      },
      registry: {
        'image-a': { type: 'image/png', src: 'https://example.com/a.png' },
        'video-a': { type: 'video/mp4', src: 'https://example.com/a.mp4' },
      },
    });

    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'duplicate_asset_binding',
      'media_type_mismatch',
      'unknown_asset_key',
      'too_many_assets',
      'unknown_slot',
    ]));
  });

  it('materializes persisted slot key bindings into host-injected URL slots', () => {
    const { slots } = normalizeAssetSlots([
      { id: 'hero', mediaType: 'image', required: true },
      { id: 'motion', mediaType: 'video' },
    ]);

    const result = materializeAssetSlots({
      slots,
      bindings: {
        hero: ['image-a'],
        motion: ['video-a', 'wrong-kind'],
      },
      registry: {
        'image-a': { type: 'image/png', src: 'https://example.com/a.png' },
        'video-a': { type: 'video/mp4', file: 'https://example.com/a.mp4' },
        'wrong-kind': { type: 'image/png', src: 'https://example.com/b.png' },
      },
    });

    expect(result.assetSlots).toEqual({
      hero: ['https://example.com/a.png'],
      motion: ['https://example.com/a.mp4'],
    });
    expect(result.errors.map((error) => error.code)).toContain('media_type_mismatch');
  });

  it('reports missing asset URLs without injecting invalid slot entries', () => {
    const { slots } = normalizeAssetSlots([
      { id: 'hero', mediaType: 'image', required: true },
    ]);

    const result = materializeAssetSlots({
      slots,
      bindings: { hero: ['image-a', 'image-without-url'] },
      registry: {
        'image-a': { type: 'image/png', src: 'https://example.com/a.png' },
        'image-without-url': { type: 'image/png' },
      },
    });

    expect(result.assetSlots).toEqual({
      hero: ['https://example.com/a.png'],
    });
    expect(result.errors.map((error) => error.code)).toContain('missing_asset_url');
  });

  it('centralizes rejection of generated-component loose media params', () => {
    expect(ASSET_SLOT_BINDINGS_PARAM).toBe('assetSlotBindings');
    expect(ASSET_SLOTS_PARAM).toBe('assetSlots');

    const errors = collectLooseGeneratedMediaParamErrors({
      imageAssetKeys: ['asset-a'],
      images: ['https://example.com/a.png'],
      title: 'Allowed',
    });

    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.path)).toEqual([
      'params.imageAssetKeys',
      'params.images',
    ]);
    expect(errors.every((error) => error.code === 'loose_generated_media_param')).toBe(true);
  });
});
