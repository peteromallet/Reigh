import { describe, expect, it } from 'vitest';
import {
  canonicalizeTimelineConfig,
  getPinnedShotGroups,
  getSanitizedAssetFile,
  getSanitizedMediaSrc,
  getSanitizedMediaTrimProps,
  getSanitizedPlaybackRate,
  getSanitizedVolume,
  resolveTimelineConfig,
} from '@/tools/video-editor/lib/config-utils';

describe('config-utils media sanitizers', () => {
  it('omits trimAfter when source out is not greater than source in', () => {
    expect(getSanitizedMediaTrimProps({ from: 4, to: 4 }, 30)).toEqual({ trimBefore: 120 });
    expect(getSanitizedMediaTrimProps({ from: 4, to: 3 }, 30)).toEqual({ trimBefore: 120 });
  });

  it('clamps invalid trim, speed, and volume values to safe playback props', () => {
    expect(getSanitizedMediaTrimProps({ from: -2, to: Number.NaN }, 30)).toEqual({ trimBefore: 0 });
    expect(getSanitizedPlaybackRate(0)).toBe(1);
    expect(getSanitizedPlaybackRate(Number.NaN)).toBe(1);
    expect(getSanitizedVolume(-3)).toBe(0);
    expect(getSanitizedVolume(Number.NaN)).toBe(1);
  });

  it('accepts only non-empty string media sources', () => {
    expect(getSanitizedMediaSrc('https://example.com/video.mp4')).toBe('https://example.com/video.mp4');
    expect(getSanitizedMediaSrc(' https://example.com/video.mp4 ')).toBe('https://example.com/video.mp4');
    expect(getSanitizedMediaSrc('https://example.com/storage/v1/object/public/timeline-assets/')).toBeNull();
    expect(getSanitizedMediaSrc('')).toBeNull();
    expect(getSanitizedMediaSrc(undefined)).toBeNull();
  });

  it('accepts only non-empty asset file references', () => {
    expect(getSanitizedAssetFile(' uploads/test.mp4 ')).toBe('uploads/test.mp4');
    expect(getSanitizedAssetFile('')).toBeNull();
    expect(getSanitizedAssetFile('   ')).toBeNull();
    expect(getSanitizedAssetFile(undefined)).toBeNull();
  });

  it('drops clips whose asset entries resolve to invalid sources', async () => {
    const resolved = await resolveTimelineConfig(
      {
        output: { file: 'out.mp4', resolution: '1920x1080' },
        clips: [
          {
            id: 'clip-1',
            at: 0,
            track: 'track-1',
            asset: 'asset-1',
          },
        ],
        tracks: [
          {
            id: 'track-1',
            kind: 'audio',
            label: 'Audio',
          },
        ],
      },
      {
        assets: {
          'asset-1': {
            file: '',
            type: 'audio/mpeg',
          },
        },
      },
      async (file: string) => `https://example.com/${file}`,
    );

    expect(resolved.registry).toEqual({});
    expect(resolved.clips[0].assetEntry).toBeUndefined();
  });

  it('canonicalizes legacy top-level pinnedShotGroups into the x-reigh app namespace', () => {
    const pinnedShotGroups = [{
      shotId: 'shot-1',
      trackId: 'V1',
      clipIds: ['clip-1'],
      mode: 'images' as const,
    }];

    const canonical = canonicalizeTimelineConfig({
      output: { file: 'out.mp4', resolution: '1920x1080', fps: 30 },
      clips: [],
      tracks: [],
      pinnedShotGroups,
    });

    expect(canonical.app).toEqual({
      'x-reigh': {
        pinnedShotGroups,
      },
    });
    expect(getPinnedShotGroups(canonical)).toEqual(pinnedShotGroups);
    expect(canonical.pinnedShotGroups).toEqual(pinnedShotGroups);
  });

  it('backfills the legacy top-level field from namespaced app data for compatibility', () => {
    const pinnedShotGroups = [{
      shotId: 'shot-2',
      trackId: 'V2',
      clipIds: ['clip-2'],
      mode: 'video' as const,
    }];

    const canonical = canonicalizeTimelineConfig({
      output: { file: 'out.mp4', resolution: '1920x1080', fps: 30 },
      clips: [],
      tracks: [],
      app: {
        'x-reigh': {
          pinnedShotGroups,
        },
      },
    });

    expect(canonical.pinnedShotGroups).toEqual(pinnedShotGroups);
    expect(getPinnedShotGroups(canonical)).toEqual(pinnedShotGroups);
  });

  it('preserves generic app data when resolving timeline config', async () => {
    const resolved = await resolveTimelineConfig(
      {
        output: { file: 'out.mp4', resolution: '1920x1080', fps: 30 },
        clips: [],
        tracks: [],
        app: {
          arbitrary: { enabled: true },
          'x-reigh': {
            pinnedShotGroups: [{
              shotId: 'shot-1',
              trackId: 'V1',
              clipIds: ['clip-1'],
              mode: 'images',
            }],
          },
        },
      },
      { assets: {} },
      async (file: string) => `https://example.com/${file}`,
    );

    expect(resolved.app).toEqual({
      arbitrary: { enabled: true },
      'x-reigh': {
        pinnedShotGroups: [{
          shotId: 'shot-1',
          trackId: 'V1',
          clipIds: ['clip-1'],
          mode: 'images',
        }],
      },
    });
  });
});
