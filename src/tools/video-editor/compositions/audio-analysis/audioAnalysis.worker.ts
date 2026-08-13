/**
 * Module worker for audio analysis. Receives rendered PCM channel buffers,
 * runs the pure FFT/band/beat pipeline off the main thread, and transfers the
 * packed result buffers back to the window.
 *
 * The message handler is exported so tests can drive the exact same code path
 * through a fake worker without instantiating a real `Worker`.
 */
import {
  AUDIO_FFT_SIZE,
  AudioAnalysisCancelledError,
  type AudioAnalysisWorkerReply,
  type AudioAnalysisWorkerRequest,
  type PackedAudioAnalysis,
  type PackedAudioAnalysisTransfer,
} from './audioAnalysis.protocol.ts';
import {
  analyzeMixedBuffer,
  createFftScratch,
} from './audioAnalysis.pipeline.ts';

const cancelledIds = new Set<number>();

function toTransferablePacked(packed: PackedAudioAnalysis): PackedAudioAnalysisTransfer {
  return {
    frameCount: packed.frameCount,
    binsPerFrame: packed.binsPerFrame,
    amplitude: packed.amplitude.buffer as ArrayBuffer,
    bass: packed.bass.buffer as ArrayBuffer,
    mid: packed.mid.buffer as ArrayBuffer,
    treble: packed.treble.buffer as ArrayBuffer,
    beats: packed.beats.buffer as ArrayBuffer,
    frequencyBins: packed.frequencyBins.buffer as ArrayBuffer,
  };
}

function toTransferList(packed: PackedAudioAnalysis): Transferable[] {
  return [
    packed.amplitude.buffer as ArrayBuffer,
    packed.bass.buffer as ArrayBuffer,
    packed.mid.buffer as ArrayBuffer,
    packed.treble.buffer as ArrayBuffer,
    packed.beats.buffer as ArrayBuffer,
    packed.frequencyBins.buffer as ArrayBuffer,
  ];
}

/**
 * Handle one worker message. `postReply` abstracts the transport so the same
 * handler runs in the real worker (posts to `self`) and in test fakes.
 */
export function handleWorkerMessage(
  message: AudioAnalysisWorkerRequest,
  postReply: (reply: AudioAnalysisWorkerReply, transfer: Transferable[]) => void,
): void {
  if (message.type === 'cancel') {
    cancelledIds.add(message.id);
    return;
  }

  const { id, sampleRate, fps, frameCount, channels } = message;
  const scratch = createFftScratch(AUDIO_FFT_SIZE);

  try {
    const packed = analyzeMixedBuffer(
      channels.map((buffer) => new Float32Array(buffer)),
      sampleRate,
      fps,
      frameCount,
      {
        isCancelled: () => cancelledIds.has(id),
        scratch,
      },
    );
    cancelledIds.delete(id);
    postReply(
      { type: 'result', id, packed: toTransferablePacked(packed) },
      toTransferList(packed),
    );
  } catch (error) {
    cancelledIds.delete(id);
    if (error instanceof AudioAnalysisCancelledError) {
      // Cancelled mid-run: the client already dropped the job; no reply.
      return;
    }
    postReply({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : String(error),
    }, []);
  }
}

// Wire the real worker transport only when this module actually runs inside a
// dedicated worker global (never in vitest/jsdom or on the window thread).
if (typeof WorkerGlobalScope !== 'undefined') {
  const workerScope = self as unknown as {
    onmessage: ((event: MessageEvent<AudioAnalysisWorkerRequest>) => void) | null;
    postMessage(message: unknown, options?: { transfer?: Transferable[] }): void;
  };

  workerScope.onmessage = (event: MessageEvent<AudioAnalysisWorkerRequest>) => {
    handleWorkerMessage(event.data, (reply, transfer) => {
      workerScope.postMessage(reply, { transfer });
    });
  };
}
