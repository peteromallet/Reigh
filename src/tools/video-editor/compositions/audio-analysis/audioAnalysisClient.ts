/**
 * Window-side audio analysis client.
 *
 * Owns the semantic mix key (canonical, interned), the decoded-asset cache,
 * the completed-analysis LRU, in-flight coalescing with subscriber counting,
 * and the lazily-created module worker. Decoding and
 * `OfflineAudioContext.startRendering()` stay on the window; every
 * per-sample/per-frame JS loop runs in the worker.
 */
import type { ResolvedTimelineClip } from '@/tools/video-editor/types/index.ts';
import {
  AUDIO_ANALYSIS_VERSION,
  AUDIO_FFT_SIZE,
  AUDIO_MIX_SAMPLE_RATE,
  AudioAnalysisCancelledError,
  type AudioAnalysisWorkerLike,
  type AudioAnalysisWorkerReply,
  type AudioAnalysisWorkerRequest,
  type PackedAudioAnalysis,
} from './audioAnalysis.protocol.ts';

// ── Semantic mix spec ──────────────────────────────────────────────────────

export type AudioMixClipSpec = {
  /** Asset revision identity: content_sha256 > etag > `asset:src`. */
  assetId: string;
  /** Declared asset duration in seconds (0 when undeclared). */
  duration: number;
  /** Mix start time in seconds — semantically relevant for audio. */
  at: number;
  from: number;
  /** Source trim end; -1 means "until the decoded buffer ends". */
  to: number;
  speed: number;
  volume: number;
};

export type AudioMixSpec = {
  version: number;
  fftSize: number;
  sampleRate: number;
  fps: number;
  clips: readonly AudioMixClipSpec[];
};

export type AudioMixRequest = {
  /** Canonical serialization of `spec` — the semantic cache key. */
  key: string;
  spec: AudioMixSpec;
  /** Parallel to `spec.clips`; fetch URLs needed only for a cache miss. */
  sources: readonly string[];
};

const INTERNED_REQUESTS_LIMIT = 64;

const INTERNED_REQUESTS = new Map<string, AudioMixRequest>();

const compareAudioMixClipSpecs = (a: AudioMixClipSpec, b: AudioMixClipSpec): number => {
  if (a.at !== b.at) return a.at - b.at;
  if (a.assetId !== b.assetId) return a.assetId < b.assetId ? -1 : 1;
  if (a.from !== b.from) return a.from - b.from;
  if (a.to !== b.to) return a.to - b.to;
  if (a.speed !== b.speed) return a.speed - b.speed;
  if (a.volume !== b.volume) return a.volume - b.volume;
  return a.duration - b.duration;
};

/**
 * Normalize clips into a canonical, identity-free mix spec. Fresh `clips`
 * arrays, visual geometry, labels, selection, app metadata, and save/config
 * versions must not change the result.
 */
export function buildAudioMixRequest(
  clips: readonly ResolvedTimelineClip[],
  fps: number,
): AudioMixRequest {
  const pairs: Array<{ spec: AudioMixClipSpec; source: string }> = [];

  for (const clip of clips) {
    const assetEntry = clip.assetEntry;
    if (!assetEntry?.src) {
      continue;
    }
    const assetId = assetEntry.content_sha256
      ?? assetEntry.etag
      ?? `${clip.asset ?? ''}:${assetEntry.src}`;
    pairs.push({
      spec: {
        assetId,
        duration: assetEntry.duration ?? 0,
        at: clip.at ?? 0,
        from: clip.from ?? 0,
        to: typeof clip.to === 'number' ? clip.to : -1,
        speed: clip.speed && clip.speed > 0 ? clip.speed : 1,
        volume: clip.volume ?? 1,
      },
      source: assetEntry.src,
    });
  }

  pairs.sort((a, b) => compareAudioMixClipSpecs(a.spec, b.spec));

  const spec: AudioMixSpec = {
    version: AUDIO_ANALYSIS_VERSION,
    fftSize: AUDIO_FFT_SIZE,
    sampleRate: AUDIO_MIX_SAMPLE_RATE,
    fps,
    clips: pairs.map((pair) => pair.spec),
  };
  const key = JSON.stringify(spec);
  const sources = pairs.map((pair) => pair.source);
  return { key, spec, sources };
}

