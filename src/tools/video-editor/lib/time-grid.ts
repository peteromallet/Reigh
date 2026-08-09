import type { TimelineClip, TimelineConfig } from '@/tools/video-editor/types/index.ts';

/**
 * Timeline-time ↔ frame semantics. **This module is the owner of that policy.**
 *
 * Seconds remain the stored truth — a timeline can change fps without every
 * clip time being meaningless, and external producers (agent, bridge, imports)
 * keep writing plain seconds. The rule this module adds: **every locally
 * committed edit snaps its timeline times (`at`, and durations via `end`) to
 * the frame grid of the timeline's current fps.**
 *
 * Why: the composition converts each quantity to frames independently
 * (`round(at·fps)`, `round(duration·fps)`), so two clips that abut *exactly in
 * seconds* are frame-contiguous only when both sit on the grid. With the
 * arbitrary floats the edit paths used to persist — the drag path's 2-decimal
 * rounding (0.01 s is a non-multiple of every common frame duration), the
 * resize path's raw pixel-derived times, keyboard nudges accumulating binary
 * dust — the fractional parts straddle .5 about a quarter of the time:
 * measured ~24% gap-or-overlap at cuts (one black or double-exposed frame)
 * across drag/pixel/nudge populations at 24/25/30/60 fps. Snapping at the
 * commit choke points makes `round(at_B·fps) === round(at_A·fps) +
 * round(dur_A·fps)` hold by construction and the whole drift class disappears
 * at the source instead of being papered over in the renderer.
 *
 * Consumers (the bindings live in `lib/time-grid-conformance.test.ts`):
 * - `rowsToConfig` (`lib/timeline-data.ts`) — the single funnel every
 *   `'rows'` edit passes through (drag, resize, nudge, delete, drop).
 * - `buildConfigFromDragResult` (`lib/multi-drag-utils.ts`) — the drag
 *   commit's `'config'`-shaped path (new-track drops).
 * - `useClipResize` — snaps pixel-derived start/end before deriving
 *   `from`/`to`/`speed`, so media trim math starts from grid instants.
 * - `getClipDurationInFrames` (`lib/config-utils.ts`) — media clips derive
 *   `durationInFrames` from the trim window via `mediaDurationInFrames`.
 *
 * Deliberately **not** snapped: remote/accepted data (poll acceptance,
 * conflict reloads, agent `'config'` mutations). Remote data is only
 * frame-consistent if the producing client snapped it; blanket-snapping every
 * commit would rewrite accepted server state and fight the sync layer
 * (signature churn, phantom conflicts). Locally-produced edits are the safe
 * and sufficient population — anything a gesture touches lands on the grid.
 */

/** True when `fps` can define a frame grid. Guards keep bad output configs inert. */
const isUsableFps = (fps: number): boolean => Number.isFinite(fps) && fps > 0;

/** Timeline seconds → nearest frame index. The composition's own conversion. */
export const secondsToFrames = (seconds: number, fps: number): number => {
  return Math.round(seconds * fps);
};

/** Frame index → timeline seconds (exact grid instant, up to float precision). */
export const framesToSeconds = (frames: number, fps: number): number => {
  return isUsableFps(fps) ? frames / fps : frames;
};

/**
 * Snap a timeline time to the nearest frame instant of `fps`.
 *
 * Identity for values already on the grid; identity for unusable fps so a
 * malformed output config can never corrupt times. The result is within float
 * precision of `k / fps`, which `secondsToFrames` recovers exactly — 4-decimal
 * serialization (see `roundTimelineTime` in `timeline-data.ts`) keeps the
 * recovery exact too, since 5e-5 · fps ≪ 0.5 for any real fps.
 */
export const snapToFrameGrid = (seconds: number, fps: number): number => {
  if (!isUsableFps(fps) || !Number.isFinite(seconds)) {
    return seconds;
  }
  return Math.round(seconds * fps) / fps;
};

