/**
 * Shared wire protocol between the window-side audio analysis client and the
 * module worker. Only plain, structured-cloneable data crosses the boundary:
 * request ids, scalar parameters, and `ArrayBuffer`s (transferred, never
 * copied as nested object graphs).
 */

export const AUDIO_ANALYSIS_VERSION = 1;
export const AUDIO_FFT_SIZE = 1024;
export const AUDIO_HALF_FFT_SIZE = AUDIO_FFT_SIZE / 2;
export const AUDIO_MIX_SAMPLE_RATE = 44_100;

/**
 * Packed, frame-major analysis result. `frequencyBins` holds
 * `frameCount * binsPerFrame` floats ordered by frame; per-frame bins for
 * frame `f` live at `[f * binsPerFrame, (f + 1) * binsPerFrame)`.
 */
export type PackedAudioAnalysis = {
  frameCount: number;
  binsPerFrame: number;
  amplitude: Float32Array;
  bass: Float32Array;
  mid: Float32Array;
  treble: Float32Array;
  beats: Uint8Array;
  frequencyBins: Float32Array;
};

/** Raised when an analysis is cancelled mid-pipeline (worker-side). */
export class AudioAnalysisCancelledError extends Error {
  constructor(message = 'Audio analysis cancelled') {
    super(message);
    this.name = 'AudioAnalysisCancelledError';
  }
}

export type AudioAnalysisAnalyzeMessage = {
  type: 'analyze';
  id: number;
  sampleRate: number;
  fps: number;
  frameCount: number;
  /** Rendered PCM channel buffers, transferred to the worker. */
  channels: ArrayBuffer[];
};

export type AudioAnalysisCancelMessage = {
  type: 'cancel';
  id: number;
};

export type AudioAnalysisWorkerRequest =
  | AudioAnalysisAnalyzeMessage
  | AudioAnalysisCancelMessage;

export type PackedAudioAnalysisTransfer = {
  frameCount: number;
  binsPerFrame: number;
  amplitude: ArrayBuffer;
  bass: ArrayBuffer;
  mid: ArrayBuffer;
  treble: ArrayBuffer;
  beats: ArrayBuffer;
  frequencyBins: ArrayBuffer;
};

export type AudioAnalysisResultMessage = {
  type: 'result';
  id: number;
  packed: PackedAudioAnalysisTransfer;
};

export type AudioAnalysisErrorMessage = {
  type: 'error';
  id: number;
  message: string;
};

export type AudioAnalysisWorkerReply =
  | AudioAnalysisResultMessage
  | AudioAnalysisErrorMessage;

/** Structural subset of `Worker` used by the client (injectable in tests). */
export interface AudioAnalysisWorkerLike {
  postMessage(message: AudioAnalysisWorkerRequest, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<AudioAnalysisWorkerReply>) => void) | null;
  terminate(): void;
}
