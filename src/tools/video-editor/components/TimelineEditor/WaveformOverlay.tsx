import { useMemo } from 'react';

type WaveformOverlayProps = {
  waveform: number[];
};

const buildWaveformPath = (waveform: number[]): string => {
  if (waveform.length === 0) {
    return '';
  }

  const lastIndex = Math.max(waveform.length - 1, 1);
  const topPath = waveform.map((value, index) => {
    const x = (index / lastIndex) * 100;
    const y = 50 - Math.max(0, Math.min(1, value)) * 45;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  const bottomPath = [...waveform].reverse().map((value, reverseIndex) => {
    const index = waveform.length - 1 - reverseIndex;
    const x = (index / lastIndex) * 100;
    const y = 50 + Math.max(0, Math.min(1, value)) * 45;
    return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return `${topPath.join(' ')} ${bottomPath.join(' ')} Z`;
};

export function WaveformOverlay({ waveform }: WaveformOverlayProps) {
  const path = useMemo(() => buildWaveformPath(waveform), [waveform]);

  if (!path) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-25"
      aria-hidden="true"
      data-testid="timeline-audio-waveform"
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="currentColor"
      >
        <path d={path} />
      </svg>
    </div>
  );
}
