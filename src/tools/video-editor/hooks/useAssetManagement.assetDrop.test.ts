import { describe, expect, it } from 'vitest';
import {
  buildAssetDropCommand,
  buildAssetDropEdit,
} from '@/tools/video-editor/hooks/useAssetManagement';
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
  it('builds an add-media command for supported assets instead of hand-authoring rows in callers', () => {
    const command = buildAssetDropCommand({
      current: createTimelineData('video/mp4', 'https://example.com/clip.mp4'),
      assetKey: 'asset1',
      trackId: 'V1',
      time: 2,
    });

    expect(command).toEqual({
      type: 'add-media',
      payload: {
        trackId: 'V1',
        at: 2,
        asset: {
          assetKey: 'asset1',
          mediaType: 'video',
          durationSeconds: 4,
          entry: {
            src: 'https://example.com/clip.mp4',
            file: 'https://example.com/clip.mp4',
            type: 'video/mp4',
            duration: 4,
          },
          source: 'registered',
        },
      },
    });
  });

  it('rejects unsupported assets before building an add-media command', () => {
    const command = buildAssetDropCommand({
      current: createTimelineData('text/plain', 'https://example.com/script.txt'),
      assetKey: 'asset1',
      trackId: 'V1',
      time: 0,
    });

    expect(command).toBeNull();
  });

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
    expect(edit?.rows[0]?.actions[0]).toMatchObject({
      id: edit?.clipId,
      start: 2,
      end: 6,
    });
    expect(edit?.clipOrderOverride).toEqual({ V1: [edit?.clipId] });
  });
});
