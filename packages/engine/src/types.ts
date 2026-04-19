import type { TimelineApp, TimelineClip, TimelineConfig, TimelineOutput, TrackDefinition } from '@tbd/schema';

export type AssetRegistryEntry = {
  file: string;
  type?: string;
  duration?: number;
  resolution?: string;
  fps?: number;
  generationId?: string;
  variantId?: string;
  thumbnailUrl?: string;
};

export type AssetRegistry = {
  assets: Record<string, AssetRegistryEntry>;
};

export type ResolvedAssetRegistryEntry = AssetRegistryEntry & {
  src: string;
};

export type ResolvedTimelineClip = TimelineClip & {
  assetEntry?: ResolvedAssetRegistryEntry;
};

export type ResolvedTimelineConfig = {
  output: TimelineOutput;
  tracks: TrackDefinition[];
  clips: ResolvedTimelineClip[];
  registry: Record<string, ResolvedAssetRegistryEntry>;
  app?: TimelineConfig['app'];
};

export type TimelineCompositionProps = {
  config?: ResolvedTimelineConfig;
  preview?: boolean;
};

export type { TimelineApp };
