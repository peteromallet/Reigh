import React, { createContext, useState, useContext, ReactNode, useEffect, useMemo } from 'react';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { getAuthStateManager } from '@/integrations/supabase/auth/AuthStateManager';
import type { Session } from '@supabase/supabase-js';
import { hasSupabaseConfig } from '@/integrations/supabase/config/env';
import { probeBridgeSession } from '@/shared/auth/bridgeSession';
import { requireContextValue } from './contextGuard';
import { isLocalTestMode } from '@/app/localTestRuntime';

interface AuthContextType {
  userId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isLocalBridgeRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('localProject') || params.has('localTimeline') || !hasSupabaseConfig();
}

/** Uses the Astrid bridge as the authority for local editor routes while
 * retaining the existing Supabase auth lifecycle for cloud routes. */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const localMode = isLocalTestMode() || isLocalBridgeRoute();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(localMode || hasSupabaseConfig());

  useEffect(() => {
    let cancelled = false;
    if (isLocalTestMode()) {
      setUserId(null);
      setIsLoading(false);
      return () => { cancelled = true; };
    }
    if (localMode) {
      void probeBridgeSession().then((probe) => {
        if (cancelled) return;
        setUserId(probe.ok ? probe.userId : null);
        setIsLoading(false);
      });
      return () => { cancelled = true; };
    }

    if (!hasSupabaseConfig()) {
      setIsLoading(false);
      return () => { cancelled = true; };
    }

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastProcessed: string | null = null;
    const process = (session: Session | null) => {
      const next = session?.user?.id ?? null;
      if (next === lastProcessed) return;
      lastProcessed = next;
      React.startTransition(() => setUserId(next));
    };
    const onAuth = (_event: string, session: Session | null) => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => process(session), 150);
    };
    void supabase().auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      process(session);
      setIsLoading(false);
    });
    const manager = getAuthStateManager();
    let unsubscribe: (() => void) | undefined;
    if (manager) unsubscribe = manager.subscribe('AuthContext', onAuth);
    else {
      const { data } = supabase().auth.onAuthStateChange(onAuth);
      unsubscribe = () => data.subscription.unsubscribe();
    }
    return () => {
      cancelled = true;
      if (debounceTimeout) clearTimeout(debounceTimeout);
      unsubscribe?.();
    };
  }, [localMode]);

  const value = useMemo(() => ({ userId, isAuthenticated: !!userId, isLoading }), [userId, isLoading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => requireContextValue(useContext(AuthContext), 'useAuth', 'AuthProvider');
const NO_AUTH = Object.freeze({ userId: null, isAuthenticated: false, isLoading: false });
export const useAuthSafe = (): AuthContextType => useContext(AuthContext) ?? NO_AUTH;
