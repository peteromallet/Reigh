import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import type { FC } from 'react';
import { getClipDurationInFrames, secondsToFrames } from '@/tools/video-editor/lib/config-utils.ts';
import type { ResolvedTimelineClip } from '@/tools/video-editor/types/index.ts';

/**
 * First-party implementation of Astrid's frozen `audio-reactive-colour/v1`
 * timeline contract. The effect is deliberately data-only: approved integer
 * frame markers select a full-frame colour, with no audio lookup in the
 * browser renderer.
 */
export type AudioReactiveColourEvent = {
  id?: string;
  frame: number;
  color: string;
};

export type AudioReactiveColourParams = {
  schemaVersion?: number;
  initialColor?: string;
  events?: AudioReactiveColourEvent[];
};

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_INITIAL_COLOR = '#000000';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
/**
 * Normalize browser-preview events exactly as Astrid does. Invalid entries
 * are ignored, valid entries are sorted by frame, and source order is an
 * explicit tie-breaker so duplicate-frame data remains deterministic on
 * runtimes whose Array#sort stability is not guaranteed by the host.
 */
export const normalizeAudioReactiveColourEvents = (
  value: unknown,
): readonly AudioReactiveColourEvent[] => {
  if (!Array.isArray(value)) return Object.freeze([]);

  const normalized = value
    .filter((event): event is AudioReactiveColourEvent => {
      if (!isRecord(event)) return false;
      return Number.isInteger(event.frame)
        && (event.frame as number) >= 1
        && typeof event.color === 'string'
        && HEX_COLOUR.test(event.color);
    })
    .map((event, sourceIndex) => ({
      event: Object.freeze({
        ...(typeof event.id === 'string' ? { id: event.id } : {}),
        frame: event.frame,
        color: event.color,
      }),
      sourceIndex,
    }))
    .sort((left, right) => left.event.frame - right.event.frame || left.sourceIndex - right.sourceIndex)
    .map(({ event }) => event);

  return Object.freeze(normalized);
};

/** Return the active marker colour at a clip-relative Remotion frame. */
export const activeAudioReactiveColour = (
  initialColor: string,
  events: readonly AudioReactiveColourEvent[],
  frame: number,
): string => {
  let low = 0;
  let high = events.length - 1;
  let active = initialColor;

  // Upper-bound binary search: an event exactly at `frame` is active. This
  // keeps the 566-marker Runaway fixture O(log n) per rendered frame.
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const event = events[middle];
    if (event.frame <= frame) {
      active = event.color;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return active;
};

export const normalizeAudioReactiveColourParams = (
  value: unknown,
): { initialColor: string; events: readonly AudioReactiveColourEvent[] } => {
  const params = isRecord(value) ? value : {};
  const initialColor = typeof params.initialColor === 'string' && HEX_COLOUR.test(params.initialColor)
    ? params.initialColor
    : DEFAULT_INITIAL_COLOR;
  return {
    initialColor,
    events: normalizeAudioReactiveColourEvents(params.events),
  };
};

/** Render the colour state at the current clip-relative Remotion frame. */
export const AudioReactiveColour: FC<{
  clipId?: string;
  params: unknown;
}> = ({ clipId, params }) => {
  const frame = useCurrentFrame();
  const normalized = normalizeAudioReactiveColourParams(params);
  const backgroundColor = activeAudioReactiveColour(normalized.initialColor, normalized.events, frame);

  return (
    <AbsoluteFill
      data-testid="audio-reactive-colour-renderer"
      data-clip-id={clipId}
      data-frame={frame}
      style={{ backgroundColor }}
    />
  );
};

/** Place the first-party renderer in a clip-relative Sequence for preview and export. */
export const AudioReactiveColourSequence: FC<{
  clip: ResolvedTimelineClip;
  fps: number;
}> = ({ clip, fps }) => (
  <Sequence
    key={clip.id}
    from={Math.max(0, secondsToFrames(clip.at, fps))}
    durationInFrames={getClipDurationInFrames(clip, fps)}
  >
    <AudioReactiveColour clipId={clip.id} params={clip.params} />
  </Sequence>
);
