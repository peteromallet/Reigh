import { useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import type { GeneratedImageWithMetadata } from '../types';
import { GalleryFilterState, DEFAULT_GALLERY_FILTERS } from '../types';
import { isImageMedia, isVideoMedia } from '@/shared/lib/media/mediaTypeFilters';

// Maps GalleryFilterState keys to reducer action types
const FILTER_ACTIONS = {
  mediaType: 'SET_MEDIA_TYPE',
  shotFilter: 'SET_SHOT_FILTER',
  excludePositioned: 'SET_EXCLUDE_POSITIONED',
  searchTerm: 'SET_SEARCH_TERM',
  starredOnly: 'SET_STARRED_ONLY',
  toolTypeFilter: 'SET_TOOL_TYPE_FILTER',
} as const;

interface InternalFiltersState {
  mediaType: 'all' | 'image' | 'video';
  shotFilter: string;
  excludePositioned: boolean;
  starredOnly: boolean;
  toolTypeFilter: boolean;
  searchTerm: string;
  isSearchOpen: boolean;
}

type InternalFiltersAction =
  | { type: 'SET_MEDIA_TYPE'; payload: 'all' | 'image' | 'video' }
  | { type: 'SET_SHOT_FILTER'; payload: string }
  | { type: 'SET_EXCLUDE_POSITIONED'; payload: boolean }
  | { type: 'SET_STARRED_ONLY'; payload: boolean }
  | { type: 'SET_TOOL_TYPE_FILTER'; payload: boolean }
  | { type: 'SET_SEARCH_TERM'; payload: string }
  | { type: 'SET_IS_SEARCH_OPEN'; payload: boolean }
  | { type: 'CLEAR_SEARCH' };

const internalReducer = (
  state: InternalFiltersState,
  action: InternalFiltersAction
): InternalFiltersState => {
  switch (action.type) {
    case 'SET_MEDIA_TYPE':
      return { ...state, mediaType: action.payload };
    case 'SET_SHOT_FILTER':
      return { ...state, shotFilter: action.payload };
    case 'SET_EXCLUDE_POSITIONED':
      return { ...state, excludePositioned: action.payload };
    case 'SET_STARRED_ONLY':
      return { ...state, starredOnly: action.payload };
    case 'SET_TOOL_TYPE_FILTER':
      return { ...state, toolTypeFilter: action.payload };
    case 'SET_SEARCH_TERM':
      return {
        ...state,
        searchTerm: action.payload,
        isSearchOpen: state.isSearchOpen || !!action.payload,
      };
    case 'SET_IS_SEARCH_OPEN':
      return { ...state, isSearchOpen: action.payload };
    case 'CLEAR_SEARCH':
      return { ...state, searchTerm: '', isSearchOpen: false };
    default:
      return state;
  }
};

interface UseMediaGalleryFiltersProps {
  images: GeneratedImageWithMetadata[];
  optimisticDeletedIds: Set<string>;
  currentToolType?: string;
  initialFilterState?: boolean;
  onServerPageChange?: (page: number, fromBottom?: boolean) => void;
  serverPage?: number;
  filters?: GalleryFilterState;
  onFiltersChange?: (filters: GalleryFilterState) => void;
  defaultFilters?: Partial<GalleryFilterState>;
}

export const useMediaGalleryFilters = ({
  images,
  optimisticDeletedIds,
  currentToolType,
  initialFilterState = true,
  onServerPageChange,
  serverPage,
  filters: controlledFilters,
  onFiltersChange,
  defaultFilters,
}: UseMediaGalleryFiltersProps) => {
  const isControlled = controlledFilters !== undefined;

   
  const mergedDefaults = useMemo((): GalleryFilterState => ({
    ...DEFAULT_GALLERY_FILTERS,
    ...defaultFilters,
  }), [defaultFilters]);

  // Reducer owns filter values (uncontrolled) and isSearchOpen (both modes)
  const [internalState, dispatch] = useReducer(internalReducer, {
    mediaType: mergedDefaults.mediaType,
    shotFilter: mergedDefaults.shotFilter,
    excludePositioned: mergedDefaults.excludePositioned,
    starredOnly: mergedDefaults.starredOnly,
    toolTypeFilter: mergedDefaults.toolTypeFilter,
    searchTerm: mergedDefaults.searchTerm,
    isSearchOpen: !!mergedDefaults.searchTerm,
  });

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter values: controlled reads from props, uncontrolled reads from reducer
  const currentFilters: GalleryFilterState = isControlled
    ? controlledFilters
    : {
        mediaType: internalState.mediaType,
        shotFilter: internalState.shotFilter,
        excludePositioned: internalState.excludePositioned,
        searchTerm: internalState.searchTerm,
        starredOnly: internalState.starredOnly,
        toolTypeFilter: internalState.toolTypeFilter,
      };

  // isSearchOpen is always internal — it's UI chrome, not filter state
  const isSearchOpen = internalState.isSearchOpen;

  // Controlled mode calls onFiltersChange, uncontrolled dispatches to reducer
  const updateFilter = useCallback(<K extends keyof GalleryFilterState>(
    key: K, value: GalleryFilterState[K]
  ) => {
    if (isControlled) {
      onFiltersChange?.({ ...controlledFilters!, [key]: value });
    } else {
      dispatch({ type: FILTER_ACTIONS[key], payload: value } as InternalFiltersAction);
    }
  }, [isControlled, controlledFilters, onFiltersChange]);

  const setMediaTypeFilter = useCallback((v: 'all' | 'image' | 'video') => updateFilter('mediaType', v), [updateFilter]);
  const setShotFilter = useCallback((v: string) => updateFilter('shotFilter', v), [updateFilter]);
  const setExcludePositioned = useCallback((v: boolean) => updateFilter('excludePositioned', v), [updateFilter]);
  const setShowStarredOnly = useCallback((v: boolean) => updateFilter('starredOnly', v), [updateFilter]);
  const setToolTypeFilterEnabled = useCallback((v: boolean) => updateFilter('toolTypeFilter', v), [updateFilter]);

  const setSearchTerm = useCallback((v: string) => {
    updateFilter('searchTerm', v);
    // Auto-open search UI when setting a non-empty term in controlled mode
    // (uncontrolled mode handles this in the SET_SEARCH_TERM reducer case)
    if (isControlled && v) dispatch({ type: 'SET_IS_SEARCH_OPEN', payload: true });
  }, [updateFilter, isControlled]);

  const setIsSearchOpen = useCallback((v: boolean) => {
    dispatch({ type: 'SET_IS_SEARCH_OPEN', payload: v });
  }, []);

  const toggleSearch = useCallback(() => {
    const opening = !internalState.isSearchOpen;
    dispatch({ type: 'SET_IS_SEARCH_OPEN', payload: opening });
  }, [internalState.isSearchOpen]);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  const clearSearch = useCallback(() => {
    if (isControlled) {
      onFiltersChange?.({ ...controlledFilters!, searchTerm: '' });
    }
    dispatch({ type: 'CLEAR_SEARCH' });
  }, [isControlled, controlledFilters, onFiltersChange]);

  const filteredImages = useMemo(() => {
    let currentFiltered = images;

    currentFiltered = currentFiltered.filter(image => !optimisticDeletedIds.has(image.id));

    // Tool type filter (client pagination only)
    const isServerPagination = !!(onServerPageChange && serverPage);
    if (!isServerPagination && initialFilterState && currentFilters.toolTypeFilter && currentToolType) {
      currentFiltered = currentFiltered.filter(image => {
        const metadata = image.metadata;
        if (!metadata || !metadata.tool_type) return false;
        if (metadata.tool_type === currentToolType) return true;
        if (metadata.tool_type === `${currentToolType}-reconstructed-client`) return true;
        return false;
      });
    }

    if (!isServerPagination && currentFilters.mediaType !== 'all') {
      currentFiltered = currentFiltered.filter(image => {
        if (currentFilters.mediaType === 'image') return isImageMedia(image);
        if (currentFilters.mediaType === 'video') return isVideoMedia(image);
        return true;
      });
    }

    if (!isServerPagination && currentFilters.starredOnly) {
      currentFiltered = currentFiltered.filter(image => image.starred === true);
    }

    if (!isServerPagination && currentFilters.searchTerm.trim()) {
      currentFiltered = currentFiltered.filter(image => {
        const prompt = image.prompt ||
                      image.metadata?.prompt ||
                      image.metadata?.originalParams?.orchestrator_details?.prompt ||
                      '';
        return prompt.toLowerCase().includes(currentFilters.searchTerm.toLowerCase());
      });
    }

    return currentFiltered;
  }, [
    images,
    optimisticDeletedIds,
    initialFilterState,
    currentFilters.toolTypeFilter,
    currentFilters.mediaType,
    currentFilters.starredOnly,
    currentFilters.searchTerm,
    currentToolType,
    onServerPageChange,
    serverPage,
  ]);

  return {
    filterByToolType: initialFilterState,
    mediaTypeFilter: currentFilters.mediaType,
    shotFilter: currentFilters.shotFilter,
    excludePositioned: currentFilters.excludePositioned,
    showStarredOnly: currentFilters.starredOnly,
    toolTypeFilterEnabled: currentFilters.toolTypeFilter,
    searchTerm: currentFilters.searchTerm,
    isSearchOpen,
    searchInputRef,

    setMediaTypeFilter,
    setShotFilter,
    setExcludePositioned,
    setShowStarredOnly,
    setToolTypeFilterEnabled,
    setSearchTerm,
    setIsSearchOpen,

    filteredImages,
    toggleSearch,
    clearSearch,
  };
};
