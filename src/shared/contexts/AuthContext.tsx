import React, {
  createContext,
  useState,
  useContext,
  ReactNode,
  useEffect,
  useMemo
} from 'react';
import { probeBridgeSession } from '@/shared/auth/bridgeSession';
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
 * AuthProvider resolves the session by probing the Astrid local bridge.
 *
 * There is no login and no credential: a healthy `/api/astrid` IS the
 * session, and the resolved identity is the fixed local user. The probe
 * runs once per boot — no polling, no retries, no redirects:
 * - while probing: `isLoading: true` (`AuthGate` holds children back)
 * - healthy bridge: `userId` set, `isAuthenticated: true`
 * - unreachable bridge: honest failure state; the layout stays alive
 *   (degraded) rather than looping a redirect to an auth page that
 *   no longer exists.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [authState, setAuthState] = useState<{
    userId: string | null;
    isLoading: boolean;
  }>({ userId: null, isLoading: true });

  useEffect(() => {
    let cancelled = false;

    void probeBridgeSession().then((probe) => {
      if (cancelled) {
        return;
      }
      setAuthState({
        userId: probe.ok ? probe.userId : null,
        isLoading: false,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      userId: authState.userId,
      isAuthenticated: !!authState.userId,
      isLoading: authState.isLoading,
    }),
    [authState]
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
