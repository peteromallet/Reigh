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
    mocks.from.mockReset();
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('never touches Supabase in deterministic local-test mode', async () => {
    window.history.replaceState({}, '', '/tools/video-editor/harness?localTest=1');
    const { result } = renderHook(() => useGlobalHeaderAuth());

    expect(result.current).toEqual({ session: null, username: null, referralStats: null });
    await Promise.resolve();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getAuthStateManager).not.toHaveBeenCalled();
    expect(mocks.onAuthStateChange).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('subscribes normally outside local-test mode', async () => {
    const unsubscribe = vi.fn();
    mocks.getAuthStateManager.mockReturnValue({
      subscribe: vi.fn().mockReturnValue(unsubscribe),
    });
    const { unmount } = renderHook(() => useGlobalHeaderAuth());

    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledOnce());
    expect(mocks.getAuthStateManager).toHaveBeenCalledOnce();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
