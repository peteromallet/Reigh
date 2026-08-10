import React, {
  createContext,
  useState,
  useContext,
  ReactNode,
  useEffect,
  useMemo
} from 'react';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { getAuthStateManager } from '@/integrations/supabase/auth/AuthStateManager';
import type { Session } from '@supabase/supabase-js';
import { requireContextValue } from './contextGuard';

interface AuthContextType {
  /** Current authenticated user ID, null if not logged in */
  userId: string | null;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Whether the initial auth check is still in progress */
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider handles authentication state and event debouncing.
 *
 * Features:
 * - [AuthDebounce] Debounces duplicate auth events to prevent cascading updates
 * - [MobileStallFix] Resets loading states on meaningful auth transitions
 * - [FastResume] Provides immediate auth state for fast tab resume
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  // [MobileStallFix] Enhanced auth state tracking with mobile recovery
  // [AuthDebounce] Prevent cascading updates from duplicate auth events
  useEffect(() => {
    let debounceTimeout: NodeJS.Timeout | null = null;
    let lastProcessedState: { event: string; userId: string | undefined } | null = null;
    let pendingAuthState: { event: string; session: Session | null } | null = null;

    const processAuthChange = (event: string, session: Session | null) => {
      const currentUserId = session?.user?.id;

      // Check if this is a meaningful state transition
      const isDuplicateEvent = lastProcessedState &&
        lastProcessedState.event === event &&
        lastProcessedState.userId === currentUserId;

      if (isDuplicateEvent) {
        return;
      }

      // Update user ID
      setUserId(currentUserId);

      // Track the processed state
      lastProcessedState = { event, userId: currentUserId };
    };

    const handleAuthStateChange = (event: string, session: Session | null) => {
      // Store the latest auth state
      pendingAuthState = { event, session };

      // Clear existing debounce timer
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      // [AuthDebounce] Wait 150ms for additional auth events before processing
      debounceTimeout = setTimeout(() => {
        if (pendingAuthState) {
          const { event: pendingEvent, session: pendingSession } = pendingAuthState;
          React.startTransition(() => {
            processAuthChange(pendingEvent, pendingSession);
          });
          pendingAuthState = null;
        }
        debounceTimeout = null;
      }, 150);
    };

    supabase().auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id);
      setIsLoading(false);
      lastProcessedState = { event: 'INITIAL_SESSION', userId: session?.user?.id };
    });

    // Use centralized auth manager instead of direct listener
    const authManager = getAuthStateManager();
    let unsubscribe: (() => void) | null = null;

    if (authManager) {
      unsubscribe = authManager.subscribe('AuthContext', handleAuthStateChange);
    } else {
      // Fallback to direct listener if auth manager not available
      const { data: listener } = supabase().auth.onAuthStateChange(handleAuthStateChange);
      unsubscribe = () => listener.subscription.unsubscribe();
    }

    return () => {
      if (unsubscribe) unsubscribe();
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
        // Process final pending state on cleanup if needed
        if (pendingAuthState) {
          processAuthChange(pendingAuthState.event, pendingAuthState.session);
        }
      }
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      userId: userId ?? null,
      isAuthenticated: !!userId,
      isLoading,
    }),
    [userId, isLoading]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Hook to access authentication state.
 *
 * @returns { userId, isAuthenticated }
 */
export const useAuth = () => {
  return requireContextValue(useContext(AuthContext), 'useAuth', 'AuthProvider');
};

const NO_AUTH = Object.freeze({ userId: null, isAuthenticated: false, isLoading: false });

/**
 * Non-throwing auth read: returns a logged-out shape outside `AuthProvider`.
 *
 * For hooks that must not crash when rendered without the provider tree (e.g.
 * shared data hooks mounted in tests or host surfaces that omit it), the
 * logged-out shape disables auth-gated queries instead of throwing.
 */
export const useAuthSafe = (): AuthContextType => {
  return useContext(AuthContext) ?? NO_AUTH;
};
