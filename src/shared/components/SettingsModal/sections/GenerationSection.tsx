import React from "react";
import { Key } from "lucide-react";
import { SegmentedControl, SegmentedControlItem } from "@/shared/components/ui/segmented-control";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Button } from "@/shared/components/ui/button";
import { CreditsManagement } from "@/domains/billing/components/CreditsManagement/CreditsManagement";
import type { GenerationSectionProps } from "../types";
import { GenerationTokenPanel } from "./GenerationSection/components/GenerationTokenPanel";

const GenerationSection: React.FC<GenerationSectionProps> = ({
  isMobile,
  onComputerChecked,
  inCloudChecked,
  updateGenerationMethodsWithNotification,
  isLoadingGenerationMethods,
  hasValidToken,
  generatedToken,
  handleGenerateToken,
  isGenerating,
  getActiveToken,
  launchConfig,
  launchSetters,
  activeInstallTab,
  setActiveInstallTab,
  creditsTab = "purchase",
}) => {
  return (
    <>
      <div className={`${isMobile ? 'mb-3' : 'mb-5'}`}>
        {isMobile && (
          <div className="mb-2">
            <p className="text-sm text-muted-foreground mb-4">How would you like to generate?</p>
          </div>
        )}

        <div className={`${isMobile ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-6'} items-start`}>
          <div className="space-y-2 sm:space-y-4">
            {!isMobile && (
              <p className="text-sm text-muted-foreground mb-4">How would you like to generate?</p>
            )}

            {isLoadingGenerationMethods ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-64 rounded-full" />
              </div>
            ) : (
              <div className="flex items-center justify-start">
                <SegmentedControl
                  value={inCloudChecked && !onComputerChecked ? 'cloud' : onComputerChecked && !inCloudChecked ? 'local' : ''}
                  onValueChange={(value) => {
                    if (value === 'cloud') {
                      updateGenerationMethodsWithNotification({ inCloud: true, onComputer: false });
                    } else if (value === 'local') {
                      updateGenerationMethodsWithNotification({ onComputer: true, inCloud: false });
                    }
                  }}
                  variant="pill"
                >
                  <SegmentedControlItem value="cloud" colorScheme="blue">
                    In the cloud
                  </SegmentedControlItem>
                  <SegmentedControlItem value="local" colorScheme="emerald">
                    On my computer
                  </SegmentedControlItem>
                </SegmentedControl>
              </div>
            )}
          </div>

          <div className="flex justify-start items-start">
            {!isLoadingGenerationMethods && !onComputerChecked && !inCloudChecked && (
              <img
                src="/generation-method/ds.gif"
                alt="Choose generation method"
                className="w-[120px] h-[120px] object-contain transform scale-x-[-1]"
              />
            )}
          </div>
        </div>
      </div>

      <div className={`space-y-6 sm:space-y-8 ${isMobile ? 'pb-2' : 'pb-2'}`}>
        {isLoadingGenerationMethods && (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
            <div className="space-y-4">
              <Skeleton className="h-6 w-40" />
              <div className="space-y-3">
                <Skeleton className="h-10 w-full rounded-md" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            </div>
          </div>
        )}

        {!isLoadingGenerationMethods && inCloudChecked && (
          <div className="space-y-3 sm:space-y-4">
            <CreditsManagement initialTab={creditsTab} mode="add-credits" />
          </div>
        )}

        {!isLoadingGenerationMethods && onComputerChecked && (
          <div className="space-y-3 sm:space-y-4">
            {!hasValidToken ? (
              <div className="space-y-3 sm:space-y-4">
                <div className="p-3 sm:p-4 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-950/40 dark:border-blue-900/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Key className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <h4 className="font-light text-blue-900 dark:text-blue-100">
                      To generate locally, you need an API key.
                    </h4>
                  </div>
                  <Button
                    onClick={handleGenerateToken}
                    disabled={isGenerating}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-500"
                  >
                    {isGenerating ? 'Generating...' : 'Generate Key & Show Instructions'}
                  </Button>
                </div>
              </div>
            ) : (
              <GenerationTokenPanel
                isMobile={isMobile}
                config={launchConfig}
                state={{
                  generatedToken,
                  activeInstallTab,
                }}
                actions={{
                  getActiveToken,
                  setComputerType: launchSetters.setComputerType,
                  setGpuType: launchSetters.setGpuType,
                  setMemoryProfile: launchSetters.setMemoryProfile,
                  setWindowsShell: launchSetters.setWindowsShell,
                  setShowDebugLogs: launchSetters.setShowDebugLogs,
                  setIdleReleaseMinutes: launchSetters.setIdleReleaseMinutes,
                  setWorkerRepoPath: launchSetters.setWorkerRepoPath,
                  setActiveInstallTab,
                  updateGenerationMethodsWithNotification,
                }}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
};

export { GenerationSection };
