import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  artAgentsElementManifestToElementManifest,
  elementManifestToSequenceComponentMetadata,
  sequenceComponentMetadataToElementManifest,
  type ElementManifestV1,
  type SequenceComponentMetadataLike,
} from './elementManifest';

const controlsManifest = [
  {
    name: 'title',
    label: 'Title',
    priority: 'primary',
    type: 'text',
    default: 'Hello',
  },
];

const assetSlots = [
  {
    id: 'heroImage',
    label: 'Hero image',
    mediaType: 'image' as const,
    required: true,
    minItems: 1,
    maxItems: 1,
    description: 'Primary still used by the sequence.',
  },
];

const sequenceMetadata: SequenceComponentMetadataLike = {
  name: 'Resource Card',
  slug: 'resource-card',
  code: 'export default function Component() { return null; }',
  schemaJson: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      assetSlotBindings: { type: 'object' },
    },
    required: ['title'],
  },
  defaultsJson: {
    title: 'Hello',
    assetSlotBindings: {
      heroImage: ['asset-1'],
    },
  },
  controlsManifest,
  assetSlots,
  clipType: 'custom:resource-card',
  themeId: '2rp',
  description: 'A saved Reigh sequence component.',
  created_by: {
    is_you: true,
    username: 'peter',
  },
  is_public: false,
};

