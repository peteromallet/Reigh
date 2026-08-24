import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeferredSession } from '@/integrations/supabase/deferredRuntime';
import {
  AuthStateManager,
  getAuthStateManager,
  initAuthStateManager,
  resetAuthStateManagerForTests,
} from './AuthStateManager';

const { handleErrorMock, requestReconnectMock, initializeReconnectSchedulerMock } = vi.hoisted(() => ({
  handleErrorMock: vi.fn(),
  requestReconnectMock: vi.fn(),
  initializeReconnectSchedulerMock: vi.fn(),
}));

vi.mock('@/shared/lib/errorHandling/runtimeErrorReporting', () => ({
  normalizeAndLogError: handleErrorMock,
}));

vi.mock('@/integrations/supabase/support/reconnect/ReconnectScheduler', () => ({
  initializeReconnectScheduler: initializeReconnectSchedulerMock,
}));

describe('AuthStateManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStateManagerForTests();
    initializeReconnectSchedulerMock.mockReturnValue({
      requestReconnect: requestReconnectMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes and notifies listeners from auth state callbacks', () => {
    const setAuthMock = vi.fn();
    let authCallback: ((event: string, session: DeferredSession | null) => void) | undefined;
    const supabase = {
      auth: {
        onAuthStateChange: (callback: (event: string, session: DeferredSession | null) => void) => {
          authCallback = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      },
      realtime: {
        setAuth: setAuthMock,
      },
    };

    const manager = new AuthStateManager(supabase as never, {
      requestReconnect: requestReconnectMock,
    });
    const listener = vi.fn();
    const unsubscribe = manager.subscribe('layout', listener);
    manager.init();

    authCallback?.('SIGNED_OUT', null);
    expect(listener).toHaveBeenCalledWith('SIGNED_OUT', null);
    expect(setAuthMock).toHaveBeenCalledWith(null);

    unsubscribe();
    authCallback?.('SIGNED_IN', { access_token: 'token' } as DeferredSession);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('schedules reconnect healing on SIGNED_IN with debounce', async () => {
    vi.useFakeTimers();
    const setAuthMock = vi.fn();
    let authCallback: ((event: string, session: DeferredSession | null) => void) | undefined;
    const supabase = {
      auth: {
        onAuthStateChange: (callback: (event: string, session: DeferredSession | null) => void) => {
          authCallback = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      },
      realtime: {
        setAuth: setAuthMock,
      },
    };

    const manager = new AuthStateManager(supabase as never, {
      requestReconnect: requestReconnectMock,
    });
    manager.init();

    authCallback?.('SIGNED_IN', { access_token: 'token-1' } as DeferredSession);
    await vi.advanceTimersByTimeAsync(1000);
    expect(setAuthMock).toHaveBeenCalledWith('token-1');
    expect(requestReconnectMock).toHaveBeenCalledTimes(1);

    authCallback?.('SIGNED_IN', { access_token: 'token-2' } as DeferredSession);
    await vi.advanceTimersByTimeAsync(1000);
    expect(requestReconnectMock).toHaveBeenCalledTimes(1);
    expect(handleErrorMock).not.toHaveBeenCalled();
  });

  it('initializes module auth manager singleton', () => {
    const supabase = {
      auth: {
        onAuthStateChange: vi.fn(),
      },
      realtime: {
        setAuth: vi.fn(),
      },
    };

    initAuthStateManager(supabase as never);

    const manager = getAuthStateManager();
    expect(manager).toBeDefined();
    expect(typeof manager?.subscribe).toBe('function');
    expect(initializeReconnectSchedulerMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the singleton for the same client and scheduler, but rejects conflicting dependencies', () => {
    const scheduler = { requestReconnect: requestReconnectMock };
    const supabase = {
      auth: {
        onAuthStateChange: vi.fn(),
      },
      realtime: {
        setAuth: vi.fn(),
      },
    };
    const otherSupabase = {
      auth: {
        onAuthStateChange: vi.fn(),
      },
      realtime: {
        setAuth: vi.fn(),
      },
    };
    const otherScheduler = { requestReconnect: vi.fn() };

    const first = initAuthStateManager(supabase as never, scheduler);
    const second = initAuthStateManager(supabase as never, scheduler);

    expect(second).toBe(first);
    expect(() => initAuthStateManager(otherSupabase as never, scheduler)).toThrow(
      'AuthStateManager is already initialized with different runtime dependencies.',
    );
    expect(() => initAuthStateManager(supabase as never, otherScheduler)).toThrow(
      'AuthStateManager is already initialized with different runtime dependencies.',
    );
  });
});
