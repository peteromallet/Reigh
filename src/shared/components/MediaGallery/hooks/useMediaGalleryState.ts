import {
  useReducer,
  useRef,
  useEffect,
  useMemo,
  type Dispatch,
} from 'react';
import type { GeneratedImageWithMetadata } from '../types';

// Consolidated state interface
interface MediaGalleryState {
  // Lightbox state
  activeLightboxMedia: GeneratedImageWithMetadata | null;
  autoEnterEditMode: boolean;
  selectedImageForDetails: GeneratedImageWithMetadata | null;
  showTaskDetailsModal: boolean;
  pendingLightboxTarget: 'first' | 'last' | null;
  
  // Optimistic state
  optimisticUnpositionedIds: Set<string>;
  optimisticPositionedIds: Set<string>;
  optimisticDeletedIds: Set<string>;
  
  // Shot selection state
  selectedShotIdLocal: string;
  
  // UI state
  showTickForImageId: string | null;
  showTickForSecondaryImageId: string | null;
  addingToShotImageId: string | null;
  addingToShotWithoutPositionImageId: string | null;
  downloadingImageId: string | null;
  isDownloadingStarred: boolean;
  
  // Mobile state
  mobileActiveImageId: string | null;
  mobilePopoverOpenImageId: string | null;
  
  // Backfill state
  isBackfillLoading: boolean;
  backfillSkeletonCount: number;
}

type SettableMediaGalleryFields = {
  activeLightboxMedia: MediaGalleryState['activeLightboxMedia'];
  autoEnterEditMode: MediaGalleryState['autoEnterEditMode'];
  selectedImageForDetails: MediaGalleryState['selectedImageForDetails'];
  showTaskDetailsModal: MediaGalleryState['showTaskDetailsModal'];
  pendingLightboxTarget: MediaGalleryState['pendingLightboxTarget'];
  selectedShotIdLocal: MediaGalleryState['selectedShotIdLocal'];
  showTickForImageId: MediaGalleryState['showTickForImageId'];
  showTickForSecondaryImageId: MediaGalleryState['showTickForSecondaryImageId'];
  addingToShotImageId: MediaGalleryState['addingToShotImageId'];
  addingToShotWithoutPositionImageId: MediaGalleryState['addingToShotWithoutPositionImageId'];
  downloadingImageId: MediaGalleryState['downloadingImageId'];
  isDownloadingStarred: MediaGalleryState['isDownloadingStarred'];
  mobileActiveImageId: MediaGalleryState['mobileActiveImageId'];
  mobilePopoverOpenImageId: MediaGalleryState['mobilePopoverOpenImageId'];
  isBackfillLoading: MediaGalleryState['isBackfillLoading'];
  backfillSkeletonCount: MediaGalleryState['backfillSkeletonCount'];
};

type SetFieldAction = {
  type: 'SET_FIELD';
  field: keyof SettableMediaGalleryFields;
  payload: SettableMediaGalleryFields[keyof SettableMediaGalleryFields];
};

// Action types for the reducer
type MediaGalleryStateAction =
  | SetFieldAction
  | { type: 'MARK_OPTIMISTIC_UNPOSITIONED'; payload: { mediaId: string; shotId: string } }
  | { type: 'MARK_OPTIMISTIC_POSITIONED'; payload: { mediaId: string; shotId: string } }
  | { type: 'MARK_OPTIMISTIC_DELETED'; payload: string }
  | { type: 'MARK_OPTIMISTIC_DELETED_WITH_BACKFILL'; payload: string } // Combined action for atomic update
  | { type: 'REMOVE_OPTIMISTIC_DELETED'; payload: string }
  | { type: 'RECONCILE_OPTIMISTIC_STATE'; payload: Set<string> }
  | { type: 'RESET_UI_STATE' };

// Initial state factory
const createInitialState = (
  currentShotId?: string,
  lastShotId?: string,
  simplifiedShotOptions: { id: string; name: string }[] = []
): MediaGalleryState => ({
  // Lightbox state
  activeLightboxMedia: null,
  autoEnterEditMode: false,
  selectedImageForDetails: null,
  showTaskDetailsModal: false,
  pendingLightboxTarget: null,
  
  // Optimistic state
  optimisticUnpositionedIds: new Set(),
  optimisticPositionedIds: new Set(),
  optimisticDeletedIds: new Set(),
  
  // Shot selection state
  selectedShotIdLocal: currentShotId || lastShotId || (simplifiedShotOptions.length > 0 ? simplifiedShotOptions[0].id : ""),
  
  // UI state
  showTickForImageId: null,
  showTickForSecondaryImageId: null,
  addingToShotImageId: null,
  addingToShotWithoutPositionImageId: null,
  downloadingImageId: null,
  isDownloadingStarred: false,
  
  // Mobile state
  mobileActiveImageId: null,
  mobilePopoverOpenImageId: null,
  
  // Backfill state
  isBackfillLoading: false,
  backfillSkeletonCount: 0,
});

