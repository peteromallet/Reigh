import { describe, expect, it } from 'vitest';
import { getConfigSignature, getStableConfigSignature } from '@/tools/video-editor/lib/config-utils';
import { configToRows, type ClipMeta, type TimelineData } from '@/tools/video-editor/lib/timeline-data';
import { buildDeleteShotGroupMutation } from '@/tools/video-editor/lib/shot-group-commands';
import type { TimelineConfig } from '@/tools/video-editor/types';
import type { ResolvedTimelineClip, TrackDefinition } from '@/tools/video-editor/types';
import type { TimelineRow } from '@/tools/video-editor/types/timeline-canvas';
import {
  resolveSelectedGenerationIdsForShotCreation,
  resolveVideoClipDoubleClickResolution,
  resolveWaveformAudioSrc,
} from './TimelineEditor';

describe('resolveSelectedGenerationIdsForShotCreation', () => {
  const rows: TimelineRow[] = [
    {
      id: 'V1',
      actions: [
        { id: 'clip-2', start: 5, end: 8, effectId: 'effect-2' },
        { id: 'clip-1', start: 1, end: 4, effectId: 'effect-1' },
      ],
    },
    {
      id: 'V2',
      actions: [
        { id: 'clip-3', start: 0, end: 2, effectId: 'effect-3' },
      ],
    },
  ];

  const meta: Record<string, ClipMeta> = {
    'clip-1': { asset: 'asset-1', track: 'V1', clipType: 'media' },
    'clip-2': { asset: 'asset-2', track: 'V1', clipType: 'media' },
    'clip-3': { asset: 'asset-3', track: 'V2', clipType: 'media' },
  };

  it('sorts selected generation ids by track index and clip start', () => {
    const assetGenerationMap = {
      'asset-1': 'gen-1',
      'asset-2': 'gen-2',
      'asset-3': 'gen-3',
    };

    const result = resolveSelectedGenerationIdsForShotCreation({
      rows,
      meta,
      assetGenerationMap,
      selectedClipIds: ['clip-3', 'clip-1', 'clip-2'],
    });

    expect(result).toEqual({
      canCreateShot: true,
      generationIds: ['gen-1', 'gen-2', 'gen-3'],
      orderedClipIds: ['clip-1', 'clip-2', 'clip-3'],
      trackId: 'V1',
    });
  });

  it('keeps non-generation clips in an ordered shot selection', () => {
    const assetGenerationMap = {
      'asset-1': 'gen-1',
      'asset-3': 'gen-3',
    };

    const result = resolveSelectedGenerationIdsForShotCreation({
      rows,
      meta,
      assetGenerationMap,
      selectedClipIds: ['clip-1', 'clip-2', 'clip-3'],
    });

    expect(result.canCreateShot).toBe(true);
    expect(result.generationIds).toEqual(['gen-1', 'gen-3']);
    expect(result.orderedClipIds).toEqual(['clip-1', 'clip-2', 'clip-3']);
    expect(result.trackId).toBe('V1');
  });
});

describe('resolveWaveformAudioSrc', () => {
  const audioTrack: TrackDefinition = { id: 'A1', kind: 'audio', label: 'A1' };
  const visualTrack: TrackDefinition = { id: 'V1', kind: 'visual', label: 'V1' };

  const createClip = (overrides: Partial<ResolvedTimelineClip> = {}): ResolvedTimelineClip => ({
    id: 'clip-1',
    at: 0,
    track: 'V1',
    clipType: 'media',
    volume: 1,
    asset: 'asset-1',
    assetEntry: {
      file: 'asset.mp4',
      src: 'https://example.com/asset.mp4',
      type: 'video/mp4',
    },
    ...overrides,
  });

  it('returns audio src for audible audio-track clips', () => {
    expect(resolveWaveformAudioSrc(createClip({ track: 'A1' }), audioTrack)).toBe('https://example.com/asset.mp4');
  });

  it('returns audio src for audible visual-track video clips', () => {
    expect(resolveWaveformAudioSrc(createClip(), visualTrack)).toBe('https://example.com/asset.mp4');
  });

  it('returns undefined for muted visual clips so detach-audio moves the waveform to the new audio clip', () => {
    const mutedVisualClip = createClip({ volume: 0 });
    const detachedAudioClip = createClip({ id: 'clip-1-audio', track: 'A1', volume: 1 });

    expect(resolveWaveformAudioSrc(mutedVisualClip, visualTrack)).toBeUndefined();
    expect(resolveWaveformAudioSrc(detachedAudioClip, audioTrack)).toBe('https://example.com/asset.mp4');
  });

  it('returns undefined for non-video visual clips and text/effect clips', () => {
    expect(resolveWaveformAudioSrc(createClip({
      assetEntry: {
        file: 'asset.png',
        src: 'https://example.com/asset.png',
        type: 'image/png',
      },
    }), visualTrack)).toBeUndefined();
    expect(resolveWaveformAudioSrc(createClip({ clipType: 'text' }), visualTrack)).toBeUndefined();
    expect(resolveWaveformAudioSrc(createClip({ clipType: 'effect-layer' }), visualTrack)).toBeUndefined();
  });
});

