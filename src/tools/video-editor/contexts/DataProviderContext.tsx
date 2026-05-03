import { createContext, useContext } from 'react';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';
import type { VideoEditorExtensionRuntimeConfig } from '@/tools/video-editor/runtime/extensionSurface';

export interface VideoEditorRuntimeContextValue {
  provider: DataProvider;
  timelineId: string;
  userId: string;
  timelineName?: string | null;
  extensions: VideoEditorExtensionRuntimeConfig;
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
