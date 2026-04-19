import { useEffect } from 'react';
import { createDefaultTimelineConfig } from '@tbd/schema';
import { EditorRuntimeProvider } from './contexts/EditorRuntimeContext.js';
import { createAssetResolverFromDataProvider, type EditorPorts, type HostContext } from './data/ports.js';
import { useCreateEditorStore, EditorStoreProvider } from './hooks/timelineStore.js';
import { loadTimelineDocument, materializeTimelineDocument } from './lib/timeline-data.js';
import type { TimelineDocument } from './types.js';

export interface EditorProviderProps {
  ports: EditorPorts;
  hostContext?: HostContext;
  initialDocument?: TimelineDocument;
  timelineId?: string;
  children: React.ReactNode;
}

export function EditorProvider({
  ports,
  hostContext = {},
  initialDocument,
  timelineId,
  children,
}: EditorProviderProps) {
  const resolvedTimelineId = timelineId ?? initialDocument?.timelineId ?? 'timeline';
  const assetResolver = ports.assetResolver ?? createAssetResolverFromDataProvider(ports.dataProvider);
  const store = useCreateEditorStore({
    timelineId: resolvedTimelineId,
    ports,
    hostContext,
    assetResolver,
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      store.getState().setLoading(true);
      store.getState().setError(null);
      try {
        const document = initialDocument ?? await loadTimelineDocument(ports.dataProvider, resolvedTimelineId);
        if (cancelled) return;
        store.getState().setDocument(document);
        const data = await materializeTimelineDocument(document, (file) => assetResolver.resolveAssetUrl({
          file,
          mode: 'preview',
        }));
        if (cancelled) return;
        store.getState().setData(data);
      } catch (error) {
        if (cancelled) return;
        store.getState().setError(error instanceof Error ? error.message : String(error));
        if (!initialDocument) {
          const fallbackDocument: TimelineDocument = {
            timelineId: resolvedTimelineId,
            config: createDefaultTimelineConfig(),
            configVersion: 1,
            registry: { assets: {} },
          };
          store.getState().setDocument(fallbackDocument);
          const data = await materializeTimelineDocument(fallbackDocument, (file) => assetResolver.resolveAssetUrl({
            file,
            mode: 'preview',
          }));
          if (!cancelled) {
            store.getState().setData(data);
          }
        }
      } finally {
        if (!cancelled) {
          store.getState().setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [assetResolver, initialDocument, ports.dataProvider, resolvedTimelineId, store]);

  return (
    <EditorRuntimeProvider value={{ ports, hostContext, timelineId: resolvedTimelineId }}>
      <EditorStoreProvider store={store}>
        {children}
      </EditorStoreProvider>
    </EditorRuntimeProvider>
  );
}
