import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const remotionMocks = vi.hoisted(() => ({
  delayRender: vi.fn(() => 101),
  continueRender: vi.fn(),
  cancelRender: vi.fn(),
}));

vi.mock('remotion', () => ({
  delayRender: remotionMocks.delayRender,
  continueRender: remotionMocks.continueRender,
  cancelRender: remotionMocks.cancelRender,
}));

import {
  AudioAnalysisProvider,
  useAudioAnalysisContext,
} from './AudioAnalysisProvider';
import type { ResolvedTimelineClip } from '../types';

type MockAudioBuffer = AudioBuffer;

function createMockAudioBuffer(
  samples: Float32Array,
  sampleRate = 44_100,
): MockAudioBuffer {
  return {
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => samples,
  } as unknown as MockAudioBuffer;
}

function createFrameSineSamples({
  fps,
  frameAmplitudes,
  frequency = 100,
  sampleRate = 44_100,
}: {
  fps: number;
  frameAmplitudes: number[];
  frequency?: number;
  sampleRate?: number;
}): Float32Array {
  const samplesPerFrame = Math.floor(sampleRate / fps);
  const samples = new Float32Array(samplesPerFrame * frameAmplitudes.length);

  frameAmplitudes.forEach((amplitude, frameIndex) => {
    const frameOffset = frameIndex * samplesPerFrame;
    for (let index = 0; index < samplesPerFrame; index += 1) {
      const time = index / sampleRate;
      samples[frameOffset + index] = amplitude * Math.sin(2 * Math.PI * frequency * time);
    }
  });

  return samples;
}

class MockOfflineAudioContext {
  static decodedBuffer: MockAudioBuffer;

  static renderedBuffer: MockAudioBuffer;

  destination = {};

  createBufferSource() {
    return {
      buffer: null as AudioBuffer | null,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      start: vi.fn(),
    };
  }

  createGain() {
    return {
      gain: { value: 1 },
      connect: vi.fn(),
    };
  }

  async decodeAudioData(_buffer: ArrayBuffer) {
    return MockOfflineAudioContext.decodedBuffer;
  }

  async startRendering() {
    return MockOfflineAudioContext.renderedBuffer;
  }
}

function AnalysisSummary() {
  const frames = useAudioAnalysisContext();
  const summary = {
    length: frames?.length ?? 0,
    first: frames?.[0]
      ? {
        amplitude: frames[0].amplitude,
        bass: frames[0].bass,
        treble: frames[0].treble,
        isBeat: frames[0].isBeat,
      }
      : null,
    second: frames?.[1]
      ? {
        amplitude: frames[1].amplitude,
        bass: frames[1].bass,
        treble: frames[1].treble,
        isBeat: frames[1].isBeat,
      }
      : null,
    beatFrames: frames?.map((frame, index) => (frame.isBeat ? index : -1)).filter((index) => index >= 0) ?? [],
  };

  return <pre data-testid="analysis">{JSON.stringify(summary)}</pre>;
}

function parseSummary() {
  return JSON.parse(screen.getByTestId('analysis').textContent ?? '{}') as {
    length: number;
    first: { amplitude: number; bass: number; treble: number; isBeat: boolean } | null;
    second: { amplitude: number; bass: number; treble: number; isBeat: boolean } | null;
    beatFrames: number[];
  };
}

function createAudioClip(durationSeconds: number): ResolvedTimelineClip {
  return {
    id: 'audio-clip',
    at: 0,
    track: 'A1',
    asset: 'asset-1',
    from: 0,
    to: durationSeconds,
    speed: 1,
    volume: 1,
    assetEntry: {
      file: 'audio.wav',
      src: 'https://example.com/audio.wav',
      duration: durationSeconds,
      type: 'audio/wav',
    },
  };
}

describe('AudioAnalysisProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('provides silent data and continues render immediately when there are no clips', async () => {
    render(
      <AudioAnalysisProvider clips={[]} fps={30} totalDurationInFrames={3}>
        <AnalysisSummary />
      </AudioAnalysisProvider>,
    );

    const summary = parseSummary();

    expect(summary.length).toBe(3);
    expect(summary.first).toEqual({
      amplitude: 0,
      bass: 0,
      treble: 0,
      isBeat: false,
    });
    expect(remotionMocks.delayRender).toHaveBeenCalledWith('Audio analysis');
    expect(remotionMocks.continueRender).toHaveBeenCalledWith(101);
    expect(remotionMocks.cancelRender).not.toHaveBeenCalled();
  });

  it('analyzes a rendered audio buffer into frame-indexed data with beat detection', async () => {
    const fps = 10;
    const amplitudes = [0, 0.1, 1, 0.1, 0.1, 0.1, 1, 0.1, 0.1, 0.1, 1, 0.1];
    const renderedBuffer = createMockAudioBuffer(createFrameSineSamples({
      fps,
      frameAmplitudes: amplitudes,
    }));

    MockOfflineAudioContext.decodedBuffer = renderedBuffer;
    MockOfflineAudioContext.renderedBuffer = renderedBuffer;

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })));
    vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext);

    render(
      <AudioAnalysisProvider clips={[createAudioClip(amplitudes.length / fps)]} fps={fps} totalDurationInFrames={amplitudes.length}>
        <AnalysisSummary />
      </AudioAnalysisProvider>,
    );

    await waitFor(() => {
      const summary = parseSummary();
      expect(summary.second?.amplitude ?? 0).toBeGreaterThan(0.05);
    });

    const summary = parseSummary();
    expect(summary.length).toBe(amplitudes.length);
    expect(summary.first?.amplitude ?? 1).toBeLessThan(0.01);
    expect(summary.second?.bass ?? 0).toBeGreaterThan(summary.second?.treble ?? 0);
    expect(summary.beatFrames.length).toBeGreaterThan(0);
    expect(summary.beatFrames).toContain(2);
    expect(remotionMocks.continueRender).toHaveBeenCalledWith(101);
    expect(remotionMocks.cancelRender).not.toHaveBeenCalled();
  });

  it('continues render on unmount while analysis is still pending and never cancels render', () => {
    class PendingOfflineAudioContext extends MockOfflineAudioContext {
      override async startRendering() {
        return await new Promise<MockAudioBuffer>(() => {});
      }
    }

    MockOfflineAudioContext.decodedBuffer = createMockAudioBuffer(createFrameSineSamples({
      fps: 10,
      frameAmplitudes: [1, 1, 1],
    }));

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })));
    vi.stubGlobal('OfflineAudioContext', PendingOfflineAudioContext);

    const view = render(
      <AudioAnalysisProvider clips={[createAudioClip(0.3)]} fps={10} totalDurationInFrames={3}>
        <AnalysisSummary />
      </AudioAnalysisProvider>,
    );

    view.unmount();

    expect(remotionMocks.continueRender).toHaveBeenCalledWith(101);
    expect(remotionMocks.cancelRender).not.toHaveBeenCalled();
  });
});
