import { describe, expect, it } from 'vitest';
import { getConfigSignature, getStableConfigSignature, setPinnedShotGroups } from '@/tools/video-editor/lib/config-utils';
import { buildKeyboardDeleteMutation } from '@/tools/video-editor/lib/keyboard-delete';
import { buildDeleteShotGroupMutation } from '@/tools/video-editor/lib/shot-group-commands';
import { configToRows, type TimelineData } from '@/tools/video-editor/lib/timeline-data';
import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types';

function makeConfigTimelineData(config: TimelineConfig, registry: AssetRegistry): TimelineData {
  const { rows, meta, effects, clipOrder, tracks } = configToRows(config);

  return {
    config,
    configVersion: 1,
    registry,
    resolvedConfig: {
      output: config.output,
      clips: config.clips.map((clip) => ({ ...clip })),
      tracks: config.tracks ?? [],
      registry: Object.fromEntries(
        Object.entries(registry.assets).map(([assetId, entry]) => [assetId, { ...entry, src: entry.file }]),
      ),
    },
    rows,
    meta,
    effects,
    assetMap: Object.fromEntries(Object.entries(registry.assets).map(([assetId, entry]) => [assetId, entry.file])),
    output: config.output,
    tracks,
    clipOrder,
    signature: getConfigSignature(config),
    stableSignature: getStableConfigSignature(config),
  };
}

describe('buildKeyboardDeleteMutation', () => {
  it('reuses the shot menu deletion mutation for a single pinned shot selection', () => {
    const currentData = makeConfigTimelineData(
      setPinnedShotGroups({
        output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        clips: [
          { id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
          { id: 'clip-2', at: 2, track: 'V1', clipType: 'hold', asset: 'asset-2', hold: 2 },
        ],
      }, [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-1', 'clip-2'],
        mode: 'images',
      }]),
      {
        assets: {
          'asset-1': { file: 'one.png', type: 'image/png' },
          'asset-2': { file: 'two.png', type: 'image/png' },
        },
      },
    );

    expect(buildKeyboardDeleteMutation(currentData, ['clip-1'])).toEqual(
      buildDeleteShotGroupMutation({
        currentData,
        group: {
          shotId: 'shot-1',
          trackId: 'V1',
          clipIds: ['clip-1', 'clip-2'],
        },
      }),
    );
  });

  it('expands grouped clips to full shot deletes while preserving free-clip keyboard deletes', () => {
    const currentData = makeConfigTimelineData(
      setPinnedShotGroups({
        output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        clips: [
          { id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
          { id: 'clip-2', at: 2, track: 'V1', clipType: 'hold', asset: 'asset-2', hold: 2 },
          { id: 'clip-3', at: 4, track: 'V1', clipType: 'hold', asset: 'asset-3', hold: 2 },
        ],
      }, [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-1', 'clip-2'],
        mode: 'images',
      }]),
      {
        assets: {
          'asset-1': { file: 'one.png', type: 'image/png' },
          'asset-2': { file: 'two.png', type: 'image/png' },
          'asset-3': { file: 'three.png', type: 'image/png' },
        },
      },
    );

    expect(buildKeyboardDeleteMutation(currentData, ['clip-1', 'clip-3'])).toEqual({
      type: 'rows',
      rows: [{
        id: 'V1',
        actions: [],
      }],
      metaDeletes: ['clip-3', 'clip-1', 'clip-2'],
      pinnedShotGroupsOverride: [],
    });
  });

  it('returns null when the keyboard delete selection contains no pinned shot group clips', () => {
    const currentData = makeConfigTimelineData(
      {
        output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        clips: [
          { id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
        ],
      },
      {
        assets: {
          'asset-1': { file: 'one.png', type: 'image/png' },
        },
      },
    );

    expect(buildKeyboardDeleteMutation(currentData, ['clip-1'])).toBeNull();
  });
});
