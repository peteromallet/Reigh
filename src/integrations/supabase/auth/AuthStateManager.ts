import { normalizeAndLogError } from '@/shared/lib/errorHandling/runtimeErrorReporting';
import { initializeReconnectScheduler } from '@/integrations/supabase/support/reconnect/ReconnectScheduler';
import type { DeferredSession, DeferredSupabaseClient } from '@/integrations/supabase/deferredRuntime';

type AuthCallback = (event: string, session: DeferredSession | null) => void;
type ReconnectRequester = {
  requestReconnect: (intent: {
    source: string;
    reason: string;
    priority: 'low' | 'medium' | 'high';
  }) => void;
};

const AUTH_HEAL_DEBOUNCE_MS = 5000;

export class AuthStateManager {
  private listeners: Array<{ id: string; callback: AuthCallback }> = [];
  private isInitialized = false;
  private __LAST_AUTH_HEAL_AT__ = 0;

  constructor(
    private supabase: DeferredSupabaseClient,
    private reconnectScheduler: ReconnectRequester,
  ) {}

  subscribe(id: string, callback: AuthCallback) {
    this.listeners.push({ id, callback });
    return () => {
      this.listeners = this.listeners.filter(listener => listener.id !== id);
    };
  }

  private notifyListeners(event: string, session: DeferredSession | null) {
    this.listeners.forEach(({ callback }) => {
      try {
        callback(event, session);
      } catch (error) {
        normalizeAndLogError(error, { context: 'AuthStateManager' });
      }
    });
  }

  private handleCoreAuth(event: string, session: DeferredSession | null) {
    try {
      this.supabase?.realtime?.setAuth?.(session?.access_token ?? null);

      if (event === 'SIGNED_IN' && typeof window !== 'undefined') {
        setTimeout(async () => {
          try {
            const now = Date.now();
            if (
              this.__LAST_AUTH_HEAL_AT__ === 0 ||
              now - this.__LAST_AUTH_HEAL_AT__ > AUTH_HEAL_DEBOUNCE_MS
            ) {
              this.__LAST_AUTH_HEAL_AT__ = now;

              this.reconnectScheduler.requestReconnect({
                source: 'AuthManager',
                reason: `SIGNED_IN event (${event})`,
                priority: 'high',
              });
            }
          } catch (healError) {
            normalizeAndLogError(healError, { context: 'AuthStateManager' });
          }
        }, 1000);
      }
    } catch (setAuthError) {
      normalizeAndLogError(setAuthError, { context: 'AuthStateManager' });
    }
  }

  init() {
    if (this.isInitialized) {
      return;
    }

    try {
      this.supabase.auth.onAuthStateChange((event, session) => {
        this.handleCoreAuth(event, session);
        this.notifyListeners(event, session);
      });
      this.isInitialized = true;
    } catch (authError) {
      normalizeAndLogError(authError, { context: 'AuthStateManager' });
    }
  }
}

let authStateManager: AuthStateManager | null = null;
let authStateManagerClient: DeferredSupabaseClient | null = null;
let authStateManagerReconnectScheduler: ReconnectRequester | null = null;

export function initAuthStateManager(
  supabase: DeferredSupabaseClient,
  reconnectScheduler: ReconnectRequester = initializeReconnectScheduler(),
): AuthStateManager {
  if (authStateManager) {
    if (authStateManagerClient !== supabase || authStateManagerReconnectScheduler !== reconnectScheduler) {
      throw new Error(
        'AuthStateManager is already initialized with different runtime dependencies.',
      );
    }
    return authStateManager;
  }

  authStateManagerClient = supabase;
  authStateManagerReconnectScheduler = reconnectScheduler;

  if (!authStateManager) {
    authStateManager = new AuthStateManager(supabase, reconnectScheduler);
    authStateManager.init();
  }
  return authStateManager;
}

export function getAuthStateManager(): AuthStateManager | null {
  return authStateManager;
}

export function resetAuthStateManagerForTests(): void {
  authStateManager = null;
  authStateManagerClient = null;
  authStateManagerReconnectScheduler = null;
}
