export interface PreviewHandle {
  seek: (time: number) => void;
  play: () => void;
  pause: () => void;
  togglePlayPause?: () => void;
  readonly isPlaying?: boolean;
}

export interface TimelineCanvasHandle {
  setTime: (time: number) => void;
  getTime?: () => number;
}

export interface CompositionMetadata {
  fps: number;
  durationInFrames: number;
  compositionWidth: number;
  compositionHeight: number;
}

export type RenderStatus = 'idle' | 'rendering' | 'done' | 'error';

export type RenderProgress = {
  current: number;
  total: number;
  percent: number;
  phase: string;
} | null;

export type RenderResult = {
  url: string | null;
  filename: string | null;
};
