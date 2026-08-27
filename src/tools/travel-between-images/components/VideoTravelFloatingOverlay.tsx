/**
 * Floating Overlay Component for VideoTravelToolPage
 *
 * Renders the sticky shot selector header that appears when scrolled past the original header.
 *
 * @see VideoTravelToolPage.tsx - Parent page component
 */

import React from 'react';
import { Button } from '@/shared/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Shot } from '@/domains/generation/types';
import { useIsTablet } from '@/shared/hooks/mobile';

// =============================================================================
// PROP TYPES
// =============================================================================

interface StickyHeaderProps {
  readOnly?: boolean;
  shouldShowShotEditor: boolean;
  stickyHeader: {
    isSticky: boolean;
    stableBounds: { left: number; width: number };
  };
  shotToEdit: Shot | null | undefined;
  isMobile: boolean;
  isShotsPaneLocked: boolean;
  shotsPaneWidth: number;
  isTasksPaneLocked: boolean;
  tasksPaneWidth: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPreviousShot: () => void;
  onNextShot: () => void;
  onBackToShotList: () => void;
  onFloatingHeaderNameClick: () => void;
}

interface VideoTravelFloatingOverlayProps {
  sticky: StickyHeaderProps;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const VideoTravelFloatingOverlay: React.FC<VideoTravelFloatingOverlayProps> = ({
  sticky,
}) => {
  const {
    shouldShowShotEditor,
    readOnly = false,
    stickyHeader,
    shotToEdit,
    isMobile,
    isShotsPaneLocked,
    shotsPaneWidth,
    isTasksPaneLocked,
    tasksPaneWidth,
    hasPrevious,
    hasNext,
    onPreviousShot,
    onNextShot,
    onBackToShotList,
    onFloatingHeaderNameClick,
  } = sticky;

  const isTablet = useIsTablet();

  // Track viewport width to match header visibility logic
  // Header is sticky (visible at top) when viewport >= 768px OR device is tablet
  const [isWideViewport, setIsWideViewport] = React.useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

  React.useEffect(() => {
    const handleResize = () => setIsWideViewport(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // The header is visible/sticky when viewport is wide OR device is tablet
  // This matches the logic in GlobalHeader.tsx
  const hasVisibleHeader = isWideViewport || isTablet;

  if (!shouldShowShotEditor || !stickyHeader.isSticky || !shotToEdit) {
    return null;
  }

  // Use larger offset when header is visible (sticky), smaller when it's not (scrolls away on phones)
  const topOffset = hasVisibleHeader ? 114 : 52;

  // Always use pane-based positioning - this ensures the floating header
  // adjusts correctly when panes lock/unlock
  const leftOffset = isShotsPaneLocked ? shotsPaneWidth : 0;
  const rightOffset = isTasksPaneLocked ? tasksPaneWidth : 0;

  return (
    <div
      className="fixed z-50 animate-in fade-in slide-in-from-top-2"
      style={{
        top: `${topOffset}px`,
        left: `${leftOffset}px`,
        right: `${rightOffset}px`,
        transition: 'left 0.2s ease-out, right 0.2s ease-out, opacity 0.3s ease-out',
        willChange: 'left, right, opacity',
        transform: 'translateZ(0)',
        pointerEvents: 'none'
      }}
    >
      <div className="flex-shrink-0 pb-2 sm:pb-1">
        <div className="flex flex-col items-center px-2">
          <div className="flex items-center justify-center">
            <div className="flex items-center gap-x-1 sm:gap-x-2 bg-background/90 backdrop-blur-md shadow-xl rounded-lg border border-border/80 dark:border-border p-1 dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)]" style={{ pointerEvents: 'auto' }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPreviousShot();
                }}
                disabled={!hasPrevious}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity h-8 w-8 sm:h-9 sm:w-9 p-0"
                title="Previous shot"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <span
                className="text-base sm:text-xl font-semibold text-primary truncate px-2 sm:px-4 w-[140px] sm:w-[200px] text-center border-2 border-transparent rounded-md py-1 sm:py-2 cursor-pointer hover:underline"
                title={readOnly ? 'Local Astrid timeline (read-only)' : 'Click to edit shot name'}
                onClick={readOnly ? undefined : onFloatingHeaderNameClick}
              >
                {shotToEdit.name || 'Untitled Shot'}
              </span>

              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNextShot();
                }}
                disabled={!hasNext}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity h-8 w-8 sm:h-9 sm:w-9 p-0"
                title="Next shot"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Mobile: Back to shot list button */}
          {isMobile && (
            <button
              onClick={onBackToShotList}
              className="mt-0.5 px-3 py-1 text-xs text-muted-foreground hover:text-foreground bg-background/90 backdrop-blur-md rounded-b-lg border border-t-0 border-border/80 dark:border-border flex items-center"
              style={{ pointerEvents: 'auto' }}
            >
              <ChevronLeft className="h-3 w-3 mr-0.5" />
              Back to shots
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
