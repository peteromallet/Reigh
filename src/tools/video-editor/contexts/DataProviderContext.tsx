import { createContext, useContext } from 'react';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';
import type {
  VideoEditorAgentChatHost,
  VideoEditorAssetResolver,
  VideoEditorAuthHost,
  VideoEditorMediaLightboxHost,
  VideoEditorProjectHost,
  VideoEditorShotsHost,
  VideoEditorTelemetryHost,
  VideoEditorToastHost,
} from '@/tools/video-editor/runtime/ports';

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
  userId: string;
  timelineName?: string | null;
}

const DataProviderContext = createContext<VideoEditorRuntimeContextValue | null>(null);

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