// Reducer with batched updates
const mediaGalleryStateReducer = (
  state: MediaGalleryState,
  action: MediaGalleryStateAction
): MediaGalleryState => {
  switch (action.type) {
    case 'SET_FIELD':
      return {
        ...state,
        [action.field]: action.payload,
      };
      
    case 'MARK_OPTIMISTIC_UNPOSITIONED': {
      // Store composite key: mediaId:shotId
      const { mediaId, shotId } = action.payload;
      const key = `${mediaId}:${shotId}`;
      const newUnpositioned = new Set(state.optimisticUnpositionedIds);
      const newPositioned = new Set(state.optimisticPositionedIds);
      newUnpositioned.add(key);
      newPositioned.delete(key);
      return {
        ...state,
        optimisticUnpositionedIds: newUnpositioned,
        optimisticPositionedIds: newPositioned,
      };
    }
    
    case 'MARK_OPTIMISTIC_POSITIONED': {
      // Store composite key: mediaId:shotId
      const { mediaId, shotId } = action.payload;
      const key = `${mediaId}:${shotId}`;
      const newPositioned = new Set(state.optimisticPositionedIds);
      const newUnpositioned = new Set(state.optimisticUnpositionedIds);
      newPositioned.add(key);
      newUnpositioned.delete(key);
      return {
        ...state,
        optimisticPositionedIds: newPositioned,
        optimisticUnpositionedIds: newUnpositioned,
      };
    }
    
    case 'MARK_OPTIMISTIC_DELETED': {
      const newDeleted = new Set(state.optimisticDeletedIds);
      newDeleted.add(action.payload);
      return { ...state, optimisticDeletedIds: newDeleted };
    }

    case 'MARK_OPTIMISTIC_DELETED_WITH_BACKFILL': {
      // Combined action: mark deleted AND enable backfill loading in ONE state update
      // This ensures skeleton appears in the same render where item disappears
      const newDeleted = new Set(state.optimisticDeletedIds);
      newDeleted.add(action.payload);
      return { ...state, optimisticDeletedIds: newDeleted, isBackfillLoading: true };
    }

    case 'REMOVE_OPTIMISTIC_DELETED': {
      const newDeleted = new Set(state.optimisticDeletedIds);
      newDeleted.delete(action.payload);
      return { ...state, optimisticDeletedIds: newDeleted };
    }
    
    case 'RECONCILE_OPTIMISTIC_STATE': {
      const currentImageIds = action.payload;

      // Clean up optimistic sets - remove entries for images no longer in the list
      // Composite keys are in format mediaId:shotId
      const newUnpositioned = new Set<string>();
      for (const key of state.optimisticUnpositionedIds) {
        const mediaId = key.split(':')[0];
        if (currentImageIds.has(mediaId)) {
          newUnpositioned.add(key);
        }
      }

      const newPositioned = new Set<string>();
      for (const key of state.optimisticPositionedIds) {
        const mediaId = key.split(':')[0];
        if (currentImageIds.has(mediaId)) {
          newPositioned.add(key);
        }
      }

      const newDeleted = new Set<string>();
      for (const id of state.optimisticDeletedIds) {
        if (currentImageIds.has(id)) {
          newDeleted.add(id);
        }
      }
      
      return {
        ...state,
        optimisticUnpositionedIds: newUnpositioned,
        optimisticPositionedIds: newPositioned,
        optimisticDeletedIds: newDeleted,
      };
    }
    
    case 'RESET_UI_STATE':
      return {
        ...state,
        showTickForImageId: null,
        showTickForSecondaryImageId: null,
        addingToShotImageId: null,
        addingToShotWithoutPositionImageId: null,
        downloadingImageId: null,
        isDownloadingStarred: false,
        mobileActiveImageId: null,
        mobilePopoverOpenImageId: null,
      };
      
    default:
      return state;
  }
};

const createFieldSetter = <Field extends keyof SettableMediaGalleryFields>(
  dispatch: Dispatch<MediaGalleryStateAction>,
  field: Field
) => (value: SettableMediaGalleryFields[Field]) => {
  dispatch({
    type: 'SET_FIELD',
    field,
    payload: value,
  });
};

