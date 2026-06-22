import { createContext, useContext } from 'react';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import type {
  VideoEditorAssetResolver,
  VideoEditorExporter,
  VideoEditorHostContext,
} from '@/tools/video-editor/lib/browser-runtime.ts';
import type {
  VideoEditorAgentChatHost,
  VideoEditorAuthHost,
  VideoEditorMediaLightboxHost,
  VideoEditorProjectHost,
  VideoEditorShotsHost,
  VideoEditorTelemetryHost,
  VideoEditorToastHost,
} from '@/tools/video-editor/runtime/ports.ts';
import type { VideoEditorExtensionRuntimeConfig } from '@/tools/video-editor/runtime/extensionSurface.ts';
import type { VideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics.ts';

export interface VideoEditorRuntimeContextValue {
  provider: DataProvider;
  assetResolver: VideoEditorAssetResolver;
  auth: VideoEditorAuthHost;
  project: VideoEditorProjectHost;
  shots: VideoEditorShotsHost;
  mediaLightbox: VideoEditorMediaLightboxHost;
  agentChat: VideoEditorAgentChatHost;
  toast: VideoEditorToastHost;
  telemetry: VideoEditorTelemetryHost;
  timelineId: string;
  userId: string | null;
  timelineName?: string | null;
  exporter?: VideoEditorExporter | null;
  hostContext?: VideoEditorHostContext | null;
  extensions: VideoEditorExtensionRuntimeConfig;
  diagnosticsStore: VideoEditorDiagnosticsStore;
}

export const DataProviderContext = createContext<VideoEditorRuntimeContextValue | null>(null);

export function DataProviderWrapper({
  value,
  children,
}: {
  value: VideoEditorRuntimeContextValue;
  children: React.ReactNode;
}) {
  return (
    <DataProviderContext.Provider value={value}>
      {children}
    </DataProviderContext.Provider>
  );
}

export function useVideoEditorRuntime(): VideoEditorRuntimeContextValue {
  const context = useContext(DataProviderContext);
  if (!context) {
    throw new Error('useVideoEditorRuntime must be used within DataProviderWrapper');
  }

  return context;
}

/**
 * Safe variant of useVideoEditorRuntime — returns null instead of throwing
 * when called outside a DataProviderWrapper.
 */
export function useVideoEditorRuntimeSafe(): VideoEditorRuntimeContextValue | null {
  return useContext(DataProviderContext);
}
