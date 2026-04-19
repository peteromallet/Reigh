import { TimelineConfigSchema } from './validators.js';
import type { TimelineApp, TimelineClip, TimelineConfig, TrackDefinition } from './types.js';

export const TIMELINE_CLIP_FIELDS = [
  'id',
  'at',
  'track',
  'clipType',
  'asset',
  'from',
  'to',
  'speed',
  'hold',
  'volume',
  'x',
  'y',
  'width',
  'height',
  'cropTop',
  'cropBottom',
  'cropLeft',
  'cropRight',
  'opacity',
  'text',
  'entrance',
  'exit',
  'continuous',
  'transition',
  'effects',
  'app',
] as const;

export type TimelineClipField = (typeof TIMELINE_CLIP_FIELDS)[number];

export const TRACK_DEFINITION_FIELDS = [
  'id',
  'kind',
  'label',
  'scale',
  'fit',
  'opacity',
  'volume',
  'muted',
  'blendMode',
  'app',
] as const;

export type TrackDefinitionField = (typeof TRACK_DEFINITION_FIELDS)[number];

type SerializableTimelineLike = {
  version?: 1;
  output: TimelineConfig['output'];
  tracks?: Array<TrackDefinition & Record<string, unknown>>;
  clips: Array<TimelineClip & Record<string, unknown>>;
  app?: TimelineApp;
};

export const serializeClipForDisk = (clip: SerializableTimelineLike['clips'][number]): TimelineClip => {
  const serializedClip: Partial<Record<TimelineClipField, TimelineClip[TimelineClipField]>> = {
    id: clip.id,
    at: clip.at,
    track: clip.track,
  };

  if (clip.asset !== undefined) {
    serializedClip.asset = clip.asset;
  }

  for (const field of TIMELINE_CLIP_FIELDS) {
    if (field in serializedClip) {
      continue;
    }

    const value = clip[field];
    if (value !== undefined) {
      serializedClip[field] = value;
    }
  }

  return serializedClip as TimelineClip;
};

export const serializeTrackForDisk = (
  track: NonNullable<SerializableTimelineLike['tracks']>[number],
): TrackDefinition => {
  const serializedTrack: Partial<Record<TrackDefinitionField, TrackDefinition[TrackDefinitionField]>> = {
    id: track.id,
    kind: track.kind,
    label: track.label,
  };

  for (const field of TRACK_DEFINITION_FIELDS) {
    if (field in serializedTrack) {
      continue;
    }

    const value = track[field];
    if (value !== undefined) {
      serializedTrack[field] = value;
    }
  }

  return serializedTrack as TrackDefinition;
};

export const validateSerializedConfig = (config: TimelineConfig): void => {
  TimelineConfigSchema.parse(config);
};

export const serializeForDisk = (config: SerializableTimelineLike): TimelineConfig => {
  const serialized: TimelineConfig = {
    ...(config.version === undefined ? {} : { version: config.version }),
    output: { ...config.output },
    clips: config.clips.map(serializeClipForDisk),
    ...(config.tracks ? { tracks: config.tracks.map(serializeTrackForDisk) } : {}),
    ...(config.app ? { app: { ...config.app } } : {}),
  };

  validateSerializedConfig(serialized);
  return serialized;
};

export const serializeTimeline = serializeForDisk;
