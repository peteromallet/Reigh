import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AssetRegistry } from '@tbd/engine';
import { createDefaultTimelineConfig, type TimelineConfig } from '@tbd/schema';
import { EditorRuntimeProvider } from './contexts/EditorRuntimeContext.js';
import type { DataProvider } from './data/DataProvider.js';
import { InMemoryDataProvider } from './data/InMemoryDataProvider.js';
import { createAssetResolverFromDataProvider, type EditorPorts, type HostContext } from './data/ports.js';
import { createEditorStore, EditorStoreProvider } from './hooks/timelineStore.js';
import { materializeTimelineDocument } from './lib/timeline-data.js';

export * from './lib/duplicate-clip.js';
export * from './lib/interaction-state.js';
export * from './lib/resolve-overlaps.js';
export * from './lib/snap-edges.js';
export * from './lib/timeline-scale.js';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function createDataProviderMock(
  seed?: Record<string, { config: TimelineConfig; registry?: AssetRegistry; name?: string }>,
): DataProvider {
  return new InMemoryDataProvider(seed);
}

export async function createTestTimelineData(input?: {
  timelineId?: string;
  config?: TimelineConfig;
  registry?: AssetRegistry;
  provider?: DataProvider;
}) {
  const timelineId = input?.timelineId ?? 'timeline-1';
  const config = input?.config ?? createDefaultTimelineConfig();
  const registry = input?.registry ?? { assets: {} };
  const provider = input?.provider ?? createDataProviderMock({
    [timelineId]: {
      config,
      registry,
    },
  });

  return materializeTimelineDocument({
    timelineId,
    config,
    configVersion: 1,
    registry,
  }, (file) => provider.resolveAssetUrl(file));
}

export function createEditorTestWrapper(input?: {
  queryClient?: QueryClient;
  provider?: DataProvider;
  timelineId?: string;
  ports?: Partial<EditorPorts>;
  hostContext?: HostContext;
}) {
  const timelineId = input?.timelineId ?? 'timeline-1';
  const provider = input?.provider ?? createDataProviderMock({
    [timelineId]: {
      config: createDefaultTimelineConfig(),
      registry: { assets: {} },
    },
  });
  const ports: EditorPorts = {
    dataProvider: provider,
    ...input?.ports,
  };
  const assetResolver = ports.assetResolver ?? createAssetResolverFromDataProvider(provider);
  const store = createEditorStore({
    timelineId,
    ports: {
      ...ports,
      assetResolver,
    },
    hostContext: input?.hostContext ?? {},
    assetResolver,
  });
  const queryClient = input?.queryClient ?? createTestQueryClient();

  return function EditorTestWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        EditorRuntimeProvider,
        {
          value: { ports: { ...ports, assetResolver }, hostContext: input?.hostContext ?? {}, timelineId },
          children: React.createElement(EditorStoreProvider, { store, children }),
        },
      ),
    );
  };
}

export async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
