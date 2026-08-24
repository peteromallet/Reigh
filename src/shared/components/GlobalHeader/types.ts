export interface HeaderSession {
  user: { id: string };
}

export interface GlobalHeaderProps {
  contentOffsetRight?: number;
  contentOffsetLeft?: number;
  onOpenSettings?: () => void;
}

export interface ReferralStats {
  total_visits: number;
  successful_referrals: number;
}

export interface GlobalHeaderAuthState {
  session: HeaderSession | null;
  username: string | null;
  referralStats: ReferralStats | null;
}

/** Dark mode icon color tokens (very muted/faded versions) */
export const darkIconColors = {
  palette: '#a098a8',    // lavender (faded)
  coral: '#a89090',      // coral (faded)
  yellow: '#a8a088',     // gold (faded)
  blue: '#8898a8',       // dusty-blue (faded)
} as const;

/** Get subtle background style for dark mode icons */
export const getDarkIconStyle = (color: string, darkMode: boolean) => darkMode ? {
  borderColor: color,
  backgroundColor: `${color}0d` // 0d = ~5% opacity
} : undefined;

/** Generate dynamic referral button text based on stats */
export function getReferralButtonText(session: HeaderSession | null, referralStats: ReferralStats | null): string {
  if (!session || !referralStats) {
    return "You've referred 0 visitors :(";
  }

  const { total_visits, successful_referrals } = referralStats;

  // Prioritize signups over visitors
  if (successful_referrals > 0) {
    const signupText = successful_referrals === 1 ? "signup" : "signups";
    const visitorText = total_visits === 1 ? "visitor" : "visitors";
    return `${successful_referrals} ${signupText} & ${total_visits} ${visitorText} referred!`;
  }

  // Show visitors if any
  if (total_visits > 0) {
    const visitorText = total_visits === 1 ? "visitor" : "visitors";
    return `You've referred ${total_visits} ${visitorText}!`;
  }

  // Default text when no stats
  return "You've referred 0 visitors :(";
}
