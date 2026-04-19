import type { TrackDefinition } from '@tbd/schema';
import type { ResolvedTimelineConfig } from './types.js';

export const getVisualTracks = (config: Pick<ResolvedTimelineConfig, 'tracks'>): TrackDefinition[] => {
  return config.tracks.filter((track) => track.kind === 'visual');
};

export const getAudioTracks = (config: Pick<ResolvedTimelineConfig, 'tracks'>): TrackDefinition[] => {
  return config.tracks.filter((track) => track.kind === 'audio');
};
