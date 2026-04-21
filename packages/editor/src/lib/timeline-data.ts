import { resolveTimelineConfig, type AssetRegistry } from '@tbd/engine';
import type { TimelineClip, TimelineConfig } from '@tbd/schema';
import type { DataProvider } from '../data/DataProvider.js';
import type { ClipMeta, TimelineAction, TimelineData, TimelineDocument, TimelineRow } from '../types.js';
import { getConfigSignature, getStableConfigSignature } from './config-signatures.js';

export interface TimelineEffect {
  id: string;
}

const effectIdForClip = (clipId: string): string => `effect-${clipId}`;

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
  effects: Record<string, TimelineEffect>;
  clipOrder: Record<string, string[]>;
} {
  const rowsMap = new Map<string, TimelineAction[]>();
  const meta: Record<string, TimelineClip> = {};
  const effects: Record<string, TimelineEffect> = {};
  const clipOrder: Record<string, string[]> = {};

  for (const clip of config.clips) {
    meta[clip.id] = { ...clip };
    effects[effectIdForClip(clip.id)] = { id: effectIdForClip(clip.id) };
    const row = rowsMap.get(clip.track) ?? [];
    row.push({
      id: clip.id,
      start: clip.at,
      end: clip.at + ((clip.hold ?? 0) || Math.max(0.05, (clip.to ?? 0) - (clip.from ?? 0)) / (clip.speed ?? 1)),
      effectId: effectIdForClip(clip.id),
    });
    rowsMap.set(clip.track, row);
  }

  const rows = (config.tracks ?? []).map((track) => {
    const actions = (rowsMap.get(track.id) ?? []).sort((left, right) => left.start - right.start);
    clipOrder[track.id] = actions.map((action) => action.id);
    return { id: track.id, actions };
  });

  return { rows, meta, effects, clipOrder };
}

export async function materializeTimelineDocument(
  document: TimelineDocument,
  resolveAssetUrl: (file: string) => Promise<string> | string,
): Promise<TimelineData> {
  const resolvedConfig = await resolveTimelineConfig(document.config, document.registry, resolveAssetUrl);
  const { rows, meta, effects, clipOrder } = buildTimelineRows(document.config);
  const assetMap = Object.fromEntries(
    Object.entries(document.registry.assets ?? {}).map(([assetId, entry]) => [assetId, entry.file]),
  );

  return {
    config: document.config,
    configVersion: document.configVersion,
    registry: document.registry,
    resolvedConfig,
    rows,
    meta,
    effects,
    assetMap,
    tracks: document.config.tracks ?? [],
    output: document.config.output,
    clipOrder,
    signature: getConfigSignature(resolvedConfig),
    stableSignature: getStableConfigSignature(document.config, document.registry),
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

export async function buildTimelineData(
  config: TimelineConfig,
  registry: AssetRegistry,
  resolveAssetUrl: (file: string) => Promise<string> | string,
  configVersion = 1,
): Promise<TimelineData> {
  return materializeTimelineDocument({
    timelineId: 'timeline',
    config,
    configVersion,
    registry,
  }, resolveAssetUrl);
}

export async function loadTimelineJsonFromProvider(
  provider: DataProvider,
  timelineId: string,
): Promise<TimelineData> {
  const document = await loadTimelineDocument(provider, timelineId);
  return materializeTimelineDocument(document, (file) => provider.resolveAssetUrl(file));
}

export function preserveUploadingClips(current: TimelineData, next: TimelineData): TimelineData {
  const uploadingActions = current.rows.flatMap((row) => row.actions.filter((action) => action.id.startsWith('uploading-')));
  if (uploadingActions.length === 0) {
    return next;
  }

  const rows = next.rows.map((row) => {
    const currentRow = current.rows.find((candidate) => candidate.id === row.id);
    if (!currentRow) {
      return row;
    }

    const retainedUploads = currentRow.actions.filter((action) => action.id.startsWith('uploading-'));
    if (retainedUploads.length === 0) {
      return row;
    }

    return {
      ...row,
      actions: [...row.actions, ...retainedUploads].sort((left, right) => left.start - right.start),
    };
  });

  return {
    ...next,
    rows,
  };
}
