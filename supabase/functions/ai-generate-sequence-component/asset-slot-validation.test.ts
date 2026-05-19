import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  normalizeAssetSlots,
  validateAssetSlotBindings,
} from './asset-slot-validation.ts';

Deno.test('valid ASSET_SLOTS metadata normalizes media MIME values and cardinality defaults', () => {
  const result = normalizeAssetSlots([
    {
      id: 'hero',
      label: 'Hero',
      mediaType: 'image/png',
      required: true,
    },
    {
      id: 'motion',
      mediaType: 'video/mp4',
      minItems: 0,
      maxItems: 2,
    },
  ]);

  assertEquals(result.errors, []);
  assertEquals(result.slots, [
    {
      id: 'hero',
      label: 'Hero',
      mediaType: 'image',
      required: true,
      minItems: 1,
      maxItems: 1,
    },
    {
      id: 'motion',
      label: 'motion',
      mediaType: 'video',
      required: false,
      minItems: 0,
      maxItems: 2,
    },
  ]);
});

Deno.test('invalid or duplicate ASSET_SLOTS metadata returns targeted errors', () => {
  const result = normalizeAssetSlots([
    { id: 'hero', mediaType: 'image' },
    { id: 'hero', mediaType: 'video' },
    { id: '1bad', mediaType: 'image' },
    { id: 'bad_media', mediaType: 'audio' },
    { id: 'bad_cardinality', mediaType: 'image', minItems: 3, maxItems: 2 },
  ]);

  assertEquals(result.errors.some((error) => error.includes('duplicate slot id "hero"')), true);
  assertEquals(result.errors.some((error) => error.includes('id must start with a letter')), true);
  assertEquals(result.errors.some((error) => error.includes('mediaType must be "image" or "video"')), true);
  assertEquals(result.errors.some((error) => error.includes('cardinality')), true);
});

Deno.test('asset slot binding validation rejects unknown slots, unknown keys, wrong media, duplicates, and cardinality failures', () => {
  const { slots } = normalizeAssetSlots([
    { id: 'hero', mediaType: 'image', required: true, minItems: 1, maxItems: 1 },
    { id: 'gallery', mediaType: 'image', minItems: 2, maxItems: 3 },
    { id: 'motion', mediaType: 'video', maxItems: 1 },
  ]);

  const errors = validateAssetSlotBindings({
    slots,
    bindings: {
      hero: ['image-a', 'image-a', 'video-a', 'missing-a'],
      gallery: ['image-a'],
      motion: ['video-a', 'video-b'],
      extra: ['image-a'],
      missing: ['missing-a'],
    },
    allowedAssets: [
      { key: 'image-a', mediaType: 'image' },
      { key: 'video-a', mediaType: 'video' },
      { key: 'video-b', mediaType: 'video' },
    ],
  });

  assertEquals(errors.some((error) => error.includes('duplicates asset key "image-a"')), true);
  assertEquals(errors.some((error) => error.includes('asset "video-a" is video, but slot requires image')), true);
  assertEquals(errors.some((error) => error.includes('references unknown asset key "missing-a"')), true);
  assertEquals(errors.some((error) => error.includes('references unknown asset slot "extra"')), true);
  assertEquals(errors.some((error) => error.includes('references unknown asset slot "missing"')), true);
  assertEquals(errors.some((error) => error.includes('requires at least 2 asset(s)')), true);
  assertEquals(errors.some((error) => error.includes('allows at most 1 asset(s)')), true);
});

Deno.test('required slots fail when no binding is present', () => {
  const { slots } = normalizeAssetSlots([
    { id: 'hero', mediaType: 'image', required: true },
  ]);

  const errors = validateAssetSlotBindings({
    slots,
    bindings: {},
    allowedAssets: [{ key: 'image-a', mediaType: 'image' }],
  });

  assertEquals(errors, ['DEFAULTS.assetSlotBindings.hero requires at least 1 asset(s)']);
});
