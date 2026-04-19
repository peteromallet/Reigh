export type TimelineEffect = {
  fade_in?: number;
  fade_out?: number;
};

export type TimelineApp = Record<string, unknown>;

export type ParameterType =
  | 'number'
  | 'select'
  | 'boolean'
  | 'color'
  | 'audio-binding';

export type AudioBindingValue = {
  source: 'bass' | 'mid' | 'treble' | 'amplitude';
  min: number;
  max: number;
};

export type ParameterOption = {
  label: string;
  value: string;
};

export type ParameterDefinition = {
  name: string;
  label: string;
  description: string;
  type: ParameterType;
  default?: number | string | boolean | AudioBindingValue;
  min?: number;
  max?: number;
  step?: number;
  options?: ParameterOption[];
};

export type ParameterSchema = ParameterDefinition[];

export type TrackKind = 'visual' | 'audio';
export type TrackFit = 'cover' | 'contain' | 'manual';
export type TrackBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'soft-light'
  | 'hard-light';
export type ClipType = 'media' | 'hold' | 'text' | 'effect-layer';

export type TrackDefinition = {
  id: string;
  kind: TrackKind;
  label: string;
  scale?: number;
  fit?: TrackFit;
  opacity?: number;
  volume?: number;
  muted?: boolean;
  blendMode?: TrackBlendMode;
  app?: TimelineApp;
};

export type ClipEntrance = {
  type: string;
  duration: number;
  intensity?: number;
  params?: Record<string, unknown>;
};

export type ClipExit = {
  type: string;
  duration: number;
  intensity?: number;
  params?: Record<string, unknown>;
};

export type ClipContinuous = {
  type: string;
  intensity?: number;
  params?: Record<string, unknown>;
};

export type ClipTransition = {
  type: string;
  duration: number;
};

export type TextAlignment = 'left' | 'center' | 'right';

export type TextClipData = {
  content: string;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  align?: TextAlignment;
  bold?: boolean;
  italic?: boolean;
};

export type TimelineClip = {
  id: string;
  at: number;
  track: string;
  clipType?: ClipType;
  asset?: string;
  from?: number;
  to?: number;
  speed?: number;
  hold?: number;
  volume?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cropTop?: number;
  cropBottom?: number;
  cropLeft?: number;
  cropRight?: number;
  opacity?: number;
  text?: TextClipData;
  entrance?: ClipEntrance;
  exit?: ClipExit;
  continuous?: ClipContinuous;
  transition?: ClipTransition;
  effects?: TimelineEffect[] | Record<string, number>;
  app?: TimelineApp;
};

export type TimelineOutput = {
  resolution: string;
  fps: number;
  file: string;
  background?: string | null;
  background_scale?: number | null;
};

export type TimelineConfig = {
  version?: 1;
  output: TimelineOutput;
  clips: TimelineClip[];
  tracks?: TrackDefinition[];
  app?: TimelineApp;
};
