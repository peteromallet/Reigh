import { describe, expect, it } from 'vitest';
import { migrateToFlatTracks, repairConfig } from '@/tools/video-editor/lib/migrate';
import { configToRows, rowsToConfig } from '@/tools/video-editor/lib/timeline-data';
import type { TimelineConfig } from '@/tools/video-editor/types';

describe('repairConfig — legacy pinnedShotGroups migration', () => {
  const buildLegacyConfig = (): TimelineConfig => ({
    output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    clips: [
      { id: 'clip-a', at: 0, track: 'V1', clipType: 'hold', hold: 1 },
      { id: 'clip-b', at: 1, track: 'V1', clipType: 'hold', hold: 2 },
      { id: 'clip-c', at: 3, track: 'V1', clipType: 'hold', hold: 1.5 },
    ],
    // Legacy projection-shape group with `start` and `children` fields.
    pinnedShotGroups: [
      {
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-a', 'clip-b', 'clip-c'],
        mode: 'images',
        imageClipSnapshot: [
          {
            clipId: 'clip-a',
            assetKey: 'asset-a',
            start: 0,
            end: 1,
            meta: { clipType: 'hold', hold: 1 },
          },
        ],
        // `as unknown as ...` escape hatch — the runtime file has extra legacy fields
        // even though the TS type no longer allows them.
        ...({
          start: 0,
          children: [
            { clipId: 'clip-a', offset: 0, duration: 1 },
            { clipId: 'clip-b', offset: 1, duration: 2 },
            { clipId: 'clip-c', offset: 3, duration: 1.5 },
          ],
        } as unknown as object),
      },
    ] as TimelineConfig['pinnedShotGroups'],
  });

  it('strips legacy `start`/`children` and derives clipIds from children', () => {
    const repaired = repairConfig(buildLegacyConfig());
    const [group] = repaired.pinnedShotGroups ?? [];
    expect(group).toBeDefined();
    expect(group).toMatchObject({
      shotId: 'shot-1',
      trackId: 'V1',
      clipIds: ['clip-a', 'clip-b', 'clip-c'],
      mode: 'images',
      imageClipSnapshot: [
        {
          clipId: 'clip-a',
          assetKey: 'asset-a',
          start: 0,
          end: 1,
          meta: { clipType: 'hold', hold: 1 },
        },
      ],
    });
    // Legacy fields must be gone.
    expect(Object.prototype.hasOwnProperty.call(group, 'start')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(group, 'children')).toBe(false);
  });

  it('preserves clipIds when legacy `children` array is missing', () => {
    const config = buildLegacyConfig();
    const [g] = config.pinnedShotGroups ?? [];
    const legacyWithoutChildren = {
      shotId: g.shotId,
      trackId: g.trackId,
      clipIds: ['clip-a', 'clip-b', 'clip-c'],
      mode: g.mode,
      ...({ start: 0 } as unknown as object),
    };
    config.pinnedShotGroups = [legacyWithoutChildren] as TimelineConfig['pinnedShotGroups'];

    const repaired = repairConfig(config);
    const [repairedGroup] = repaired.pinnedShotGroups ?? [];
    expect(repairedGroup?.clipIds).toEqual(['clip-a', 'clip-b', 'clip-c']);
    expect(Object.prototype.hasOwnProperty.call(repairedGroup, 'start')).toBe(false);
  });

  it('round-trips via configToRows → rowsToConfig without emitting legacy fields', () => {
    const repaired = repairConfig(buildLegacyConfig());
    const { rows, meta, clipOrder } = configToRows(repaired);
    const nextConfig = rowsToConfig(
      rows,
      meta,
      repaired.output,
      clipOrder,
      repaired.tracks ?? [],
      repaired.pinnedShotGroups,
    );

    const [group] = nextConfig.pinnedShotGroups ?? [];
    expect(group).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(group, 'start')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(group, 'children')).toBe(false);
    expect(group).toMatchObject({
      shotId: 'shot-1',
      trackId: 'V1',
      clipIds: ['clip-a', 'clip-b', 'clip-c'],
      mode: 'images',
      imageClipSnapshot: [
        {
          clipId: 'clip-a',
          assetKey: 'asset-a',
          start: 0,
          end: 1,
          meta: { clipType: 'hold', hold: 1 },
        },
      ],
    });
  });

  it('leaves already-soft-tag configs unchanged', () => {
    const config: TimelineConfig = {
      output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      clips: [
        { id: 'clip-a', at: 0, track: 'V1', clipType: 'hold', hold: 1 },
      ],
      pinnedShotGroups: [
        { shotId: 'shot-1', trackId: 'V1', clipIds: ['clip-a'], mode: 'images' },
      ],
    };
    const repaired = repairConfig(config);
    expect(repaired.pinnedShotGroups).toBe(config.pinnedShotGroups);
  });
});

describe('migrateToFlatTracks clip-type defaults', () => {
  it('infers legacy clip types and synthesizes descriptor-backed background hold clips', () => {
    const migrated = migrateToFlatTracks({
      output: {
        resolution: '1920x1080',
        fps: 30,
        file: 'out.mp4',
        background: 'asset-background',
      },
      clips: [
        {
          id: 'clip-text',
          at: 1,
          track: 'overlay',
          text: { content: 'hello' },
          hold: 2,
        },
        {
          id: 'clip-media',
          at: 3,
          track: 'video',
          asset: 'asset-video',
          from: 0,
          to: 4,
        },
      ],
    });

    expect(migrated.tracks?.map((track) => track.id)).toEqual(['V1', 'V2', 'V3', 'A1']);
    expect(migrated.clips[0]).toMatchObject({
      id: 'clip-background',
      track: 'V1',
      clipType: 'hold',
      asset: 'asset-background',
      opacity: 1,
    });
    expect(migrated.clips[1]).toMatchObject({
      id: 'clip-text',
      track: 'V3',
      clipType: 'text',
      hold: 2,
    });
    expect(migrated.clips[2]).toMatchObject({
      id: 'clip-media',
      track: 'V2',
      clipType: 'media',
      from: 0,
      to: 4,
    });
  });
});