const sourcesEqual = (a: AudioMixRequest, b: AudioMixRequest): boolean => (
  a.sources.length === b.sources.length
  && a.sources.every((source, index) => source === b.sources[index])
);

/**
 * Return the existing immutable request object when the canonical key AND the
 * fetch sources are equal, so fresh `clips` arrays do not change effect
 * dependency identity. When the key matches but `sources` differ (e.g. a
 * re-signed asset URL for the same `content_sha256`/etag), the entry is
 * replaced with the candidate so consumers observe a new identity and
 * re-acquire with the refreshed URLs. Bounded LRU: evicting an interned
 * request is safe — equal-key candidates re-create the object and
 * cache/in-flight lookups are keyed by `key`.
 */
export function internAudioMixRequest(candidate: AudioMixRequest): AudioMixRequest {
  const existing = INTERNED_REQUESTS.get(candidate.key);
  if (existing) {
    if (sourcesEqual(existing, candidate)) {
      // LRU touch: identical sources keep the existing identity stable.
      INTERNED_REQUESTS.delete(candidate.key);
      INTERNED_REQUESTS.set(candidate.key, existing);
      return existing;
    }
    // Same semantic key, refreshed fetch URLs: replace the entry and move it
    // to the most-recent position so the next consumer sees a new identity.
    INTERNED_REQUESTS.delete(candidate.key);
    INTERNED_REQUESTS.set(candidate.key, candidate);
    return candidate;
  }
  INTERNED_REQUESTS.set(candidate.key, candidate);
  if (INTERNED_REQUESTS.size > INTERNED_REQUESTS_LIMIT) {
    const oldestKey = INTERNED_REQUESTS.keys().next().value;
    if (oldestKey !== undefined) {
      INTERNED_REQUESTS.delete(oldestKey);
    }
  }
  return candidate;
}

// ── Decoded-asset cache (module-level, bounded, promise-coalesced) ─────────

const DECODE_CACHE_LIMIT = 32;
const PCM_COPY_CHUNK_SAMPLES = 32_768;

const decodeCache = new Map<string, Promise<AudioBuffer>>();
let decoderContext: OfflineAudioContext | null = null;

const getDecoderContext = (): OfflineAudioContext | null => {
  if (typeof OfflineAudioContext === 'undefined') {
    return null;
  }
  if (!decoderContext) {
    decoderContext = new OfflineAudioContext(1, 1, AUDIO_MIX_SAMPLE_RATE);
  }
  return decoderContext;
};

const decodeAsset = (assetId: string, src: string): Promise<AudioBuffer> => {
  const cached = decodeCache.get(assetId);
  if (cached) {
    // LRU touch.
    decodeCache.delete(assetId);
    decodeCache.set(assetId, cached);
    return cached;
  }

  const promise = (async () => {
    const context = getDecoderContext();
    if (!context) {
      throw new Error('OfflineAudioContext is unavailable');
    }
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio source: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return context.decodeAudioData(arrayBuffer.slice(0));
  })();

  decodeCache.set(assetId, promise);
  // Evict rejected entries so retries work.
  void promise.catch(() => {
    if (decodeCache.get(assetId) === promise) {
      decodeCache.delete(assetId);
    }
  });
  if (decodeCache.size > DECODE_CACHE_LIMIT) {
    const oldestKey = decodeCache.keys().next().value;
    if (oldestKey !== undefined) {
      decodeCache.delete(oldestKey);
    }
  }

  return promise;
};

const yieldToMainThread = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

