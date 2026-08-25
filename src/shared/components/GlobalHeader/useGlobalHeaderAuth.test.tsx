import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGlobalHeaderAuth } from './useGlobalHeaderAuth';

const mocks = vi.hoisted(() => ({
  userId: vi.fn<[], string | null>(() => 'user-1'),
}));

vi.mock('@/shared/contexts/AuthContext', () => ({
  useAuthSafe: () => ({
    userId: mocks.userId(),
    isAuthenticated: true,
    isLoading: false,
  }),
}));

describe('useGlobalHeaderAuth', () => {
  it('derives the header session from the boot probe user without any network read', () => {
    const { result } = renderHook(() => useGlobalHeaderAuth());

    expect(result.current).toEqual({
      session: { user: { id: 'user-1' } },
      username: null,
      referralStats: null,
    });
    expect(mocks.userId).toHaveBeenCalledTimes(1);
  });

  it('stays anonymous when the boot probe resolved no user', () => {
    mocks.userId.mockReturnValue(null);
    const { result } = renderHook(() => useGlobalHeaderAuth());

    expect(result.current.session).toBeNull();
    expect(result.current.username).toBeNull();
    expect(result.current.referralStats).toBeNull();
  });
});
