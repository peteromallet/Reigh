import { useState, useEffect } from 'react';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { getAuthStateManager } from '@/integrations/supabase/auth/AuthStateManager';
import type { Session } from '@supabase/supabase-js';
import type { ReferralStats, GlobalHeaderAuthState } from './types';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { isLocalTestMode } from '@/app/localTestRuntime';

/** Fetch username for a given user ID */
async function fetchUsername(userId: string): Promise<string | null> {
  const { data, error } = await supabase().from('users')
    .select('username')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    normalizeAndPresentError(error, { context: 'GlobalHeader.fetchUsername', showToast: false });
    return null;
  }

  return data?.username ?? null;
}

/**
 * Consolidated auth state management for GlobalHeader.
 * Handles session tracking, username fetch, and referral stats.
 */
export function useGlobalHeaderAuth(): GlobalHeaderAuthState {
  const localTestMode = isLocalTestMode();
  const [session, setSession] = useState<Session | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);

  // Track session + username
  useEffect(() => {
    if (localTestMode) return undefined;
    const getSessionAndUserData = async () => {
      const { data: { session }, error } = await supabase().auth.getSession();
      if (error) {
        normalizeAndPresentError(error, { context: 'GlobalHeader.getSession', showToast: false });
      }
      setSession(session);

      if (session?.user?.id) {
        const name = await fetchUsername(session.user.id);
        setUsername(name);
      }
    };

    getSessionAndUserData();

    // Use centralized auth manager instead of direct listener
    const authManager = getAuthStateManager();
    let unsubscribe: (() => void) | null = null;

    const handleAuthChange = async (_event: string, newSession: Session | null) => {
      setSession(newSession);

      if (!newSession?.user?.id) {
        setUsername(null);
        setReferralStats(null);
      } else {
        const name = await fetchUsername(newSession.user.id);
        setUsername(name);
      }
    };

    if (authManager) {
      unsubscribe = authManager.subscribe('GlobalHeader', handleAuthChange);
    } else {
      // Fallback to direct listener if auth manager not available
      const { data: { subscription } } = supabase().auth.onAuthStateChange(handleAuthChange);
      unsubscribe = () => subscription?.unsubscribe();
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [localTestMode]);

  // Get referral stats when username is available
  useEffect(() => {
    if (localTestMode) {
      setReferralStats(null);
      return;
    }
    const getReferralStats = async () => {
      if (!username) {
        setReferralStats(null);
        return;
      }

      try {
        const { data, error } = await supabase().from('referral_stats')
          .select('total_visits, successful_referrals')
          .eq('username', username)
          .maybeSingle();

        if (error) {
          normalizeAndPresentError(error, { context: 'GlobalHeader.referralStats', showToast: false });
          setReferralStats(null);
          return;
        }

        if (!data) {
          setReferralStats({ total_visits: 0, successful_referrals: 0 });
          return;
        }

        setReferralStats({
          total_visits: data.total_visits ?? 0,
          successful_referrals: data.successful_referrals ?? 0,
        });
      } catch (error) {
        normalizeAndPresentError(error, { context: 'GlobalHeader.referralStats', showToast: false });
        setReferralStats(null);
      }
    };

    getReferralStats();
  }, [localTestMode, username]);

  return { session, username, referralStats };
}
