import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { TimelineRenderer, getClipDurationInFrames, parseResolution, secondsToFrames, type ResolvedTimelineConfig } from '@tbd/engine';

export interface PreviewHandle {
  seek: (time: number) => void;
  play: () => void;
  pause: () => void;
}

export interface RemotionPreviewProps {
  config: ResolvedTimelineConfig;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
}

export const RemotionPreview = forwardRef<PreviewHandle, RemotionPreviewProps>(function RemotionPreview(
  { config, currentTime, onTimeUpdate },
  ref,
) {
  const playerRef = useRef<PlayerRef>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const metadata = useMemo(() => {
    const { width, height } = parseResolution(config.output.resolution);
    return {
      fps: config.output.fps,
      width,
      height,
      durationInFrames: Math.max(
        1,
        ...config.clips.map((clip) => secondsToFrames(clip.at, config.output.fps) + getClipDurationInFrames(clip, config.output.fps)),
      ),
    };
  }, [config]);

  useImperativeHandle(ref, () => ({
    seek(time: number) {
      playerRef.current?.seekTo(Math.round(time * metadata.fps));
    },
    play() {
      playerRef.current?.play();
    },
    pause() {
      playerRef.current?.pause();
    },
  }), [metadata.fps]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Player
        ref={playerRef}
        component={TimelineRenderer}
        inputProps={{ config }}
        durationInFrames={metadata.durationInFrames}
        fps={metadata.fps}
        compositionWidth={metadata.width}
        compositionHeight={metadata.height}
        initialFrame={Math.round(currentTime * metadata.fps)}
        controls={false}
        clickToPlay={false}
        acknowledgeRemotionLicense
        style={{ width: '100%', aspectRatio: `${metadata.width} / ${metadata.height}`, background: '#111' }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={() => playerRef.current?.seekTo(0)}>Start</button>
        <button
          type="button"
          onClick={() => {
            playerRef.current?.toggle();
            setIsPlaying((value) => !value);
          }}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => onTimeUpdate(playerRef.current?.getCurrentFrame() ? playerRef.current!.getCurrentFrame() / metadata.fps : 0)}>
          Sync
        </button>
      </div>
    </div>
  );
});
