// @vitest-environment jsdom
/**
 * Policy ↔ mechanism conformance for `lib/time-grid.ts`, in the mold of
 * `mobile-interaction-conformance.test.tsx`.
 *
 * The policy module says *committed timeline times sit on the frame grid*. It
 * cannot make that happen — the edit paths must actually route through it. So
 * this suite binds each commit choke point to the module over realistic float
 * populations (the same populations that measured ~24% one-frame gap/overlap
 * at cuts before the snap), asserts the invariant under the composition's
 * EXACT formulas (`secondsToFrames` / `getClipDurationInFrames`, imported —
 * not re-derived), and gates coverage: an export of `time-grid.ts` with
 * neither a binding here nor a documented exclusion fails the suite.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as timeGrid from '@/tools/video-editor/lib/time-grid.ts';
import {
  framesToSeconds,
  mediaDurationInFrames,
  resnapTimelineToFps,
  secondsToFrames,
  snapToFrameGrid,
} from '@/tools/video-editor/lib/time-grid.ts';
import {
  getClipDurationInFrames,
  getSanitizedMediaTrimProps,
  getConfigSignature,
  getStableConfigSignature,
  secondsToFrames as compositionSecondsToFrames,
} from '@/tools/video-editor/lib/config-utils.ts';
import { buildConfigFromDragResult } from '@/tools/video-editor/lib/multi-drag-utils.ts';
import { buildKeyboardTimeNudgeMutation } from '@/tools/video-editor/lib/keyboard-nudge.ts';
import {
  configToRows,
  rowsToConfig,
  type ClipMeta,
  type TimelineData,
} from '@/tools/video-editor/lib/timeline-data.ts';
import { createTimelineScale } from '@/tools/video-editor/lib/timeline-scale.ts';
import { SCALE_SECONDS, TIMELINE_START_LEFT } from '@/tools/video-editor/lib/coordinate-utils.ts';
import { applyClipEdgeMove } from '@/tools/video-editor/lib/resize-math.ts';
import { useClipResize, type ClipEdgeResizeSession } from '@/tools/video-editor/hooks/useClipResize.ts';
import type { TimelineApplyEdit } from '@/tools/video-editor/hooks/timeline-state-types.ts';
import type { ResolvedTimelineConfig, TimelineClip, TimelineConfig } from '@/tools/video-editor/types/index.ts';
import type { TimelineRow } from '@/tools/video-editor/types/timeline-canvas.ts';

// ---------------------------------------------------------------------------
// Coverage declaration, gated at the bottom of the file.
// ---------------------------------------------------------------------------

const COVERAGE = {
  'commit funnel (rowsToConfig)': ['snapToFrameGrid', 'secondsToFrames'],
  'drag config path (buildConfigFromDragResult)': ['snapToFrameGrid'],
  'resize commit (useClipResize)': ['snapToFrameGrid'],
  'keyboard nudge result': ['snapToFrameGrid', 'framesToSeconds'],
  'media Sequence duration': ['mediaDurationInFrames'],
  'fps migration': ['resnapTimelineToFps', 'framesToSeconds'],
} as const satisfies Record<string, readonly string[]>;

const EXCLUSIONS: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Populations — the float sources real gestures produce. Deterministic PRNG so
// a failure is reproducible.
// ---------------------------------------------------------------------------

const makeRng = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
};

type TimePair = { at: number; dur: number };

/** 2-decimal values — what the drag path's old rounding persisted. */
const dragPopulation = (rng: () => number, n: number): TimePair[] =>
  Array.from({ length: n }, () => ({
    at: Math.round(rng() * 6000) / 100,
    dur: Math.round((0.5 + rng() * 8) * 100) / 100,
  }));

/** Raw pixel→time floats at assorted zoom levels — what resize produced. */
const pixelPopulation = (rng: () => number, n: number): TimePair[] => {
  const zooms = [40, 58.31, 81.63, 114.29, 160, 224, 313.6, 439.04, 500];
  return Array.from({ length: n }, () => {
    const scale = createTimelineScale({
      scale: SCALE_SECONDS,
      scaleWidth: zooms[Math.floor(rng() * zooms.length)],
      startLeft: TIMELINE_START_LEFT,
    });
    const startPx = TIMELINE_START_LEFT + Math.floor(rng() * 2000);
    const widthPx = 20 + Math.floor(rng() * 400);
    const at = scale.pixelToTime(startPx);
    return { at, dur: scale.pixelToTime(startPx + widthPx) - at };
  });
};

