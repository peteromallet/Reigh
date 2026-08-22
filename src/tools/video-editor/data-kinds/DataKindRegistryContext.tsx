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
  /**
   * dataKind V1 bridge (Wave-3 ruling): an externally-owned registry — the
   * editor runtime assembly's `dataKindRegistryRef` instance. When provided,
   * the provider exposes that instance instead of creating its own, so
   * `ctx.dataKinds.register(...)` writes and `useDataKindRegistrySnapshot()`
   * reads hit the same registry. The provider never disposes an injected
   * registry; disposal stays with the owner.
   */
  registry?: DataKindRegistry;
}

export function DataKindRegistryProvider({
  children,
  registry: bridgedRegistry,
}: DataKindRegistryProviderProps) {
  const ownedRegistry = useMemo(() => createDataKindRegistry(), []);
  const registry = bridgedRegistry ?? ownedRegistry;
  const subscribe = useCallback((onStoreChange: () => void) => {
    const handle = registry.subscribe(() => onStoreChange());
    return () => handle.dispose();
  }, [registry]);
  const getSnapshot = useCallback(() => registry.getSnapshot(), [registry]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (bridgedRegistry) return undefined; // Owner (runtime assembly) disposes it.
    return () => {
      ownedRegistry.dispose();
    };
  }, [bridgedRegistry, ownedRegistry]);

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
