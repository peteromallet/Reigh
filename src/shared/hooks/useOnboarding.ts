import { useEffect, useState } from 'react';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { isLocalTestMode } from '@/app/localTestRuntime';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';

/**
 * Hook to check if user has completed onboarding and show modal if not
 */
export function useOnboarding() {
  const [showModal, setShowModal] = useState(false);
  const localTestMode = isLocalTestMode();
  const isLocalMode = hasLocalModeUrlParams(typeof window === 'undefined' ? '' : window.location.search);

  useEffect(() => {
    if (localTestMode) return undefined;
  useEffect(() => {
    if (localTestMode || isLocalMode) return;
    let timeoutId: NodeJS.Timeout;

    const checkOnboardingStatus = async () => {
      try {
        const { data: { user } } = await supabase().auth.getUser();

        if (!user) {
          return;
        }

        // Check if user has completed onboarding
        const { data: userData, error } = await supabase().from('users')
          .select('onboarding_completed')
          .eq('id', user.id)
          .single();

        if (error) {
          return;
        }

        if (!userData) {
          return;
        }

        const onboardingCompleted = (userData as Record<string, unknown>).onboarding_completed;

        // If user hasn't completed onboarding, show the modal
        if (!onboardingCompleted) {
          timeoutId = setTimeout(() => {
            setShowModal(true);
          }, 500);
        }

      } catch (error) {
        normalizeAndPresentError(error, { context: 'useOnboarding', showToast: false });
      }
    };

    checkOnboardingStatus();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [localTestMode, isLocalMode]);

  const completeOnboarding = async () => {
    if (localTestMode) return;
  const completeOnboarding = async () => {
    if (localTestMode || isLocalMode) return;
    try {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return;

      await supabase().from('users')
        .update({ onboarding_completed: true })
        .eq('id', user.id);
    } catch (error) {
      normalizeAndPresentError(error, { context: 'useOnboarding', showToast: false });
    }
  };

  return {
    showOnboardingModal: showModal,
    closeOnboardingModal: () => {
      setShowModal(false);
      completeOnboarding();
    },
  };
}
