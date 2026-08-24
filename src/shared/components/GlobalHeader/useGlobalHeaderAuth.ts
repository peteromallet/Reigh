import { useEffect, useState } from 'react';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
import { useAuthSafe } from '@/shared/contexts/AuthContext';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { isLocalTestMode } from '@/app/localTestRuntime';
import type { ReferralStats, GlobalHeaderAuthState } from './types';

async function fetchUsername(userId: string): Promise<string | null> {
  const { data, error } = await supabase().from('users').select('username').eq('id', userId).maybeSingle();
  if (error) {
    normalizeAndPresentError(error, { context: 'GlobalHeader.fetchUsername', showToast: false });
    return null;
  }
  return data?.username ?? null;
}

/** Auth is owned by AuthContext; cloud-only profile/referral reads remain deferred
 * and are never touched by the local Astrid journey. */
export function useGlobalHeaderAuth(): GlobalHeaderAuthState {
  const { userId } = useAuthSafe();
  const localTestMode = isLocalTestMode();
  const [username, setUsername] = useState<string | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);

  useEffect(() => {
    if (localTestMode || !userId) {
      setUsername(null);
      return;
    }
    void fetchUsername(userId).then(setUsername);
  }, [localTestMode, userId]);

  useEffect(() => {
    if (localTestMode || !username) {
      setReferralStats(null);
      return;
    }
    void (async () => {
      try {
        const { data, error } = await supabase().from('referral_stats')
          .select('total_visits, successful_referrals').eq('username', username).maybeSingle();
        if (error) throw error;
        setReferralStats({ total_visits: data?.total_visits ?? 0, successful_referrals: data?.successful_referrals ?? 0 });
      } catch (error) {
        normalizeAndPresentError(error, { context: 'GlobalHeader.referralStats', showToast: false });
        setReferralStats(null);
      }
    })();
  }, [localTestMode, username]);

  const session = userId ? ({ user: { id: userId } } as Session) : null;
  return { session, username, referralStats };
}
