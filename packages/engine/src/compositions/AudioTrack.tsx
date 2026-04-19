import { memo, type FC } from 'react';
import { Audio as Html5Audio, Sequence, useRemotionEnvironment } from 'remotion';
import { Audio as MediaAudio } from '@remotion/media';
import {
  getClipDurationInFrames,
  getSanitizedMediaSrc,
  getSanitizedMediaTrimProps,
  getSanitizedPlaybackRate,
  getSanitizedVolume,
  secondsToFrames,
} from '../config-utils.js';
import { MediaErrorBoundary } from './MediaErrorBoundary.js';
import type { ResolvedTimelineClip } from '../types.js';
import type { TrackDefinition } from '@tbd/schema';

const AudioTrackComponent: FC<{
  track: TrackDefinition;
  clips: ResolvedTimelineClip[];
  fps: number;
}> = ({ track, clips, fps }) => {
  const environment = useRemotionEnvironment();
  const AudioComponent = environment.isRendering || environment.isClientSideRendering
    ? MediaAudio
    : Html5Audio;

  return (
    <>
      {clips.map((clip) => {
        const mediaSrc = getSanitizedMediaSrc(clip.assetEntry?.src);
        const effectiveVolume = track.muted ? 0 : getSanitizedVolume(track.volume) * getSanitizedVolume(clip.volume);
        const playbackRate = getSanitizedPlaybackRate(clip.speed);
        const trimProps = getSanitizedMediaTrimProps(clip, fps);

        return (
          <Sequence
            key={`${clip.id}-${clip.at}-${clip.from ?? 0}-${clip.to ?? ''}-${clip.speed ?? 1}`}
            from={secondsToFrames(clip.at, fps)}
            durationInFrames={getClipDurationInFrames(clip, fps)}
            premountFor={fps}
          >
            {mediaSrc ? (
              <MediaErrorBoundary
                clipId={clip.id}
                resetKey={`${clip.id}:${mediaSrc}:${trimProps.trimBefore}:${trimProps.trimAfter ?? 'none'}:${playbackRate}:${effectiveVolume}:audio`}
                fallback={null}
              >
                <AudioComponent
                  src={mediaSrc}
                  trimBefore={trimProps.trimBefore}
                  trimAfter={trimProps.trimAfter}
                  playbackRate={playbackRate}
                  volume={effectiveVolume}
                  pauseWhenBuffering={false}
                />
              </MediaErrorBoundary>
            ) : null}
          </Sequence>
        );
      })}
    </>
  );
};

export const AudioTrack = memo(AudioTrackComponent);
AudioTrack.displayName = 'AudioTrack';
