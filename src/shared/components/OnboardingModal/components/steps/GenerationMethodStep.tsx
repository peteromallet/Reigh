import { ChevronRight, Monitor } from 'lucide-react';
import { DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@/shared/components/ui/segmented-control';
import { useUserUIState } from '@/shared/hooks/useUserUIState';
import { getStepColors } from '@/shared/components/OnboardingModal/lib/onboardingColors';
import type { OnboardingStepProps } from '@/shared/components/OnboardingModal/types';

export function GenerationMethodStep({ onNext }: OnboardingStepProps) {
  const {
    value: generationMethods,
    update: updateGenerationMethods,
    isLoading: isLoadingGenerationMethods,
  } = useUserUIState('generationMethods', { onComputer: true, inCloud: true });

  const colors = getStepColors(3);
  const onComputerChecked = generationMethods.onComputer;
  const inCloudChecked = generationMethods.inCloud;

  if (isLoadingGenerationMethods) {
    return (
      <>
        <DialogHeader className="text-center space-y-4 mb-6">
          <div className={`mx-auto w-16 h-16 ${colors.bg} rounded-full flex items-center justify-center`}>
            <Monitor className={`w-8 h-8 ${colors.icon}`} />
          </div>
          <DialogTitle className="text-2xl font-bold text-center">
            How would you like to generate?
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="text-center">
            <div className="h-4 bg-muted rounded animate-pulse mx-auto w-80" />
            <div className="h-4 bg-muted rounded animate-pulse mx-auto w-48 mt-1" />
          </div>

          <div className="flex justify-center px-4">
            <div className="relative inline-flex items-center bg-muted rounded-full p-1 shadow-inner min-w-fit">
              <div className="flex">
                <div className="px-4 py-2 rounded-full bg-border animate-pulse">
                  <div className="h-4 w-24 bg-muted-foreground/30 rounded" />
                </div>
                <div className="px-4 py-2 rounded-full">
                  <div className="h-4 w-28 bg-border rounded animate-pulse" />
                </div>
              </div>
            </div>
          </div>

          <div className="text-center space-y-3">
            <div className="p-4 bg-muted rounded-lg animate-pulse">
              <div className="h-4 bg-border rounded mx-auto w-64" />
            </div>
          </div>
        </div>

        <div className="flex justify-center pt-5 pb-2">
          <div className="w-full sm:w-auto h-10 bg-border rounded animate-pulse px-8" />
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader className="text-center space-y-4 mb-6">
        <div className={`mx-auto w-16 h-16 ${colors.bg} rounded-full flex items-center justify-center`}>
          <Monitor className={`w-8 h-8 ${colors.icon}`} />
        </div>
        <DialogTitle className="text-2xl font-bold text-center">
          How would you like to generate?
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-6">
        <p className="text-center text-muted-foreground">
          If you have{' '}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="sparkle-underline cursor-pointer transition-colors duration-200">
                  a sufficiently powerful computer
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="center"
                className="flex items-center gap-2 text-left p-3 max-w-xs border-2 border-transparent bg-wes-cream/95 rounded-lg shadow-md transition-all duration-300 hover:bg-gradient-to-r hover:from-wes-pink/10 hover:via-wes-coral/10 hover:to-wes-vintage-gold/10 hover:border-transparent hover:bg-origin-border hover:shadow-2xl hover:-translate-y-1 z-[11100]"
                style={{ zIndex: 11100 }}
              >
                <p className="text-xs sm:text-sm leading-relaxed text-primary">
                  Things are optimized to run on a NVIDIA 4090 - 24GB VRAM GPU -
                  but some models can work on computers with as little as 6GB of
                  VRAM.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          , you can run Reigh <strong>for free</strong> - thanks to the work of{' '}
          <a
            href="https://github.com/deepbeepmeep/Wan2GP"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline text-primary"
          >
            deepbeepmeep
          </a>
          . You can change this later in settings.
        </p>

        <div className="flex justify-center px-4">
          <SegmentedControl
            value={
              inCloudChecked && !onComputerChecked
                ? 'cloud'
                : onComputerChecked && !inCloudChecked
                  ? 'local'
                  : ''
            }
            onValueChange={(value) => {
              if (value === 'cloud') {
                updateGenerationMethods({ inCloud: true, onComputer: false });
              } else if (value === 'local') {
                updateGenerationMethods({ onComputer: true, inCloud: false });
              }
            }}
            variant="pill"
          >
            <SegmentedControlItem value="cloud" colorScheme="blue">
              In the cloud ☁️
            </SegmentedControlItem>
            <SegmentedControlItem value="local" colorScheme="emerald">
              On my computer 💻
            </SegmentedControlItem>
          </SegmentedControl>
        </div>

        <div className="text-center space-y-3">
          {inCloudChecked && !onComputerChecked && (
            <div className="p-4 bg-secondary/50 rounded-lg">
              <p className="text-sm text-secondary-foreground font-light">
                ☁️ Easy setup, pay-per-use, works on any device
              </p>
            </div>
          )}

          {onComputerChecked && !inCloudChecked && (
            <div className="p-4 bg-accent rounded-lg">
              <p className="text-sm text-accent-foreground font-light flex items-center justify-center gap-2">
                <span>💻 Free to use, requires setup, need a good GPU</span>
                <span className="bg-primary text-primary-foreground text-xs font-light px-2 py-1 rounded-full">
                  Free
                </span>
              </p>
            </div>
          )}
        </div>

        {!onComputerChecked && !inCloudChecked && (
          <div className="text-center">
            <img
              src="/generation-method/ds.gif"
              alt="Choose generation method"
              className="w-[120px] h-[120px] object-contain transform scale-x-[-1] mx-auto"
            />
            <p className="text-sm text-muted-foreground mt-2">
              Select at least one option to continue
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-center pt-5 pb-2">
        <Button
          variant="retro"
          size="retro-sm"
          onClick={onNext}
          disabled={!onComputerChecked && !inCloudChecked}
          className="w-full sm:w-auto"
        >
          Continue
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </>
  );
}