/** N accumulated `1/fps` additions — precision-nudge binary dust. */
const nudgePopulation = (rng: () => number, n: number, fps: number): TimePair[] =>
  Array.from({ length: n }, () => {
    let at = Math.round(rng() * 6000) / 100;
    const presses = Math.floor(rng() * 40);
    for (let i = 0; i < presses; i += 1) at += 1 / fps;
    return { at, dur: Math.round((0.5 + rng() * 8) * 100) / 100 };
  });

// ---------------------------------------------------------------------------
// The composition's exact frame math, spelled through the real imports.
// ---------------------------------------------------------------------------

const holdClip = (id: string, at: number, dur: number): TimelineClip => ({
  id,
  track: 'V1',
  at,
  clipType: 'hold',
  hold: dur,
} as TimelineClip);

/** `<Sequence from>` for a non-transition clip (VisualClip/TextClip/etc). */
const sequenceFrom = (at: number, fps: number): number =>
  Math.max(0, compositionSecondsToFrames(at, fps));

const expectFrameContiguous = (
  a: TimelineClip,
  b: TimelineClip,
  fps: number,
  context: string,
) => {
  const aEnd = sequenceFrom(a.at, fps) + getClipDurationInFrames(a, fps);
  const bStart = sequenceFrom(b.at, fps);
  if (aEnd !== bStart) {
    throw new Error(
      `${context}: abutting pair not frame-contiguous @${fps}fps — `
      + `A(at=${a.at}) ends frame ${aEnd}, B(at=${b.at}) starts frame ${bStart}`,
    );
  }
};

const expectOnGrid = (seconds: number, fps: number, context: string) => {
  // Serialized values are 4-decimal-rounded grid instants; a duration is the
  // difference of two of them, so the worst case is 2·5e-5 off the exact
  // instant. Frame recovery needs |value·fps − k| ≪ 0.5 — at 60 fps the bound
  // is 0.006 frames, two orders of magnitude inside the rounding budget.
  const frames = seconds * fps;
  const drift = Math.abs(frames - Math.round(frames));
  if (drift > 1e-4 * fps + 1e-9) {
    throw new Error(`${context}: ${seconds}s is off the ${fps}fps grid by ${drift} frames`);
  }
};

const FPS_MATRIX = [24, 25, 30, 60] as const;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const makeConfig = (clips: TimelineClip[], fps: number): TimelineConfig => ({
  output: { resolution: '1920x1080', fps, file: 'out.mp4' },
  tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
  clips,
});

