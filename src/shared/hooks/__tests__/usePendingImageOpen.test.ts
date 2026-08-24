import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePendingImageOpen } from '../usePendingImageOpen';
import type { GenerationRow } from '@/domains/generation/types';

describe('usePendingImageOpen', () => {
  const mockOpenLightbox = vi.fn();
  const mockOnClear = vi.fn();
  const mockImages = [
    { id: 'img-1', generation_id: 'gen-1', shot_generation_id: 'entry-1' },
    { id: 'img-2', generation_id: 'gen-2', shot_generation_id: 'entry-2' },
    { id: 'img-3', generation_id: 'gen-3', shot_generation_id: 'entry-3' },
  ] as unknown as GenerationRow[];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a ref for capturedVariantId', () => {
    const { result } = renderHook(() =>
      usePendingImageOpen({
        pendingImageToOpen: null,
        pendingImageVariantId: null,
        images: mockImages,
        openLightbox: mockOpenLightbox,
        onClear: mockOnClear,
      })
    );
    expect(result.current).toHaveProperty('current');
  });

  it('does nothing when pendingImageToOpen is null', () => {
    renderHook(() =>
      usePendingImageOpen({
        pendingImageToOpen: null,
        pendingImageVariantId: null,
        images: mockImages,
        openLightbox: mockOpenLightbox,
        onClear: mockOnClear,
      })
    );
    expect(mockOpenLightbox).not.toHaveBeenCalled();
    expect(mockOnClear).not.toHaveBeenCalled();
  });

  it('does nothing when images is empty', () => {
    renderHook(() =>
      usePendingImageOpen({
        pendingImageToOpen: 'img-1',
        pendingImageVariantId: null,
        images: [],
        openLightbox: mockOpenLightbox,
        onClear: mockOnClear,
      })
    );
    expect(mockOpenLightbox).not.toHaveBeenCalled();
  });

  it('opens lightbox at correct index when matching by id', () => {
    renderHook(() =>
      usePendingImageOpen({
        pendingImageToOpen: 'img-2',
        pendingImageVariantId: null,
        images: mockImages,
        openLightbox: mockOpenLightbox,
        onClear: mockOnClear,
      })
    );
    expect(mockOpenLightbox).toHaveBeenCalledWith(1);
    expect(mockOnClear).toHaveBeenCalled();
  });

  it('opens lightbox when matching by generation_id', () => {
    renderHook(() =>
      usePendingImageOpen({
        pendingImageToOpen: 'gen-3',
        pendingImageVariantId: null,
        images: mockImages,
        openLightbox: mockOpenLightbox,
        onClear: mockOnClear,
      })
    );
    expect(mockOpenLightbox).toHaveBeenCalledWith(2);
  });

  it('opens lightbox when matching by normalized shot_generation_id', () => {
    renderHook(() =>
      usePendingImageOpen({
        pendingImageToOpen: 'entry-1',
        pendingImageVariantId: null,
        images: mockImages,
        openLightbox: mockOpenLightbox,
        onClear: mockOnClear,
      })
    );
    expect(mockOpenLightbox).toHaveBeenCalledWith(0);
  });

  it('captures variantId in the ref', () => {
    const { result } = renderHook(() =>
      usePendingImageOpen({
        pendingImageToOpen: 'img-1',
        pendingImageVariantId: 'variant-123',
        images: mockImages,
        openLightbox: mockOpenLightbox,
        onClear: mockOnClear,
      })
    );
    expect(result.current.current).toBe('variant-123');
  });

  it('does not call openLightbox when image is not found', () => {
    renderHook(() =>
      usePendingImageOpen({
        pendingImageToOpen: 'nonexistent-id',
        pendingImageVariantId: null,
        images: mockImages,
        openLightbox: mockOpenLightbox,
        onClear: mockOnClear,
      })
    );
    expect(mockOpenLightbox).not.toHaveBeenCalled();
    expect(mockOnClear).toHaveBeenCalled();
  });
});
