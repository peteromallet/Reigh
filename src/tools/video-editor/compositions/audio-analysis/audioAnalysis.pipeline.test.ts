import { describe, expect, it } from 'vitest';
import {
  analyzeMixedBuffer,
  getBandAverage,
  getFrameWindow,
  runFft,
  toMonoSamples,
} from './audioAnalysis.pipeline.ts';
import {
  AUDIO_HALF_FFT_SIZE,
  AudioAnalysisCancelledError,
  type PackedAudioAnalysis,
} from './audioAnalysis.protocol.ts';

const SAMPLE_RATE = 44_100;
const FPS = 10;
const AMPLITUDES = [0, 0.1, 1, 0.1, 0.1, 0.1, 1, 0.1, 0.1, 0.1, 1, 0.1];

function createFrameSineSamples(
  frameAmplitudes: number[],
  frequency = 100,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const samplesPerFrame = Math.floor(sampleRate / FPS);
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

function analyzeFixture(): PackedAudioAnalysis {
  return analyzeMixedBuffer(
    [createFrameSineSamples(AMPLITUDES)],
    SAMPLE_RATE,
    FPS,
    AMPLITUDES.length,
  );
}

describe('analyzeMixedBuffer (packed worker pipeline)', () => {
  it('matches the sine/beat fixture amplitudes within float tolerance', () => {
    const packed = analyzeFixture();

    expect(packed.frameCount).toBe(AMPLITUDES.length);
    expect(packed.binsPerFrame).toBe(AUDIO_HALF_FFT_SIZE);
    expect(packed.amplitude).toHaveLength(AMPLITUDES.length);

    const expectedAmplitudes = AMPLITUDES.map((amplitude) => amplitude / Math.sqrt(2));
    expectedAmplitudes.forEach((expected, frame) => {
      expect(Math.abs((packed.amplitude[frame] ?? 0) - expected)).toBeLessThan(1e-2);
    });
  });

  it('detects beats at the fixture peak frames and keeps low bands dominant for a 100 Hz sine', () => {
    const packed = analyzeFixture();

    const beatFrames: number[] = [];
    for (let frame = 0; frame < packed.frameCount; frame += 1) {
      if ((packed.beats[frame] ?? 0) !== 0) {
        beatFrames.push(frame);
      }
    }
    expect(beatFrames).toEqual([2, 6, 10]);

    expect(packed.bass[1] ?? 0).toBeGreaterThan(packed.treble[1] ?? 0);
    expect(packed.mid[1] ?? 0).toBeGreaterThan(packed.treble[1] ?? 0);
  });

  it('writes frequency bins frame-major with normalized magnitudes', () => {
    const packed = analyzeFixture();

    expect(packed.frequencyBins).toHaveLength(packed.frameCount * packed.binsPerFrame);
    // Frame 2 is the loudest frame; its first bin region (low frequency) peaks.
    const loudFrameOffset = 2 * packed.binsPerFrame;
    const peakBin = Array.from({ length: packed.binsPerFrame }, (_, bin) => (
      packed.frequencyBins[loudFrameOffset + bin] ?? 0
    ));
    const maxBin = Math.max(...peakBin);
    expect(maxBin).toBeGreaterThan(0.9);
    expect(maxBin).toBeLessThanOrEqual(1);

    // Every bin is normalized into [0, 1].
    for (let index = 0; index < packed.frequencyBins.length; index += 1) {
      const value = packed.frequencyBins[index] ?? 0;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('throws AudioAnalysisCancelledError when cancellation is requested', () => {
    expect(() => analyzeMixedBuffer(
      [createFrameSineSamples(AMPLITUDES)],
      SAMPLE_RATE,
      FPS,
      AMPLITUDES.length,
      { isCancelled: () => true },
    )).toThrow(AudioAnalysisCancelledError);
  });
});

describe('toMonoSamples', () => {
  it('averages multiple channels', () => {
    const left = new Float32Array([0.5, 0.5]);
    const right = new Float32Array([-0.5, 0.5]);

    const mono = toMonoSamples([left, right]);

    expect(Array.from(mono)).toEqual([0, 0.5]);
  });
});

describe('runFft', () => {
  it('returns half-size magnitudes for a pure sine input', () => {
    const samples = new Float32Array(1024);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 100 * index) / SAMPLE_RATE);
    }

    const magnitudes = runFft(samples);

    expect(magnitudes).toHaveLength(AUDIO_HALF_FFT_SIZE);
    let peakIndex = 0;
    for (let index = 1; index < magnitudes.length; index += 1) {
      if ((magnitudes[index] ?? 0) > (magnitudes[peakIndex] ?? 0)) {
        peakIndex = index;
      }
    }
    // 100 Hz at 44.1 kHz / 1024 bins → bin ~2.32, so the peak sits in bin 2 or 3.
    expect(peakIndex).toBeGreaterThanOrEqual(2);
    expect(peakIndex).toBeLessThanOrEqual(3);
  });
});

describe('getBandAverage', () => {
  it('returns zero when the band is out of range', () => {
    const magnitudes = new Float32Array(16);

    expect(getBandAverage(magnitudes, SAMPLE_RATE, 100_000, null)).toBe(0);
  });

  it('averages the magnitudes inside the requested band', () => {
    const magnitudes = new Float32Array(16).fill(0.5);

    expect(getBandAverage(magnitudes, SAMPLE_RATE, 0, 250)).toBe(0.5);
  });
});

describe('getFrameWindow', () => {
  it('zero-pads beyond the available samples', () => {
    const samples = new Float32Array([0.25, 0.5, 0.25]);

    const windowed = getFrameWindow(samples, 0, samples.length);

    expect(windowed[0]).toBeCloseTo(0.25 * (0.5 - 0.5 * Math.cos(0)), 6);
    expect(windowed[samples.length]).toBe(0);
    expect(windowed[1023]).toBe(0);
  });
});
