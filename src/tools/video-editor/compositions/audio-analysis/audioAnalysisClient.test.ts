import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  acquireAudioAnalysis,
  buildAudioMixRequest,
  internAudioMixRequest,
  resetAudioAnalysisCaches,
  setAudioAnalysisWorkerFactory,
} from './audioAnalysisClient.ts';
import { handleWorkerMessage } from './audioAnalysis.worker.ts';
import type {
  AudioAnalysisWorkerLike,
  AudioAnalysisWorkerReply,
  AudioAnalysisWorkerRequest,
} from './audioAnalysis.protocol.ts';
import type { ResolvedTimelineClip } from '@/tools/video-editor/types';

const DEAD_SRC = 'https://example.com/audio.wav?expired=1';
const REFRESHED_SRC = 'https://example.com/audio.wav?sig=refreshed';
const FPS = 10;

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

function createSineSamples(frameCount: number, fps = FPS): Float32Array {
  const sampleRate = 44_100;
  const samplesPerFrame = Math.floor(sampleRate / fps);
  const samples = new Float32Array(samplesPerFrame * frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * samplesPerFrame;
    for (let index = 0; index < samplesPerFrame; index += 1) {
      samples[offset + index] = Math.sin((2 * Math.PI * 100 * index) / sampleRate);
    }
  }
  return samples;
}

class MockOfflineAudioContext {
  static decodedBuffer: MockAudioBuffer;
  static renderedBuffers: MockAudioBuffer[] = [];
  static renderIndex = 0;

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
    const buffers = MockOfflineAudioContext.renderedBuffers;
    const index = MockOfflineAudioContext.renderIndex;
    if (index < buffers.length) {
      MockOfflineAudioContext.renderIndex += 1;
    }
    return buffers[Math.min(index, buffers.length - 1)] ?? MockOfflineAudioContext.decodedBuffer;
  }
}

class FakeAudioAnalysisWorker implements AudioAnalysisWorkerLike {
  onmessage: ((event: MessageEvent<AudioAnalysisWorkerReply>) => void) | null = null;

  posted: AudioAnalysisWorkerRequest[] = [];

  postMessage(message: AudioAnalysisWorkerRequest, _transfer?: Transferable[]): void {
    this.posted.push(message);
    if (message.type === 'cancel') {
      return;
    }
    let reply: AudioAnalysisWorkerReply | null = null;
    handleWorkerMessage(message, (computed) => {
      reply = computed;
    });
    if (reply) {
      setTimeout(() => {
        this.onmessage?.({ data: reply } as MessageEvent<AudioAnalysisWorkerReply>);
      }, 0);
    }
  }

  terminate(): void {}
}

function createAudioClip(src: string): ResolvedTimelineClip {
  return {
    id: 'audio-clip',
    at: 0,
    track: 'A1',
    asset: 'asset-1',
    from: 0,
    to: 1.2,
    speed: 1,
    volume: 1,
    assetEntry: {
      file: 'audio.wav',
      src,
      duration: 1.0,
      type: 'audio/wav',
      // sha/etag identity keeps the semantic key stable across URL refreshes.
      content_sha256: 'sha-retry-sources',
    },
  };
}

let fakeWorker: FakeAudioAnalysisWorker | null = null;

describe('acquireAudioAnalysis retry after refreshed sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeWorker = null;
    setAudioAnalysisWorkerFactory(() => {
      const created = new FakeAudioAnalysisWorker();
      fakeWorker = created;
      return created;
    });
    resetAudioAnalysisCaches();
    MockOfflineAudioContext.renderedBuffers = [];
    MockOfflineAudioContext.renderIndex = 0;
    MockOfflineAudioContext.decodedBuffer = createMockAudioBuffer(createSineSamples(4));
    vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext);
  });

  afterEach(() => {
    setAudioAnalysisWorkerFactory(null);
    resetAudioAnalysisCaches();
    vi.unstubAllGlobals();
  });

  it('replaces the interned request when sources change; keeps identity when sources match', () => {
    const dead = buildAudioMixRequest([createAudioClip(DEAD_SRC)], FPS);
    const refreshed = buildAudioMixRequest([createAudioClip(REFRESHED_SRC)], FPS);
    expect(refreshed.key).toBe(dead.key);

    const internedDead = internAudioMixRequest(dead);
    expect(internedDead).toBe(dead);

    // Same key, refreshed URL: the interned entry is replaced so consumers
    // observe a new identity and re-acquire with the fresh sources.
    expect(internAudioMixRequest(refreshed)).toBe(refreshed);

    // Sources equal again: the existing identity is kept (LRU touch only).
    expect(internAudioMixRequest(refreshed)).toBe(refreshed);
    expect(refreshed.sources).toEqual([REFRESHED_SRC]);
  });

  it('rejects when the first-seen fetch URL is dead', async () => {
    const fetchMock = vi.fn(async (url: string) => (
      url === DEAD_SRC
        ? new Response(null, { status: 403 })
        : new Response(new ArrayBuffer(8), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const interned = internAudioMixRequest(buildAudioMixRequest([createAudioClip(DEAD_SRC)], FPS));
    const subscription = acquireAudioAnalysis(interned);

    await expect(subscription.promise).rejects.toThrow(/Failed to fetch audio source/);
    subscription.release();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(DEAD_SRC);
  });

  it('succeeds on a second acquire with refreshed sources for the same key', async () => {
    const fetchMock = vi.fn(async (url: string) => (
      url === DEAD_SRC
        ? new Response(null, { status: 403 })
        : new Response(new ArrayBuffer(8), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);

    // First acquire: dead signed URL. The semantic key (sha identity) is the
    // same as any later retry, so this interned request carries the dead URL
    // until a same-key candidate with different sources replaces it below.
    const internedDead = internAudioMixRequest(
      buildAudioMixRequest([createAudioClip(DEAD_SRC)], FPS),
    );
    const first = acquireAudioAnalysis(internedDead);
    await expect(first.promise).rejects.toThrow(/Failed to fetch audio source/);
    first.release();

    // Asset entry refreshed: same key, current source URL. The interned entry
    // is replaced when sources differ, so the provider's stable-request
    // identity changes and its effect re-runs with the fresh URL.
    const refreshedRequest = buildAudioMixRequest([createAudioClip(REFRESHED_SRC)], FPS);
    expect(refreshedRequest.key).toBe(internedDead.key);
    expect(internAudioMixRequest(refreshedRequest)).toBe(refreshedRequest);
    expect(refreshedRequest.sources).toEqual([REFRESHED_SRC]);

    // The acquire path keys cache/in-flight lookups by `request.key` but
    // fetches `request.sources`, so the FRESH candidate (as the provider now
    // passes) retries against the refreshed URL and produces an analysis.
    const second = acquireAudioAnalysis(refreshedRequest);
    const result = await second.promise;
    second.release();

    expect(result).not.toBeNull();
    expect(result?.frameCount ?? 0).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, DEAD_SRC);
    expect(fetchMock).toHaveBeenNthCalledWith(2, REFRESHED_SRC);
    expect(fakeWorker?.posted.filter((message) => message.type === 'analyze')).toHaveLength(1);
  });
});
