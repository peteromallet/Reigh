import type { FC, ReactNode } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export type EffectComponentProps = {
  children: ReactNode;
  durationInFrames: number;
  effectFrames?: number;
  intensity?: number;
  params?: Record<string, unknown>;
};

const getNormalizedProgress = (frame: number, durationInFrames: number): number => {
  return interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};

const withTransform = (transform: string, opacity = 1): React.CSSProperties => ({
  width: '100%',
  height: '100%',
  transform,
  opacity,
});

export const SlideUpEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame, fps, durationInFrames: effectFrames, config: { damping: 14, stiffness: 120 } });
  const translateY = interpolate(progress, [0, 1], [80, 0]);
  return <AbsoluteFill style={withTransform(`translateY(${translateY}px)`, progress)}>{children}</AbsoluteFill>;
};

export const SlideDownEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const progress = getNormalizedProgress(frame, effectFrames ?? 18);
  const translateY = interpolate(progress, [0, 1], [-80, 0]);
  return <AbsoluteFill style={withTransform(`translateY(${translateY}px)`, progress)}>{children}</AbsoluteFill>;
};

export const SlideLeftEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const progress = getNormalizedProgress(frame, effectFrames ?? 18);
  const translateX = interpolate(progress, [0, 1], [180, 0]);
  return <AbsoluteFill style={withTransform(`translateX(${translateX}px)`, progress)}>{children}</AbsoluteFill>;
};

export const SlideRightEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const progress = getNormalizedProgress(frame, effectFrames ?? 18);
  const translateX = interpolate(progress, [0, 1], [-180, 0]);
  return <AbsoluteFill style={withTransform(`translateX(${translateX}px)`, progress)}>{children}</AbsoluteFill>;
};

export const ZoomInEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const progress = getNormalizedProgress(frame, effectFrames ?? 16);
  const scale = interpolate(progress, [0, 1], [0.75, 1]);
  return <AbsoluteFill style={withTransform(`scale(${scale})`, progress)}>{children}</AbsoluteFill>;
};

export const ZoomSpinEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const progress = getNormalizedProgress(frame, effectFrames ?? 20);
  const scale = interpolate(progress, [0, 1], [0.35, 1]);
  const rotate = interpolate(progress, [0, 1], [-10, 0]);
  return <AbsoluteFill style={withTransform(`scale(${scale}) rotate(${rotate}deg)`, progress)}>{children}</AbsoluteFill>;
};

export const PulseEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const progress = getNormalizedProgress(frame, effectFrames ?? 14);
  const scale = interpolate(progress, [0, 0.6, 1], [1.12, 0.95, 1]);
  return <AbsoluteFill style={withTransform(`scale(${scale})`, progress)}>{children}</AbsoluteFill>;
};

export const FadeEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const progress = getNormalizedProgress(frame, effectFrames ?? 12);
  return <AbsoluteFill style={withTransform('none', progress)}>{children}</AbsoluteFill>;
};

export const FlipEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const progress = getNormalizedProgress(frame, effectFrames ?? 18);
  const rotateY = interpolate(progress, [0, 1], [-90, 0]);
  return (
    <AbsoluteFill style={{ perspective: 1000 }}>
      <AbsoluteFill style={withTransform(`rotateY(${rotateY}deg)`, progress)}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

export const BounceEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const progress = getNormalizedProgress(frame, effectFrames ?? 20);
  const translateY = interpolate(progress, [0, 0.6, 0.8, 1], [120, -20, 10, 0]);
  return <AbsoluteFill style={withTransform(`translateY(${translateY}px)`, progress)}>{children}</AbsoluteFill>;
};

export const MeteoriteEntrance: FC<EffectComponentProps> = ({ children, effectFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = effectFrames ?? 24;

  const approach = interpolate(frame, [0, dur * 0.35], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const impact = spring({ frame: Math.max(0, frame - dur * 0.35), fps, durationInFrames: dur * 0.65, config: { damping: 8, stiffness: 250, mass: 0.6 } });
  const phase = approach < 1 ? approach : 1;
  const settled = approach >= 1 ? impact : 0;

  const translateX = interpolate(phase, [0, 1], [600, 0]);
  const translateY = interpolate(phase, [0, 1], [-500, 0]);
  const rotate = interpolate(phase, [0, 1], [-35, 0]);
  const preImpactScale = interpolate(phase, [0, 1], [0.15, 1]);

  const bounceScale = settled > 0 ? interpolate(settled, [0, 1], [1.2, 1]) : 1;
  const finalScale = preImpactScale * bounceScale;

  const shakeIntensity = interpolate(settled, [0, 0.15, 0.5, 1], [0, 12, 4, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shakeX = shakeIntensity * Math.sin(frame * 47);
  const shakeY = shakeIntensity * Math.cos(frame * 31);

  const flashOpacity = interpolate(settled, [0, 0.08, 0.3], [0, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const glowSize = interpolate(settled, [0, 0.5], [20, 80], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const glowOpacity = interpolate(settled, [0, 0.1, 0.6], [0, 0.7, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const brightness = interpolate(settled, [0, 0.1, 0.4], [1, 1.8, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = interpolate(phase, [0, 0.15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ transform: `translate(${shakeX}px, ${shakeY}px)` }}>
      <AbsoluteFill
        style={{
          background: `rgba(255, 240, 200, ${flashOpacity})`,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, rgba(255, 160, 40, ${glowOpacity}) 0%, rgba(255, 100, 20, ${glowOpacity * 0.5}) ${glowSize * 0.5}%, transparent ${glowSize}%)`,
          pointerEvents: 'none',
          zIndex: 5,
        }}
      />
      <AbsoluteFill
        style={{
          transform: `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg) scale(${finalScale})`,
          opacity,
          filter: `brightness(${brightness})`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
