import { useEffect, useMemo, type ReactNode } from 'react';
import { useLayoutEffect } from 'react';
import { useEffects } from '@/tools/video-editor/hooks/useEffects.ts';
import { useEffectRegistry } from '@/tools/video-editor/hooks/useEffectRegistry.ts';
import {
  EffectCatalogProvider,
  useResolvedEffectCatalog,
  type VideoEditorEffectCatalog,
} from '@/tools/video-editor/hooks/useEffectResources.ts';
import {
  SequenceComponentCatalogProvider,
  useResolvedSequenceComponentCatalog,
  type VideoEditorSequenceComponentCatalog,
} from '@/tools/video-editor/hooks/useSequenceResources.ts';
import { SequenceComponentRegistryProvider } from '@/tools/video-editor/sequences/SequenceComponentRegistryContext.tsx';
import { TimelineStoreProvider } from '@/tools/video-editor/hooks/timelineStore.ts';
import { useTimelineState } from '@/tools/video-editor/hooks/useTimelineState.ts';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import {
  DataProviderWrapper,
  type VideoEditorRuntimeContextValue,
} from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import {
  resolveVideoEditorExtensionRuntimeWithDiagnostics,
  type VideoEditorExtensionInput,
} from '@/tools/video-editor/runtime/extensionSurface.ts';
import type { VideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics.ts';

export interface EditorRuntimeProviderProps {
  dataProvider: DataProvider;
  timelineId: string;
  timelineName?: string | null;
  userId?: string | null;
  effectCatalog?: VideoEditorEffectCatalog | null;
  sequenceComponentCatalog?: VideoEditorSequenceComponentCatalog | null;
  runtime?: Pick<VideoEditorRuntimeContextValue, 'assetResolver' | 'exporter' | 'hostContext'>;
  extensions?: VideoEditorExtensionInput;
  diagnosticsStore?: VideoEditorDiagnosticsStore;
  children: ReactNode;
}

function EditorRuntimeProviderInner({
  children,
  userId,
  effectCatalog,
  sequenceComponentCatalog,
}: {
  children: ReactNode;
  userId: string | null;
  effectCatalog?: VideoEditorEffectCatalog | null;
  sequenceComponentCatalog?: VideoEditorSequenceComponentCatalog | null;
}) {
  const effectsQuery = useEffects(userId, { enabled: !effectCatalog && Boolean(userId) });
  const effectResources = useResolvedEffectCatalog(userId, effectCatalog);
  const sequenceComponentResources = useResolvedSequenceComponentCatalog(
    userId,
    sequenceComponentCatalog,
  );
  useEffectRegistry(
    effectsQuery.data?.map((effect) => ({
      slug: effect.slug,
      code: effect.code,
    })),
    effectResources.effects,
  );

  const { store } = useTimelineState();

  useLayoutEffect(() => {
    store.getState().syncSlices({
      availability: { mounted: true },
    });
  }, [store]);

  return (
    <EffectCatalogProvider value={effectResources}>
      <SequenceComponentCatalogProvider value={sequenceComponentResources}>
        <SequenceComponentRegistryProvider components={sequenceComponentResources.components}>
          <TimelineStoreProvider store={store}>
            {children}
          </TimelineStoreProvider>
        </SequenceComponentRegistryProvider>
      </SequenceComponentCatalogProvider>
    </EffectCatalogProvider>
  );
}

export function EditorRuntimeProvider({
  dataProvider,
  timelineId,
  timelineName,
  userId = null,
  effectCatalog,
  sequenceComponentCatalog,
  runtime,
  extensions,
  diagnosticsStore,
  children,
}: EditorRuntimeProviderProps) {
  // T4: Use the diagnostics-aware resolver so duplicate-contribution and
  // other extension-runtime diagnostics are collected instead of thrown.
  const resolved = useMemo(
    () => resolveVideoEditorExtensionRuntimeWithDiagnostics(extensions),
    [extensions],
  );

  // T4: Publish extension-runtime diagnostics into the store with source
  // replacement so rerenders do not duplicate entries.
  useEffect(() => {
    if (resolved.diagnostics.length > 0) {
      diagnosticsStore!.replaceBySource('extension-runtime', resolved.diagnostics);
    }
  }, [resolved.diagnostics, diagnosticsStore]);

  // T9: Refresh provider/materialization diagnostics when the data provider
  // or timeline identity changes.  Uses source replacement to prevent stale
  // or duplicate entries from accumulating across rerenders.
  useEffect(() => {
    const providerDiagnostics = dataProvider.collectDiagnostics?.();
    if (providerDiagnostics && providerDiagnostics.length > 0) {
      // Collect diagnostics may carry different sources (e.g. asset-materialization).
      // Group by source and replace atomically per source to avoid cross-contamination.
      const bySource = new Map<string, Array<typeof providerDiagnostics[number]>>();
      for (const d of providerDiagnostics) {
        const group = bySource.get(d.source);
        if (group) group.push(d);
        else bySource.set(d.source, [d]);
      }
      for (const [source, diags] of bySource) {
        diagnosticsStore!.replaceBySource(source as any, diags);
      }
    }
  }, [dataProvider, timelineId, diagnosticsStore]);

  return (
    <DataProviderWrapper
      value={{
        provider: dataProvider,
        timelineId,
        timelineName,
        userId,
        assetResolver: runtime?.assetResolver ?? null,
        exporter: runtime?.exporter ?? null,
        hostContext: runtime?.hostContext ?? null,
        extensions: resolved.runtime,
        // diagnosticsStore is always provided — BrowserVideoEditorProvider
        // creates a default store when none is injected.
        diagnosticsStore: diagnosticsStore!,
      }}
    >
      <EditorRuntimeProviderInner
        userId={userId}
        effectCatalog={effectCatalog}
        sequenceComponentCatalog={sequenceComponentCatalog}
      >
        {children}
      </EditorRuntimeProviderInner>
    </DataProviderWrapper>
  );
}