const copyRenderedChannels = async (buffer: AudioBuffer): Promise<Float32Array[]> => {
  const channelCount = Math.max(1, buffer.numberOfChannels);
  const channels: Float32Array[] = [];

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const source = buffer.getChannelData(channelIndex);
    const target = new Float32Array(source.length);
    for (let offset = 0; offset < source.length; offset += PCM_COPY_CHUNK_SAMPLES) {
      const end = Math.min(source.length, offset + PCM_COPY_CHUNK_SAMPLES);
      target.set(source.subarray(offset, end), offset);
      if (end < source.length) {
        await yieldToMainThread();
      }
    }
    channels.push(target);
  }

  return channels;
};

type RenderedAudioMix = {
  channels: Float32Array[];
  sampleRate: number;
  frameCount: number;
};

/**
 * Window-side render: decode unique assets, build the mix to the audible
 * audio horizon, render with OfflineAudioContext, and copy channel PCM in
 * bounded chunks (yielding between chunks so the copy is not the new stall).
 */
const renderAudioMix = async (request: AudioMixRequest): Promise<RenderedAudioMix> => {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('OfflineAudioContext is unavailable');
  }

  const { spec, sources } = request;
  const decodedClips = await Promise.all(spec.clips.map(async (clipSpec, index) => ({
    clipSpec,
    buffer: await decodeAsset(clipSpec.assetId, sources[index] ?? ''),
  })));

  const audibleEndSeconds = computeAudibleEndSeconds(decodedClips);

  const totalSamples = Math.max(1, Math.ceil(audibleEndSeconds * AUDIO_MIX_SAMPLE_RATE));
  const mixContext = new OfflineAudioContext(2, totalSamples, AUDIO_MIX_SAMPLE_RATE);

  for (const { clipSpec, buffer } of decodedClips) {
    const clipFrom = Math.max(0, clipSpec.from);
    const clipTo = Math.min(
      clipSpec.to >= 0 ? clipSpec.to : buffer.duration,
      buffer.duration,
    );
    const sourceDuration = Math.max(0, clipTo - clipFrom);
    if (sourceDuration <= 0) {
      continue;
    }

    const source = mixContext.createBufferSource();
    const gain = mixContext.createGain();
    source.buffer = buffer;
    source.playbackRate.value = clipSpec.speed;
    gain.gain.value = clipSpec.volume;
    source.connect(gain);
    gain.connect(mixContext.destination);
    source.start(Math.max(0, clipSpec.at), clipFrom, sourceDuration);
  }

  const rendered = await mixContext.startRendering();
  const channels = await copyRenderedChannels(rendered);

  return {
    channels,
    sampleRate: rendered.sampleRate,
    frameCount: Math.max(1, Math.ceil(audibleEndSeconds * spec.fps)),
  };
};

const computeAudibleEndSeconds = (
  decodedClips: ReadonlyArray<{ clipSpec: AudioMixClipSpec; buffer: AudioBuffer }>,
): number => {
  let audibleEndSeconds = 0;
  for (const { clipSpec, buffer } of decodedClips) {
    const clipFrom = Math.max(0, clipSpec.from);
    const clipTo = Math.min(
      clipSpec.to >= 0 ? clipSpec.to : buffer.duration,
      buffer.duration,
    );
    const sourceDuration = Math.max(0, clipTo - clipFrom);
    if (sourceDuration <= 0) {
      continue;
    }
    audibleEndSeconds = Math.max(
      audibleEndSeconds,
      clipSpec.at + sourceDuration / clipSpec.speed,
    );
  }
  return audibleEndSeconds;
};

// ── Worker lifecycle ───────────────────────────────────────────────────────

let worker: AudioAnalysisWorkerLike | null = null;
let workerFactory: (() => AudioAnalysisWorkerLike | null) | null = null;
let workerUnavailableWarned = false;

type PendingJob = {
  resolve: (packed: PackedAudioAnalysis) => void;
  reject: (error: Error) => void;
};

const pendingJobs = new Map<number, PendingJob>();
let nextWorkerJobId = 1;

const warnWorkerUnavailable = (): void => {
  if (!workerUnavailableWarned) {
    workerUnavailableWarned = true;
    console.warn(
      '[audio-analysis] Web Worker unavailable; audio analysis is disabled and will return silence.',
    );
  }
};

