import type { AssetRegistry, ResolvedTimelineConfig } from '@tbd/engine';
import type { TimelineConfig } from '@tbd/schema';
import type { DataProvider, TimelineDocument } from '../index-internal.js';

export interface AssetResolver {
  resolveAssetUrl(input: {
    assetKey?: string;
    file: string;
    entry?: AssetRegistry['assets'][string];
    mode: 'preview' | 'render';
  }): Promise<string> | string;
  loadWaveform?(assetKey: string): Promise<unknown | null>;
  loadProfile?(assetKey: string): Promise<unknown | null>;
}

export interface MediaPickerSelection {
  assetId?: string;
  file?: File;
  fileUrl?: string;
  generationId?: string;
  title?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export class PickerUnavailableError extends Error {
  code = 'picker_unavailable' as const;
}

export class PickerPermissionError extends Error {
  code = 'picker_permission_error' as const;
}

export interface MediaPicker {
  open(options: {
    accept: Array<'image' | 'video' | 'audio'>;
    multiple?: boolean;
    initialQuery?: string;
  }): Promise<MediaPickerSelection[]>;
}

export interface ExportRequest {
  timeline: TimelineConfig;
  registry?: AssetRegistry;
  output: {
    file: string;
    codec?: 'h264' | 'h265' | 'vp8' | 'vp9' | 'prores';
    width?: number;
    height?: number;
    fps?: number;
  };
}

export interface ExportProgress {
  phase: 'validating' | 'rendering' | 'encoding' | 'uploading' | 'complete' | 'failed';
  progress?: number;
  log?: string;
  resultUrl?: string | null;
}

export interface ExportJobHandle {
  id: string;
  subscribe(listener: (progress: ExportProgress) => void): () => void;
  cancel?(): Promise<void>;
}

export interface Exporter {
  render(request: ExportRequest): Promise<ExportJobHandle>;
}

export interface HostContext {
  userId?: string | null;
  locale?: string;
  timeZone?: string;
  brand?: {
    appName?: string;
    accentColor?: string;
  };
  featureFlags?: Record<string, boolean>;
  routes?: {
    openTimeline?: (timelineId: string) => void;
    openAsset?: (assetId: string) => void;
  };
}

export interface EditorPorts {
  dataProvider: DataProvider;
  assetResolver?: AssetResolver;
  mediaPicker?: MediaPicker;
  exporter?: Exporter;
}

export const createAssetResolverFromDataProvider = (provider: DataProvider): AssetResolver => ({
  resolveAssetUrl: ({ file }) => provider.resolveAssetUrl(file),
  loadWaveform: provider.loadWaveform ? (assetId: string) => provider.loadWaveform!(assetId) : undefined,
  loadProfile: provider.loadAssetProfile ? (assetId: string) => provider.loadAssetProfile!(assetId) : undefined,
});

export const createBrowserMediaPicker = (): MediaPicker => ({
  async open({ accept, multiple = false }) {
    if (typeof document === 'undefined') {
      throw new PickerUnavailableError('Media picker requires a browser');
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = accept.map((item) => `${item}/*`).join(',');

    const files = await new Promise<FileList | null>((resolve) => {
      input.onchange = () => resolve(input.files);
      input.click();
    });

    if (!files || files.length === 0) {
      return [];
    }

    return [...files].map((file) => ({
      file,
      title: file.name,
      mimeType: file.type,
      metadata: { size: file.size },
    }));
  },
});

export const createLocalExporter = (resolvedConfig: () => ResolvedTimelineConfig | null): Exporter => ({
  async render(request) {
    const listeners = new Set<(progress: ExportProgress) => void>();
    const jobId = `job-${Date.now()}`;

    queueMicrotask(async () => {
      const notify = (progress: ExportProgress) => {
        for (const listener of listeners) {
          listener(progress);
        }
      };

      try {
        notify({ phase: 'validating', progress: 0 });
        const config = resolvedConfig();
        if (!config) {
          throw new Error('Timeline is not ready to export');
        }
        notify({
          phase: 'failed',
          log: `LocalExporter is a host hook point. The default implementation does not write ${request.output.file}; provide a custom exporter for production rendering.`,
        });
      } catch (error) {
        notify({
          phase: 'failed',
          log: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return {
      id: jobId,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  },
});

export const createDefaultTimelineDocument = (timelineId: string, config: TimelineConfig): TimelineDocument => ({
  timelineId,
  config,
  configVersion: 1,
  registry: { assets: {} },
});
