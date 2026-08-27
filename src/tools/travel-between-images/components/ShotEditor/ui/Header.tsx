import React from 'react';
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Shot } from "@/domains/generation/types";
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { AspectRatioSelector } from '@/shared/components/GenerationControls/AspectRatioSelector';
import { useUpdateShotAspectRatio } from '@/shared/hooks/shots';

type AutoAdjustedAspectRatioInfo = {
  previousAspectRatio: string | null;
  adjustedTo: string;
} | null;

interface HeaderProps {
  selectedShot: Shot;
  isEditingName: boolean;
  editingName: string;
  isTransitioningFromNameEdit?: boolean;
  onBack: () => void;
  onUpdateShotName?: (newName: string) => void;
  onPreviousShot?: () => void;
  onNextShot?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onNameClick: () => void;
  onNameSave: () => void;
  onNameCancel: (e?: React.MouseEvent) => void;
  onNameKeyDown: (e: React.KeyboardEvent) => void;
  onEditingNameChange: (value: string) => void;
  autoAdjustedInfo?: AutoAdjustedAspectRatioInfo;
  onRevertAspectRatio?: () => void | Promise<void>;
  onManualAspectRatioChange?: () => void;
  projectAspectRatio?: string;
  projectId?: string;
  centerSectionRef?: React.RefObject<HTMLDivElement>;
  /** Hide header when floating sticky header is visible */
  isSticky?: boolean;
  readOnly?: boolean;
}

