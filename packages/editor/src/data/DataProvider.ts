import type { AssetRegistry, AssetRegistryEntry } from '@tbd/engine';
import type { TimelineConfig } from '@tbd/schema';

export interface SilenceRegion {
  start: number;
  end: number;
}

export interface AssetProfile {
  transcript?: { segments?: Array<{ start: number; end: number; text: string }> };
  [key: string]: unknown;
}

export interface TimelineSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface TimelineCheckpointInput {
  timelineId: string;
  config: TimelineConfig;
  createdAt: string;
  triggerType: 'session_boundary' | 'edit_distance' | 'semantic' | 'manual';
  label: string;
  editsSinceLastCheckpoint: number;
}

export interface TimelineCheckpoint extends TimelineCheckpointInput {
  id: string;
}

export interface TimelineSubscriptionEvent {
  type: 'timeline-updated' | 'asset-registry-updated' | 'timeline-deleted';
  timelineId: string;
}

export interface UploadAssetOptions {
  timelineId: string;
  userId?: string | null;
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
    super(`Timeline ${timelineId} not found`);
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
  listTimelines?(scope?: { projectId?: string | null }): Promise<TimelineSummary[]>;
  deleteTimeline?(timelineId: string): Promise<void>;
  saveCheckpoint?(timelineId: string, checkpoint: TimelineCheckpointInput): Promise<string>;
  loadCheckpoints?(timelineId: string): Promise<TimelineCheckpoint[]>;
  loadAssetRegistry(timelineId: string): Promise<AssetRegistry>;
  resolveAssetUrl(file: string): Promise<string> | string;
  registerAsset?(timelineId: string, assetId: string, entry: AssetRegistryEntry): Promise<void>;
  uploadAsset?(
    file: File | Blob | Uint8Array,
    options: UploadAssetOptions,
  ): Promise<{ assetId: string; entry: AssetRegistryEntry }>;
  loadWaveform?(assetId: string): Promise<SilenceRegion[] | null>;
  loadAssetProfile?(assetId: string): Promise<AssetProfile | null>;
  subscribe?(
    timelineId: string,
    listener: (event: TimelineSubscriptionEvent) => void,
  ): Promise<() => void> | (() => void);
}
