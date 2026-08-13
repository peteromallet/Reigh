import { useContext } from 'react';
import { useCurrentFrame } from 'remotion';
import {
  AudioAnalysisContext,
  SILENT_AUDIO_DATA,
  type AudioAnalysisData,
} from '@/tools/video-editor/compositions/AudioAnalysisProvider.tsx';
import type { AudioBindingValue } from '@/tools/video-editor/types/index.ts';

export function useAudioReactive(): AudioAnalysisData {
  const frame = useCurrentFrame();
  const analysis = useContext(AudioAnalysisContext);

  return analysis?.getFrame(frame) ?? SILENT_AUDIO_DATA;
}

export function useAudioParam(binding: AudioBindingValue | undefined | null): number {
  const audio = useAudioReactive();
  return binding ? audio[binding.source] * (binding.max - binding.min) + binding.min : 0;
}
