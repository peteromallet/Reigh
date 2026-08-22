import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createDataKindRegistry } from '@/tools/video-editor/data-kinds/DataKindRegistry.ts';
import type {
  DataKindRegistry,
  DataKindRegistrySnapshot,
} from '@/tools/video-editor/data-kinds/DataKindRegistry.ts';

export interface DataKindRegistryContextValue {
  readonly registry: DataKindRegistry;
  readonly snapshot: DataKindRegistrySnapshot;
}

const EMPTY_DATA_KIND_REGISTRY_SNAPSHOT: DataKindRegistrySnapshot = Object.freeze({
  records: Object.freeze([]),
  diagnostics: Object.freeze([]),
  get: () => undefined,
  has: () => false,
});

const DataKindRegistryContext = createContext<DataKindRegistryContextValue | null>(null);

export interface DataKindRegistryProviderProps {
  children: ReactNode;
}

export function DataKindRegistryProvider({
  children,
}: DataKindRegistryProviderProps) {
  const registry = useMemo(() => createDataKindRegistry(), []);
  const subscribe = useCallback((onStoreChange: () => void) => {
    const handle = registry.subscribe(() => onStoreChange());
    return () => handle.dispose();
  }, [registry]);
  const getSnapshot = useCallback(() => registry.getSnapshot(), [registry]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => () => {
    registry.dispose();
  }, [registry]);

  const value = useMemo<DataKindRegistryContextValue>(
    () => ({ registry, snapshot }),
    [registry, snapshot],
  );

  return (
    <DataKindRegistryContext.Provider value={value}>
      {children}
    </DataKindRegistryContext.Provider>
  );
}

export function useDataKindRegistrySnapshot(): DataKindRegistrySnapshot {
  return useOptionalDataKindRegistryContext()?.snapshot ?? EMPTY_DATA_KIND_REGISTRY_SNAPSHOT;
}

export function useDataKindRegistryContext(): DataKindRegistryContextValue {
  const context = useOptionalDataKindRegistryContext();
  if (!context) {
    throw new Error('useDataKindRegistryContext must be called inside a DataKindRegistryProvider');
  }
  return context;
}

export function useOptionalDataKindRegistryContext(): DataKindRegistryContextValue | null {
  return useContext(DataKindRegistryContext);
}
