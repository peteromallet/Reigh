import React from 'react';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const remotionState = vi.hoisted(() => ({
  frame: 0,
}));

vi.mock('remotion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('remotion')>();
  return {
    ...actual,
    useCurrentFrame: vi.fn(() => remotionState.frame),
  };
});

import { AudioAnalysisContext, SILENT_AUDIO_DATA, type AudioAnalysisData } from '../compositions/AudioAnalysisProvider';
import { useAudioParam, useAudioReactive } from './useAudioReactive';
import type { AudioBindingValue } from '@tbd/schema';

function createWrapper(frames: AudioAnalysisData[] | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(AudioAnalysisContext.Provider, { value: frames }, children);
  };
}

describe('useAudioReactive', () => {
  it('returns silent audio data outside a provider', () => {
    remotionState.frame = 0;

    const { result } = renderHook(() => useAudioReactive());

    expect(result.current).toEqual(SILENT_AUDIO_DATA);
  });

  it('returns the current frame audio data inside a provider', () => {
    remotionState.frame = 1;
    const frames: AudioAnalysisData[] = [
      {
        amplitude: 0.1,
        bass: 0.2,
        mid: 0.3,
        treble: 0.4,
        isBeat: false,
        frequencyBins: [0.1, 0.2],
      },
      {
        amplitude: 0.9,
        bass: 0.8,
        mid: 0.7,
        treble: 0.6,
        isBeat: true,
        frequencyBins: [0.9, 0.8],
      },
    ];

    const { result } = renderHook(() => useAudioReactive(), {
      wrapper: createWrapper(frames),
    });

    expect(result.current).toEqual(frames[1]);
  });

  it('maps audio bindings with plain arithmetic', () => {
    remotionState.frame = 0;
    const binding: AudioBindingValue = {
      source: 'bass',
      min: 2,
      max: 6,
    };
    const frames: AudioAnalysisData[] = [
      {
        amplitude: 0.4,
        bass: 0.25,
        mid: 0.1,
        treble: 0.05,
        isBeat: false,
        frequencyBins: [0.2, 0.1],
      },
    ];

    const { result } = renderHook(() => useAudioParam(binding), {
      wrapper: createWrapper(frames),
    });

    expect(result.current).toBe(3);
  });
});