/**
 * Sequence duration (in frames) for a media clip, derived from its **trim
 * window** — the same rounded window `getSanitizedMediaTrimProps` hands to
 * `<Video trimBefore/trimAfter>`.
 *
 * Why not `round(((to−from)/speed)·fps)`: that rounds a *different* quantity
 * than the trim window the player cuts at, and whenever
 * `round(dur·fps) > round(to·fps) − round(from·fps)` the clip's final frame
 * asks for source material past the cutoff — `@remotion/media` returns
 * `frame: null` and the frame renders blank. Measured at 8–9% of trimmed
 * clips. Deriving the duration from the already-rounded window kills the
 * mismatch by construction: `round(W/speed) − 1 < W/speed` always, so the
 * last frame's source time stays inside the window for every speed.
 *
 * Trade-off, made deliberately: at fractional speeds the window's integer
 * granularity cannot represent every timeline duration, so a speed-changed
 * clip's Sequence can differ from its seconds-derived duration by one frame.
 * The window is authoritative — ending a retimed clip one frame early beats
 * rendering a frame that has no source material. At `speed: 1` (every clip a
 * drag/nudge/trim produces without an explicit speed edit) the two formulas
 * agree exactly once `at`/`end` sit on the grid, so abutting clips stay
 * frame-contiguous.
 */
export const mediaDurationInFrames = ({
  from,
  to,
  speed,
  fps,
}: {
  from: number;
  to: number;
  speed: number;
  fps: number;
}): number => {
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const windowFrames = secondsToFrames(to, fps) - secondsToFrames(Math.max(0, from), fps);
  return Math.max(1, Math.round(windowFrames / rate));
};

const isHoldTimed = (clip: TimelineClip): boolean => typeof clip.hold === 'number' && Number.isFinite(clip.hold);

const hasTrimWindow = (clip: TimelineClip): boolean => (
  typeof clip.from === 'number'
  && Number.isFinite(clip.from)
  && typeof clip.to === 'number'
  && Number.isFinite(clip.to)
  && clip.to > Math.max(0, clip.from)
);

/**
 * Re-quantize a whole config onto the frame grid of `fps` (and stamp
 * `output.fps`). Pure — returns a new config, never mutates.
 *
 * **Callers must treat this as a migration**, not a convenience: it rewrites
 * every clip's persisted `at`/`hold`/`to`, so it belongs at an explicit
 * fps-change boundary (one commit, one undo entry, one save) — never inside a
 * render path or a hot loop. Nothing calls it yet; it exists so a future
 * "change timeline fps" feature re-quantizes geometry through the same policy
 * the edit paths use, instead of growing a second formula.
 *
 * Media clips keep `from` and `speed` (source in-point and rate are not
 * timeline geometry); `to` is re-derived from the snapped timeline duration so
 * the trim window keeps matching what the composition shows.
 */
export const resnapTimelineToFps = (config: TimelineConfig, fps: number): TimelineConfig => {
  if (!isUsableFps(fps)) {
    return config;
  }

  return {
    ...config,
    output: { ...config.output, fps },
    clips: config.clips.map((clip) => {
      const at = snapToFrameGrid(clip.at, fps);

      if (isHoldTimed(clip)) {
        const holdFrames = Math.max(1, secondsToFrames(clip.hold as number, fps));
        return { ...clip, at, hold: framesToSeconds(holdFrames, fps) };
      }

      if (hasTrimWindow(clip)) {
        const from = clip.from as number;
        const to = clip.to as number;
        const rate = Number.isFinite(clip.speed) && (clip.speed as number) > 0 ? clip.speed as number : 1;
        const durationFrames = Math.max(1, secondsToFrames((to - from) / rate, fps));
        return { ...clip, at, to: from + framesToSeconds(durationFrames, fps) * rate };
      }

      return { ...clip, at };
    }),
  };
};
