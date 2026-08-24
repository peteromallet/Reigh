/**
 * useImageManagement - Image reorder and final video management hooks
 *
 * Extracted from ShotEditor to reduce component size.
 * Handles:
 * - Image reorder within shot timeline
 * - Final video deletion/clearing
 * - Pending position tracking
 */

import { useState, useCallback, useRef } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { queryKeys } from '@/shared/lib/queryKeys';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import type { GenerationRow, Shot } from '@/domains/generation/types';

interface ReorderUpdate {
  shotId: string;
  projectId: string;
  updates: Array<{ shot_id: string; generation_id: string; timeline_frame: number }>;
}

interface UseImageManagementOptions {
  queryClient: QueryClient;
  selectedShotRef: React.MutableRefObject<Shot | undefined>;
  projectIdRef: React.MutableRefObject<string | null>;
  allShotImagesRef: React.MutableRefObject<GenerationRow[]>;
  batchVideoFramesRef: React.MutableRefObject<number>;
  updateShotImageOrderMutation: {
    mutate: (params: ReorderUpdate, options?: { onSuccess?: () => void; onError?: (error: unknown) => void }) => void;
  };
  demoteOrphanedVariants: (shotId: string, reason: string) => void;
  actionsRef: React.MutableRefObject<{ setPendingFramePositions: (value: Map<string, number>) => void }>;
  pendingFramePositions: Map<string, number>;
}

interface UseImageManagementReturn {
  // Final video
  isClearingFinalVideo: boolean;
  handleDeleteFinalVideo: (generationId: string) => Promise<void>;
  // Image reorder
  handleReorderImagesInShot: (orderedShotGenerationIds: string[], draggedItemId?: string) => void;
  // Pending positions
  handlePendingPositionApplied: (generationId: string) => void;
}

export function useImageManagement({
  queryClient,
  selectedShotRef,
  projectIdRef,
  allShotImagesRef,
  batchVideoFramesRef,
  updateShotImageOrderMutation,
  demoteOrphanedVariants,
  actionsRef,
  pendingFramePositions,
}: UseImageManagementOptions): UseImageManagementReturn {
  // State for final video clearing
  const [isClearingFinalVideo, setIsClearingFinalVideo] = useState(false);

  // Refs for stable callbacks
  const updateShotImageOrderMutationRef = useRef(updateShotImageOrderMutation);
  updateShotImageOrderMutationRef.current = updateShotImageOrderMutation;

  const demoteOrphanedVariantsRef = useRef(demoteOrphanedVariants);
  demoteOrphanedVariantsRef.current = demoteOrphanedVariants;

  const pendingFramePositionsRef = useRef(pendingFramePositions);
  pendingFramePositionsRef.current = pendingFramePositions;

  // Handler for clearing the final video output (not deleting the entire generation)
  const handleDeleteFinalVideo = useCallback(async (generationId: string) => {
    const selectedShot = selectedShotRef.current;
    const projectId = projectIdRef.current;

    setIsClearingFinalVideo(true);

    try {
      // 1. Clear the generation's location and thumbnail_url (keeps the generation record)
      const { error: updateError } = await supabase().from('generations')
        .update({
          location: null,
          thumbnail_url: null
        })
        .eq('id', generationId);

      if (updateError) {
        normalizeAndPresentError(updateError, { context: 'FinalVideoDelete', toastTitle: 'Failed to clear final video output' });
        return;
      }

      // 2. Delete ALL variants of this generation except the original
      const { error: deleteVariantError } = await supabase().from('generation_variants')
        .delete()
        .eq('generation_id', generationId)
        .neq('variant_type', 'original')
        .select('id');

      if (deleteVariantError) {
        normalizeAndPresentError(deleteVariantError, { context: 'FinalVideoDelete', showToast: false });
      }

      // Invalidate queries to refresh the UI
      if (selectedShot?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.segments.parents(selectedShot.id, projectId ?? undefined) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.generations.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.projectStats.videos(projectId!) });
    } catch (error) {
      normalizeAndPresentError(error, { context: 'FinalVideoDelete', toastTitle: 'Failed to clear final video output' });
    } finally {
      setIsClearingFinalVideo(false);
    }
  }, [queryClient, selectedShotRef, projectIdRef]);

  // Handler for reordering images in shot timeline
  const handleReorderImagesInShot = useCallback((orderedShotGenerationIds: string[]) => {
    const shot = selectedShotRef.current;
    const projId = projectIdRef.current;

    if (!shot || !projId) {
      normalizeAndPresentError(new Error('Cannot reorder images: No shot or project selected.'), { context: 'ShotEditor', showToast: false });
      return;
    }

    // Convert ordered IDs into timeline_frame updates
    const updates = orderedShotGenerationIds.map((shotGenerationId, index) => ({
      shot_id: shot.id,
      generation_id: (() => {
        const img = allShotImagesRef.current?.find((i) => i.id === shotGenerationId);
        return img?.generation_id ?? shotGenerationId;
      })(),
      timeline_frame: index * batchVideoFramesRef.current,
    }));

    updateShotImageOrderMutationRef.current.mutate({
      shotId: shot.id,
      projectId: projId,
      updates,
    }, {
      onSuccess: () => {
        demoteOrphanedVariantsRef.current(shot.id, 'image-reorder');
      },
      onError: (error: unknown) => {
        normalizeAndPresentError(error, { context: 'ShotEditor', showToast: false });
      }
    });
  }, [selectedShotRef, projectIdRef, allShotImagesRef, batchVideoFramesRef]);

  // Handler for clearing applied pending positions
  const handlePendingPositionApplied = useCallback((generationId: string) => {
    const newMap = new Map(pendingFramePositionsRef.current);
    if (newMap.has(generationId)) {
      newMap.delete(generationId);
    }
    actionsRef.current.setPendingFramePositions(newMap);
  }, [actionsRef]);

  return {
    isClearingFinalVideo,
    handleDeleteFinalVideo,
    handleReorderImagesInShot,
    handlePendingPositionApplied,
  };
}
