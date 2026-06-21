import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { EditorRuntimeProvider } from '@/tools/video-editor/contexts/EditorRuntimeProvider.tsx';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import type { VideoEditorEffectCatalog } from '@/tools/video-editor/hooks/useEffectResources.ts';
import type {
  VideoEditorAssetResolver,
  VideoEditorExporter,
  VideoEditorHostContext,
} from '@/tools/video-editor/lib/browser-runtime.ts';
import type { ExtensionPackage } from '@/tools/video-editor/runtime/extensionManifest.ts';
import type { ExtensionStateRepository } from '@/tools/video-editor/runtime/extensionStateRepository.ts';
import {
  ExtensionLoader,
  type ExtensionLoadResult,
} from '@/tools/video-editor/runtime/extensionLoader.ts';
import {
  InMemoryExtensionStateRepository,
  LocalStorageExtensionStateRepository,
} from '@/tools/video-editor/runtime/extensionStateRepository.ts';
import {
  type VideoEditorExtensionConfig,
  type VideoEditorExtensionInput,
} from '@/tools/video-editor/runtime/extensionSurface.ts';

export interface BrowserVideoEditorProviderProps {
  dataProvider: DataProvider;
  timelineId: string;
  timelineName?: string | null;
  userId?: string | null;
  effectCatalog?: VideoEditorEffectCatalog | null;
  assetResolver?: VideoEditorAssetResolver | null;
  exporter?: VideoEditorExporter | null;
  hostContext?: VideoEditorHostContext | null;
  queryClient?: QueryClient;
  initialEntries?: string[];
  /** Raw M1 extension configs (slots, dialogs, registry). */
  extensions?: VideoEditorExtensionInput;
  /** Extension packages to validate, load state for, and adapt into runtime configs. */
  extensionPackages?: readonly ExtensionPackage[];
  /** Repository for extension enabled/disabled state and settings overrides. */
  extensionStateRepository?: ExtensionStateRepository;
  children: ReactNode;
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
 * Browser-only runtime provider for custom shells that use the supported
 * public hooks instead of the stock editor chrome.
 */
export function BrowserVideoEditorProvider({
  dataProvider,
  timelineId,
  timelineName,
  userId = null,
  effectCatalog,
  assetResolver = null,
  exporter = null,
  hostContext = null,
  queryClient,
  initialEntries,
  extensions,
  extensionPackages,
  extensionStateRepository,
  children,
}: BrowserVideoEditorProviderProps) {
  const [ownedQueryClient] = useState(() => queryClient ?? createDefaultQueryClient());

  // Resolve the default repository when none is injected.
  const repository = useMemo(() => {
    if (extensionStateRepository) return extensionStateRepository;

    // Detect if we're in an environment with localStorage available.
    const hasLocalStorage =
      typeof window !== 'undefined' &&
      typeof window.localStorage !== 'undefined' &&
      window.localStorage !== null;

    if (hasLocalStorage) {
      // Scope the storage key to the available user/project context
      // so different users and projects get isolated state.
      const scopeSegments: string[] = [];
      if (userId) scopeSegments.push(`user:${userId}`);
      if (hostContext?.projectId) scopeSegments.push(`project:${hostContext.projectId}`);

      const key =
        scopeSegments.length > 0
          ? `reigh:extension-state:v1:${scopeSegments.join(':')}`
          : 'reigh:extension-state:v1';

      return new LocalStorageExtensionStateRepository(window.localStorage, key);
    }

    // Fallback for tests and server-side rendering: pure in-memory storage.
    return new InMemoryExtensionStateRepository();
  }, [extensionStateRepository, userId, hostContext?.projectId]);

  // Load extension packages through the loader.
  const loadResult: ExtensionLoadResult | null = useMemo(() => {
    if (!extensionPackages || extensionPackages.length === 0) return null;
    const loader = new ExtensionLoader(extensionPackages, repository);
    return loader.load();
  }, [extensionPackages, repository]);

  // Combine raw M1 extension configs with package-loaded configs.
  // Raw configs do NOT carry extensionId, so they don't pollute the
  // packages/settings maps in resolveVideoEditorExtensionRuntime.
  const combinedExtensions: VideoEditorExtensionInput = useMemo(() => {
    if (!loadResult) return extensions;

    const rawConfigs: VideoEditorExtensionConfig[] =
      extensions === undefined
        ? []
        : Array.isArray(extensions)
          ? [...extensions]
          : [extensions];

    return [...rawConfigs, ...loadResult.configs];
  }, [extensions, loadResult]);

  return (
    <QueryClientProvider client={ownedQueryClient}>
      <MemoryRouter initialEntries={initialEntries ?? ['/tools/video-editor']}>
        <EditorRuntimeProvider
          dataProvider={dataProvider}
          timelineId={timelineId}
          timelineName={timelineName}
          userId={userId}
          effectCatalog={effectCatalog}
          runtime={{ assetResolver, exporter, hostContext }}
          extensions={combinedExtensions}
        >
          {children}
        </EditorRuntimeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
