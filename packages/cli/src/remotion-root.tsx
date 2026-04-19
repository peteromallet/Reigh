import React from 'react';
import { Composition, getInputProps, registerRoot } from 'remotion';
import { TimelineRenderer, getTimelineDurationInFrames, parseResolution, type ResolvedTimelineConfig, type TimelineCompositionProps } from '@tbd/engine';

const Root = () => {
  const { config } = getInputProps<TimelineCompositionProps>();
  const fallback = config ?? {
    output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
    tracks: [],
    clips: [],
    registry: {},
  } satisfies ResolvedTimelineConfig;
  const { width, height } = parseResolution(fallback.output.resolution);

  return (
    <Composition
      id="timeline"
      component={TimelineRenderer}
      durationInFrames={Math.max(1, getTimelineDurationInFrames(fallback, fallback.output.fps))}
      fps={fallback.output.fps}
      width={width}
      height={height}
      defaultProps={{ config: fallback }}
      calculateMetadata={({ props }) => {
        const next = (props as TimelineCompositionProps).config ?? fallback;
        const size = parseResolution(next.output.resolution);
        return {
          fps: next.output.fps,
          durationInFrames: Math.max(1, getTimelineDurationInFrames(next, next.output.fps)),
          width: size.width,
          height: size.height,
          props,
        };
      }}
    />
  );
};

registerRoot(Root);
