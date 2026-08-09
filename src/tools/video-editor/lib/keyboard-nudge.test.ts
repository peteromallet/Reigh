import { describe, expect, it } from 'vitest';
import { getConfigSignature, getStableConfigSignature } from '@/tools/video-editor/lib/config-utils';
import {
  COARSE_TIME_NUDGE_SECONDS,
  buildKeyboardTimeNudgeMutation,
  resolveKeyboardNudgeSeconds,
} from '@/tools/video-editor/lib/keyboard-nudge';
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

const ASSETS: AssetRegistry = {
  assets: {
    'asset-1': { file: 'one.png', type: 'image/png' },
    'asset-2': { file: 'two.png', type: 'image/png' },
    'asset-3': { file: 'three.png', type: 'image/png' },
  },
};

/** Two visual tracks so a multi-selection can span rows. */
function makeTimeline(clips: TimelineConfig['clips']): TimelineData {
  return makeConfigTimelineData(
    {
      output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
      tracks: [
        { id: 'V1', kind: 'visual', label: 'V1' },
        { id: 'V2', kind: 'visual', label: 'V2' },
      ],
      clips,
    },
    ASSETS,
  );
}

function startsById(mutation: ReturnType<typeof buildKeyboardTimeNudgeMutation>): Record<string, number> {
  if (!mutation || mutation.type !== 'rows') {
    throw new Error('expected a rows mutation');
  }

  return Object.fromEntries(
    mutation.rows.flatMap((row) => row.actions.map((action) => [action.id, action.start])),
  );
}

describe('resolveKeyboardNudgeSeconds', () => {
  it('steps one frame with precision on and the coarse step without it', () => {
    expect(resolveKeyboardNudgeSeconds(true, 30)).toBeCloseTo(1 / 30, 10);
    expect(resolveKeyboardNudgeSeconds(false, 30)).toBe(COARSE_TIME_NUDGE_SECONDS);
  });

  it('falls back to the coarse step when fps is unusable', () => {
    expect(resolveKeyboardNudgeSeconds(true, 0)).toBe(COARSE_TIME_NUDGE_SECONDS);
    expect(resolveKeyboardNudgeSeconds(true, Number.NaN)).toBe(COARSE_TIME_NUDGE_SECONDS);
  });
});

describe('buildKeyboardTimeNudgeMutation', () => {
  it('moves the selected clip by the requested delta', () => {
    const currentData = makeTimeline([
      { id: 'clip-1', at: 4, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
    ]);

    const mutation = buildKeyboardTimeNudgeMutation(currentData, ['clip-1'], 1 / 30);

    expect(startsById(mutation)['clip-1']).toBeCloseTo(4 + 1 / 30, 10);
  });

  it('clamps a leftward nudge so no clip crosses t=0', () => {
    const currentData = makeTimeline([
      { id: 'clip-1', at: 0.2, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
    ]);

    const mutation = buildKeyboardTimeNudgeMutation(currentData, ['clip-1'], -COARSE_TIME_NUDGE_SECONDS);

    expect(startsById(mutation)['clip-1']).toBe(0);
  });

  it('returns null when the selection already sits at t=0 and is nudged left', () => {
    const currentData = makeTimeline([
      { id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
    ]);

    expect(buildKeyboardTimeNudgeMutation(currentData, ['clip-1'], -0.5)).toBeNull();
  });

  it('clamps a multi-selection as one group, preserving relative offsets', () => {
    const currentData = makeTimeline([
      { id: 'clip-1', at: 0.2, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
      { id: 'clip-2', at: 1.7, track: 'V2', clipType: 'hold', asset: 'asset-2', hold: 2 },
    ]);

    const starts = startsById(
      buildKeyboardTimeNudgeMutation(currentData, ['clip-1', 'clip-2'], -COARSE_TIME_NUDGE_SECONDS),
    );

    // Whole-group clamp: the earliest clip lands on 0 and the 1.5s gap survives.
    expect(starts['clip-1']).toBe(0);
    expect(starts['clip-2']).toBeCloseTo(1.5, 10);
  });

  it('keeps relative offsets on an unclamped multi-selection', () => {
    const currentData = makeTimeline([
      { id: 'clip-1', at: 3, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
      { id: 'clip-2', at: 7, track: 'V2', clipType: 'hold', asset: 'asset-2', hold: 2 },
    ]);

    const starts = startsById(buildKeyboardTimeNudgeMutation(currentData, ['clip-1', 'clip-2'], 0.5));

    expect(starts['clip-1']).toBeCloseTo(3.5, 10);
    expect(starts['clip-2']).toBeCloseTo(7.5, 10);
  });

  it('moves a whole pinned shot group when one member is selected', () => {
    const currentData = makeConfigTimelineData(
      {
        output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        clips: [
          { id: 'clip-1', at: 2, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
          { id: 'clip-2', at: 4, track: 'V1', clipType: 'hold', asset: 'asset-2', hold: 2 },
        ],
        pinnedShotGroups: [{ shotId: 'shot-1', trackId: 'V1', clipIds: ['clip-1', 'clip-2'], mode: 'images' }],
      },
      ASSETS,
    );

    const starts = startsById(buildKeyboardTimeNudgeMutation(currentData, ['clip-1'], 0.5));

    expect(starts['clip-1']).toBeCloseTo(2.5, 10);
    expect(starts['clip-2']).toBeCloseTo(4.5, 10);
  });

  it('returns null without data, without a selection, or for a zero delta', () => {
    const currentData = makeTimeline([
      { id: 'clip-1', at: 1, track: 'V1', clipType: 'hold', asset: 'asset-1', hold: 2 },
    ]);

    expect(buildKeyboardTimeNudgeMutation(null, ['clip-1'], 0.5)).toBeNull();
    expect(buildKeyboardTimeNudgeMutation(currentData, [], 0.5)).toBeNull();
    expect(buildKeyboardTimeNudgeMutation(currentData, ['clip-1'], 0)).toBeNull();
  });
});