interface UseMediaGalleryStateProps {
  images: GeneratedImageWithMetadata[];
  currentShotId?: string;
  lastShotId?: string;
  simplifiedShotOptions: { id: string; name: string }[];
  isServerPagination?: boolean;
  serverPage?: number;
}

interface UseMediaGalleryStateReturn {
  // State
  state: MediaGalleryState;
  
  // Actions
  setActiveLightboxMedia: (media: GeneratedImageWithMetadata | null) => void;
  setAutoEnterEditMode: (value: boolean) => void;
  setSelectedImageForDetails: (image: GeneratedImageWithMetadata | null) => void;
  setShowTaskDetailsModal: (show: boolean) => void;
  setPendingLightboxTarget: (target: 'first' | 'last' | null) => void;
  markOptimisticUnpositioned: (imageId: string, shotId: string) => void;
  markOptimisticPositioned: (imageId: string, shotId: string) => void;
  markOptimisticDeleted: (imageId: string) => void;
  markOptimisticDeletedWithBackfill: (imageId: string) => void;
  removeOptimisticDeleted: (imageId: string) => void;
  setSelectedShotIdLocal: (id: string) => void;
  setShowTickForImageId: (id: string | null) => void;
  setShowTickForSecondaryImageId: (id: string | null) => void;
  setAddingToShotImageId: (id: string | null) => void;
  setAddingToShotWithoutPositionImageId: (id: string | null) => void;
  setDownloadingImageId: (id: string | null) => void;
  setIsDownloadingStarred: (downloading: boolean) => void;
  setMobileActiveImageId: (id: string | null) => void;
  setMobilePopoverOpenImageId: (id: string | null) => void;
  setIsBackfillLoading: (loading: boolean) => void;
  setBackfillSkeletonCount: (count: number) => void;
  resetUIState: () => void;
  
  // Refs (unchanged)
  mainTickTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  secondaryTickTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  galleryTopRef: React.MutableRefObject<HTMLDivElement | null>;
  safetyTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
}

function clearTimer(timeoutRef: React.MutableRefObject<NodeJS.Timeout | null>): void {
  const timeoutId = timeoutRef.current;
  if (!timeoutId) {
    return;
  }

  clearTimeout(timeoutId);
  timeoutRef.current = null;
}

