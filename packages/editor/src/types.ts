import type { AssetRegistry, ResolvedTimelineConfig } from '@tbd/engine';
import type { TimelineClip, TimelineConfig, TrackDefinition } from '@tbd/schema';
import type { TimelineEffect } from './lib/timeline-data.js';

export interface TimelineAction {
  id: string;
  start: number;
  end: number;
  effectId?: string;
}

export interface TimelineRow {
  id: string;
  actions: TimelineAction[];
}

export type ClipMeta = TimelineClip;

export interface TimelineDocument {
  timelineId: string;
  config: TimelineConfig;
  configVersion: number;
  registry: AssetRegistry;
  name?: string | null;
}

export interface TimelineData {
  config: TimelineConfig;
  configVersion: number;
  registry: AssetRegistry;
  resolvedConfig: ResolvedTimelineConfig;
  rows: TimelineRow[];
  meta: Record<string, ClipMeta>;
  effects: Record<string, TimelineEffect>;
  assetMap: Record<string, string>;
  tracks: TrackDefinition[];
  output: TimelineConfig['output'];
  clipOrder: Record<string, string[]>;
  signature: string;
  stableSignature: string;
}