const makeTimelineData = (config: TimelineConfig): TimelineData => {
  const rowData = configToRows(config);
  const resolvedConfig: ResolvedTimelineConfig = {
    output: { ...config.output },
    tracks: (config.tracks ?? []).map((track) => ({ ...track })),
    clips: config.clips.map((clip) => ({ ...clip, assetEntry: undefined })),
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
};

/** Run an abutting pair through the `'rows'` commit funnel. */
const commitAbuttingPairThroughFunnel = (
  pair: TimePair,
  fps: number,
): TimelineConfig => {
  const output = { resolution: '1920x1080', fps, file: 'out.mp4' };
  const tracks = [{ id: 'V1', kind: 'visual' as const, label: 'V1' }];
  const rows: TimelineRow[] = [{
    id: 'V1',
    actions: [
      { id: 'a', start: pair.at, end: pair.at + pair.dur, effectId: 'effect-a' },
      { id: 'b', start: pair.at + pair.dur, end: pair.at + pair.dur + 1.37, effectId: 'effect-b' },
    ],
  }];
  const meta: Record<string, ClipMeta> = {
    a: { track: 'V1', clipType: 'hold', hold: pair.dur },
    b: { track: 'V1', clipType: 'hold', hold: 1.37 },
  };
  return rowsToConfig(rows, meta, output, { V1: ['a', 'b'] }, tracks);
};

// ---------------------------------------------------------------------------
// 1. Commit funnel: every `'rows'` edit lands on the grid, and abutting pairs
//    are frame-contiguous under the composition's exact formulas.
// ---------------------------------------------------------------------------

describe.each(FPS_MATRIX)('commit funnel (rowsToConfig) @%dfps', (fps) => {
  it('snaps drag-, pixel- and nudge-shaped floats onto the frame grid, keeping cuts frame-contiguous', () => {
    const rng = makeRng(987654321);
    const populations: Array<[string, TimePair[]]> = [
      ['drag-2dp', dragPopulation(rng, 400)],
      ['pixel-derived', pixelPopulation(rng, 400)],
      ['precision-nudged', nudgePopulation(rng, 400, fps)],
    ];

    for (const [label, pairs] of populations) {
      for (const pair of pairs) {
        const committed = commitAbuttingPairThroughFunnel(pair, fps);
        const [a, b] = committed.clips;
        expectOnGrid(a.at, fps, `${label} A.at`);
        expectOnGrid(a.hold as number, fps, `${label} A.hold`);
        expectOnGrid(b.at, fps, `${label} B.at`);
        expectFrameContiguous(a, b, fps, label);
      }
    }
  });

  it('demonstrates the funnel is what closes the drift (raw floats still drift)', () => {
    // The minimal reproduction from the investigation: raw 2dp values that a
    // pre-snap drag commit persisted verbatim. If someone removes the snap
    // from rowsToConfig, the first test fails; this one documents why.
    const rawA = holdClip('a', 0.01, 0.51);
    const rawB = holdClip('b', 0.52, 1);
    const aEnd = sequenceFrom(rawA.at, 30) + getClipDurationInFrames(rawA, 30);
    const bStart = sequenceFrom(rawB.at, 30);
    expect(bStart - aEnd).toBe(1); // one black frame at the cut, pre-snap
  });
});

// ---------------------------------------------------------------------------
// 2. Drag `'config'` path (new-track drops bypass rowsToConfig)
// ---------------------------------------------------------------------------

describe.each(FPS_MATRIX)('drag config path (buildConfigFromDragResult) @%dfps', (fps) => {
  it('persists frame-grid times for hold and media clips', () => {
    const rng = makeRng(24681357);
    for (const pair of [...dragPopulation(rng, 150), ...pixelPopulation(rng, 150)]) {
      const baseConfig: ResolvedTimelineConfig = {
        output: { resolution: '1920x1080', fps, file: 'out.mp4' },
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        clips: [
          { ...holdClip('h', 0, 1), assetEntry: undefined },
          { id: 'm', track: 'V1', at: 0, clipType: 'media', from: 0.4, to: 1.4, speed: 1, assetEntry: undefined } as ResolvedTimelineConfig['clips'][number],
        ],
        registry: {},
      };
      const baseMeta: Record<string, ClipMeta> = {
        h: { track: 'V1', clipType: 'hold', hold: 1 },
        m: { track: 'V1', clipType: 'media', from: 0.4, to: 1.4, speed: 1 },
      };
      const nextRows: TimelineRow[] = [{
        id: 'V1',
        actions: [
          { id: 'h', start: pair.at, end: pair.at + pair.dur, effectId: 'effect-h' },
          { id: 'm', start: pair.at + pair.dur, end: pair.at + pair.dur + 1, effectId: 'effect-m' },
        ],
      }];

      const committed = buildConfigFromDragResult(baseConfig, baseMeta, nextRows, {});
      const hold = committed.clips.find((clip) => clip.id === 'h');
      const media = committed.clips.find((clip) => clip.id === 'm');
      if (!hold || !media) throw new Error('expected both clips to survive the drag commit');

      expectOnGrid(hold.at, fps, 'drag-config hold.at');
      expectOnGrid(hold.hold as number, fps, 'drag-config hold.hold');
      expectOnGrid(media.at, fps, 'drag-config media.at');
      expectFrameContiguous(hold, media, fps, 'drag-config');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Resize commit: raw pixel floats are snapped before trim math derives
//    from/to, and the committed mutation materializes onto the grid.
// ---------------------------------------------------------------------------

describe('resize commit (useClipResize)', () => {
  it('commits pixel-derived edges as frame instants and grid-consistent trim windows', () => {
    const fps = 30;
    const config = makeConfig([
      { id: 'video-1', track: 'V1', at: 5, clipType: 'media', from: 0, to: 2, speed: 1 } as TimelineClip,
    ], fps);
    const data = makeTimelineData(config);
    const dataRef = { current: data };
    const applyEdit = vi.fn<Parameters<TimelineApplyEdit>>();
    const { result } = renderHook(() => useClipResize({ dataRef, applyEdit }));

    const row = data.rows[0];
    const action = row.actions[0];
    const session: ClipEdgeResizeSession = {
      pointerId: 1,
      rowId: 'V1',
      clipId: 'video-1',
      edge: 'right',
      cursorOffsetPx: 0,
      initialBoundaryTime: 7,
      context: { kind: 'free', clipId: 'video-1', initialStart: 5, initialEnd: 7 },
      siblingTimes: [],
    };

    act(() => {
      result.current.onActionResizeStart({ action, row, dir: 'right' });
    });
    act(() => {
      result.current.onClipEdgeResizeEnd({
        session,
        // A raw pixel→time float, exactly what the gesture layer hands over.
        updates: applyClipEdgeMove(session.context, session.edge, 8.4837262951).updates,
        cancelled: false,
      });
    });

    expect(applyEdit).toHaveBeenCalledOnce();
    const [mutation] = applyEdit.mock.calls[0];
    if (mutation.type !== 'rows') throw new Error('expected rows mutation');

    // The rows the mutation carries are already frame instants…
    const committedAction = mutation.rows[0].actions[0];
    expectOnGrid(committedAction.start, fps, 'resize rows.start');
    expectOnGrid(committedAction.end, fps, 'resize rows.end');

    // …and materializing through the funnel yields a grid clip. A visual
    // right-edge resize keeps `from`/`to` and rewrites `speed`, so the
    // Sequence duration must equal the timeline window in frames AND the last
    // frame must stay inside the trim window the player cuts at.
    const committed = rowsToConfig(
      mutation.rows,
      { 'video-1': { ...data.meta['video-1'], ...mutation.metaUpdates?.['video-1'] } },
      data.output,
      data.clipOrder,
      data.tracks,
    );
    const clip = committed.clips[0];
    expectOnGrid(clip.at, fps, 'resize committed at');
    const timelineWindowFrames = secondsToFrames(committedAction.end, fps) - secondsToFrames(committedAction.start, fps);
    const durationInFrames = getClipDurationInFrames(clip, fps);
    expect(durationInFrames).toBe(timelineWindowFrames);
    const trims = getSanitizedMediaTrimProps(clip, fps);
    const cutoffSourceSeconds = ((trims.trimAfter ?? 0) - trims.trimBefore) / fps;
    const lastFrameElapsed = ((durationInFrames - 1) / fps) * (clip.speed ?? 1);
    expect(lastFrameElapsed).toBeLessThan(cutoffSourceSeconds);
  });
});

// ---------------------------------------------------------------------------
// 4. Keyboard nudge: the RESULT of every nudge is a frame instant — N presses
//    cannot accumulate binary dust because each press re-lands on the grid.
// ---------------------------------------------------------------------------

describe('keyboard nudge result', () => {
  it('keeps a precision-nudged clip on exact frame instants across 40 presses', () => {
    const fps = 24;
    // 0.01 s: representative pre-existing off-grid value (old drag rounding).
    let config = makeConfig([holdClip('clip-1', 0.01, 1)], fps);

    for (let press = 0; press < 40; press += 1) {
      const data = makeTimelineData(config);
      const mutation = buildKeyboardTimeNudgeMutation(data, ['clip-1'], 1 / fps);
      if (!mutation || mutation.type !== 'rows') throw new Error('expected a rows nudge mutation');
      config = rowsToConfig(
        mutation.rows,
        data.meta,
        data.output,
        mutation.clipOrderOverride ?? data.clipOrder,
        data.tracks,
      );
      expectOnGrid(config.clips[0].at, fps, `press ${press + 1}`);
    }

    // 40 presses from frame 0 (0.01 s snaps to frame 0) land on frame 40 —
    // the exact instant, not "near" it.
    expect(config.clips[0].at).toBeCloseTo(framesToSeconds(40, fps), 4);
  });
});

// ---------------------------------------------------------------------------
// 5. Media Sequence duration: derived from the trim window, so the last frame
//    always has source material (`@remotion/media` cuts at the same window).
// ---------------------------------------------------------------------------

describe('media Sequence duration', () => {
  it('never outlives the trim window for any from/to/speed population', () => {
    const rng = makeRng(1357911);
    for (const fps of [24, 30]) {
      for (let i = 0; i < 20000; i += 1) {
        const from = Math.round(rng() * 500) / 100;
        const to = from + 0.2 + Math.round(rng() * 800) / 100;
        const speed = [0.5, 1, 1.5, 2, 3][Math.floor(rng() * 5)];
        const clip = { id: 'c', track: 'V1', at: 0, clipType: 'media', from, to, speed } as TimelineClip;

        const durationInFrames = getClipDurationInFrames(clip, fps);
        const trims = getSanitizedMediaTrimProps(clip, fps);
        // @remotion/media renders null once unloopedTime·rate ≥ (trimAfter−trimBefore)/fps.
        const cutoffSourceSeconds = ((trims.trimAfter ?? 0) - trims.trimBefore) / fps;
        const lastFrameElapsed = ((durationInFrames - 1) / fps) * speed;
        if (lastFrameElapsed >= cutoffSourceSeconds) {
          throw new Error(
            `blank last frame @${fps}fps: from=${from} to=${to} speed=${speed} `
            + `dur=${durationInFrames}f lastElapsed=${lastFrameElapsed} cutoff=${cutoffSourceSeconds}`,
          );
        }
      }
    }
  });

  it('is the formula config-utils delegates to (one owner)', () => {
    const clip = { id: 'c', track: 'V1', at: 0, clipType: 'media', from: 1.69, to: 8.17, speed: 1 } as TimelineClip;
    expect(getClipDurationInFrames(clip, 24)).toBe(
      mediaDurationInFrames({ from: 1.69, to: 8.17, speed: 1, fps: 24 }),
    );
    // config-utils re-exports the module's converter, not a copy.
    expect(compositionSecondsToFrames).toBe(secondsToFrames);
  });
});

// ---------------------------------------------------------------------------
// 6. fps migration
// ---------------------------------------------------------------------------

describe('fps migration', () => {
  it('re-quantizes a whole config onto the new grid without mutating the input', () => {
    const config = makeConfig([
      holdClip('h', 0.52, 1.37),
      { id: 'm', track: 'V1', at: 2.01, clipType: 'media', from: 0.4, to: 2.4, speed: 2 } as TimelineClip,
    ], 30);
    const snapshot = JSON.stringify(config);

    const resnapped = resnapTimelineToFps(config, 24);

    expect(JSON.stringify(config)).toBe(snapshot); // pure
    expect(resnapped.output.fps).toBe(24);
    for (const clip of resnapped.clips) {
      expectOnGrid(clip.at, 24, `resnap ${clip.id}.at`);
      if (typeof clip.hold === 'number') {
        expectOnGrid(clip.hold, 24, `resnap ${clip.id}.hold`);
      } else {
        // Media timeline duration ((to−from)/speed) sits on the new grid.
        expectOnGrid(((clip.to as number) - (clip.from as number)) / (clip.speed ?? 1), 24, `resnap ${clip.id} duration`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 7. The gate
// ---------------------------------------------------------------------------

describe('conformance coverage gate', () => {
  it('binds or explicitly excuses every export of time-grid', () => {
    const covered = new Set(Object.values(COVERAGE).flat());
    const excluded = new Set(Object.keys(EXCLUSIONS));
    const uncovered = Object.keys(timeGrid).filter(
      (name) => !covered.has(name) && !excluded.has(name),
    );

    expect(
      uncovered,
      'Every time-grid export needs a conformance binding (add it to COVERAGE and write the check) '
      + 'or an EXCLUSIONS entry with a reason specific to that export. A time policy without a '
      + 'bound commit path is exactly how arbitrary floats leaked into persisted configs.',
    ).toEqual([]);
  });

  it('keeps the coverage and exclusion lists pointing at exports that still exist', () => {
    const exported = new Set(Object.keys(timeGrid));
    const stale = [...Object.values(COVERAGE).flat(), ...Object.keys(EXCLUSIONS)].filter(
      (name) => !exported.has(name),
    );
    expect(stale, 'listed in COVERAGE/EXCLUSIONS but no longer exported').toEqual([]);
  });
});
