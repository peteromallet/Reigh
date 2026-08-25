import React, { createContext, useState, useContext, ReactNode, useEffect, useMemo } from 'react';
import { probeBridgeSession } from '@/shared/auth/bridgeSession';
import { requireContextValue } from './contextGuard';
import { isLocalTestMode } from '@/app/localTestRuntime';

interface AuthContextType {
  userId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Boot/auth seam: one `/api/astrid` health probe per boot IS the session
 * (doc 27 §local-trust). A healthy bridge resolves the fixed local user;
 * failure degrades to alive-but-unauthenticated with exactly one probe.
 * The per-boot request token lives at the vite-proxy layer and never
 * reaches browser code. */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const localTestMode = isLocalTestMode();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!localTestMode);

  useEffect(() => {
    if (localTestMode) {
      setUserId(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    void probeBridgeSession().then((probe) => {
      if (cancelled) return;
      setUserId(probe.ok ? probe.userId : null);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [localTestMode]);

  const value = useMemo(() => ({ userId, isAuthenticated: !!userId, isLoading }), [userId, isLoading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => requireContextValue(useContext(AuthContext), 'useAuth', 'AuthProvider');
const NO_AUTH = Object.freeze({ userId: null, isAuthenticated: false, isLoading: false });
export const useAuthSafe = (): AuthContextType => useContext(AuthContext) ?? NO_AUTH;
