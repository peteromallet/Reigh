import type { FC, ReactNode } from 'react';
import { Sequence, useCurrentFrame } from 'remotion';
import {
  continuousEffects,
  getEffectRegistry,
  lookupEffect,
  wrapWithEffect,
} from '../effects/index.js';
import { getClipDurationInFrames, secondsToFrames } from '../config-utils.js';
import type { ResolvedTimelineClip } from '../types.js';

interface EffectLayerSequenceProps {
  clip: ResolvedTimelineClip;
  fps: number;
  children: ReactNode;
}

export const EffectLayerSequence: FC<EffectLayerSequenceProps> = ({ clip, fps, children }) => {
  const frame = useCurrentFrame();
  const startFrame = Math.max(0, secondsToFrames(clip.at, fps));
  const durationInFrames = getClipDurationInFrames(clip, fps);

  if (!clip.continuous) {
    return <>{children}</>;
  }

  const Effect = lookupEffect(continuousEffects, clip.continuous.type);
  if (!Effect) {
    console.warn('[EffectLayer] effect NOT FOUND for clip=%s type=%s', clip.id, clip.continuous.type);
    return <>{children}</>;
  }

  if (frame < startFrame || frame >= startFrame + durationInFrames) {
    return <>{children}</>;
  }

  const inner = startFrame === 0 ? children : <Sequence from={-startFrame}>{children}</Sequence>;

  return (
    <Sequence from={startFrame} durationInFrames={durationInFrames}>
      {wrapWithEffect(
        inner,
        Effect,
        {
          effectName: clip.continuous.type,
          durationInFrames,
          effectFrames: durationInFrames,
          intensity: clip.continuous.intensity ?? 0.5,
          params: clip.continuous.params,
          schema: getEffectRegistry().getSchema(clip.continuous.type),
        },
      )}
    </Sequence>
  );
};
