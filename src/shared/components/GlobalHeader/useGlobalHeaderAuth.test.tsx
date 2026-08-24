import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalHeaderAuth } from './useGlobalHeaderAuth';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  getAuthStateManager: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
    from: mocks.from,
  }),
}));

vi.mock('@/shared/contexts/AuthContext', () => ({
  useAuthSafe: () => ({
    userId: 'user-1',
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('@/integrations/supabase/auth/AuthStateManager', () => ({
  getAuthStateManager: mocks.getAuthStateManager,
}));

describe('useGlobalHeaderAuth', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/home');
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    mocks.onAuthStateChange.mockReset().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mocks.getAuthStateManager.mockReset().mockReturnValue(null);
    mocks.from.mockReset().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue(table === 'users'
            ? { data: { username: 'peter' }, error: null }
            : { data: { total_visits: 4, successful_referrals: 2 }, error: null }),
        }),
      }),
    }));
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('never touches Supabase in deterministic local-test mode', async () => {
    window.history.replaceState({}, '', '/tools/video-editor/harness?localTest=1');
    const { result } = renderHook(() => useGlobalHeaderAuth());

    expect(result.current).toEqual({
      session: { user: { id: 'user-1' } },
      username: null,
      referralStats: null,
    });
    await Promise.resolve();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getAuthStateManager).not.toHaveBeenCalled();
    expect(mocks.onAuthStateChange).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('loads the cloud-owned profile and referral data outside local-test mode', async () => {
    const { result } = renderHook(() => useGlobalHeaderAuth());

    await waitFor(() => expect(result.current.username).toBe('peter'));
    expect(result.current.referralStats).toEqual({ total_visits: 4, successful_referrals: 2 });
    expect(mocks.from).toHaveBeenCalledWith('users');
    expect(mocks.from).toHaveBeenCalledWith('referral_stats');
    // Auth lifecycle remains owned by AuthContext; this hook only reads the
    // profile/referral records needed by the header.
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getAuthStateManager).not.toHaveBeenCalled();
  });
});
