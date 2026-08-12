// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioTrack } from '@/tools/video-editor/compositions/AudioTrack';
import { secondsToFrames } from '@/tools/video-editor/lib/config-utils';
import type { ResolvedTimelineClip, TrackDefinition } from '@/tools/video-editor/types';

const sequenceProps: Array<Record<string, unknown>> = [];
const html5AudioProps: Array<Record<string, unknown>> = [];
const mediaAudioProps: Array<Record<string, unknown>> = [];

let currentEnvironment = {
  isRendering: false,
  isClientSideRendering: false,
};

vi.mock('remotion', async () => {
  const React = await import('react');

  return {
    Sequence: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      sequenceProps.push(props);
      return <div data-testid="sequence">{children}</div>;
    },
    Audio: (props: Record<string, unknown>) => {
      html5AudioProps.push(props);
      return <div data-testid="html5-audio" />;
    },
    useRemotionEnvironment: () => currentEnvironment,
  };
});

vi.mock('@remotion/media', () => ({
  Audio: (props: Record<string, unknown>) => {
    mediaAudioProps.push(props);
    return <div data-testid="media-audio" />;
  },
}));

vi.mock('@/tools/video-editor/compositions/MediaErrorBoundary', () => ({
  MediaErrorBoundary: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

const track: TrackDefinition = {
  id: 'A1',
  kind: 'audio',
  label: 'A1',
};

const clip: ResolvedTimelineClip = {
  id: 'clip-1',
  at: 2,
  track: 'A1',
  clipType: 'media',
  asset: 'asset-1',
  from: 1,
  to: 4,
  speed: 1,
  volume: 0.8,
  assetEntry: {
    file: 'audio.mp3',
    src: 'https://example.com/audio.mp3',
    type: 'audio/mpeg',
  },
};

describe('AudioTrack', () => {
  beforeEach(() => {
    sequenceProps.length = 0;
    html5AudioProps.length = 0;
    mediaAudioProps.length = 0;
    currentEnvironment = {
      isRendering: false,
      isClientSideRendering: false,
    };
  });

  it('premounts preview audio and keeps buffering non-blocking in the player', () => {
    render(<AudioTrack track={track} clips={[clip]} fps={30} />);

    expect(screen.getByTestId('html5-audio')).toBeInTheDocument();
    expect(sequenceProps[0]?.premountFor).toBe(30);
    expect(html5AudioProps[0]?.pauseWhenBuffering).toBe(false);
  });

  it('uses the media audio component while rendering', () => {
    currentEnvironment = {
      isRendering: true,
      isClientSideRendering: false,
    };

    render(<AudioTrack track={track} clips={[clip]} fps={24} />);

    expect(screen.getByTestId('media-audio')).toBeInTheDocument();
    expect(sequenceProps[0]?.premountFor).toBe(24);
    expect(mediaAudioProps[0]?.pauseWhenBuffering).toBe(false);
  });

  it('remounts the audio sequence when a clip moves mid-playback (keyed on at)', () => {
    const { rerender } = render(<AudioTrack track={track} clips={[clip]} fps={30} />);

    const firstSequenceNode = screen.getByTestId('sequence');
    const firstAudioMounters = html5AudioProps.length;

    const movedClip: ResolvedTimelineClip = { ...clip, at: 5 };
    rerender(<AudioTrack track={track} clips={[movedClip]} fps={30} />);

    // The Sequence key includes `at`, so a move remounts the subtree — the only
    // path that re-times Remotion audio during playback.
    expect(screen.getByTestId('sequence')).not.toBe(firstSequenceNode);
    expect(html5AudioProps.length).toBe(firstAudioMounters + 1);
    expect(sequenceProps.at(-1)?.from).toBe(secondsToFrames(5, 30));
  });
});
