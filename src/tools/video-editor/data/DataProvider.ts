import type { AssetRegistry, AssetRegistryEntry, TimelineConfig } from '@/tools/video-editor/types';
import type { Checkpoint } from '@/tools/video-editor/types/history';

export interface SilenceRegion {
  start: number;
  end: number;
}

export interface AssetProfile {
  transcript?: { segments?: Array<{ start: number; end: number; text: string }> };
  [key: string]: unknown;
}

export interface UploadAssetOptions {
  timelineId: string;
  userId: string;
  filename?: string;
}

export interface LoadedTimeline {
  config: TimelineConfig;
  configVersion: number;
}

export class TimelineVersionConflictError extends Error {
  code = 'timeline_version_conflict' as const;

  constructor(message = 'Timeline version conflict') {
    super(message);
    this.name = 'TimelineVersionConflictError';
  }
}

export function isTimelineVersionConflictError(error: unknown): error is TimelineVersionConflictError {
  return error instanceof TimelineVersionConflictError
    || (error instanceof Error && error.name === 'TimelineVersionConflictError');
}

export class TimelineNotFoundError extends Error {
  code = 'timeline_not_found' as const;

  constructor(timelineId: string) {
    super(`Timeline ${timelineId} not found — it may have been deleted`);
    this.name = 'TimelineNotFoundError';
  }
}

export function isTimelineNotFoundError(error: unknown): error is TimelineNotFoundError {
  return error instanceof TimelineNotFoundError
    || (error instanceof Error && error.name === 'TimelineNotFoundError');
}

export interface DataProvider {
  loadTimeline(timelineId: string): Promise<LoadedTimeline>;
  saveTimeline(
    timelineId: string,
    config: TimelineConfig,
    expectedVersion: number,
    registry?: AssetRegistry,
  ): Promise<number>;
  saveCheckpoint?(timelineId: string, checkpoint: Omit<Checkpoint, 'id'>): Promise<string>;
  loadCheckpoints?(timelineId: string): Promise<Checkpoint[]>;
  loadAssetRegistry(timelineId: string): Promise<AssetRegistry>;
  resolveAssetUrl(file: string): Promise<string>;
  registerAsset?(timelineId: string, assetId: string, entry: AssetRegistryEntry): Promise<void>;
  uploadAsset?(
    file: File,
    options: UploadAssetOptions,
  ): Promise<{ assetId: string; entry: AssetRegistryEntry }>;
  loadWaveform?(assetId: string): Promise<SilenceRegion[] | null>;
  loadAssetProfile?(assetId: string): Promise<AssetProfile | null>;
}

// The persistence boundary for the headless editor core remains the existing
// data provider contract. Core/runtime ports can rename or regroup host inputs,
// but persistence should continue to flow through this canonical interface.
export type VideoEditorPersistencePort = DataProvider;
