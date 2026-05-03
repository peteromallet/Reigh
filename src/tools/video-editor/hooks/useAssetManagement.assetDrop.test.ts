import { describe, expect, it } from 'vitest';
import { buildAssetDropEdit } from '@/tools/video-editor/hooks/useAssetManagement';
import { planGenerationAssetRegistration } from '@/tools/video-editor/lib/timeline-asset-plans';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data';

const createTimelineData = (assetType: string, file: string): TimelineData => ({
  config: {
    output: { width: 1280, height: 720, fps: 30 },
    tracks: [{ id: 'V1', kind: 'visual' }],
    clips: [],
    registry: {
      assets: {
        asset1: { src: file, file, type: assetType, duration: 4 },
      },
    },
  },
  configVersion: 1,
  registry: {
    assets: {
      asset1: { src: file, file, type: assetType, duration: 4 },
    },
  },
  resolvedConfig: {
    output: { width: 1280, height: 720, fps: 30 },
    tracks: [{ id: 'V1', kind: 'visual' }],
    clips: [],
    registry: {
      asset1: { src: file, file, type: assetType, duration: 4 },
    },
  },
  rows: [{ id: 'V1', actions: [] }],
  meta: {},
  effects: {},
  assetMap: {},
  output: { width: 1280, height: 720, fps: 30 },
  tracks: [{ id: 'V1', kind: 'visual' }],
  clipOrder: { V1: [] },
  signature: 'sig',
  stableSignature: 'stable',
});

describe('buildAssetDropEdit media kind validation', () => {
  it('rejects text assets instead of adding them as visual video clips', () => {
    const edit = buildAssetDropEdit({
      current: createTimelineData('text/plain', 'https://example.com/script.txt'),
      assetKey: 'asset1',
      trackId: 'V1',
      time: 0,
    });

    expect(edit).toBeNull();
  });

  it('allows normal video assets on visual tracks', () => {
    const edit = buildAssetDropEdit({
      current: createTimelineData('video/mp4', 'https://example.com/clip.mp4'),
      assetKey: 'asset1',
      trackId: 'V1',
      time: 2,
    });

    expect(edit?.metaUpdates[edit.clipId]).toMatchObject({
      asset: 'asset1',
      track: 'V1',
      clipType: 'media',
      from: 0,
      to: 4,
    });
  });

  it('keeps clip span separate from unresolved video asset duration for external-drop style inserts', () => {
    const registrationPlan = planGenerationAssetRegistration({
      assetId: 'asset-drop',
      generationId: 'gen-video',
      variantType: 'video',
      imageUrl: 'https://example.com/final.mp4',
      thumbUrl: 'https://example.com/final-thumb.jpg',
      assetDurationSeconds: null,
      metadata: { content_type: 'video/mp4' },
    });
    expect(registrationPlan.ok).toBe(true);
    if (!registrationPlan.ok) {
      throw new Error('registration plan should succeed');
    }

    expect(registrationPlan.assetEntry.duration).toBeUndefined();

    const edit = buildAssetDropEdit({
      current: makeDropTestDataLikeTimeline(),
      assetKey: registrationPlan.assetId,
      assetEntry: registrationPlan.assetEntry,
      trackId: 'V1',
      time: 12,
      clipSpanSeconds: 5,
    });

    expect(edit?.rows[0]?.actions[0]).toMatchObject({
      start: 12,
      end: 17,
    });
    expect(edit?.metaUpdates[edit.clipId]).toMatchObject({
      asset: 'asset-drop',
      to: 5,
    });
  });

  it('preserves explicit asset duration for duplicate-generation style registrations', () => {
    const registrationPlan = planGenerationAssetRegistration({
      assetId: 'asset-dup',
      generationId: 'gen-video',
      variantId: 'variant-video',
      variantType: 'video',
      imageUrl: 'https://example.com/source.mp4',
      thumbUrl: 'https://example.com/source-thumb.jpg',
      assetDurationSeconds: 8.25,
      metadata: { content_type: 'video/mp4' },
    });

    expect(registrationPlan).toMatchObject({
      ok: true,
      assetId: 'asset-dup',
      assetEntry: {
        duration: 8.25,
        generationId: 'gen-video',
        variantId: 'variant-video',
      },
    });
  });
});

function makeDropTestDataLikeTimeline(): TimelineData {
  return createTimelineData('video/mp4', 'https://example.com/fallback.mp4');
}
