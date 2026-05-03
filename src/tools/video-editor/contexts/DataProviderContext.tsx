import { createContext, useContext } from 'react';
import type { AssetResolver } from '@/tools/video-editor/data/AssetResolver';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';
import {
  FALLBACK_RENDER_RUNTIME,
  type RenderRuntime,
} from '@/tools/video-editor/render/renderRuntime';

export interface VideoEditorRuntimeContextValue {
  provider: DataProvider;
  assetResolver: AssetResolver;
  renderRuntime: RenderRuntime;
  timelineId: string;
  userId: string;
  timelineName?: string | null;
}

export interface VideoEditorRuntimeContextInputValue extends Omit<VideoEditorRuntimeContextValue, 'assetResolver' | 'renderRuntime'> {
  assetResolver?: AssetResolver;
  renderRuntime?: RenderRuntime;
}

const DataProviderContext = createContext<VideoEditorRuntimeContextValue | null>(null);

export function DataProviderWrapper({
  value,
  children,
}: {
  value: VideoEditorRuntimeContextInputValue;
  children: React.ReactNode;
}) {
  const normalizedValue: VideoEditorRuntimeContextValue = {
    ...value,
    assetResolver: value.assetResolver ?? value.provider,
    renderRuntime: value.renderRuntime ?? FALLBACK_RENDER_RUNTIME,
  };

  return (
    <DataProviderContext.Provider value={normalizedValue}>
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
