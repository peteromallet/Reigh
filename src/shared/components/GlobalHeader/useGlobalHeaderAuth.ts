import { useMemo } from 'react';
import { useAuthSafe } from '@/shared/contexts/AuthContext';
import type { GlobalHeaderAuthState } from './types';

/**
 * Consolidated auth state management for GlobalHeader.
 * Handles session tracking, username fetch, and referral stats.
 */
export function useGlobalHeaderAuth(): GlobalHeaderAuthState {
  const { userId } = useAuthSafe();
  return useMemo(() => ({
    session: userId ? { user: { id: userId } } : null,
    username: userId ? 'Local user' : null,
    // Referral tenancy is a ratified cut surface in local mode.
    referralStats: null,
  }), [userId]);
}
