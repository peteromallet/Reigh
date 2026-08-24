import React from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { ShotSelector } from "@/shared/components/selectors/ShotSelector";
import { ShotPrimaryActionButton } from '@/shared/components/shots/ShotPrimaryActionButton';
import { cn } from '@/shared/components/ui/contracts/cn';
import type {
  GeneratedImageWithMetadata,
  SimplifiedShotOption,
} from "../../MediaGallery/types";
import { useShotActionController } from "../hooks/useShotActionController";

/** Shot selector dropdown state and options */
interface ShotSelectorState {
  selectedShotId: string;
  simplifiedShotOptions: SimplifiedShotOption[];
  isShotSelectorOpen: boolean;
  setIsShotSelectorOpen: (open: boolean) => void;
  setSelectedShotIdLocal: (id: string) => void;
  setLastAffectedShotId: (id: string) => void;
}

/** Loading IDs, position flags, and visual status indicators */
interface ShotActionStatus {
  isMobile: boolean;
  isVideoContent: boolean;
  addingToShotImageId: string | null;
  addingToShotWithoutPositionImageId: string | null;
  showTickForImageId: string | null;
  isAlreadyPositionedInSelectedShot: boolean;
  isAlreadyAssociatedWithoutPosition: boolean;
  shouldShowAddWithoutPositionButton: boolean;
  currentTargetShotName: string | undefined;
}

/** Quick-create shot state and callbacks */
interface ShotQuickCreateState {
  quickCreateSuccess: {
    isSuccessful: boolean;
    shotId: string | null;
    shotName: string | null;
    isLoading?: boolean;
  };
  handleQuickCreateAndAdd: () => void;
  handleVisitCreatedShot: () => void;
}

/** Callback handlers for shot actions */
interface ShotActionCallbacks {
  onCreateShot?: (name: string, files: File[]) => Promise<void>;
  onNavigateToShot: (shot: { id: string; name: string }) => void;
  onAddToShot: () => Promise<void>;
  onAddToShotWithoutPosition: () => Promise<void>;
}

interface ShotActionsProps {
  image: GeneratedImageWithMetadata;
  selector: ShotSelectorState;
  status: ShotActionStatus;
  quickCreate: ShotQuickCreateState;
  actions: ShotActionCallbacks;
}

export const ShotActions: React.FC<ShotActionsProps> = ({
  image,
  selector,
  status,
  quickCreate,
  actions,
}) => {
  const {
    selectedShotId,
    simplifiedShotOptions,
    isShotSelectorOpen,
    setIsShotSelectorOpen,
    setSelectedShotIdLocal,
    setLastAffectedShotId,
  } = selector;

  const {
    isMobile,
    isVideoContent,
    addingToShotImageId,
    addingToShotWithoutPositionImageId,
    showTickForImageId,
    isAlreadyPositionedInSelectedShot,
    isAlreadyAssociatedWithoutPosition,
    shouldShowAddWithoutPositionButton,
    currentTargetShotName,
  } = status;

  const {
    quickCreateSuccess,
    handleQuickCreateAndAdd,
    handleVisitCreatedShot,
  } = quickCreate;

  const {
    onCreateShot,
    onNavigateToShot,
    onAddToShot,
    onAddToShotWithoutPosition,
  } = actions;

  const {
    handleAddToShotIntent,
    handleAddWithoutPositionIntent,
  } = useShotActionController({
    imageId: image.id,
    selectedShotId,
    simplifiedShotOptions,
    showTickForImageId,
    isAlreadyPositionedInSelectedShot,
    isAlreadyAssociatedWithoutPosition,
    onNavigateToShot,
    onAddToShot,
    onAddToShotWithoutPosition,
  });

  return (
    <div className={cn(
      "absolute top-1.5 left-1.5 right-1.5 flex flex-col items-start gap-1 transition-opacity z-20",
      isShotSelectorOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
    )}>
      {!isVideoContent && (
        <ShotSelector
          value={selectedShotId}
          onValueChange={(value) => {
            setSelectedShotIdLocal(value);
            setLastAffectedShotId(value);
          }}
          shots={simplifiedShotOptions}
          placeholder="Shot..."
          className="w-full"
          triggerClassName={isMobile
            ? "h-8 px-3 py-1 rounded-md bg-black/50 hover:bg-black/70 text-white text-sm w-full truncate focus:ring-0 focus:ring-offset-0"
            : "h-7 px-2 py-1 rounded-md bg-black/50 hover:bg-black/70 text-white text-xs w-full truncate focus:ring-0 focus:ring-offset-0"
          }
          showAddShot={!!onCreateShot}
          onCreateShot={handleQuickCreateAndAdd}
          isCreatingShot={addingToShotImageId === image.id}
          quickCreateSuccess={quickCreateSuccess}
          onVisitCreatedShot={handleVisitCreatedShot}
          side="bottom"
          align="start"
          sideOffset={4}
          onNavigateToShot={(shot) => onNavigateToShot(shot)}
          open={isShotSelectorOpen}
          onOpenChange={setIsShotSelectorOpen}
        />
      )}

      {!isVideoContent && (
        <div className="relative">
          <ShotPrimaryActionButton
            selectedShotId={selectedShotId}
            currentTargetShotName={currentTargetShotName}
            isLoading={addingToShotImageId === image.id}
            showTick={showTickForImageId === image.id}
            isAlreadyPositionedInSelectedShot={isAlreadyPositionedInSelectedShot}
            onClick={(event) => { void handleAddToShotIntent(event); }}
            className={`h-7 w-7 p-0 rounded-full bg-black/50 hover:bg-black/70 text-white ${
              showTickForImageId === image.id
                ? 'bg-emerald-500 hover:bg-emerald-600'
                : isAlreadyPositionedInSelectedShot
                  ? 'bg-black/40 hover:bg-black/60 text-white'
                  : ''
            }`}
          />

          {/* Add without position button - visibility now memoized for performance */}
          {shouldShowAddWithoutPositionButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={`absolute -top-1 -right-1 h-4 w-4 p-0 rounded-full border-0 scale-75 hover:scale-100 transition-transform duration-200 ease-out ${
                    isAlreadyAssociatedWithoutPosition
                      ? 'bg-black/40 hover:bg-black/60 text-white'
                      : 'bg-black/60 hover:bg-black/80 text-white'
                  }`}
                  onClick={(event) => { void handleAddWithoutPositionIntent(event); }}
                  disabled={!selectedShotId || addingToShotWithoutPositionImageId === image.id || addingToShotImageId === image.id}
                  aria-label={
                    isAlreadyAssociatedWithoutPosition
                      ? (currentTargetShotName ? `Jump to ${currentTargetShotName}` : 'Jump to shot')
                      : (currentTargetShotName ? `Add to '${currentTargetShotName}' without position` : "Add to selected shot without position")
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {addingToShotWithoutPositionImageId === image.id ? (
                    <div className="h-2 w-2 animate-spin rounded-full border-b border-white"></div>
                  ) : isAlreadyAssociatedWithoutPosition ? (
                    <Check className="h-2 w-2" />
                  ) : (
                    <Plus className="h-2 w-2" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isAlreadyAssociatedWithoutPosition
                  ? `Jump to ${currentTargetShotName || 'shot'}`
                  : (selectedShotId && currentTargetShotName ? `Add to '${currentTargetShotName}' without position` : "Add to selected shot without position")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
};
