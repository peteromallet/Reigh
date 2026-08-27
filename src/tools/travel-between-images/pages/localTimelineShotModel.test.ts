import { describe, expect, it } from 'vitest';
import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index.ts';
import { selectDocumentDerivedShots } from './localTimelineShotModel.ts';

const config = (overrides: Partial<TimelineConfig> = {}): TimelineConfig => ({
  output: { resolution: '1280x720', fps: 24, file: 'out.mp4' },
  tracks: [
    { id: 'V1', kind: 'visual', label: 'Visual' },
    { id: 'A1', kind: 'audio', label: 'Audio' },
  ],
  clips: [
    { id: 'late', at: 5, track: 'V1', asset: 'image-b', from: 0, to: 2 },
    { id: 'early', at: 0, track: 'V1', asset: 'image-a', from: 0, to: 1, label: 'shot-a' },
    { id: 'overlap', at: 0.5, track: 'V1', asset: 'image-a', from: 0, to: 2 },
    { id: 'anchor', at: 9, track: 'V1', asset: 'image-a', from: 0, to: 1, label: 'shot-c' },
    { id: 'audio', at: 2, track: 'A1', asset: 'sound', from: 0, to: 10 },
    { id: 'zero', at: 7, track: 'V1', asset: 'missing' },
  ],
  pinnedShotGroups: [
    { shotId: 'shot-a', name: 'Opening', trackId: 'V1', clipIds: ['late', 'early', 'overlap', 'zero', 'ghost', 'audio'] },
    { shotId: 'shot-b', trackId: 'V1', clipIds: [] },
    { shotId: 'shot-c', trackId: 'V1', clipIds: ['early', 'anchor'] },
  ],
  ...overrides,
});

const registry: AssetRegistry = {
  assets: {
    'image-a': { media_id: 'media-a', type: 'image/png', duration: 1, thumbnailUrl: 'https://cdn.test/a.png' },
    'image-b': { media_id: 'media-b', type: 'image/png', duration: 2, thumbnailUrl: 'https://cdn.test/b.png' },
    sound: { media_id: 'media-audio', type: 'audio/wav', duration: 10 },
  },
};

describe('selectDocumentDerivedShots', () => {
  it('scopes each shot to its own clipIds and orders visual clips by document position', () => {
    const [shot] = selectDocumentDerivedShots(config(), registry, 'demo');

    expect(shot).toMatchObject({
      id: 'shot-a',
      name: 'Opening',
      missingClipCount: 1,
      nonVisualClipCount: 1,
    });
    expect(shot.clips.map((clip) => clip.clipId)).toEqual(['early', 'overlap', 'late', 'zero']);
    expect(shot.clips.map((clip) => clip.durationSeconds)).toEqual([1, 2, 2, 0]);
    expect(shot.durationSeconds).toBe(7);
    expect(shot.laneCount).toBe(2);
    expect(shot.clips[1]).toMatchObject({ relativeStartSeconds: 0.5, lane: 1 });
    expect(shot.clips[2]?.relativeStartSeconds).toBe(5);
    expect(shot.clips[0]?.thumbnailUrl).toBe('https://cdn.test/a.png');
    expect(shot.clips[2]?.missingAsset).toBe(true);
  });

  it('keeps empty groups as empty shots and handles a missing groups block', () => {
    expect(selectDocumentDerivedShots(config(), registry)[1]).toMatchObject({
      id: 'shot-b',
      name: 'Shot 2',
      clips: [],
    });
    expect(selectDocumentDerivedShots(config({ pinnedShotGroups: undefined }), registry)).toEqual([]);
    expect(selectDocumentDerivedShots(config(), registry)[2]).toMatchObject({
      id: 'shot-c',
      name: 'shot-c',
      clips: [{ clipId: 'early' }],
    });
  });

  it('does not let clips on another track leak into a visual shot', () => {
    const result = selectDocumentDerivedShots(config({
      pinnedShotGroups: [{ shotId: 'audio-shot', trackId: 'A1', clipIds: ['audio'] }],
    }), registry);
    expect(result[0]).toMatchObject({ clips: [], nonVisualClipCount: 1 });
  });
});
