import { describe, expect, it } from 'vitest';
import { buildDuplicateClipEdit } from './duplicate-clip';
import type { TimelineData } from '../types';

function buildTimelineData(): TimelineData {
  return {
    config: {
      output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
      clips: [],
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    },
    configVersion: 1,
    registry: { assets: {} },
    resolvedConfig: {
      output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      clips: [],
      registry: {},
    },
    rows: [{
      id: 'V1',
      actions: [
        { id: 'clip-0', start: 0, end: 2, effectId: 'effect-clip-0' },
        { id: 'clip-1', start: 2, end: 4, effectId: 'effect-clip-1' },
        { id: 'clip-2', start: 7, end: 9, effectId: 'effect-clip-2' },
      ],
    }],
    meta: {
      'clip-0': { asset: 'asset-0', track: 'V1', clipType: 'hold', hold: 2, id: 'clip-0', at: 0 },
      'clip-1': { asset: 'asset-1', track: 'V1', clipType: 'hold', hold: 2, text: { content: 'A' }, id: 'clip-1', at: 2 },
      'clip-2': { asset: 'asset-2', track: 'V1', clipType: 'hold', hold: 2, id: 'clip-2', at: 7 },
    },
    effects: {
      'effect-clip-0': { id: 'effect-clip-0' },
      'effect-clip-1': { id: 'effect-clip-1' },
      'effect-clip-2': { id: 'effect-clip-2' },
    },
    assetMap: {},
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
    clipOrder: { V1: ['clip-0', 'clip-1', 'clip-2'] },
    signature: JSON.stringify({
      output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      clips: [],
      registry: {},
    }),
    stableSignature: JSON.stringify({
      config: {
        output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      },
      registry: { assets: {} },
    }),
  };
}

describe('buildDuplicateClipEdit', () => {
  it('inserts the duplicated clip after the source and shifts following clips', () => {
    const result = buildDuplicateClipEdit(buildTimelineData(), 'clip-1', 'asset-copy');

    expect(result).not.toBeNull();
    expect(result?.clipId).toBe('clip-3');
    expect(result?.trackId).toBe('V1');
    expect(result?.rows[0].actions).toEqual([
      { id: 'clip-0', start: 0, end: 2, effectId: 'effect-clip-0' },
      { id: 'clip-1', start: 2, end: 4, effectId: 'effect-clip-1' },
      { id: 'clip-3', start: 4, end: 6, effectId: 'effect-clip-3' },
      { id: 'clip-2', start: 9, end: 11, effectId: 'effect-clip-2' },
    ]);
    expect(result?.metaUpdates['clip-3']).toMatchObject({
      asset: 'asset-copy',
      track: 'V1',
      clipType: 'hold',
      hold: 2,
      text: { content: 'A' },
    });
  });
});
