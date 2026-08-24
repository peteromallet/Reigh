/**
 * usePanelModeRestore Hook
 *
 * Handles automatic restoration of edit/info panel mode when media changes.
 * If the user was last in edit mode, automatically re-enters edit mode.
 */

import { useRef, useEffect } from 'react';

interface UsePanelModeRestoreProps {
  /** Current media ID for tracking changes */
  mediaId: string;
  /** Persisted panel mode from last used settings */
  persistedPanelMode: 'edit' | 'info' | null | undefined;
  /** Whether currently in special edit mode (image) */
  isSpecialEditMode: boolean;
  /** Whether currently in video edit mode */
  isInVideoEditMode: boolean;
  /** Whether initial video trim mode was requested */
  initialVideoTrimMode?: boolean;
  /** Whether initial edit active was requested (explicit mode set, skip restore) */
  initialEditActive?: boolean;
}

interface UseVideoPanelModeRestoreProps extends UsePanelModeRestoreProps {
  isVideo: true;
  /** Handler to enter video edit mode */
  handleEnterVideoEditMode: () => void;
}

interface UseImagePanelModeRestoreProps extends UsePanelModeRestoreProps {
  isVideo: false;
  /** Handler to enter magic edit mode (image) */
  handleEnterMagicEditMode: () => void;
}

interface UsePanelModeRestoreReturn {
  /** Whether panel mode has been restored for current media */
  hasRestoredPanelMode: boolean;
}

/**
 * Automatically restores the last used panel mode (edit/info) when opening a media item.
 * Prevents loops by tracking restoration per-media and respecting explicit modes.
 */
export function usePanelModeRestore({
  mediaId,
  persistedPanelMode,
  isVideo,
  isSpecialEditMode,
  isInVideoEditMode,
  initialVideoTrimMode,
  initialEditActive,
  ...modeHandlers
}: UseVideoPanelModeRestoreProps | UseImagePanelModeRestoreProps): UsePanelModeRestoreReturn {
  const hasRestoredPanelModeRef = useRef(false);
  const enterEditMode = 'handleEnterVideoEditMode' in modeHandlers
    ? modeHandlers.handleEnterVideoEditMode
    : modeHandlers.handleEnterMagicEditMode;

  // Main restoration effect
  useEffect(() => {

    // Only restore once per media (prevent loops)
    if (hasRestoredPanelModeRef.current) {
      return;
    }

    // Don't restore if initialVideoTrimMode or initialEditActive is set (explicit modes take precedence)
    if (initialVideoTrimMode || initialEditActive) {
      hasRestoredPanelModeRef.current = true;
      return;
    }

    // Don't restore if already in edit mode
    if (isSpecialEditMode || isInVideoEditMode) {
      hasRestoredPanelModeRef.current = true;
      return;
    }

    if (persistedPanelMode === 'edit') {
      hasRestoredPanelModeRef.current = true;
      setTimeout(() => enterEditMode(), 0);
    } else {
      hasRestoredPanelModeRef.current = true;
    }
  }, [
    persistedPanelMode,
    enterEditMode,
    initialVideoTrimMode,
    initialEditActive,
    isSpecialEditMode,
    isInVideoEditMode,
  ]);

  // Reset restore flag when media changes
  useEffect(() => {
    hasRestoredPanelModeRef.current = false;
  }, [mediaId]);

  return {
    hasRestoredPanelMode: hasRestoredPanelModeRef.current,
  };
}