describe('resolveVideoClipDoubleClickResolution', () => {
  it('prefers the media lightbox when the clip has a generation-backed asset, even if it matches a final video', () => {
    const result = resolveVideoClipDoubleClickResolution({
      clipId: 'clip-33',
      assetKey: 'asset-1',
      generationId: 'gen-final',
      fileUrl: 'https://example.com/final.mp4',
      pinnedShotGroups: [
        { shotId: 'shot-1', clipIds: ['clip-33'] },
      ],
      finalVideoMap: new Map([
        ['shot-1', { id: 'gen-final', location: 'https://example.com/final.mp4' }],
      ]),
    });

    expect(result).toEqual({
      type: 'lightbox',
      assetKey: 'asset-1',
      generationId: 'gen-final',
    });
  });

  it('falls back to the video modal when a clip has no generation-backed asset but belongs to a pinned shot group', () => {
    const result = resolveVideoClipDoubleClickResolution({
      clipId: 'clip-33',
      assetKey: 'asset-1',
      generationId: undefined,
      fileUrl: 'https://example.com/final.mp4',
      pinnedShotGroups: [
        { shotId: 'shot-1', clipIds: ['clip-33'] },
      ],
      finalVideoMap: new Map([
        ['shot-1', { id: 'gen-final', location: 'https://example.com/final.mp4' }],
      ]),
    });

    expect(result).toEqual({
      type: 'lightbox',
      assetKey: 'asset-1',
      generationId: undefined,
    });
  });
});

describe('buildDeleteShotGroupMutation', () => {
  function makeTimelineData(config: TimelineConfig): TimelineData {
    const rowData = configToRows(config);
    const resolvedConfig = {
      output: { ...config.output },
      tracks: (config.tracks ?? []).map((track) => ({ ...track })),
      clips: config.clips.map((clip) => ({
        ...clip,
        assetEntry: undefined,
      })),
      registry: {},
    };

    return {
      config,
      configVersion: 1,
      registry: { assets: {} },
      resolvedConfig,
      rows: rowData.rows,
      meta: rowData.meta,
      effects: rowData.effects,
      assetMap: {},
      output: { ...config.output },
      tracks: (config.tracks ?? []).map((track) => ({ ...track })),
      clipOrder: rowData.clipOrder,
      signature: getConfigSignature(resolvedConfig),
      stableSignature: getStableConfigSignature(config, { assets: {} }),
    };
  }

  it('removes shot clips and the pinned group in one mutation for a single-step undo', () => {
    const currentData = makeTimelineData({
      output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      clips: [
        { id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 2 },
        { id: 'clip-2', at: 2, track: 'V1', clipType: 'hold', hold: 2 },
        { id: 'clip-3', at: 4, track: 'V1', clipType: 'hold', hold: 2 },
      ],
      pinnedShotGroups: [
        { shotId: 'shot-1', trackId: 'V1', clipIds: ['clip-1', 'clip-2'], mode: 'images' },
        { shotId: 'shot-2', trackId: 'V1', clipIds: ['clip-3'], mode: 'images' },
      ],
    });

    const mutation = buildDeleteShotGroupMutation({
      currentData,
      group: { shotId: 'shot-1', trackId: 'V1', clipIds: ['clip-1', 'clip-2'] },
    });

    expect(mutation).toEqual({
      type: 'rows',
      rows: [{
        id: 'V1',
        actions: [
          { id: 'clip-3', start: 4, end: 6, effectId: 'effect-clip-3' },
        ],
      }],
      metaDeletes: ['clip-1', 'clip-2'],
      pinnedShotGroupsOverride: [
        { shotId: 'shot-2', trackId: 'V1', clipIds: ['clip-3'], mode: 'images' },
      ],
    });
  });

  it('returns null when timeline data is unavailable', () => {
    expect(buildDeleteShotGroupMutation({
      currentData: null,
      group: { shotId: 'shot-1', trackId: 'V1', clipIds: ['clip-1'] },
    })).toBeNull();
  });
});
