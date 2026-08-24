import {
  type ExtensionPersistenceScope,
  type ExtensionPersistenceService,
  TimelineNotFoundError,
  type DataProvider,
  type LoadedTimeline,
} from '@/tools/video-editor/data/DataProvider.ts';
import {
  parseTimelineBundle,
  type TimelineBundleEnvelope,
} from '@/tools/video-editor/data/typed/timelineBundle.ts';
import { TimelineVersionConflictError } from '@/sdk/video/timeline/errors.ts';
import type { ExtensionDiagnostic } from '@reigh/editor-sdk';
import {
  createCachedExtensionPersistenceService,
  type FullSnapshotStore,
} from '@/tools/video-editor/runtime/extensionPersistenceCache.ts';
import { createDefaultTimelineConfig } from '@/tools/video-editor/lib/defaults.ts';
import type { AssetRegistry, AssetRegistryEntry, TimelineConfig } from '@/tools/video-editor/types/index.ts';

type TimelineSeed = {
  config?: TimelineConfig;
  configVersion?: number;
  registry?: AssetRegistry;
  bundle?: TimelineBundleEnvelope | null;
};

type InMemoryTimelineRecord = {
  config: TimelineConfig;
  configVersion: number;
  registry: AssetRegistry;
  bundle: TimelineBundleEnvelope | null;
};

class InMemoryExtensionSnapshotStore implements FullSnapshotStore {
  constructor(
    private readonly snapshots: Map<string, string>,
    private readonly key: string,
  ) {}

  async loadSnapshot(): Promise<string | null> {
    return this.snapshots.get(this.key) ?? null;
  }

  async saveSnapshot(serialized: string): Promise<void> {
    this.snapshots.set(this.key, serialized);
  }

  async deleteSnapshot(): Promise<void> {
    this.snapshots.delete(this.key);
  }
}

const clone = <T,>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const normalizeTimelineSeed = (seed?: TimelineSeed): InMemoryTimelineRecord => {
  return {
    config: clone(seed?.config ?? createDefaultTimelineConfig()),
    configVersion: seed?.configVersion ?? 1,
    registry: clone(seed?.registry ?? { assets: {} }),
    // Seeds go through the same fail-closed parse as a real load, so a test
    // can never silently stage a bundle the persistence contract would reject.
    bundle: seed?.bundle == null ? null : clone(parseTimelineBundle(seed.bundle)),
  };
};

export class InMemoryDataProvider implements DataProvider {
  /** Test double: neither cloud sync nor local folder drops. */
  readonly supportsEditorSync = false;
  readonly supportsDirectAssetUpload = false;

  private readonly timelines = new Map<string, InMemoryTimelineRecord>();
  private readonly extensionSnapshots = new Map<string, string>();

  constructor(seed: Record<string, TimelineSeed> = {}) {
    for (const [timelineId, value] of Object.entries(seed)) {
      this.timelines.set(timelineId, normalizeTimelineSeed(value));
    }
  }

  seedTimeline(timelineId: string, seed?: TimelineSeed) {
    this.timelines.set(timelineId, normalizeTimelineSeed(seed));
  }

  clearExtensionPersistence(): void {
    this.extensionSnapshots.clear();
  }

  seedExtensionPersistenceSnapshot(scope: ExtensionPersistenceScope, serialized: string): void {
    this.extensionSnapshots.set(`${scope.userId}:${scope.timelineId}`, serialized);
  }

  async loadTimeline(timelineId: string): Promise<LoadedTimeline> {
    const existing = this.timelines.get(timelineId);
    if (!existing) {
      throw new TimelineNotFoundError(timelineId);
    }

    return {
      config: clone(existing.config),
      configVersion: existing.configVersion,
      bundle: existing.bundle ? clone(existing.bundle) : null,
    };
  }

  async saveTimeline(
    timelineId: string,
    config: TimelineConfig,
    expectedVersion: number,
    registry?: AssetRegistry,
    bundle?: TimelineBundleEnvelope | null,
  ): Promise<number> {
    const existing = this.timelines.get(timelineId);
    if (!existing) {
      throw new TimelineNotFoundError(timelineId);
    }
    // Validate BEFORE the version check and any mutation: a malformed bundle
    // must fail the whole save atomically — config, registry, and version
    // stay untouched (CAS atomicity).
    if (bundle !== undefined && bundle !== null) {
      parseTimelineBundle(bundle);
    }
    if (existing.configVersion !== expectedVersion) {
      throw new TimelineVersionConflictError();
    }

    const nextVersion = expectedVersion + 1;
    this.timelines.set(timelineId, {
      config: clone(config),
      configVersion: nextVersion,
      registry: clone(registry ?? existing.registry),
      // `undefined` preserves the stored bundle; explicit `null` clears it.
      bundle: clone(bundle === undefined ? existing.bundle : bundle),
    });
    return nextVersion;
  }

  async loadAssetRegistry(timelineId: string): Promise<AssetRegistry> {
    const existing = this.timelines.get(timelineId);
    if (!existing) {
      throw new TimelineNotFoundError(timelineId);
    }
    return clone(existing.registry);
  }

  async resolveAssetUrl(file: string): Promise<string> {
    return file.startsWith('http://') || file.startsWith('https://')
      ? file
      : `memory://${file}`;
  }

  async registerAsset(timelineId: string, assetId: string, entry: AssetRegistryEntry): Promise<void> {
    const existing = this.timelines.get(timelineId);
    if (!existing) {
      throw new TimelineNotFoundError(timelineId);
    }
    existing.registry = {
      assets: {
        ...existing.registry.assets,
        [assetId]: clone(entry),
      },
    };
  }

  createExtensionPersistenceService(
    scope: ExtensionPersistenceScope,
    diagnostics: ExtensionDiagnostic[],
  ): ExtensionPersistenceService {
    const key = `${scope.userId}:${scope.timelineId}`;
    return createCachedExtensionPersistenceService(
      new InMemoryExtensionSnapshotStore(this.extensionSnapshots, key),
      diagnostics,
      scope,
    );
  }
}
