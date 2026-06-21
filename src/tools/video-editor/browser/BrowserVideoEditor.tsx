import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { VideoEditorShell } from '@/tools/video-editor/components/VideoEditorShell.tsx';
import {
  BrowserVideoEditorProvider,
  type BrowserVideoEditorProviderProps,
} from '@/tools/video-editor/browser/BrowserVideoEditorProvider.tsx';

export type BrowserVideoEditorLayoutRenderer = (shell: ReactNode) => ReactNode;

export interface BrowserVideoEditorProps extends Omit<BrowserVideoEditorProviderProps, 'children' | 'diagnosticsStore'> {
  mode?: 'full' | 'compact';
  onCreateTimeline?: () => void;
  renderLayout?: BrowserVideoEditorLayoutRenderer;
  /** Optional diagnostics store — when omitted the provider creates a default in-memory store. */
  diagnosticsStore?: BrowserVideoEditorProviderProps['diagnosticsStore'];
  children?: ReactNode;
}

function createDefaultQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

/**
 * @publicContract
 * Standalone browser bootstrap that mounts the real editor shell from injected services.
 */
export function BrowserVideoEditor({
  dataProvider,
  timelineId,
  timelineName,
  userId = null,
  mode = 'full',
  effectCatalog,
  assetResolver = null,
  exporter = null,
  hostContext = null,
  queryClient,
  initialEntries,
  extensions,
  extensionPackages,
  extensionStateRepository,
  diagnosticsStore,
  onCreateTimeline,
  renderLayout,
  children,
}: BrowserVideoEditorProps) {
  const [ownedQueryClient] = useState(() => queryClient ?? createDefaultQueryClient());
  const shell = children ?? <VideoEditorShell mode={mode} timelineId={timelineId} onCreateTimeline={onCreateTimeline} />;

  return (
    <BrowserVideoEditorProvider
      dataProvider={dataProvider}
      timelineId={timelineId}
      timelineName={timelineName}
      userId={userId}
      effectCatalog={effectCatalog}
      assetResolver={assetResolver}
      exporter={exporter}
      hostContext={hostContext}
      queryClient={ownedQueryClient}
      initialEntries={initialEntries}
      extensions={extensions}
      extensionPackages={extensionPackages}
      extensionStateRepository={extensionStateRepository}
      diagnosticsStore={diagnosticsStore}
    >
      {renderLayout ? renderLayout(shell) : shell}
    </BrowserVideoEditorProvider>
  );
}
