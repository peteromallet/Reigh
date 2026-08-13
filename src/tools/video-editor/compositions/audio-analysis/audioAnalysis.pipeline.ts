/**
 * Pure per-sample / per-frame analysis pipeline. Runs ONLY inside the module
 * worker in production; tests import it directly to exercise the FFT, band
 * aggregation, normalization, and beat detection without a real worker.
 *
 * The window thread must never import this module — it would reintroduce the
 * synchronous main-thread stall this worker isolation exists to remove.
 */
import {
  AUDIO_FFT_SIZE,
  AUDIO_HALF_FFT_SIZE,
  AudioAnalysisCancelledError,
  type PackedAudioAnalysis,
} from './audioAnalysis.protocol.ts';

const BASS_MAX_HZ = 250;
const MID_MAX_HZ = 4_000;
/** Cancellation is checked once per batch of frames. */
const CANCELLATION_CHECK_INTERVAL = 8;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Precomputed Hann window shared by every frame in every run. */
export const HANN_WINDOW: Float32Array = (() => {
  const windowTable = new Float32Array(AUDIO_FFT_SIZE);
  for (let index = 0; index < AUDIO_FFT_SIZE; index += 1) {
    windowTable[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (AUDIO_FFT_SIZE - 1));
  }
  return windowTable;
})();

export type FftTables = {
  sizes: number[];
  offsets: number[];
  cosine: Float32Array;
  sine: Float32Array;
};

/** Precomputed Cooley-Tukey twiddle factors for every butterfly stage. */
export function createFftTables(fftSize: number): FftTables {
  const sizes: number[] = [];
  const offsets: number[] = [];
  const cosineParts: number[] = [];
  const sineParts: number[] = [];

  for (let size = 2; size <= fftSize; size <<= 1) {
    sizes.push(size);
    offsets.push(cosineParts.length);
    const halfSize = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let index = 0; index < halfSize; index += 1) {
      const angle = step * index;
      cosineParts.push(Math.cos(angle));
      sineParts.push(Math.sin(angle));
    }
  }

  return {
    sizes,
    offsets,
    cosine: Float32Array.from(cosineParts),
    sine: Float32Array.from(sineParts),
  };
}

/** Module-level twiddle tables shared by worker runs and tests. */
export const FFT_TABLES: FftTables = createFftTables(AUDIO_FFT_SIZE);

export type FftScratch = {
  real: Float32Array;
  imaginary: Float32Array;
  magnitudes: Float32Array;
};

/** Reusable FFT buffers — allocated once per analysis run, reused per frame. */
export function createFftScratch(fftSize: number): FftScratch {
  return {
    real: new Float32Array(fftSize),
    imaginary: new Float32Array(fftSize),
    magnitudes: new Float32Array(fftSize / 2),
  };
}

export function toMonoSamples(channels: readonly Float32Array[]): Float32Array {
  let length = 0;
  for (const channel of channels) {
    length = Math.max(length, channel.length);
  }
  const mono = new Float32Array(length);
  const channelCount = Math.max(1, channels.length);

  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      mono[index] += (channel[index] ?? 0) / channelCount;
    }
  }

  return mono;
}

export function getFrameWindow(
  samples: Float32Array,
  start: number,
  end: number,
  windowTable: Float32Array = HANN_WINDOW,
  out: Float32Array = new Float32Array(AUDIO_FFT_SIZE),
): Float32Array {
  out.fill(0);
  const available = Math.max(0, Math.min(samples.length, end) - start);
  const copyLength = Math.min(AUDIO_FFT_SIZE, available);

  for (let index = 0; index < copyLength; index += 1) {
    const sample = samples[start + index] ?? 0;
    out[index] = sample * windowTable[index];
  }

  return out;
}