const handleWorkerReply = (event: MessageEvent<AudioAnalysisWorkerReply>): void => {
  const reply = event.data;
  const job = pendingJobs.get(reply.id);
  if (!job) {
    // Stale reply from a cancelled job — cannot win.
    return;
  }
  pendingJobs.delete(reply.id);
  if (reply.type === 'error') {
    job.reject(new Error(reply.message));
    return;
  }
  job.resolve(unpackPackedAnalysis(reply.packed));
};

type PackedAudioAnalysisTransferShape = Extract<
  AudioAnalysisWorkerReply,
  { type: 'result' }
>['packed'];

const unpackPackedAnalysis = (packed: PackedAudioAnalysisTransferShape): PackedAudioAnalysis => {
  return {
    frameCount: packed.frameCount,
    binsPerFrame: packed.binsPerFrame,
    amplitude: new Float32Array(packed.amplitude),
    bass: new Float32Array(packed.bass),
    mid: new Float32Array(packed.mid),
    treble: new Float32Array(packed.treble),
    beats: new Uint8Array(packed.beats),
    frequencyBins: new Float32Array(packed.frequencyBins),
  };
};

const getOrCreateWorker = (): AudioAnalysisWorkerLike | null => {
  if (worker) {
    return worker;
  }
  if (workerFactory) {
    const created = workerFactory();
    if (created) {
      worker = created;
      worker.onmessage = handleWorkerReply;
      return worker;
    }
    warnWorkerUnavailable();
    return null;
  }
  if (typeof Worker === 'undefined') {
    warnWorkerUnavailable();
    return null;
  }
  try {
    const instance = new Worker(
      new URL('./audioAnalysis.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker = instance as unknown as AudioAnalysisWorkerLike;
    worker.onmessage = handleWorkerReply;
    return worker;
  } catch (error) {
    console.warn('[audio-analysis] Failed to create Web Worker.', error);
    warnWorkerUnavailable();
    return null;
  }
};

type InFlightEntry = {
  request: AudioMixRequest;
  promise: Promise<PackedAudioAnalysis | null>;
  subscribers: number;
  jobId: number | null;
};

const analyzeInWorker = (
  request: AudioMixRequest,
  frameCount: number,
  channels: Float32Array[],
  entry: InFlightEntry,
): Promise<PackedAudioAnalysis> => {
  return new Promise((resolve, reject) => {
    if (inFlight.get(request.key) !== entry) {
      reject(new AudioAnalysisCancelledError());
      return;
    }
    const activeWorker = getOrCreateWorker();
    if (!activeWorker) {
      reject(new Error('Audio analysis worker is unavailable'));
      return;
    }

    const id = nextWorkerJobId;
    nextWorkerJobId += 1;
    entry.jobId = id;
    pendingJobs.set(id, { resolve, reject });

    const message: AudioAnalysisWorkerRequest = {
      type: 'analyze',
      id,
      sampleRate: AUDIO_MIX_SAMPLE_RATE,
      fps: request.spec.fps,
      frameCount,
      channels: channels.map((channel) => channel.buffer as ArrayBuffer),
    };
    try {
      activeWorker.postMessage(
        message,
        channels.map((channel) => channel.buffer as ArrayBuffer),
      );
    } catch (error) {
      pendingJobs.delete(id);
      entry.jobId = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
};

// ── Completed-analysis LRU (byte-bounded) ──────────────────────────────────

const COMPLETED_CACHE_MAX_BYTES = 64 * 1024 * 1024;

const completedCache = new Map<string, PackedAudioAnalysis>();
let completedCacheBytes = 0;

const byteSizeOfPacked = (packed: PackedAudioAnalysis): number => {
  return packed.amplitude.byteLength
    + packed.bass.byteLength
    + packed.mid.byteLength
    + packed.treble.byteLength
    + packed.beats.byteLength
    + packed.frequencyBins.byteLength;
};

const cacheCompleted = (key: string, packed: PackedAudioAnalysis): void => {
  const existing = completedCache.get(key);
  if (existing) {
    completedCacheBytes -= byteSizeOfPacked(existing);
    completedCache.delete(key);
  }
  completedCache.set(key, packed);
  completedCacheBytes += byteSizeOfPacked(packed);

  while (completedCacheBytes > COMPLETED_CACHE_MAX_BYTES && completedCache.size > 1) {
    const oldestKey = completedCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    const oldest = completedCache.get(oldestKey);
    if (oldest) {
      completedCacheBytes -= byteSizeOfPacked(oldest);
    }
    completedCache.delete(oldestKey);
  }
};

// ── In-flight coalescing with subscriber counting ──────────────────────────

const inFlight = new Map<string, InFlightEntry>();

const runAnalysis = (entry: InFlightEntry): Promise<PackedAudioAnalysis | null> => {
  return (async () => {
    const { channels, frameCount } = await renderAudioMix(entry.request);
    const packed = await analyzeInWorker(entry.request, frameCount, channels, entry);
    if (inFlight.get(entry.request.key) !== entry) {
      // Cancelled while running — a stale result must not win or be cached.
      return null;
    }
    cacheCompleted(entry.request.key, packed);
    return packed;
  })().catch((error: unknown) => {
    if (inFlight.get(entry.request.key) === entry) {
      // Failure eviction — the next acquire retries from scratch.
      inFlight.delete(entry.request.key);
      throw error;
    }
    return null;
  });
};

export type AudioAnalysisSubscription = {
  promise: Promise<PackedAudioAnalysis | null>;
  release: () => void;
};

/**
 * Acquire an analysis for a canonical request. Equal keys share one in-flight
 * job and later hit the completed cache. `release()` decrements the subscriber
 * count; cancellation is sent to the worker only when the final subscriber
 * releases.
 */
export function acquireAudioAnalysis(request: AudioMixRequest): AudioAnalysisSubscription {
  const cached = completedCache.get(request.key);
  if (cached) {
    completedCache.delete(request.key);
    completedCache.set(request.key, cached);
    return {
      promise: Promise.resolve(cached),
      release: () => {},
    };
  }

  let entry = inFlight.get(request.key);
  if (!entry) {
    entry = {
      request,
      promise: null as unknown as Promise<PackedAudioAnalysis | null>,
      subscribers: 0,
      jobId: null,
    };
    entry.promise = runAnalysis(entry);
    inFlight.set(request.key, entry);
  }
  entry.subscribers += 1;

  let released = false;
  return {
    promise: entry.promise,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      entry.subscribers -= 1;
      if (entry.subscribers <= 0 && inFlight.get(request.key) === entry) {
        inFlight.delete(request.key);
        if (entry.jobId !== null) {
          worker?.postMessage({ type: 'cancel', id: entry.jobId });
          // The worker sends no reply for cancelled runs, so drop the pending
          // job here — otherwise the resolve/reject closures (and the rendered
          // PCM channels they capture) stay referenced forever.
          pendingJobs.delete(entry.jobId);
          entry.jobId = null;
        }
      }
    },
  };
}

export const hasCachedAudioAnalysis = (request: AudioMixRequest): boolean => {
  return completedCache.has(request.key);
};

export const hasInFlightAudioAnalysis = (request: AudioMixRequest): boolean => {
  return inFlight.has(request.key);
};

// ── Test seams ─────────────────────────────────────────────────────────────

export const setAudioAnalysisWorkerFactory = (
  factory: (() => AudioAnalysisWorkerLike | null) | null,
): void => {
  workerFactory = factory;
  worker = null;
  pendingJobs.clear();
};

export const resetAudioAnalysisCaches = (): void => {
  decodeCache.clear();
  decoderContext = null;
  completedCache.clear();
  completedCacheBytes = 0;
  inFlight.clear();
  pendingJobs.clear();
  if (worker) {
    worker.terminate();
    worker = null;
  }
};
