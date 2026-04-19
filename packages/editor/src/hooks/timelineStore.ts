import { createContext, createElement, useContext, useRef } from 'react';
import { createStore, type StoreApi, useStore } from 'zustand';
import type { AssetResolver, EditorPorts, HostContext } from '../data/ports.js';
import type { TimelineDocument, TimelineData } from '../types.js';

export interface EditorStoreState {
  timelineId: string;
  hostContext: HostContext;
  ports: EditorPorts;
  assetResolver: AssetResolver;
  document: TimelineDocument | null;
  data: TimelineData | null;
  loading: boolean;
  error: string | null;
  selectedClipIds: string[];
  currentTime: number;
  setDocument: (document: TimelineDocument) => void;
  setData: (data: TimelineData) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedClipIds: (clipIds: string[]) => void;
  setCurrentTime: (time: number) => void;
}

export type EditorStoreApi = StoreApi<EditorStoreState>;

export const createEditorStore = (input: {
  timelineId: string;
  ports: EditorPorts;
  hostContext: HostContext;
  assetResolver: AssetResolver;
}): EditorStoreApi => createStore<EditorStoreState>((set) => ({
  timelineId: input.timelineId,
  hostContext: input.hostContext,
  ports: input.ports,
  assetResolver: input.assetResolver,
  document: null,
  data: null,
  loading: false,
  error: null,
  selectedClipIds: [],
  currentTime: 0,
  setDocument: (document) => set({ document }),
  setData: (data) => set({ data }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSelectedClipIds: (selectedClipIds) => set({ selectedClipIds }),
  setCurrentTime: (currentTime) => set({ currentTime }),
}));

const EditorStoreContext = createContext<EditorStoreApi | null>(null);

export function EditorStoreProvider({
  store,
  children,
}: {
  store: EditorStoreApi;
  children: React.ReactNode;
}) {
  return createElement(EditorStoreContext.Provider, { value: store }, children);
}

export function useEditorStore<T>(selector: (state: EditorStoreState) => T): T {
  const store = useContext(EditorStoreContext);
  if (!store) {
    throw new Error('useEditorStore must be used within EditorStoreProvider');
  }
  return useStore(store, selector);
}

export function useCreateEditorStore(input: {
  timelineId: string;
  ports: EditorPorts;
  hostContext: HostContext;
  assetResolver: AssetResolver;
}): EditorStoreApi {
  const ref = useRef<EditorStoreApi | null>(null);
  if (!ref.current) {
    ref.current = createEditorStore(input);
  }
  return ref.current;
}
