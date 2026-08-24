import React, { createContext, useContext, type ReactNode } from 'react';
import type { Shot } from '@/domains/generation/types';

export interface ShotsContextType {
  shots: Shot[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetchShots: () => void;
  // Stats for SHOT_FILTER.ALL and SHOT_FILTER.NO_SHOT filters
  allImagesCount?: number;
  noShotImagesCount?: number;
}

const ShotsContext = createContext<ShotsContextType | undefined>(undefined);

interface ShotsProviderProps {
  children: ReactNode;
}

const EMPTY_BRIDGE_SHOTS: ShotsContextType = Object.freeze({
  shots: [],
  isLoading: false,
  error: null,
  refetchShots: () => undefined,
  allImagesCount: 0,
  noShotImagesCount: 0,
});

export function ShotsContextProvider({
  children,
  value,
}: ShotsProviderProps & { value: ShotsContextType }) {
  return (
    <ShotsContext.Provider value={value}>
      {children}
    </ShotsContext.Provider>
  );
}

/**
 * Bridge authority has no relational shots read route. Supply an explicit empty
 * compatibility view without importing or executing the deferred Supabase shot
 * hooks. Document-native groups are owned by the editor runtime instead.
 */
export function AstridShotsProvider({ children }: ShotsProviderProps) {
  return <ShotsContextProvider value={EMPTY_BRIDGE_SHOTS}>{children}</ShotsContextProvider>;
}

export const useShots = (): ShotsContextType => {
  const context = useContext(ShotsContext);
  if (context === undefined) {
    throw new Error('useShots must be used within a shots context provider');
  }
  return context;
}; 
