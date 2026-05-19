import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { extractSequenceComponentCodeAndMeta } from './templates.ts';

const buildResponse = (overrides: {
  schema?: object;
  defaults?: object;
  assetSlots?: unknown[];
  controls?: unknown[];
  code?: string;
} = {}) => {
  const schema = overrides.schema ?? {
    type: 'object',
    properties: {
      duration: { type: 'number' },
      assetSlotBindings: { type: 'object' },
    },
  };
  const defaults = overrides.defaults ?? {
    duration: 30,
    assetSlotBindings: { hero: ['asset-a'] },
  };
  const assetSlots = overrides.assetSlots ?? [
    {
      id: 'hero',
      label: 'Hero',
      mediaType: 'image',
      required: true,
      minItems: 1,
      maxItems: 1,
    },
  ];
  const controls = overrides.controls ?? [
    { name: 'duration', label: 'Duration', priority: 'primary', type: 'number', default: 30 },
  ];
  const code = overrides.code ?? `
function GeneratedSequence({ params }) {
  const heroUrl = (params.assetSlots?.hero ?? [])[0];
  return React.createElement('div', null, params.duration, heroUrl);
}
exports.default = GeneratedSequence;
`;

  return `// NAME: Slot Hero
// DESCRIPTION: Uses a host-injected asset slot URL.
// SCHEMA: ${JSON.stringify(schema)}
// DEFAULTS: ${JSON.stringify(defaults)}
// ASSET_SLOTS: ${JSON.stringify(assetSlots)}
// CONTROLS: ${JSON.stringify(controls)}
// MESSAGE: Ready.
${code}`;
};

Deno.test('extracts valid ASSET_SLOTS metadata and accepts host-injected params.assetSlots access', () => {
  const result = extractSequenceComponentCodeAndMeta(buildResponse(), {
    allowedAssets: [{ key: 'asset-a', mediaType: 'image' }],
  });

  assertEquals(result.name, 'Slot Hero');
  assertEquals(result.assetSlots, [{
    id: 'hero',
    label: 'Hero',
    mediaType: 'image',
    required: true,
    minItems: 1,
    maxItems: 1,
  }]);
  assertEquals(result.defaultsJson, {
    duration: 30,
    assetSlotBindings: { hero: ['asset-a'] },
  });
});

Deno.test('extract rejects missing ASSET_SLOTS metadata', () => {
  const responseWithoutSlots = buildResponse().replace(/^\/\/ ASSET_SLOTS: .*\n/m, '');

  assertThrows(
    () => extractSequenceComponentCodeAndMeta(responseWithoutSlots, {
      allowedAssets: [{ key: 'asset-a', mediaType: 'image' }],
    }),
    Error,
    'missing a valid // ASSET_SLOTS',
  );
});

Deno.test('extract rejects duplicate or invalid ASSET_SLOTS metadata', () => {
  assertThrows(
    () => extractSequenceComponentCodeAndMeta(buildResponse({
      assetSlots: [
        { id: 'hero', mediaType: 'image' },
        { id: 'hero', mediaType: 'video' },
      ],
    }), {
      allowedAssets: [{ key: 'asset-a', mediaType: 'image' }],
    }),
    Error,
    'Invalid ASSET_SLOTS metadata',
  );
});

Deno.test('extract rejects default slot bindings with unknown slots, unknown keys, wrong media, and cardinality failures', () => {
  assertThrows(
    () => extractSequenceComponentCodeAndMeta(buildResponse({
      assetSlots: [
        { id: 'hero', label: 'Hero', mediaType: 'image', required: true, minItems: 1, maxItems: 1 },
        { id: 'motion', label: 'Motion', mediaType: 'video', required: true, minItems: 1, maxItems: 1 },
      ],
      defaults: {
        duration: 30,
        assetSlotBindings: {
          hero: ['video-a', 'missing-a'],
          extra: ['asset-a'],
        },
      },
    }), {
      allowedAssets: [
        { key: 'asset-a', mediaType: 'image' },
        { key: 'video-a', mediaType: 'video' },
      ],
    }),
    Error,
    'Invalid asset slot bindings',
  );
});

Deno.test('extract rejects loose generated media params in schema/defaults/code', () => {
  assertThrows(
    () => extractSequenceComponentCodeAndMeta(buildResponse({
      schema: {
        type: 'object',
        properties: {
          duration: { type: 'number' },
          assetSlotBindings: { type: 'object' },
          imageAssetKeys: { type: 'array' },
        },
      },
    }), {
      allowedAssets: [{ key: 'asset-a', mediaType: 'image' }],
    }),
    Error,
    'loose media params',
  );

  assertThrows(
    () => extractSequenceComponentCodeAndMeta(buildResponse({
      code: `
function GeneratedSequence({ params }) {
  return React.createElement('div', null, params.duration, (params.images ?? []).length);
}
exports.default = GeneratedSequence;
`,
    }), {
      allowedAssets: [{ key: 'asset-a', mediaType: 'image' }],
    }),
    Error,
    'loose media params',
  );
});
