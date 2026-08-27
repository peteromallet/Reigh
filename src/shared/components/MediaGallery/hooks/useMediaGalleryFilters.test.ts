import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GeneratedImageWithMetadata } from '../types';
import { useMediaGalleryFilters } from './useMediaGalleryFilters';

describe('useMediaGalleryFilters media type filtering', () => {
  const images = [
    { id: 'image', url: '/image.png', type: 'image', isVideo: false },
    { id: 'audio', url: '/audio.aac', type: 'audio', isVideo: false },
    { id: 'video', url: '/video.mp4', type: 'video', isVideo: true },
  ] as GeneratedImageWithMetadata[];

  it('shows actual images only for image and videos only for video', () => {
    const { result } = renderHook(() => useMediaGalleryFilters({
      images,
      optimisticDeletedIds: new Set(),
      defaultFilters: { mediaType: 'image' },
    }));

    expect(result.current.filteredImages.map((item) => item.id)).toEqual(['image']);

    act(() => result.current.setMediaTypeFilter('video'));
    expect(result.current.filteredImages.map((item) => item.id)).toEqual(['video']);
  });

  it('keeps audio available in the all view', () => {
    const { result } = renderHook(() => useMediaGalleryFilters({
      images,
      optimisticDeletedIds: new Set(),
      defaultFilters: { mediaType: 'all' },
    }));

    expect(result.current.filteredImages.map((item) => item.id)).toEqual(['image', 'audio', 'video']);
  });
});
