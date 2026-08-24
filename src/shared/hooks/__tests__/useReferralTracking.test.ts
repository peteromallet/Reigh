import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockRpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock('@/shared/lib/taskCreation', () => ({
  generateUUID: vi.fn(() => 'mock-uuid'),
}));

import { useReferralTracking } from '../useReferralTracking';

describe('useReferralTracking', () => {
  const originalLocation = window.location;
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Mock crypto.subtle
    Object.defineProperty(global, 'crypto', {
      value: {
        subtle: {
          digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      writable: true,
      configurable: true,
    });
  });

  it('does nothing when no referrer code in URL', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    });
    renderHook(() => useReferralTracking());
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('tracks referral when code is present', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?from=testuser' },
      writable: true,
    });
    mockRpc.mockResolvedValue({ data: 'session-id', error: null });

    renderHook(() => useReferralTracking());

    // Give the async effect time to run
    await vi.waitFor(() => {
      expect(localStorage.getItem('referralCode')).toBe('testuser');
    });
  });

  it('creates or retrieves session ID', () => {
    localStorage.removeItem('sessionId');
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    });
    renderHook(() => useReferralTracking());
    // Session ID should be created even without referral code
    expect(localStorage.getItem('sessionId')).toBeTruthy();
  });
});
