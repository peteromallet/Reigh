import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw, Stethoscope } from 'lucide-react';
import { DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { getStepColors } from '@/shared/components/OnboardingModal/lib/onboardingColors';
import type { OnboardingStepProps } from '@/shared/components/OnboardingModal/types';
import {
  ASTRID_DOCTOR_COMMAND,
  checkAstridDoctorAvailability,
  type AstridDoctorAvailability,
} from '@/integrations/astrid/doctorAvailability.ts';
import { getBridgeRecoveryGuidance } from '@/integrations/astrid/bridgeRecovery.ts';

export function SetupCompleteStep({ onClose }: OnboardingStepProps) {
  const colors = getStepColors(6);
  const [availability, setAvailability] = useState<AstridDoctorAvailability>({
    status: 'checking',
  });
  const requestVersionRef = useRef(0);
  const unavailableRecovery = getBridgeRecoveryGuidance('capability_unavailable');

  const checkAvailability = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    setAvailability({ status: 'checking' });
    const result = await checkAstridDoctorAvailability();
    if (requestVersionRef.current === requestVersion) {
      setAvailability(result);
    }
  }, []);

  useEffect(() => {
    void checkAvailability();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [checkAvailability]);

  return (
    <>
      <DialogHeader className="text-center space-y-4 mb-6">
        <div className={`mx-auto w-16 h-16 ${colors.bg} rounded-full flex items-center justify-center`}>
          {availability.status === 'available' ? (
            <CheckCircle2 className={`w-8 h-8 ${colors.icon}`} />
          ) : (
            <Stethoscope className={`w-8 h-8 ${colors.icon}`} />
          )}
        </div>
        <DialogTitle className="text-2xl font-bold text-center">
          Check your local setup
        </DialogTitle>
      </DialogHeader>

      <div className="text-center space-y-4">
        {availability.status === 'checking' && (
          <p role="status" className="text-muted-foreground">
            Checking that Astrid's local runtime is available…
          </p>
        )}

        {availability.status === 'available' && (
          <div role="status" className="space-y-2">
            <p className="font-medium">Astrid is ready</p>
            <p className="text-muted-foreground">
              The local bridge is available. You can start creating without cloud setup.
            </p>
          </div>
        )}

        {availability.status === 'degraded' && (
          <div role="status" className="space-y-2 text-left rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
            <p className="font-medium">Astrid is reachable with limited features</p>
            <p className="text-sm text-muted-foreground">
              Timeline editing is available, but {availability.unavailable.length > 0
                ? `${availability.unavailable.join(', ')} support is missing`
                : `${availability.unknown.join(', ')} support could not be verified`}.
              {' '}{availability.reason}
            </p>
            <p className="text-sm text-muted-foreground">
              Run <code>{ASTRID_DOCTOR_COMMAND}</code> to upgrade or repair those capabilities.
            </p>
          </div>
        )}

        {availability.status === 'unavailable' && (
          <div role="alert" className="space-y-2 text-left rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-medium">{unavailableRecovery.title}</p>
            <p className="text-sm text-muted-foreground">{unavailableRecovery.detail}</p>
            <p className="text-sm text-muted-foreground">
              {availability.reason}. Run <code>{ASTRID_DOCTOR_COMMAND}</code>, resolve the reported issue,
              then check again.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-y-2 pt-5 pb-2">
        {availability.status === 'unavailable' ? (
          <Button variant="retro" size="retro-sm" onClick={() => void checkAvailability()} className="w-full">
            <RefreshCw className="w-4 h-4 mr-2" />
            Check Astrid Again
          </Button>
        ) : (
          <Button
            variant="retro"
            size="retro-sm"
            onClick={onClose}
            disabled={availability.status === 'checking'}
            className="w-full"
          >
            {availability.status === 'degraded' ? 'Continue with Available Features' : 'Start Creating'}
          </Button>
        )}
      </div>
    </>
  );
}