export function runFft(
  input: Float32Array,
  scratch: FftScratch = createFftScratch(AUDIO_FFT_SIZE),
  tables: FftTables = FFT_TABLES,
): Float32Array {
  const { real, imaginary, magnitudes } = scratch;
  real.fill(0);
  imaginary.fill(0);
  real.set(input.subarray(0, AUDIO_FFT_SIZE));

  for (let index = 1, bit = 0; index < AUDIO_FFT_SIZE; index += 1) {
    let mask = AUDIO_FFT_SIZE >> 1;
    while (bit & mask) {
      bit ^= mask;
      mask >>= 1;
    }
    bit ^= mask;
    if (index < bit) {
      const swap = real[index];
      real[index] = real[bit];
      real[bit] = swap;
    }
  }

  for (let stage = 0; stage < tables.sizes.length; stage += 1) {
    const size = tables.sizes[stage];
    const halfSize = size >> 1;
    const tableOffset = tables.offsets[stage];

    for (let offset = 0; offset < AUDIO_FFT_SIZE; offset += size) {
      for (let index = 0; index < halfSize; index += 1) {
        const even = offset + index;
        const odd = even + halfSize;
        const cosine = tables.cosine[tableOffset + index];
        const sine = tables.sine[tableOffset + index];
        const oddReal = real[odd] * cosine - imaginary[odd] * sine;
        const oddImaginary = real[odd] * sine + imaginary[odd] * cosine;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }

  for (let index = 0; index < AUDIO_HALF_FFT_SIZE; index += 1) {
    magnitudes[index] = Math.hypot(real[index], imaginary[index]);
  }

  return magnitudes;
}

export function getBandAverage(
  magnitudes: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number | null,
): number {
  const binSize = sampleRate / AUDIO_FFT_SIZE;
  const startBin = Math.max(0, Math.floor(minHz / binSize));
  const endBin = Math.min(
    magnitudes.length - 1,
    maxHz === null ? magnitudes.length - 1 : Math.floor(maxHz / binSize),
  );

  if (endBin < startBin) {
    return 0;
  }

  let total = 0;
  for (let index = startBin; index <= endBin; index += 1) {
    total += magnitudes[index] ?? 0;
  }

  return total / Math.max(1, endBin - startBin + 1);
}

export type AnalyzeMixedBufferOptions = {
  /** Called every `CANCELLATION_CHECK_INTERVAL` frames; throws when true. */
  isCancelled?: () => boolean;
  scratch?: FftScratch;
  tables?: FftTables;
  windowTable?: Float32Array;
};

/**
 * Analyze rendered PCM into packed frame-major typed arrays. Mirrors the
 * historical per-frame algorithm exactly (same windows, FFT, band averages,
 * normalization, rolling-average beat detection) but writes directly into
 * packed arrays — no per-frame `AudioAnalysisData[]` object graph.
 */
export function analyzeMixedBuffer(
  channels: readonly Float32Array[],
  sampleRate: number,
  fps: number,
  frameCount: number,
  options: AnalyzeMixedBufferOptions = {},
): PackedAudioAnalysis {
  const scratch = options.scratch ?? createFftScratch(AUDIO_FFT_SIZE);
  const tables = options.tables ?? FFT_TABLES;
  const windowTable = options.windowTable ?? HANN_WINDOW;
  const isCancelled = options.isCancelled ?? (() => false);

  const samples = toMonoSamples(channels);
  const samplesPerFrame = sampleRate / fps;
  const frames = Math.max(1, frameCount);
  const binsPerFrame = AUDIO_HALF_FFT_SIZE;

  const amplitude = new Float32Array(frames);
  const bass = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const treble = new Float32Array(frames);
  const beats = new Uint8Array(frames);
  const frequencyBins = new Float32Array(frames * binsPerFrame);

  const rawBass = new Float32Array(frames);
  const frameWindow = new Float32Array(AUDIO_FFT_SIZE);
  let maxMagnitude = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    if ((frame & (CANCELLATION_CHECK_INTERVAL - 1)) === 0 && isCancelled()) {
      throw new AudioAnalysisCancelledError();
    }

    const start = Math.floor(frame * samplesPerFrame);
    const end = Math.floor((frame + 1) * samplesPerFrame);
    if (start >= samples.length) {
      continue;
    }

    let squareSum = 0;
    const sampleCount = Math.max(1, Math.min(samples.length, end) - start);
    for (let index = start; index < Math.min(samples.length, end); index += 1) {
      const sample = samples[index] ?? 0;
      squareSum += sample * sample;
    }

    amplitude[frame] = clamp01(Math.sqrt(squareSum / sampleCount));

    const magnitudes = runFft(
      getFrameWindow(samples, start, end, windowTable, frameWindow),
      scratch,
      tables,
    );
    let framePeak = 0;
    for (let index = 0; index < magnitudes.length; index += 1) {
      framePeak = Math.max(framePeak, magnitudes[index]);
    }
    maxMagnitude = Math.max(maxMagnitude, framePeak);

    rawBass[frame] = getBandAverage(magnitudes, sampleRate, 0, BASS_MAX_HZ);
    mid[frame] = getBandAverage(magnitudes, sampleRate, BASS_MAX_HZ, MID_MAX_HZ);
    treble[frame] = getBandAverage(magnitudes, sampleRate, MID_MAX_HZ, null);

    const binOffset = frame * binsPerFrame;
    for (let index = 0; index < binsPerFrame; index += 1) {
      frequencyBins[binOffset + index] = magnitudes[index] ?? 0;
    }
  }

  const magnitudeScale = maxMagnitude > 0 ? maxMagnitude : 1;
  const rollingWindow = Math.max(1, Math.round(fps * 0.75));
  const beatCooldownFrames = Math.max(1, Math.ceil(fps * 0.3));

  for (let index = 0; index < frames; index += 1) {
    rawBass[index] = clamp01(rawBass[index] / magnitudeScale);
  }

  let lastBeatFrame = -beatCooldownFrames;
  for (let index = 0; index < frames; index += 1) {
    const windowStart = Math.max(0, index - rollingWindow);
    let rollingTotal = 0;
    let rollingCount = 0;
    for (let historyIndex = windowStart; historyIndex < index; historyIndex += 1) {
      rollingTotal += rawBass[historyIndex];
      rollingCount += 1;
    }
    const rollingAverage = rollingCount > 0
      ? rollingTotal / rollingCount
      : rawBass[index];
    const isBeat = (
      index - lastBeatFrame >= beatCooldownFrames
      && rollingAverage > 0.01
      && rawBass[index] > rollingAverage * 1.5
    );
    if (isBeat) {
      lastBeatFrame = index;
    }

    bass[index] = rawBass[index];
    beats[index] = isBeat ? 1 : 0;
    mid[index] = clamp01(mid[index] / magnitudeScale);
    treble[index] = clamp01(treble[index] / magnitudeScale);

    const binOffset = index * binsPerFrame;
    for (let bin = 0; bin < binsPerFrame; bin += 1) {
      frequencyBins[binOffset + bin] = clamp01(frequencyBins[binOffset + bin] / magnitudeScale);
    }
  }

  return {
    frameCount: frames,
    binsPerFrame,
    amplitude,
    bass,
    mid,
    treble,
    beats,
    frequencyBins,
  };
}