describe('Element Manifest adapters', () => {
  it('exports Reigh sequence metadata with resource provenance and compatibility aliases', () => {
    const manifest = sequenceComponentMetadataToElementManifest(sequenceMetadata, {
      id: 'reigh-resource:resource-1',
      resourceId: 'resource-1',
      userId: 'user-1',
      createdAt: '2026-05-06T12:00:00.000Z',
      generatedBy: 'sequence-creator',
    });

    expect(manifest).toMatchObject({
      version: '1',
      id: 'reigh-resource:resource-1',
      kind: {
        source: 'reigh',
        type: 'sequence-component',
      },
      runtime: {
        renderer: 'react-sequence-component',
        source: 'database',
        code: sequenceMetadata.code,
        clipType: 'custom:resource-card',
        themeId: '2rp',
      },
      provenance: {
        source: 'reigh',
        resourceId: 'resource-1',
        resourceType: 'sequence-component',
        generatedBy: 'sequence-creator',
        createdBy: {
          isYou: true,
          username: 'peter',
          userId: 'user-1',
        },
      },
      compatibility: {
        aliases: ['custom:resource-card'],
        reigh: {
          clipType: 'custom:resource-card',
          themeId: '2rp',
          controlsManifestAlias: 'controlsManifest',
          assetSlotsAlias: 'assetSlots',
          schemaAlias: 'schemaJson',
          defaultsAlias: 'defaultsJson',
        },
      },
    });
    expect(manifest.contract.schema).toEqual(sequenceMetadata.schemaJson);
    expect(manifest.contract.defaults).toEqual(sequenceMetadata.defaultsJson);
    expect(manifest.contract.controlsManifest).toEqual(controlsManifest);
    expect(manifest.contract.assetSlots).toEqual(assetSlots);
  });

  it('imports an ElementManifest back into top-level Reigh metadata fields', () => {
    const manifest = sequenceComponentMetadataToElementManifest(sequenceMetadata);
    const imported = elementManifestToSequenceComponentMetadata(manifest);

    expect(imported.code).toBe(sequenceMetadata.code);
    expect(imported.schemaJson).toEqual(sequenceMetadata.schemaJson);
    expect(imported.defaultsJson).toEqual(sequenceMetadata.defaultsJson);
    expect(imported.controlsManifest).toEqual(controlsManifest);
    expect(imported.assetSlots).toEqual(assetSlots);
    expect(imported.clipType).toBe('custom:resource-card');
    expect(imported.themeId).toBe('2rp');
    expect(imported.elementManifest).toBe(manifest);
  });

  it('keeps existing Reigh top-level fields ahead of conflicting nested manifest data', () => {
    const manifest: ElementManifestV1 = {
      ...sequenceComponentMetadataToElementManifest(sequenceMetadata),
      runtime: {
        renderer: 'react-sequence-component',
        code: 'manifest code',
        clipType: 'manifest-clip',
        themeId: 'manifest-theme',
      },
      contract: {
        schema: { from: 'manifest' },
        defaults: { from: 'manifest' },
        controlsManifest: [{ name: 'manifest' }],
        assetSlots: [{
          id: 'manifestAsset',
          label: 'Manifest asset',
          mediaType: 'video',
          required: false,
          minItems: 0,
          maxItems: 2,
        }],
      },
      compatibility: {
        reigh: {
          clipType: 'compat-clip',
          themeId: 'compat-theme',
        },
      },
    };

    const imported = elementManifestToSequenceComponentMetadata(manifest, sequenceMetadata);

    expect(imported.code).toBe(sequenceMetadata.code);
    expect(imported.schemaJson).toEqual(sequenceMetadata.schemaJson);
    expect(imported.defaultsJson).toEqual(sequenceMetadata.defaultsJson);
    expect(imported.controlsManifest).toEqual(controlsManifest);
    expect(imported.assetSlots).toEqual(assetSlots);
    expect(imported.clipType).toBe('custom:resource-card');
    expect(imported.themeId).toBe('2rp');
  });

  it('maps a parsed ArtAgents text-card manifest without YAML parsing', () => {
    const manifest = artAgentsElementManifestToElementManifest({
      id: 'text-card',
      kind: 'text-card',
      pack_id: 'core-pack',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
        },
      },
      defaults: {
        title: 'Build with elements',
        subtitle: 'Shared manifests',
      },
      inputs: [
        {
          id: 'title',
          type: 'text',
          label: 'Title',
          required: true,
          default: 'Build with elements',
        },
      ],
      metadata: {
        name: 'Text Card',
        descriptions: {
          short: 'Simple title and subtitle card.',
        },
        keywords: ['title', 'card'],
      },
      dependencies: [
        { name: '@artagents/runtime', version: '1.0.0' },
        'react',
      ],
    });

    expect(manifest).toMatchObject({
      version: '1',
      id: 'text-card',
      kind: {
        source: 'artagents',
        type: 'text-card',
        namespace: 'core-pack',
      },
      runtime: {
        renderer: 'artagents-element',
        source: 'package',
        dependencies: [
          { name: '@artagents/runtime', version: '1.0.0' },
          { name: 'react' },
        ],
      },
      catalog: {
        name: 'Text Card',
        slug: 'text-card',
        description: 'Simple title and subtitle card.',
        keywords: ['title', 'card'],
        packId: 'core-pack',
      },
      provenance: {
        source: 'artagents',
        packId: 'core-pack',
        importId: 'text-card',
      },
      compatibility: {
        aliases: ['artagents:text-card:text-card'],
        artAgents: {
          id: 'text-card',
          kind: 'text-card',
          packId: 'core-pack',
        },
      },
    });
    expect(manifest.contract.schema).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
      },
    });
    expect(manifest.contract.defaults).toEqual({
      title: 'Build with elements',
      subtitle: 'Shared manifests',
    });
    expect(manifest.contract.inputs).toEqual([
      {
        id: 'title',
        type: 'text',
        label: 'Title',
        required: true,
        default: 'Build with elements',
      },
    ]);
    expect(manifest.runtime.clipType).toBeUndefined();
    expect(manifest.compatibility.reigh).toBeUndefined();
  });
});

describe('Element Manifest import governance', () => {
  it('keeps resource metadata on the public sequence entrypoint', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/resources/hooks/useResources.ts'),
      'utf8',
    );

    expect(source).toContain("import type { ElementManifestV1 } from '@/tools/video-editor/sequence'");
    expect(source).not.toContain('sequences/elementManifest');
  });
});
