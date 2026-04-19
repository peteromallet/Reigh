import { z } from 'zod';

export const TimelineAppSchema = z.record(z.string(), z.unknown());

export const TimelineEffectSchema = z.object({
  fade_in: z.number().optional(),
  fade_out: z.number().optional(),
}).strict();

export const AudioBindingValueSchema = z.object({
  source: z.enum(['bass', 'mid', 'treble', 'amplitude']),
  min: z.number(),
  max: z.number(),
}).strict();

export const ParameterOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
}).strict();

export const ParameterDefinitionSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  type: z.enum(['number', 'select', 'boolean', 'color', 'audio-binding']),
  default: z.union([z.number(), z.string(), z.boolean(), AudioBindingValueSchema]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(ParameterOptionSchema).optional(),
}).strict();

export const ParameterSchemaSchema = z.array(ParameterDefinitionSchema);

export const ClipEntranceSchema = z.object({
  type: z.string().min(1),
  duration: z.number(),
  intensity: z.number().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const ClipExitSchema = ClipEntranceSchema;

export const ClipContinuousSchema = z.object({
  type: z.string().min(1),
  intensity: z.number().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const ClipTransitionSchema = z.object({
  type: z.string().min(1),
  duration: z.number(),
}).strict();

export const TextClipDataSchema = z.object({
  content: z.string(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
}).strict();

export const TimelineTrackSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['visual', 'audio']),
  label: z.string().min(1),
  scale: z.number().optional(),
  fit: z.enum(['cover', 'contain', 'manual']).optional(),
  opacity: z.number().optional(),
  volume: z.number().optional(),
  muted: z.boolean().optional(),
  blendMode: z.enum([
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'soft-light',
    'hard-light',
  ]).optional(),
  app: TimelineAppSchema.optional(),
}).strict();

export const TimelineClipSchema = z.object({
  id: z.string().min(1),
  at: z.number().min(0),
  track: z.string().min(1),
  clipType: z.enum(['media', 'hold', 'text', 'effect-layer']).optional(),
  asset: z.string().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  speed: z.number().positive().optional(),
  hold: z.number().optional(),
  volume: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  cropTop: z.number().optional(),
  cropBottom: z.number().optional(),
  cropLeft: z.number().optional(),
  cropRight: z.number().optional(),
  opacity: z.number().optional(),
  text: TextClipDataSchema.optional(),
  entrance: ClipEntranceSchema.optional(),
  exit: ClipExitSchema.optional(),
  continuous: ClipContinuousSchema.optional(),
  transition: ClipTransitionSchema.optional(),
  effects: z.union([
    z.array(TimelineEffectSchema),
    z.record(z.string(), z.number()),
  ]).optional(),
  app: TimelineAppSchema.optional(),
}).strict();

export const TimelineOutputSchema = z.object({
  resolution: z.string().min(1),
  fps: z.number(),
  file: z.string().min(1),
  background: z.string().nullable().optional(),
  background_scale: z.number().nullable().optional(),
}).strict();

export const TimelineConfigSchema = z.object({
  version: z.literal(1).optional(),
  output: TimelineOutputSchema,
  tracks: z.array(TimelineTrackSchema).optional(),
  clips: z.array(TimelineClipSchema),
  app: TimelineAppSchema.optional(),
}).strict();

export type TimelineConfigInput = z.input<typeof TimelineConfigSchema>;
export type TimelineConfigParsed = z.output<typeof TimelineConfigSchema>;
