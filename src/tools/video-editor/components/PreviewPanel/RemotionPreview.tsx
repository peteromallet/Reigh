import type { RefObject } from 'react';
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import { Player, type PlayerRef } from '@remotion/player';
import { Button } from '@/shared/components/ui/button.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { TimelineRenderer } from '@/tools/video-editor/compositions/TimelineRenderer.tsx';
import { useEffectDiagnostic, useRenderDiagnostic } from '@/tools/video-editor/hooks/usePerfDiagnostics.ts';
import { getClipDurationInFrames, parseResolution, secondsToFrames } from '@/tools/video-editor/lib/config-utils.ts';
import { VIDEO_EDITOR_THEME_VARS } from '@/tools/video-editor/lib/themeTokens.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';

export interface PreviewHandle {
  seek: (time: number) => void;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  readonly isPlaying: boolean;
}

const TRANSPORT_BUTTON_CLASS = 'pointer-events-auto rounded-full border-[color:var(--video-editor-stage-control-border)] bg-[var(--video-editor-stage-control-bg)] text-[color:var(--video-editor-stage-fg)] hover:bg-[var(--video-editor-stage-control-bg-hover)]';

interface RemotionPreviewProps {
  config: ResolvedTimelineConfig;
  onTimeUpdate: (time: number) => void;
  playerContainerRef: RefObject<HTMLDivElement>;
  compact?: boolean;
  /** Phone/tablet chrome: transport controls grow to touch-sized hit targets. */
  touchChrome?: boolean;
  initialTime?: number;
  currentTime?: number;
}

