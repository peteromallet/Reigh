import type { AssetRegistry, AssetRegistryEntry } from '@tbd/engine';
import type { TimelineConfig } from '@tbd/schema';
import {
  type DataProvider,
  type TimelineCheckpoint,
  type TimelineCheckpointInput,
  type TimelineSummary,
  TimelineNotFoundError,
  TimelineVersionConflictError,
} from './DataProvider.js';

type StoredTimeline = {
  config: TimelineConfig;
  configVersion: number;
  registry: AssetRegistry;
  name: string;
  updatedAt: string;
  checkpoints: TimelineCheckpoint[];
};

export class InMemoryDataProvider implements DataProvider {
  private readonly timelines = new Map<string, StoredTimeline>();

  constructor(seed?: Record<string, { config: TimelineConfig; registry?: AssetRegistry; name?: string }>) {
    for (const [timelineId, value] of Object.entries(seed ?? {})) {
      this.timelines.set(timelineId, {
        config: value.config,
        configVersion: 1,
        registry: value.registry ?? { assets: {} },
        name: value.name ?? timelineId,
        updatedAt: new Date().toISOString(),
        checkpoints: [],
      });
    }
  }

  async loadTimeline(timelineId: string) {
    const stored = this.timelines.get(timelineId);
    if (!stored) {
      throw new TimelineNotFoundError(timelineId);
    }
    return {
      config: stored.config,
      configVersion: stored.configVersion,
    };
  }

  async saveTimeline(
    timelineId: string,
    config: TimelineConfig,
    expectedVersion: number,
    registry?: AssetRegistry,
  ): Promise<number> {
    const stored = this.timelines.get(timelineId);
    if (!stored) {
      this.timelines.set(timelineId, {
        config,
        configVersion: 1,
        registry: registry ?? { assets: {} },
        name: timelineId,
        updatedAt: new Date().toISOString(),
        checkpoints: [],
      });
      return 1;
    }

    if (stored.configVersion !== expectedVersion) {
      throw new TimelineVersionConflictError();
    }

    const nextVersion = stored.configVersion + 1;
    this.timelines.set(timelineId, {
      ...stored,
      config,
      configVersion: nextVersion,
      registry: registry ?? stored.registry,
      updatedAt: new Date().toISOString(),
    });
    return nextVersion;
  }

  async listTimelines(): Promise<TimelineSummary[]> {
    return [...this.timelines.entries()].map(([id, value]) => ({
      id,
      name: value.name,
      updatedAt: value.updatedAt,
    }));
  }

  async deleteTimeline(timelineId: string): Promise<void> {
    this.timelines.delete(timelineId);
  }

  async saveCheckpoint(_timelineId: string, checkpoint: TimelineCheckpointInput): Promise<string> {
    const stored = this.timelines.get(checkpoint.timelineId);
    if (!stored) {
      throw new TimelineNotFoundError(checkpoint.timelineId);
    }

    const id = `checkpoint-${stored.checkpoints.length + 1}`;
    stored.checkpoints.push({ ...checkpoint, id });
    return id;
  }

  async loadCheckpoints(timelineId: string): Promise<TimelineCheckpoint[]> {
    return this.timelines.get(timelineId)?.checkpoints ?? [];
  }

  async loadAssetRegistry(timelineId: string): Promise<AssetRegistry> {
    const stored = this.timelines.get(timelineId);
    if (!stored) {
      throw new TimelineNotFoundError(timelineId);
    }
    return stored.registry;
  }

  resolveAssetUrl(file: string): string {
    return file;
  }

  async registerAsset(timelineId: string, assetId: string, entry: AssetRegistryEntry): Promise<void> {
    const stored = this.timelines.get(timelineId);
    if (!stored) {
      throw new TimelineNotFoundError(timelineId);
    }
    stored.registry = {
      assets: {
        ...stored.registry.assets,
        [assetId]: entry,
      },
    };
  }
}
