import {
  getTrustedSequenceParamDefinitions,
} from '@/tools/video-editor/clip-types/registry.ts';
import type { ClipTypeSequenceParamDefinition as SequenceParamMetadata } from '@/tools/video-editor/clip-types/defineClipType.ts';
import type {
  ResolvedAssetRegistryEntry,
  ResolvedTimelineClip,
  ResolvedTimelineConfig,
} from '@/tools/video-editor/types/index.ts';
import {
  ASSET_SLOT_BINDINGS_PARAM,
  ASSET_SLOTS_PARAM,
  materializeAssetSlots,
} from '@/tools/video-editor/sequences/assetSlots.ts';
import type { DynamicSequenceComponentEntry } from '@/tools/video-editor/sequences/registry.ts';

export type SequenceAssetRegistry = Record<string, Partial<ResolvedAssetRegistryEntry> | undefined>;

export type SequenceMaterializationOptions = {
  dynamicEntries?: readonly DynamicSequenceComponentEntry[];
};

const resolveAssetUrl = (
  assetKey: string,
  registry: SequenceAssetRegistry,
): string | null => {
  const entry = registry[assetKey];
  if (!entry) return null;
  if (typeof entry.src === 'string' && entry.src.trim()) return entry.src;
  if (typeof entry.file === 'string' && entry.file.trim()) return entry.file;
  return null;
};

const materializeAssetListParam = (
  value: unknown,
  registry: SequenceAssetRegistry,
): string[] | null => {
  if (!Array.isArray(value)) return null;
  const assetKeys = value.filter((assetKey): assetKey is string => typeof assetKey === 'string');
  const urls = assetKeys
    .map((assetKey) => resolveAssetUrl(assetKey, registry))
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
  if (assetKeys.length > 0 && urls.length === 0) {
    console.warn('[SequenceComponent:Materialize] asset_keys_unresolved', {
      assetKeyCount: assetKeys.length,
      registryKeyCount: Object.keys(registry).length,
      sampleKeys: assetKeys.slice(0, 5),
    });
  }
  return urls.length > 0 ? urls : [];
};

const assetListParamsForClipType = (
  clipType: string | undefined,
): readonly SequenceParamMetadata[] => {
  return getTrustedSequenceParamDefinitions(clipType).filter((param) => (
    param.kind === 'asset-list' && typeof param.componentParam === 'string'
  ));
};

const resolveDynamicAssetSlotEntry = (
  clipType: string | undefined,
  dynamicEntries: readonly DynamicSequenceComponentEntry[] | undefined,
): DynamicSequenceComponentEntry | undefined => {
  if (typeof clipType !== 'string' || !dynamicEntries || dynamicEntries.length === 0) {
    return undefined;
  }
  const normalized = clipType.startsWith('custom:') ? clipType.slice('custom:'.length) : clipType;
  return dynamicEntries.find((entry) => entry.clipType === normalized);
};

export const materializeSequenceParams = (
  clipType: string | undefined,
  params: Record<string, unknown> | undefined,
  registry: SequenceAssetRegistry,
  options: SequenceMaterializationOptions = {},
): Record<string, unknown> | undefined => {
  if (!params) return params;

  let changed = false;
  let nextParams: Record<string, unknown> = params;
  const ensureCopy = () => {
    if (nextParams === params) {
      nextParams = { ...params };
    }
  };

  // Trusted clip types: descriptor-driven substitution (e.g. image-jump
  // declares imageAssetKeys → images via componentParam).
  for (const param of assetListParamsForClipType(clipType)) {
    const componentParam = param.componentParam;
    if (!componentParam) continue;
    const materialized = materializeAssetListParam(params[param.key], registry);
    if (materialized === null) continue;
    if (materialized.length === 0) {
      console.warn('[SequenceComponent:Materialize] trusted_asset_param_empty', {
        clipType,
        paramKey: param.key,
        componentParam,
      });
    }
    ensureCopy();
    nextParams[componentParam] = materialized;
    changed = true;
  }

  const dynamicEntry = resolveDynamicAssetSlotEntry(clipType, options.dynamicEntries);
  const assetSlots = dynamicEntry?.assetSlots ?? [];
  if (assetSlots.length > 0) {
    const materialized = materializeAssetSlots({
      slots: assetSlots,
      bindings: params[ASSET_SLOT_BINDINGS_PARAM],
      registry,
      path: `params.${ASSET_SLOT_BINDINGS_PARAM}`,
    });
    if (materialized.errors.length > 0) {
      console.warn('[SequenceComponent:Materialize] asset_slot_bindings_invalid', {
        clipType,
        errors: materialized.errors.map((error) => error.message),
      });
    }
    const hasMaterializedSlots = Object.values(materialized.assetSlots).some((urls) => urls.length > 0);
    if (!hasMaterializedSlots) {
      return changed ? nextParams : params;
    }
    ensureCopy();
    nextParams[ASSET_SLOTS_PARAM] = materialized.assetSlots;
    changed = true;
  }

  return changed ? nextParams : params;
};

export const materializeSequenceClip = (
  clip: ResolvedTimelineClip,
  registry: SequenceAssetRegistry,
  options: SequenceMaterializationOptions = {},
): ResolvedTimelineClip => {
  const nextParams = materializeSequenceParams(clip.clipType, clip.params, registry, options);
  if (nextParams === clip.params) {
    return clip;
  }
  return {
    ...clip,
    params: nextParams,
  };
};

export const materializeSequenceConfig = <
  TConfig extends { clips?: ReadonlyArray<ResolvedTimelineClip>; registry?: SequenceAssetRegistry },
>(
  config: TConfig,
  options: SequenceMaterializationOptions = {},
): TConfig => {
  const clips = config.clips;
  if (!Array.isArray(clips) || clips.length === 0) {
    return config;
  }

  const registry = config.registry ?? {};
  let changed = false;
  const nextClips = clips.map((clip) => {
    const nextClip = materializeSequenceClip(clip, registry, options);
    if (nextClip !== clip) {
      changed = true;
    }
    return nextClip;
  });

  if (!changed) {
    return config;
  }

  return {
    ...config,
    clips: nextClips,
  };
};

export const materializeResolvedSequenceConfig = (
  config: ResolvedTimelineConfig,
  options: SequenceMaterializationOptions = {},
): ResolvedTimelineConfig => materializeSequenceConfig(config, options);
