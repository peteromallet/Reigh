export type {
  AudioBindingValue,
  ClipContinuous,
  ClipEntrance,
  ClipExit,
  ClipTransition,
  ClipType,
  ParameterDefinition,
  ParameterOption,
  ParameterSchema,
  ParameterType,
  TextAlignment,
  TextClipData,
  TimelineApp,
  TimelineClip,
  TimelineConfig,
  TimelineEffect,
  TimelineOutput,
  TrackBlendMode,
  TrackDefinition,
  TrackFit,
  TrackKind,
} from '@tbd/schema';

import type {
  ClipContinuous,
  ClipEntrance,
  ClipExit,
  ClipTransition,
  ClipType,
  TextClipData,
  TimelineClip,
  TimelineConfig,
  TimelineEffect,
  TimelineOutput,
  TrackDefinition,
} from '@tbd/schema';

export type CustomEffectEntry = {
  code: string;
  category?: 'entrance' | 'exit' | 'continuous';
};

export type PinnedShotImageClipSnapshot = {
  clipId: string;
  assetKey?: string;
  start?: number;
  end?: number;
  meta: {
    clipType?: ClipType;
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
  };
};

// `clipIds` is ordered left-to-right by each clip's live `at` and must be rebuilt whenever group membership or ordering changes.
export type PinnedShotGroup = {
  shotId: string;
  trackId: string;
  clipIds: string[];
  mode?: 'images' | 'video';
  videoAssetKey?: string;
  imageClipSnapshot?: PinnedShotImageClipSnapshot[];
};

export type TimelinePinnedShotGroups = PinnedShotGroup[];

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
