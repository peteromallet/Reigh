import { describe, expect, it } from 'vitest';
import {
  getPinnedShotGroups,
  getTimelineAppNamespace,
  REIGH_TIMELINE_APP_NAMESPACE,
  setPinnedShotGroups,
} from '@/tools/video-editor/lib/config-utils';
import { repairConfig } from '@/tools/video-editor/lib/migrate';
import { serializeForDisk, validateSerializedConfig } from '@tbd/schema';
import type { ResolvedTimelineConfig, TimelineConfig, TimelinePinnedShotGroups } from '@/tools/video-editor/types';

describe('video-editor serialization', () => {
  it('preserves exact source fields and strips resolved-only data', () => {
    const resolved = {
      output: {
        resolution: '1280x720',
        fps: 30,
        file: 'out.mp4',
        background_scale: 1,
      },
      tracks: [
        {
          id: 'V1',
          kind: 'visual',
          label: 'V1',
          scale: 1,
          fit: 'manual',
          opacity: 1,
          blendMode: 'normal',
          extra: 'strip-me',
        },
      ],
      clips: [
        {
          id: 'clip-1',
          at: 1,
          track: 'V1',
          clipType: 'hold',
          asset: 'asset-1',
          hold: 5,
          opacity: 0.8,
          transition: { type: 'crossfade', duration: 0.4 },
          continuous: { type: 'custom:glow', intensity: 0.6 },
          assetEntry: { file: 'foo.png', src: 'https://example.com/foo.png' },
          extra: 'strip-me',
        },
      ],
      registry: {
        'asset-1': { file: 'foo.png', src: 'https://example.com/foo.png' },
      },
    } as unknown as ResolvedTimelineConfig;

    const serialized = serializeForDisk(resolved);

    expect(serialized.output.background_scale).toBe(1);
    expect(serialized.clips[0]).not.toHaveProperty('assetEntry');
    expect(serialized.clips[0]).not.toHaveProperty('extra');
    expect(serialized.tracks?.[0]).not.toHaveProperty('extra');
    expect(() => validateSerializedConfig(serialized)).not.toThrow();
  });

  it('round-trips pinnedShotGroups through serializeForDisk and validation', () => {
    const resolved = {
      output: {
        resolution: '1280x720',
        fps: 30,
        file: 'out.mp4',
      },
      tracks: [
        {
          id: 'V1',
          kind: 'visual',
          label: 'V1',
        },
      ],
      clips: [
        {
          id: 'clip-1',
          at: 0,
          track: 'V1',
          clipType: 'hold',
          asset: 'asset-1',
          hold: 5,
        },
      ],
      registry: {
        'asset-1': { file: 'foo.png', src: 'https://example.com/foo.png' },
      },
    } as unknown as ResolvedTimelineConfig;

    const pinnedShotGroups: TimelinePinnedShotGroups = [
      {
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-1'],
        mode: 'images',
        imageClipSnapshot: [
          {
            clipId: 'clip-1',
            assetKey: 'asset-1',
            start: 0,
            end: 5,
            meta: {
              clipType: 'hold',
              hold: 5,
            },
          },
        ],
      },
    ];

    const serialized = serializeForDisk(setPinnedShotGroups(resolved, pinnedShotGroups));

    expect(() => validateSerializedConfig(serialized)).not.toThrow();
    expect(getPinnedShotGroups(serialized)).toEqual(pinnedShotGroups);
    expect(Object.prototype.hasOwnProperty.call(serialized, 'pinnedShotGroups')).toBe(false);
    expect(getTimelineAppNamespace(serialized, REIGH_TIMELINE_APP_NAMESPACE)?.pinnedShotGroups).toEqual(pinnedShotGroups);
  });

  it('round-trips legacy pinnedShotGroups through repairConfig before serialization', () => {
    const repaired = repairConfig({
      output: {
        resolution: '1280x720',
        fps: 30,
        file: 'out.mp4',
      },
      tracks: [
        {
          id: 'V1',
          kind: 'visual',
          label: 'V1',
        },
      ],
      clips: [
        {
          id: 'clip-2',
          at: 5,
          track: 'V1',
          clipType: 'hold',
          asset: 'asset-2',
          hold: 3,
        },
        {
          id: 'clip-1',
          at: 1,
          track: 'V1',
          clipType: 'hold',
          asset: 'asset-1',
          hold: 4,
        },
      ],
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-2', 'clip-1'],
        mode: 'images',
        imageClipSnapshot: [
          {
            clipId: 'clip-1',
            assetKey: 'asset-1',
            start: 1,
            end: 5,
            meta: { clipType: 'hold', hold: 4 },
          },
        ],
        ...({
          start: 1,
          children: [
            { clipId: 'clip-1', offset: 0, duration: 4 },
            { clipId: 'clip-2', offset: 4, duration: 3 },
          ],
        } as unknown as object),
      }],
    } as TimelineConfig);

    expect(getPinnedShotGroups(repaired)).toEqual([
      expect.objectContaining({
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-2', 'clip-1'],
        mode: 'images',
        imageClipSnapshot: [
          {
            clipId: 'clip-1',
            assetKey: 'asset-1',
            start: 1,
            end: 5,
            meta: { clipType: 'hold', hold: 4 },
          },
        ],
      }),
    ]);

    const serialized = serializeForDisk(setPinnedShotGroups({
      output: repaired.output,
      tracks: repaired.tracks ?? [],
      clips: repaired.clips,
      registry: {},
      app: repaired.app,
    } as unknown as ResolvedTimelineConfig, getPinnedShotGroups(repaired)));

    expect(() => validateSerializedConfig(serialized)).not.toThrow();
    expect(Object.prototype.hasOwnProperty.call(repaired, 'pinnedShotGroups')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(serialized, 'pinnedShotGroups')).toBe(false);
    expect(getPinnedShotGroups(serialized)).toEqual(getPinnedShotGroups(repaired));
    expect(getPinnedShotGroups(serialized)?.[0]).not.toHaveProperty('start');
    expect(getPinnedShotGroups(serialized)?.[0]).not.toHaveProperty('children');
  });
});
