import type { AssetRegistry } from '@tbd/engine';
import type { TimelineConfig } from '@tbd/schema';
import type { TimelineData } from '../types.js';
import { getConfigSignature, getStableConfigSignature } from './config-signatures.js';
import { buildTimelineRows } from './timeline-data.js';

export function shouldAcceptPolledData(
  editSeq: number,
  savedSeq: number,
  pendingOps: number,
  polledStableSig: string,
  lastSavedStableSig: string,
): boolean {
  if (savedSeq < editSeq) {
    return false;
  }

  if (pendingOps > 0) {
    return false;
  }

  return polledStableSig !== lastSavedStableSig;
}

function buildResolvedConfigFromCurrent(
  config: TimelineConfig,
  current: TimelineData,
  registry: AssetRegistry,
) {
  const resolvedRegistry = Object.fromEntries(
    Object.entries(registry.assets ?? {}).map(([assetId, entry]) => {
      const existing = current.resolvedConfig.registry[assetId];
      return [assetId, existing ?? { ...entry, src: entry.file }];
    }),
  );

  return {
    output: { ...config.output },
    tracks: (config.tracks ?? []).map((track) => ({ ...track })),
    clips: config.clips.map((clip) => ({
      ...clip,
      assetEntry: clip.asset ? resolvedRegistry[clip.asset] : undefined,
    })),
    registry: resolvedRegistry,
  };
}

function assembleData(
  config: TimelineConfig,
  registry: AssetRegistry,
  resolvedConfig: TimelineData['resolvedConfig'],
  current: TimelineData,
): TimelineData {
  const rowData = buildTimelineRows(config);
  const assetMap = Object.fromEntries(
    Object.entries(registry.assets ?? {}).map(([assetId, entry]) => [assetId, entry.file]),
  );

  return {
    ...current,
    config,
    registry,
    resolvedConfig,
    rows: rowData.rows,
    meta: rowData.meta,
    effects: rowData.effects,
    tracks: (config.tracks ?? []).map((track) => ({ ...track })),
    output: { ...config.output },
    clipOrder: rowData.clipOrder,
    assetMap,
    signature: getConfigSignature(resolvedConfig),
    stableSignature: getStableConfigSignature(config, registry),
  };
}

export function buildDataFromCurrentRegistry(
  config: TimelineConfig,
  current: TimelineData,
): TimelineData {
  const resolvedConfig = buildResolvedConfigFromCurrent(config, current, current.registry);
  return assembleData(config, current.registry, resolvedConfig, current);
}

export function buildDataFromSnapshot(
  config: TimelineConfig,
  registry: AssetRegistry,
  current: TimelineData,
): TimelineData {
  const resolvedConfig = buildResolvedConfigFromCurrent(config, current, registry);
  return assembleData(config, registry, resolvedConfig, current);
}
