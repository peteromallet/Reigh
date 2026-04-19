import { useContext } from 'react';
import { useCurrentFrame } from 'remotion';
import type { AudioBindingValue } from '@tbd/schema';
import {
  AudioAnalysisContext,
  SILENT_AUDIO_DATA,
  type AudioAnalysisData,
} from '../compositions/AudioAnalysisProvider.js';

export function useAudioReactive(): AudioAnalysisData {
  const frame = useCurrentFrame();
  const analysisFrames = useContext(AudioAnalysisContext);

  if (!analysisFrames) {
    return SILENT_AUDIO_DATA;
  }

  return analysisFrames[frame] ?? analysisFrames[analysisFrames.length - 1] ?? SILENT_AUDIO_DATA;
}

export function useAudioParam(binding: AudioBindingValue | undefined | null): number {
  const audio = useAudioReactive();
  return binding ? audio[binding.source] * (binding.max - binding.min) + binding.min : 0;
}
