import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index.ts';
import type { Checkpoint } from '@/tools/video-editor/types/history.ts';
import type { AssetResolver } from '@/tools/video-editor/data/AssetResolver.ts';
import type { VideoEditorDiagnostic } from '@/tools/video-editor/runtime/diagnostics.ts';
export type {
  AssetProfile,
  SilenceRegion,
  UploadedAssetResult,
  UploadAssetOptions,
} from '@/tools/video-editor/data/AssetResolver.ts';

export interface LoadedTimeline {
  config: TimelineConfig;
  configVersion: number;
}

export const DATA_PROVIDER_CAPABILITIES = [
  'timelinePersistence',
  'assetRegistry',
  'extensionState',
  'extensionSettings',
  'commandProposals',
  'syncEventLog',
  'materialization',
  'assetUploads',
  'checkpoints',
] as const;

export type DataProviderCapability = (typeof DATA_PROVIDER_CAPABILITIES)[number];

export type DataProviderCapabilityValue =
  | boolean
  | {
    supported: boolean;
    degraded?: boolean;
    reason?: string;
    message?: string;
    remedy?: string;
    detail?: Record<string, unknown>;
  };

export type DataProviderCapabilities = Partial<Record<DataProviderCapability, DataProviderCapabilityValue>>;

export interface ProviderCapabilityDiagnosticOptions {
  providerId?: string;
  requiredCapabilities?: readonly DataProviderCapability[];
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

export interface DataProvider extends AssetResolver {
  persistenceEnabled?: boolean;
  capabilities?: DataProviderCapabilities;
  getCapabilities?(): DataProviderCapabilities | Promise<DataProviderCapabilities>;
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
  /**
   * Collect diagnostics from the data provider (materialization failures,
   * generation asset resolution failures, provider degradation, etc.).
   *
   * Optional — providers that don't produce diagnostics can omit this.
   * Callers should use `provider.collectDiagnostics?.()` and gracefully
   * handle `undefined`.
   */
  collectDiagnostics?(): Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>;
}

export function isDataProviderPersistenceEnabled(provider: DataProvider | null | undefined): boolean {
  return provider?.persistenceEnabled !== false;
}

const DATA_PROVIDER_CAPABILITY_LABELS: Readonly<Record<DataProviderCapability, string>> = {
  timelinePersistence: 'timeline persistence',
  assetRegistry: 'asset registry',
  extensionState: 'extension state',
  extensionSettings: 'extension settings',
  commandProposals: 'command proposals',
  syncEventLog: 'sync event log',
  materialization: 'materialization',
  assetUploads: 'asset uploads',
  checkpoints: 'checkpoints',
};

function normalizeCapabilityValue(
  capability: DataProviderCapability,
  value: DataProviderCapabilityValue | undefined,
): {
  supported: boolean;
  degraded: boolean;
  reason: 'absent' | 'unsupported' | 'degraded';
  message?: string;
  remedy?: string;
  detail?: Record<string, unknown>;
} | null {
  if (value === undefined) {
    return {
      supported: false,
      degraded: false,
      reason: 'absent',
      message: `Data provider does not declare ${DATA_PROVIDER_CAPABILITY_LABELS[capability]} capability.`,
      remedy: 'Declare provider.capabilities or getCapabilities() for this feature, or omit it from the required capability list.',
    };
  }
  if (typeof value === 'boolean') {
    return value
      ? null
      : {
        supported: false,
        degraded: false,
        reason: 'unsupported',
        message: `Data provider does not support ${DATA_PROVIDER_CAPABILITY_LABELS[capability]}.`,
        remedy: 'Use a provider that supports this feature or gate the feature for the current provider.',
      };
  }
  if (value.supported && !value.degraded) {
    return null;
  }
  return {
    supported: value.supported,
    degraded: value.degraded === true,
    reason: value.supported ? 'degraded' : 'unsupported',
    message: value.message,
    remedy: value.remedy,
    detail: value.detail,
  };
}

export function normalizeProviderCapabilityDiagnostics(
  capabilities: DataProviderCapabilities | null | undefined,
  options: ProviderCapabilityDiagnosticOptions = {},
): Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> {
  const requiredCapabilities = options.requiredCapabilities ?? DATA_PROVIDER_CAPABILITIES;
  return requiredCapabilities.flatMap((capability) => {
    const normalized = normalizeCapabilityValue(capability, capabilities?.[capability]);
    if (!normalized) {
      return [];
    }

    const detail: Record<string, unknown> = {
      capability,
      supported: normalized.supported,
      reason: normalized.reason,
    };
    if (options.providerId) detail.providerId = options.providerId;
    if (normalized.remedy) detail.remedy = normalized.remedy;
    if (normalized.detail) Object.assign(detail, normalized.detail);

    return [{
      code: `provider_capability_${capability}_${normalized.reason}`,
      severity: normalized.degraded ? 'warning' : 'warning',
      source: 'provider',
      message: normalized.message
        ?? `Data provider ${normalized.reason === 'degraded' ? 'has degraded support for' : 'does not support'} ${DATA_PROVIDER_CAPABILITY_LABELS[capability]}.`,
      detail,
    }];
  });
}

export async function resolveDataProviderCapabilities(
  provider: DataProvider | null | undefined,
): Promise<DataProviderCapabilities | undefined> {
  if (!provider) {
    return undefined;
  }
  if (provider.getCapabilities) {
    return await provider.getCapabilities();
  }
  return provider.capabilities;
}

export async function collectProviderCapabilityDiagnostics(
  provider: DataProvider | null | undefined,
  options: ProviderCapabilityDiagnosticOptions = {},
): Promise<Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>> {
  return normalizeProviderCapabilityDiagnostics(await resolveDataProviderCapabilities(provider), options);
}

// The persistence boundary for the headless editor core remains the existing
// data provider contract. Core/runtime ports can rename or regroup host inputs,
// but persistence should continue to flow through this canonical interface.
export type VideoEditorPersistencePort = DataProvider;