const RemotionPreviewComponent = forwardRef<PreviewHandle, RemotionPreviewProps>(function RemotionPreview(
  { config, onTimeUpdate, playerContainerRef, compact = false, touchChrome = false, initialTime = 0, currentTime },
  ref,
) {
  const playerRef = useRef<PlayerRef>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  useRenderDiagnostic('RemotionPreview');
  const markEventsEffect = useEffectDiagnostic('remotionPreview:events');
  // Throttle config updates to the Player to avoid stutter during drag operations.
  // The timeline canvas shows immediate visual feedback; the Player catches up after 150ms idle.
  const [deferredConfig, setDeferredConfig] = useState(config);
  const deferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live-edit mailbox: while playing, timeline edits must reach the Player on
  // the next animation frame (live media updates, no pause+restart), but no
  // more than once per frame so rapid commits can't cause renderer jank.
  const latestConfigRef = useRef<ResolvedTimelineConfig | null>(null);
  const rafRef = useRef<number | null>(null);
  const flushDeferredConfig = (nextConfig: ResolvedTimelineConfig, delayMs: number) => {
    // Guard is load-bearing: it narrows `Timeout | null` away (this lib mix
    // rejects null) and resets the ref so a stale timer can't double-fire.
    if (deferTimerRef.current) {
      clearTimeout(deferTimerRef.current);
      deferTimerRef.current = null;
    }
    if (delayMs <= 0) {
      setDeferredConfig(nextConfig);
      return;
    }
    deferTimerRef.current = setTimeout(() => setDeferredConfig(nextConfig), delayMs);
  };

  useEffect(() => {
    if (isPlaying) {
      latestConfigRef.current = config;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const nextConfig = latestConfigRef.current;
          latestConfigRef.current = null;
          if (nextConfig) {
            setDeferredConfig(nextConfig);
          }
        });
      }
    } else {
      // Paused: flush any in-flight live update immediately, then debounce idle edits.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const nextConfig = latestConfigRef.current ?? config;
      const delayMs = latestConfigRef.current ? 0 : 150;
      latestConfigRef.current = null;
      flushDeferredConfig(nextConfig, delayMs);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (deferTimerRef.current) {
        clearTimeout(deferTimerRef.current);
        deferTimerRef.current = null;
      }
    };
  }, [config, isPlaying]);

  const inputProps = useMemo(() => ({ config: deferredConfig }), [deferredConfig]);
  const metadata = useMemo(() => {
    const fps = deferredConfig.output.fps;
    const { width, height } = parseResolution(deferredConfig.output.resolution);

    return {
      fps,
      durationInFrames: Math.max(
        1,
        ...deferredConfig.clips.map((clip) => secondsToFrames(clip.at, fps) + getClipDurationInFrames(clip, fps)),
      ),
      compositionWidth: Math.max(1, width),
      compositionHeight: Math.max(1, height),
    };
  }, [deferredConfig.clips, deferredConfig.output.fps, deferredConfig.output.resolution]);

  // Live edits can shrink the timeline mid-playback; park the playhead on the
  // last frame instead of running past (or looping past) the new end.
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const player = playerRef.current;
    if (player && player.getCurrentFrame() >= metadata.durationInFrames) {
      player.seekTo(Math.max(0, metadata.durationInFrames - 1));
    }
  }, [isPlaying, metadata.durationInFrames]);

  useEffect(() => {
    markEventsEffect();
    const player = playerRef.current;
    if (!player) {
      return;
    }

    const onFrameUpdate = (event: { detail: { frame: number } }) => {
      onTimeUpdate(event.detail.frame / metadata.fps);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    player.addEventListener('frameupdate', onFrameUpdate);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);

    return () => {
      player.removeEventListener('frameupdate', onFrameUpdate);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
    };
  }, [markEventsEffect, metadata.fps, onTimeUpdate]);

  useImperativeHandle(ref, () => ({
    seek(time: number) {
      playerRef.current?.seekTo(Math.max(0, Math.round(time * metadata.fps)));
    },
    play() {
      playerRef.current?.play();
    },
    pause() {
      playerRef.current?.pause();
    },
    togglePlayPause() {
      playerRef.current?.toggle();
    },
    get isPlaying() {
      return playerRef.current?.isPlaying() ?? isPlaying;
    },
  }), [isPlaying, metadata.fps]);

  useEffect(() => {
    if (isPlaying || currentTime === undefined) {
      return;
    }

    playerRef.current?.seekTo(Math.min(
      Math.max(0, Math.round(currentTime * metadata.fps)),
      Math.max(0, metadata.durationInFrames - 1),
    ));
  }, [currentTime, isPlaying, metadata.durationInFrames, metadata.fps]);

  return (
    <div
      ref={playerContainerRef}
      className="relative flex h-full min-h-[220px] w-full items-center justify-center overflow-hidden rounded-xl bg-background"
      style={VIDEO_EDITOR_THEME_VARS}
    >
      <Player
        ref={playerRef}
        component={TimelineRenderer}
        inputProps={inputProps}
        durationInFrames={metadata.durationInFrames}
        fps={metadata.fps}
        compositionWidth={metadata.compositionWidth}
        compositionHeight={metadata.compositionHeight}
        initialFrame={Math.min(Math.max(0, Math.round(initialTime * metadata.fps)), Math.max(0, metadata.durationInFrames - 1))}
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        showVolumeControls={false}
        acknowledgeRemotionLicense
        bufferStateDelayInMilliseconds={1000}
        renderLoading={() => (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--video-editor-stage-bg)',
              color: 'var(--video-editor-stage-fg-subtle)',
              fontSize: 13,
              fontFamily: 'monospace',
            }}
          >
            Loading preview…
          </div>
        )}
        style={{ width: '100%', height: '100%' }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 px-3 py-3"
        style={{ backgroundImage: 'linear-gradient(to top, var(--video-editor-stage-gradient-start), transparent)' }}
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(TRANSPORT_BUTTON_CLASS, touchChrome ? 'h-11 w-11' : 'h-8 w-8')}
          onClick={() => playerRef.current?.seekTo(0)}
          title="Jump to beginning"
          aria-label="Jump to beginning"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(TRANSPORT_BUTTON_CLASS, touchChrome ? 'h-12 w-12' : 'h-10 w-10')}
          onClick={() => playerRef.current?.toggle()}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
        </Button>
        {!compact && (
          <div className="pointer-events-none rounded-full bg-background/70 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {config.output.resolution}
          </div>
        )}
      </div>
    </div>
  );
});

RemotionPreviewComponent.displayName = 'RemotionPreview';

export const RemotionPreview = memo(RemotionPreviewComponent);
