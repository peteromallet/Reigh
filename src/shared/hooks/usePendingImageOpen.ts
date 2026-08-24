/**
 * Hook for opening a lightbox at a specific image by ID.
 * Used for deep-linking from TasksPane, segment constituent navigation, etc.
 *
 * Returns a ref containing the captured variant ID — pass to MediaLightbox
 * as `initialVariantId` and clear on lightbox close.
 */

import { useEffect, useRef } from 'react';
import type { GenerationRow } from '@/domains/generation/types';

interface UsePendingImageOpenProps {
  pendingImageToOpen: string | null | undefined;
  pendingImageVariantId: string | null | undefined;
  images: GenerationRow[] | undefined;
  openLightbox: (index: number) => void;
  onClear: (() => void) | undefined;
}

export function usePendingImageOpen({
  pendingImageToOpen,
  pendingImageVariantId,
  images,
  openLightbox,
  onClear,
}: UsePendingImageOpenProps) {
  const capturedVariantIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingImageToOpen || !images?.length) return;

    // Capture variant ID before clearing (will be passed to MediaLightbox on next render)
    capturedVariantIdRef.current = pendingImageVariantId ?? null;

    // Find image by shot_generations.id, legacy shot-image entry id, or
    // generation_id. Deep links can carry any of these identifiers depending
    // on which surface initiated the open request.
    const index = images.findIndex(
      (img) =>
        img.id === pendingImageToOpen ||
        img.shotImageEntryId === pendingImageToOpen ||
        img.generation_id === pendingImageToOpen
    );

    if (index !== -1) {
      openLightbox(index);
    }

    onClear?.();
  }, [pendingImageToOpen, pendingImageVariantId, images, openLightbox, onClear]);

  return capturedVariantIdRef;
}
