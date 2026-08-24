import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { useOnboarding } from '@/shared/hooks/useOnboarding';
import { useUserUIState } from '@/shared/hooks/useUserUIState';
import { useProductTour } from '@/shared/hooks/useProductTour';
import {
  checkAstridDoctorAvailability,
  type AstridDoctorAvailability,
} from '@/integrations/astrid/doctorAvailability.ts';
import { getBridgeRecoveryGuidance } from '@/integrations/astrid/bridgeRecovery.ts';

export function useOnboardingFlow() {
  const { showOnboardingModal, closeOnboardingModal } = useOnboarding();
  const navigate = useNavigate();
  const { startTour } = useProductTour();
  const tourStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const availabilityRequestRef = useRef(0);
  const [doctorAvailability, setDoctorAvailability] = useState<AstridDoctorAvailability>({
    status: 'checking',
  });

  const clearTourStartTimeout = useCallback(() => {
    if (tourStartTimeoutRef.current) {
      clearTimeout(tourStartTimeoutRef.current);
      tourStartTimeoutRef.current = null;
    }
  }, []);

  const refreshDoctorAvailability = useCallback(async () => {
    const requestVersion = ++availabilityRequestRef.current;
    setDoctorAvailability({ status: 'checking' });
    const result = await checkAstridDoctorAvailability();
    if (availabilityRequestRef.current === requestVersion) {
      setDoctorAvailability(result);
    }
    return result;
  }, []);

  // The shots pack has no frozen v1 route, so the old Supabase lookup cannot
  // choose a "Getting Started" shot in local mode. Check the doctor-owned
  // runtime instead, then enter the tool without fabricating a shot identity.
  const handleOnboardingClose = useCallback(async () => {
    const availability = await refreshDoctorAvailability();
    if (availability.status === 'unavailable') {
      const recovery = getBridgeRecoveryGuidance('capability_unavailable');
      normalizeAndPresentError(
        new Error(`${availability.reason}. ${recovery.nextAction}`),
        {
          context: 'useOnboardingFlow.doctorUnavailable',
          showToast: true,
        },
      );
      return;
    }

    closeOnboardingModal();
    navigate('/tools/travel-between-images');
    clearTourStartTimeout();
    tourStartTimeoutRef.current = setTimeout(() => {
      tourStartTimeoutRef.current = null;
      startTour();
    }, 1000);
  }, [clearTourStartTimeout, closeOnboardingModal, navigate, refreshDoctorAvailability, startTour]);

  // Preload user settings to warm the cache for the welcome modal
  useUserUIState('generationMethods', { onComputer: true, inCloud: true });

  // Preload ProductTour chunk when onboarding is shown
  useEffect(() => {
    if (showOnboardingModal) {
      void refreshDoctorAvailability();
      import('@/shared/components/ProductTour').catch((error) => {
        normalizeAndPresentError(error, {
          context: 'useOnboardingFlow.preloadProductTour',
          showToast: false,
        });
      });
    }
  }, [refreshDoctorAvailability, showOnboardingModal]);

  useEffect(() => () => {
    availabilityRequestRef.current += 1;
    clearTourStartTimeout();
  }, [clearTourStartTimeout]);

  return {
    showOnboardingModal,
    handleOnboardingClose,
    doctorAvailability,
  };
}
