// @vitest-environment jsdom
import React, { createRef } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RemotionPreview } from '@/tools/video-editor/components/PreviewPanel/RemotionPreview';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types';

const playerListeners = new Map<string, Set<(...args: any[]) => void>>();
const playerPropsHistory: Array<{ config: ResolvedTimelineConfig }> = [];
const playerHandles: Array<{ seekTo: ReturnType<typeof vi.fn>; getCurrentFrame: ReturnType<typeof vi.fn> }> = [];

vi.mock('@remotion/player', async () => {
  const React = await import('react');

  return {
    Player: React.forwardRef(function MockPlayer(
      props: { inputProps: { config: ResolvedTimelineConfig } },
      ref: React.Ref<unknown>,
    ) {
      playerPropsHistory.push({ config: props.inputProps.config });
      React.useImperativeHandle(ref, () => {
        const seekTo = vi.fn();
        const getCurrentFrame = vi.fn(() => 0);
        playerHandles.push({ seekTo, getCurrentFrame });
        return {
          addEventListener: (name: string, listener: (...args: unknown[]) => void) => {
            if (!playerListeners.has(name)) {
              playerListeners.set(name, new Set());
            }
            playerListeners.get(name)!.add(listener);
          },
          removeEventListener: (name: string, listener: (...args: unknown[]) => void) => {
            playerListeners.get(name)?.delete(listener);
          },
          seekTo,
          getCurrentFrame,
          play: vi.fn(),
          pause: vi.fn(),
          toggle: vi.fn(),
          isPlaying: vi.fn(() => false),
        };
      }, []);

      return <div data-testid="mock-player" />;
    }),
  };
});

function emitPlayerEvent(name: string, detail: unknown = undefined) {
  const listeners = playerListeners.get(name);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener({ detail });
  }
}

function makeConfig(label: string, hold = 1): ResolvedTimelineConfig {
  return {
    output: {
      fps: 30,
      resolution: '1280x720',
      file: `${label}.mp4`,
    },
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    clips: [{
      id: `clip-${label}`,
      at: 0,
      track: 'V1',
      clipType: 'hold',
      hold,
    }],
    registry: {},
  };
}

describe('RemotionPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playerListeners.clear();
    playerPropsHistory.length = 0;
    playerHandles.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies config updates live while playing', () => {
    const onTimeUpdate = vi.fn();
    const playerContainerRef = createRef<HTMLDivElement>();
    const initialConfig = makeConfig('initial');
    const nextConfig = makeConfig('next');

    const { rerender } = render(
      <RemotionPreview
        config={initialConfig}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(playerPropsHistory.at(-1)?.config).toBe(initialConfig);

    act(() => {
      emitPlayerEvent('play');
    });

    rerender(
      <RemotionPreview
        config={nextConfig}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    act(() => {
      // One animation frame (16ms) — a 150ms debounce would NOT have flushed yet,
      // so this pins the rAF-mailbox delivery, not just "eventually applies".
      vi.advanceTimersByTime(16);
    });

    // The edit reaches the Player on the next animation frame — no pause needed.
    expect(playerPropsHistory.at(-1)?.config).toBe(nextConfig);
  });

  it('coalesces rapid config updates while playing into one player update per frame', () => {
    const onTimeUpdate = vi.fn();
    const playerContainerRef = createRef<HTMLDivElement>();
    const configA = makeConfig('burst-a');
    const configB = makeConfig('burst-b');
    const configC = makeConfig('burst-c');

    const { rerender } = render(
      <RemotionPreview
        config={configA}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    act(() => {
      emitPlayerEvent('play');
    });

    rerender(
      <RemotionPreview
        config={configB}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );
    rerender(
      <RemotionPreview
        config={configC}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    const entriesBeforeFlush = playerPropsHistory.length;

    act(() => {
      // Exactly one animation frame: the burst coalesces into a single flush.
      // A debounce-style delivery would still be pending at 16ms.
      vi.advanceTimersByTime(16);
    });

    // One frame flush: only the last config of the burst reaches the Player.
    expect(playerPropsHistory.at(-1)?.config).toBe(configC);
    expect(playerPropsHistory.length).toBe(entriesBeforeFlush + 1);
  });

  it('parks the playhead on the last frame when a live edit shrinks the timeline during playback', () => {
    const onTimeUpdate = vi.fn();
    const playerContainerRef = createRef<HTMLDivElement>();
    const longConfig = makeConfig('long');
    const shortConfig = makeConfig('short', 0.5);

    const { rerender } = render(
      <RemotionPreview
        config={longConfig}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    act(() => {
      emitPlayerEvent('play');
    });

    const player = playerHandles.at(-1)!;
    player.getCurrentFrame.mockReturnValue(20);

    rerender(
      <RemotionPreview
        config={shortConfig}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    act(() => {
      vi.runAllTimers();
    });

    // 30-frame timeline shrinks to a 15-frame hold; the playhead at frame 20
    // parks on the new last frame instead of looping to the start.
    expect(player.seekTo).toHaveBeenLastCalledWith(14);
    expect(player.seekTo).not.toHaveBeenLastCalledWith(0);
  });

  it('still debounces config updates while paused', () => {
    const onTimeUpdate = vi.fn();
    const playerContainerRef = createRef<HTMLDivElement>();
    const configA = makeConfig('debounce-a');
    const configB = makeConfig('debounce-b');

    const { rerender } = render(
      <RemotionPreview
        config={configA}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    act(() => {
      vi.runAllTimers();
    });

    rerender(
      <RemotionPreview
        config={configB}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(149);
    });

    expect(playerPropsHistory.at(-1)?.config).toBe(configA);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(playerPropsHistory.at(-1)?.config).toBe(configB);
  });

  it('seeks the player when timeline playback context currentTime changes outside playback', () => {
    const onTimeUpdate = vi.fn();
    const playerContainerRef = createRef<HTMLDivElement>();
    const config = makeConfig('seek');

    const { rerender } = render(
      <RemotionPreview
        config={config}
        currentTime={0}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    expect(playerHandles.at(-1)?.seekTo).toHaveBeenLastCalledWith(0);

    rerender(
      <RemotionPreview
        config={config}
        currentTime={0.5}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    expect(playerHandles.at(-1)?.seekTo).toHaveBeenLastCalledWith(15);

    act(() => {
      emitPlayerEvent('play');
    });

    rerender(
      <RemotionPreview
        config={config}
        currentTime={0.75}
        onTimeUpdate={onTimeUpdate}
        playerContainerRef={playerContainerRef}
      />,
    );

    expect(playerHandles.at(-1)?.seekTo).not.toHaveBeenLastCalledWith(23);
  });
});