export const useMediaGalleryState = ({
  images,
  currentShotId,
  lastShotId,
  simplifiedShotOptions,
}: UseMediaGalleryStateProps): UseMediaGalleryStateReturn => {
  
  // Initialize state with useReducer instead of multiple useState calls
  const [state, dispatch] = useReducer(
    mediaGalleryStateReducer,
    createInitialState(currentShotId, lastShotId, simplifiedShotOptions)
  );
  
  // Memoized action creators to prevent unnecessary re-renders
  const actions = useMemo(() => ({
    setActiveLightboxMedia: createFieldSetter(dispatch, 'activeLightboxMedia'),
    setAutoEnterEditMode: createFieldSetter(dispatch, 'autoEnterEditMode'),
    setSelectedImageForDetails: createFieldSetter(dispatch, 'selectedImageForDetails'),
    setShowTaskDetailsModal: createFieldSetter(dispatch, 'showTaskDetailsModal'),
    setPendingLightboxTarget: createFieldSetter(dispatch, 'pendingLightboxTarget'),
    markOptimisticUnpositioned: (imageId: string, shotId: string) => 
      dispatch({ type: 'MARK_OPTIMISTIC_UNPOSITIONED', payload: { mediaId: imageId, shotId } }),
    markOptimisticPositioned: (imageId: string, shotId: string) => 
      dispatch({ type: 'MARK_OPTIMISTIC_POSITIONED', payload: { mediaId: imageId, shotId } }),
    markOptimisticDeleted: (imageId: string) =>
      dispatch({ type: 'MARK_OPTIMISTIC_DELETED', payload: imageId }),
    markOptimisticDeletedWithBackfill: (imageId: string) =>
      dispatch({ type: 'MARK_OPTIMISTIC_DELETED_WITH_BACKFILL', payload: imageId }),
    removeOptimisticDeleted: (imageId: string) => 
      dispatch({ type: 'REMOVE_OPTIMISTIC_DELETED', payload: imageId }),
    setSelectedShotIdLocal: createFieldSetter(dispatch, 'selectedShotIdLocal'),
    setShowTickForImageId: createFieldSetter(dispatch, 'showTickForImageId'),
    setShowTickForSecondaryImageId: createFieldSetter(dispatch, 'showTickForSecondaryImageId'),
    setAddingToShotImageId: createFieldSetter(dispatch, 'addingToShotImageId'),
    setAddingToShotWithoutPositionImageId: createFieldSetter(dispatch, 'addingToShotWithoutPositionImageId'),
    setDownloadingImageId: createFieldSetter(dispatch, 'downloadingImageId'),
    setIsDownloadingStarred: createFieldSetter(dispatch, 'isDownloadingStarred'),
    setMobileActiveImageId: createFieldSetter(dispatch, 'mobileActiveImageId'),
    setMobilePopoverOpenImageId: createFieldSetter(dispatch, 'mobilePopoverOpenImageId'),
    setIsBackfillLoading: createFieldSetter(dispatch, 'isBackfillLoading'),
    setBackfillSkeletonCount: createFieldSetter(dispatch, 'backfillSkeletonCount'),
    resetUIState: () =>
      dispatch({ type: 'RESET_UI_STATE' }),
  }), []);
  
  // Refs (unchanged from original)
  const mainTickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const secondaryTickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const galleryTopRef = useRef<HTMLDivElement | null>(null);
  const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track previous lastShotId to detect when user navigates to a different shot
  const prevLastShotIdRef = useRef<string | undefined>(lastShotId);
  
  // Sync selectedShotIdLocal when:
  // 1. lastShotId changes (user navigated to a different shot)
  // 2. Current selection is invalid (empty or shot no longer exists)
  useEffect(() => {
    const isCurrentSelectionValid = state.selectedShotIdLocal && simplifiedShotOptions.find(shot => shot.id === state.selectedShotIdLocal);
    const lastShotIdChanged = lastShotId && lastShotId !== prevLastShotIdRef.current;
    
    // Update ref for next comparison
    prevLastShotIdRef.current = lastShotId;
    
    // Sync when lastShotId changes (user clicked into a shot)
    if (lastShotIdChanged && lastShotId !== state.selectedShotIdLocal) {
      actions.setSelectedShotIdLocal(lastShotId);
      return;
    }
    
    // Fix invalid selections (empty or shot no longer exists)
    if (!isCurrentSelectionValid) {
      const newSelection = lastShotId || (simplifiedShotOptions.length > 0 ? simplifiedShotOptions[0].id : "");
      if (newSelection && newSelection !== state.selectedShotIdLocal) {
        actions.setSelectedShotIdLocal(newSelection);
      }
    }
  }, [lastShotId, simplifiedShotOptions, state.selectedShotIdLocal, actions]);

  // Memoize image IDs to prevent unnecessary effect triggers
  const currentImageIds = useMemo(() => 
    new Set(images.map(img => img.id)), 
    [images]
  );

  // Reconcile optimistic state when images update
  useEffect(() => {
    // Sync activeLightboxMedia with updated images list to ensure fresh data (like name changes)
    if (state.activeLightboxMedia) {
      const activeLightbox = state.activeLightboxMedia;
      const updatedImage = images.find(img => img.id === activeLightbox.id);
      // Only update if the object reference changed (meaning data changed or refetched)
      // and deep equality check on key properties to avoid unnecessary render cycles
      if (updatedImage && updatedImage !== state.activeLightboxMedia) {
        // Check if relevant fields actually changed to prevent loop.
        const nameChanged = updatedImage.name !== state.activeLightboxMedia.name;
        const starredChanged = updatedImage.starred !== state.activeLightboxMedia.starred;
        const urlChanged = updatedImage.url !== state.activeLightboxMedia.url;

        if (nameChanged || starredChanged || urlChanged) {
          const autoEnterFlag = state.activeLightboxMedia.metadata?.__autoEnterEditMode as boolean | undefined;
          actions.setActiveLightboxMedia({
            ...updatedImage,
            metadata: autoEnterFlag === undefined
              ? updatedImage.metadata
              : { ...updatedImage.metadata, __autoEnterEditMode: autoEnterFlag },
          });
        }
      }
    }

    // Clean up optimistic sets using the consolidated action
    dispatch({ type: 'RECONCILE_OPTIMISTIC_STATE', payload: currentImageIds });
  }, [currentImageIds, images, actions, state.activeLightboxMedia]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      clearTimer(mainTickTimeoutRef);
      clearTimer(secondaryTickTimeoutRef);
      clearTimer(safetyTimeoutRef);
    };
  }, []);

  return {
    state,
    ...actions,
    
    // Refs
    mainTickTimeoutRef,
    secondaryTickTimeoutRef,
    galleryTopRef,
    safetyTimeoutRef,
  };
};