// Internal component - not memoized to allow hooks
const HeaderComponent: React.FC<HeaderProps> = ({
  selectedShot,
  isEditingName,
  editingName,
  isTransitioningFromNameEdit = false,
  onBack,
  onUpdateShotName,
  onPreviousShot,
  onNextShot,
  hasPrevious,
  hasNext,
  onNameClick,
  onNameSave,
  onNameCancel,
  onNameKeyDown,
  onEditingNameChange,
  autoAdjustedInfo = null,
  onRevertAspectRatio,
  onManualAspectRatioChange,
  projectAspectRatio,
  projectId,
  centerSectionRef,
  isSticky = false,
  readOnly = false,
}) => {
  const { updateShotAspectRatio } = useUpdateShotAspectRatio();

  const handleAspectRatioChange = async (newAspectRatio: string) => {
    if (!selectedShot?.id || !projectId) return;
    onManualAspectRatioChange?.();
    await updateShotAspectRatio(selectedShot.id, projectId, newAspectRatio);
  };

  const autoAdjustNotice = autoAdjustedInfo ? (
    <button
      type="button"
      onClick={onRevertAspectRatio}
      className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer transition-colors whitespace-nowrap"
    >
      Revert to project dimensions
    </button>
  ) : null;

  return (
    <div
      className="flex-shrink-0 space-y-1 sm:space-y-1 pb-2 sm:pb-1 transition-opacity duration-200"
      style={{
        opacity: isSticky ? 0 : 1,
        pointerEvents: isSticky ? 'none' : 'auto'
      }}
    >
      {/* Desktop layout */}
      <div className="hidden sm:flex justify-between items-center gap-y-2 px-2">
        {/* Back button on the left - fixed width container */}
        <div className="w-[100px]">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onBack}
            className="flex items-center justify-center gap-1 border-2 border-[#6a8a8a]/30 dark:border-[#6a7a7a] w-full"
            title="Back to shots"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </Button>
        </div>
        
        {/* Desktop shot name with navigation buttons - centered */}
        <div ref={centerSectionRef} className="flex items-center justify-center" data-tour="shot-selector">
          {isEditingName ? (
            // Hide navigation buttons when editing - only show name editing controls
            <div className="flex items-center gap-x-2">
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={(e) => onNameCancel(e)}
                onMouseDown={(e) => e.preventDefault()}
              >
                Cancel
              </Button>
              <Input
                key="shot-name-input" // Stable key to maintain focus across re-renders
                value={editingName}
                onChange={(e) => onEditingNameChange(e.target.value)}
                onKeyDown={onNameKeyDown}
                onBlur={onNameSave}
                className="!text-xl font-semibold text-primary h-auto py-2 px-4 w-[200px] border-2 text-center"
                autoFocus
                maxLength={30}
              />
              <Button size="sm" variant="outline" onClick={onNameSave}>
                Save
              </Button>
            </div>
          ) : (
            // Show navigation buttons tightly around the shot name
            <div className="flex items-center gap-x-2">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onPreviousShot}
                disabled={!hasPrevious || isTransitioningFromNameEdit}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                title="Previous shot"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <span
                className={`text-xl font-semibold text-primary truncate px-4 w-[200px] text-center border-2 border-transparent rounded-md py-2 preserve-case ${onUpdateShotName ? 'cursor-pointer hover:underline hover:border-border hover:bg-accent/50 transition-all duration-200' : ''}`}
                onClick={onNameClick}
                title={onUpdateShotName ? "Click to edit shot name" : selectedShot?.name || 'Untitled Shot'}
              >
                {selectedShot?.name || 'Untitled Shot'}
              </span>
              
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onNextShot}
                disabled={!hasNext || isTransitioningFromNameEdit}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                title="Next shot"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        
        {/* Aspect Ratio Selector on the right - fixed width container */}
        <div className="relative w-[100px]">
          {autoAdjustNotice && (
            <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2">
              {autoAdjustNotice}
            </div>
          )}
          <AspectRatioSelector
            value={selectedShot?.aspect_ratio || projectAspectRatio || '16:9'}
            onValueChange={handleAspectRatioChange}
            showVisualizer={false}
            disabled={readOnly}
            className="w-full"
          />
        </div>
      </div>

      {/* Mobile layout - all on one row */}
      <div className="sm:hidden">
        {isEditingName ? (
          // Editing mode - centered editing controls
          <div className="flex items-center justify-center gap-x-2">
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={(e) => onNameCancel(e)}
              onMouseDown={(e) => e.preventDefault()}
              className="flex-shrink-0"
            >
              Cancel
            </Button>
            <Input
              key="shot-name-input-mobile" // Stable key to maintain focus across re-renders
              value={editingName}
              onChange={(e) => onEditingNameChange(e.target.value)}
              onKeyDown={onNameKeyDown}
              onBlur={onNameSave}
              className="!text-xl font-semibold text-primary h-auto py-0.5 px-2 flex-1 text-center"
              autoFocus
              maxLength={30}
            />
            <Button size="sm" variant="outline" onClick={onNameSave} className="flex-shrink-0">
              Save
            </Button>
          </div>
        ) : (
          // Normal mode - back button, name with chevrons, and aspect ratio all on one row
          <div className="flex items-center justify-between">
            {/* Back button on the left - fixed width container */}
            <div className="w-[75px]">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onBack}
                className="flex items-center justify-center border-2 border-[#6a8a8a]/30 dark:border-[#6a7a7a] w-full px-0 text-[10px]"
                title="Back to shots"
              >
                <ArrowLeft className="h-2.5 w-2.5" />
              </Button>
            </div>
            
            {/* Shot name with navigation buttons - tighter spacing */}
            <div className="flex items-center gap-x-1" data-tour="shot-selector">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onPreviousShot}
                disabled={!hasPrevious || isTransitioningFromNameEdit}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                title="Previous shot"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <span
                className={`text-base font-semibold text-primary truncate text-center px-1 w-[70px] preserve-case ${onUpdateShotName ? 'cursor-pointer hover:underline' : ''}`}
                onClick={onNameClick}
                title={onUpdateShotName ? "Click to edit shot name" : selectedShot?.name || 'Untitled Shot'}
              >
                {selectedShot?.name || 'Untitled Shot'}
              </span>
              
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onNextShot}
                disabled={!hasNext || isTransitioningFromNameEdit}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                title="Next shot"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Aspect Ratio Selector on the right - fixed width container */}
            <div className="relative w-[75px]">
              <AspectRatioSelector
                value={selectedShot?.aspect_ratio || projectAspectRatio || '16:9'}
                onValueChange={handleAspectRatioChange}
                showVisualizer={false}
                disabled={readOnly}
                className="w-full text-[10px]"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Memoize Header to prevent re-renders from parent when props haven't changed
// This fixes the issue where clicking the shot name to edit loses focus immediately
export const Header = React.memo(HeaderComponent); 
