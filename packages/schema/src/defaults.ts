import type { TimelineConfig, TrackDefinition } from './types.js';

export const DEFAULT_VIDEO_TRACKS: TrackDefinition[] = [
  {
    id: 'V1',
    kind: 'visual',
    label: 'V1',
    scale: 1,
    fit: 'contain',
    opacity: 1,
    blendMode: 'normal',
  },
  {
    id: 'A1',
    kind: 'audio',
    label: 'A1',
    scale: 1,
    fit: 'contain',
    opacity: 1,
    blendMode: 'normal',
  },
];

export function createDefaultTimelineConfig(): TimelineConfig {
  return {
    output: {
      resolution: '1280x720',
      fps: 30,
      file: 'output.mp4',
      background: null,
      background_scale: null,
    },
    clips: [],
    tracks: DEFAULT_VIDEO_TRACKS.map((track) => ({ ...track })),
  };
}
