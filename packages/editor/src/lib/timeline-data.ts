import { resolveTimelineConfig, type AssetRegistry } from '@tbd/engine';
import type { TimelineClip, TimelineConfig } from '@tbd/schema';
import type { DataProvider } from '../data/DataProvider.js';
import type { ClipMeta, TimelineAction, TimelineData, TimelineDocument, TimelineRow } from '../types.js';

export const getNextClipId = (meta: Record<string, ClipMeta>): string => {
  let nextId = Object.keys(meta).length;
  while (meta[`clip-${nextId}`]) {
    nextId += 1;
  }
  return `clip-${nextId}`;
};

export const updateClipOrder = (
  clipOrder: Record<string, string[]>,
  rowId: string,
  updater: (ids: string[]) => string[],
): Record<string, string[]> => ({
  ...clipOrder,
  [rowId]: updater(clipOrder[rowId] ?? []),
});

export function buildTimelineRows(config: TimelineConfig): {
  rows: TimelineRow[];
  meta: Record<string, TimelineClip>;
  clipOrder: Record<string, string[]>;
} {
  const rowsMap = new Map<string, TimelineAction[]>();
  const meta: Record<string, TimelineClip> = {};
  const clipOrder: Record<string, string[]> = {};

  for (const clip of config.clips) {
    meta[clip.id] = { ...clip };
    const row = rowsMap.get(clip.track) ?? [];
    row.push({
      id: clip.id,
      start: clip.at,
      end: clip.at + ((clip.hold ?? 0) || Math.max(0.05, (clip.to ?? 0) - (clip.from ?? 0)) / (clip.speed ?? 1)),
      effectId: `effect-${clip.id}`,
    });
    rowsMap.set(clip.track, row);
  }

  const rows = (config.tracks ?? []).map((track) => {
    const actions = (rowsMap.get(track.id) ?? []).sort((left, right) => left.start - right.start);
    clipOrder[track.id] = actions.map((action) => action.id);
    return { id: track.id, actions };
  });

  return { rows, meta, clipOrder };
}

export async function materializeTimelineDocument(
  document: TimelineDocument,
  resolveAssetUrl: (file: string) => Promise<string> | string,
): Promise<TimelineData> {
  const resolvedConfig = await resolveTimelineConfig(document.config, document.registry, resolveAssetUrl);
  const { rows, meta, clipOrder } = buildTimelineRows(document.config);

  return {
    config: document.config,
    configVersion: document.configVersion,
    registry: document.registry,
    resolvedConfig,
    rows,
    meta,
    tracks: document.config.tracks ?? [],
    output: document.config.output,
    clipOrder,
  };
}

export async function loadTimelineDocument(
  provider: DataProvider,
  timelineId: string,
): Promise<TimelineDocument> {
  const [loaded, registry] = await Promise.all([
    provider.loadTimeline(timelineId),
    provider.loadAssetRegistry(timelineId),
  ]);

  return {
    timelineId,
    config: loaded.config,
    configVersion: loaded.configVersion,
    registry,
  };
}

export const createEmptyRegistry = (): AssetRegistry => ({ assets: {} });
