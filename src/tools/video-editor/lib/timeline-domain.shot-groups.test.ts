import { describe, expect, it } from 'vitest';

import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index.ts';
import {
  canonicalizeTimelinePair,
  clonePinnedShotGroups,
  deriveTimelineShotGroupViews,
  serializeTimelineConfigSnapshot,
} from './timeline-domain.ts';

const config: TimelineConfig = {
  output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
  tracks: [{ id: 'V1', kind: 'visual', label: 'Visual' }],
  clips: [{ id: 'clip-a', track: 'V1', at: 0, clipType: 'media', hold: 2, asset: 'asset-a' }],
  pinnedShotGroups: [{
    shotId: 'shot-copy',
    name: 'Copied shot',
    trackId: 'V1',
    clipIds: ['clip-a'],
    poolGenerationIds: ['gen-pool'],
    videoAssetKey: 'asset-final',
    derivedFrom: { shotId: 'shot-source', trackId: 'V1' },
  }],
};

const registry: AssetRegistry = {
  assets: {
    'asset-a': { file: 'media-a', generationId: 'gen-a', variantId: 'variant-a' },
    'gen:gen-pool': { file: 'media-pool', generationId: 'gen-pool', variantId: 'variant-pool' },
    'asset-final': { file: 'media-final', generationId: 'gen-final', variantId: 'variant-final' },
  },
};

describe('timeline-domain document-native shot groups', () => {
  it('preserves pool, name, and duplicate lineage through canonicalize + serialize', () => {
    const canonical = canonicalizeTimelinePair(config, registry);
    const serialized = serializeTimelineConfigSnapshot(canonical.config);

    expect(serialized.config.pinnedShotGroups?.[0]).toMatchObject({
      shotId: 'shot-copy',
      name: 'Copied shot',
      poolGenerationIds: ['gen-pool'],
      derivedFrom: { shotId: 'shot-source', trackId: 'V1' },
    });
  });

  it('deep-clones every new group-owned reference', () => {
    const source = config.pinnedShotGroups!;
    const cloned = clonePinnedShotGroups(source)!;

    expect(cloned).not.toBe(source);
    expect(cloned[0]).not.toBe(source[0]);
    expect(cloned[0]!.clipIds).not.toBe(source[0]!.clipIds);
    expect(cloned[0]!.poolGenerationIds).not.toBe(source[0]!.poolGenerationIds);
    expect(cloned[0]!.derivedFrom).not.toBe(source[0]!.derivedFrom);
  });

  it('projects placed, pooled, current-primary, final-video, and lineage facts from one document pair', () => {
    const [view] = deriveTimelineShotGroupViews(config, registry);

    expect(view).toMatchObject({
      id: 'shot-copy:V1',
      name: 'Copied shot',
      placedMembers: [{ generationId: 'gen-a', variantId: 'variant-a', pooled: false }],
      pooledMembers: [{ generationId: 'gen-pool', variantId: 'variant-pool', pooled: true }],
      finalVideo: { assetKey: 'asset-final', variantId: 'variant-final' },
      derivedFrom: { shotId: 'shot-source', trackId: 'V1' },
    });
  });
});
