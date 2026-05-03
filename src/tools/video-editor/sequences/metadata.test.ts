import { describe, expect, it } from 'vitest';
import {
  TRUSTED_SEQUENCE_CLIP_TYPES,
  TRUSTED_SEQUENCE_METADATA,
  getTrustedSequenceMetadata,
} from '@/tools/video-editor/sequences/metadata';
import {
  AVAILABLE_SEQUENCE_CLIP_TYPES,
  AVAILABLE_SEQUENCE_METADATA,
  buildSequenceClipCapabilityRegistry,
  CLIP_CAPABILITY_REGISTRY,
  filterTrustedSequenceMetadataForRegistry,
  getClipCapabilityDescriptor,
  isAvailableSequenceClipType,
  SEQUENCE_COMPONENT_REGISTRY,
} from '@/tools/video-editor/sequences/registry';

describe('trusted sequence metadata', () => {
  it('defines the trusted 2rp v1 clip set only', () => {
    expect([...TRUSTED_SEQUENCE_CLIP_TYPES].sort()).toEqual([
      'art-card',
      'cta-card',
      'image-jump',
      'resource-card',
      'section-hook',
    ]);
    expect(TRUSTED_SEQUENCE_METADATA.every((metadata) => metadata.themeId === '2rp')).toBe(true);
  });

  it('keeps timing as top-level hold metadata instead of an editable param', () => {
    for (const metadata of TRUSTED_SEQUENCE_METADATA) {
      expect(metadata.hold.defaultSeconds).toBeGreaterThan(0);
      expect(metadata.hold.minSeconds).toBeGreaterThan(0);
      expect(metadata.hold.maxSeconds).toBeGreaterThanOrEqual(metadata.hold.defaultSeconds);
      expect(metadata.params.map((param) => param.key)).not.toContain('hold');
    }
  });

  it('does not expose entrance or exit animation refs as editable params', () => {
    for (const metadata of TRUSTED_SEQUENCE_METADATA) {
      const paramKeys = metadata.params.map((param) => param.key);
      expect(paramKeys).not.toContain('entrance');
      expect(paramKeys).not.toContain('exit');
    }
  });

  it('uses previewAssetKeys as the resource-card asset-list field', () => {
    const resourceCard = getTrustedSequenceMetadata('resource-card');
    expect(resourceCard).toBeDefined();
    const previewField = resourceCard!.params.find((param) => param.key === 'previewAssetKeys');
    expect(previewField).toMatchObject({
      kind: 'asset-list',
      maxItems: 3,
      componentParam: 'previews',
    });
  });

  it('exposes image-jump as a text-free asset-backed motion sequence', () => {
    const imageJump = getTrustedSequenceMetadata('image-jump');
    expect(imageJump).toBeDefined();
    expect(imageJump!.params.map((param) => param.key)).not.toContain('title');
    expect(imageJump!.params.find((param) => param.key === 'imageAssetKeys')).toMatchObject({
      kind: 'asset-list',
      required: true,
      maxItems: 8,
      componentParam: 'images',
    });
    expect(imageJump!.params.find((param) => param.key === 'mode')).toMatchObject({
      kind: 'string',
      options: ['jump', 'snap', 'gallery', 'pulse', 'shuffle'],
    });
  });
});

describe('available sequence metadata', () => {
  it('exposes only trusted sequences that exist in the active component registry', () => {
    expect(AVAILABLE_SEQUENCE_METADATA).toEqual(
      filterTrustedSequenceMetadataForRegistry(SEQUENCE_COMPONENT_REGISTRY),
    );
    expect(AVAILABLE_SEQUENCE_CLIP_TYPES).toContain('image-jump');
    expect(isAvailableSequenceClipType('image-jump')).toBe(true);
    expect(
      AVAILABLE_SEQUENCE_CLIP_TYPES.every((clipType) => TRUSTED_SEQUENCE_CLIP_TYPES.includes(clipType as typeof TRUSTED_SEQUENCE_CLIP_TYPES[number])),
    ).toBe(true);
  });

  it('filters trusted metadata against a provided frontend registry shape', () => {
    const filtered = filterTrustedSequenceMetadataForRegistry({
      'section-hook': {},
      'resource-card': {},
    });

    expect(filtered.map((metadata) => metadata.clipType).sort()).toEqual([
      'resource-card',
      'section-hook',
    ]);
  });

  it('builds explicit capability defaults for registry-discovered sequence clips', () => {
    const descriptors = buildSequenceClipCapabilityRegistry({
      'section-hook': {
        component: () => null,
        themeId: '2rp',
        source: 'installed:@banodoco/timeline-theme-2rp',
      },
      'theme-package-not-yet-trusted': {
        component: () => null,
        themeId: 'custom',
        source: 'installed:@banodoco/timeline-theme-custom',
      },
    });

    expect(descriptors['section-hook']).toMatchObject({
      source: 'installed-sequence',
      capabilities: {
        preview: 'browser',
        browserRender: false,
        workerRender: true,
      },
    });
    expect(descriptors['theme-package-not-yet-trusted']).toMatchObject({
      source: 'registry-discovered',
      capabilities: {
        preview: 'browser',
        browserRender: false,
        workerRender: true,
      },
    });
  });

  it('keeps built-ins and trusted local sequences in one clip capability source of truth', () => {
    expect(CLIP_CAPABILITY_REGISTRY.media).toMatchObject({
      source: 'builtin',
      capabilities: {
        preview: 'browser',
        browserRender: true,
        workerRender: false,
      },
    });
    expect(getClipCapabilityDescriptor('image-jump')).toMatchObject({
      source: 'trusted-local-sequence',
      capabilities: {
        preview: 'browser',
        browserRender: false,
        workerRender: true,
      },
    });
  });
});
