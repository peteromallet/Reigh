import { useAuthSafe } from '@/shared/contexts/AuthContext';
import type { ReferralStats, GlobalHeaderAuthState } from './types';

/** Header auth derives entirely from the boot probe's fixed local user.
 * The cloud profile (`users.username`) and referral-stats reads were cut
 * with the referral surface (cutover inventory T1.2): the Astrid bridge
 * has no such tables, so both stay honestly null. */
export function useGlobalHeaderAuth(): GlobalHeaderAuthState {
  const { userId } = useAuthSafe();
  const session = userId ? { user: { id: userId } } : null;
  const username: string | null = null;
  const referralStats: ReferralStats | null = null;
  return { session, username, referralStats };
}
