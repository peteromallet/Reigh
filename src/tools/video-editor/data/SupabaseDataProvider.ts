/**
 * Phase C compatibility name for the retired cloud provider.
 *
 * App-mode callers still import `SupabaseDataProvider` while the page-shell
 * rename lands, but all supported persistence now delegates to the frozen
 * Astrid timeline/asset contract. No Supabase query or cloud fallback remains.
 */
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability.ts';
import { AstridBridgeDataProvider } from '@/tools/video-editor/data/AstridBridgeDataProvider.ts';
import type {
  AssetRegistry,
  AssetRegistryEntry,
  TimelineConfig,
} from '@/tools/video-editor/types/index.ts';
import type {
  DataProvider,
  LoadedTimeline,
  UploadedAssetResult,
  UploadAssetOptions,
} from '@/tools/video-editor/data/DataProvider.ts';

export type AppSyncState =
  | 'up_to_date'
  | 'source_only'
  | 'destination_only'
  | 'both_advanced'
  | 'bookmark_missing'
  | 'bookmark_incompatible';

export type SyncTimelineAction =
  | 'none'
  | 'saved'
  | 'reload_required'
  | 'bookmark_bootstrapped'
  | 'divergence_recorded';

export interface SyncTimelineOptions {
  timelineId: string;
  config: TimelineConfig;
  currentConfigVersion: number;
  hasUnsavedEdits: boolean;
  registry?: AssetRegistry;
}

export interface SyncTimelineResult {
  state: AppSyncState;
  action: SyncTimelineAction;
  configVersion: number;
  dbHead: { version: number; hash: string | null; event_id: string | null };
  bookmark: null;
  keepBothArtifact?: { id: string; created_at: string; remote_entry_id: string | null };
}

export class SupabaseDataProvider implements DataProvider {
  readonly persistenceEnabled = true;
  readonly supportsEditorSync = false;
  readonly supportsDirectAssetUpload = true;

  private readonly providers = new Map<string, AstridBridgeDataProvider>();
  private activeProvider: AstridBridgeDataProvider | null = null;

  constructor(
    private readonly options: {
      /** Phase C treats the selected project id as Astrid's project slug. */
      projectId: string;
      /** Retained only for source compatibility; Astrid is fixed-user. */
      userId: string;
    },
  ) {}

  private providerFor(timelineId: string): AstridBridgeDataProvider {
    let provider = this.providers.get(timelineId);
    if (!provider) {
      provider = new AstridBridgeDataProvider({
        projectSlug: this.options.projectId,
        timelineRef: timelineId,
        timelineId,
      });
      this.providers.set(timelineId, provider);
    }
    this.activeProvider = provider;
    return provider;
  }

  async loadTimeline(timelineId: string): Promise<LoadedTimeline> {
    return await this.providerFor(timelineId).loadTimeline(timelineId);
  }

  async saveTimeline(
    timelineId: string,
    config: TimelineConfig,
    expectedVersion: number,
    registry?: AssetRegistry,
  ): Promise<number> {
    return await this.providerFor(timelineId).saveTimeline(timelineId, config, expectedVersion, registry);
  }

  async loadAssetRegistry(timelineId: string): Promise<AssetRegistry> {
    return await this.providerFor(timelineId).loadAssetRegistry(timelineId);
  }

  async resolveAssetUrl(file: string): Promise<string> {
    if (!this.activeProvider) {
      const candidate = file.trim();
      if (!candidate) throw new Error('Cannot resolve asset URL for an empty file path');
      if (/^https?:\/\//.test(candidate)) return candidate;
      throw bridgeCapabilityUnavailable(
        'resolve a relative timeline asset before loading its timeline',
        'Reload the timeline so Astrid can resolve its asset registry.',
      );
    }
    return await this.activeProvider.resolveAssetUrl(file);
  }

  async registerAsset(timelineId: string, assetId: string, entry: AssetRegistryEntry): Promise<void> {
    await this.providerFor(timelineId).registerAsset(timelineId, assetId, entry);
  }

  async uploadAsset(file: File, options: UploadAssetOptions): Promise<UploadedAssetResult> {
    return await this.providerFor(options.timelineId).uploadAsset(file, options);
  }

  async syncTimeline(_options: SyncTimelineOptions): Promise<SyncTimelineResult> {
    throw bridgeCapabilityUnavailable(
      'legacy app-to-cloud timeline sync',
      'Astrid is the timeline authority; save through the editor instead.',
    );
  }
}
