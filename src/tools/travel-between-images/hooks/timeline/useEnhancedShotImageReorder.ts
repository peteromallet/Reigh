import { useCallback } from 'react';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { log } from '@/shared/lib/logger';
import type { GenerationRow } from '@/domains/generation/types';

function shortId(id: string | null | undefined): string | null {
  return id ? id.slice(0, 8) : null;
}

/**
 * Enhanced hook for handling shot image reordering with a single canonical
 * persistence path (absolute frame assignments).
 */
export const useEnhancedShotImageReorder = (
  shotId: string | null,
  deps: {
    shotGenerations: GenerationRow[];
    getImagesForMode: (mode: 'batch' | 'timeline' | 'by-pair') => GenerationRow[];
    batchExchangePositions: (updates: Array<{ shotGenerationId: string; newFrame: number }>) => Promise<void>;
    deleteItem: (genId: string) => Promise<void>;
    loadPositions: (opts?: { silent?: boolean; reason?: string }) => Promise<void>;
    isLoading: boolean;
    moveItemsToMidpoint?: (
      draggedItemIds: string[],
      newStartIndex: number,
      allItems: Array<{ id: string; timeline_frame: number | null }>
    ) => Promise<void>;
  },
) => {
  const REORDER_LOG_PREFIX = '[BatchReorder]';

  const {
    shotGenerations,
    getImagesForMode,
    batchExchangePositions,
    deleteItem,
    loadPositions,
    isLoading,
    moveItemsToMidpoint,
  } = deps;

  const handleReorder = useCallback(async (orderedShotImageEntryIds: string[], draggedItemId?: string) => {
    if (!shotId || orderedShotImageEntryIds.length === 0) {
      return;
    }

    // [BatchEditorOrder] Log at the exact moment drag ends — before any async work.
    // This shows what the DnD library requested vs. what React state currently shows.
    // If React state (currentImages) already shows old order here, there is NO
    // optimistic update in the batch editor and the user will see snap-back until
    // the RPC + refetch completes.
    const currentImagesAtDragEnd = getImagesForMode('batch');
    log(`${REORDER_LOG_PREFIX} drag-end snapshot`, {
      shotId: shortId(shotId),
      draggedItemId: shortId(draggedItemId),
      desiredCount: orderedShotImageEntryIds.length,
      currentCount: currentImagesAtDragEnd.length,
      desiredOrder: orderedShotImageEntryIds.map((id) => shortId(id)),
      currentOrder: currentImagesAtDragEnd.map((img) => shortId(img.id)),
      currentFrames: currentImagesAtDragEnd.map((img) => img.timeline_frame ?? null),
      orderMatchesCurrent: JSON.stringify(orderedShotImageEntryIds) === JSON.stringify(currentImagesAtDragEnd.map((img) => img.id)),
    });

    try {
      const currentImages = getImagesForMode('batch');
      const currentOrder = currentImages.map((img) => img.id);
      const normalizedDraggedItemId = draggedItemId
        ? (currentImages.find((img) => img.id === draggedItemId)?.id ?? draggedItemId)
        : undefined;

      log(`${REORDER_LOG_PREFIX} reorder requested`, {
        shotId: shortId(shotId),
        draggedItemId: shortId(draggedItemId),
        normalizedDraggedItemId: shortId(normalizedDraggedItemId),
        currentCount: currentOrder.length,
        desiredCount: orderedShotImageEntryIds.length,
        currentOrder: currentOrder.map((id) => shortId(id)),
        desiredOrder: orderedShotImageEntryIds.map((id) => shortId(id)),
      });

      const detectItemMove = (() => {
        if (!moveItemsToMidpoint || orderedShotImageEntryIds.length !== currentOrder.length || !normalizedDraggedItemId) {
          return null;
        }

        const oldIndex = currentOrder.indexOf(normalizedDraggedItemId);
        const newIndex = orderedShotImageEntryIds.indexOf(normalizedDraggedItemId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
          return null;
        }

        return {
          movedItemIds: [normalizedDraggedItemId],
          newStartIndex: newIndex,
          oldStartIndex: oldIndex,
        };
      })();

      if (detectItemMove && moveItemsToMidpoint) {
        const newOrderItems = orderedShotImageEntryIds.map((id) => {
          const img = currentImages.find((item) => item.id === id);
          return { id, timeline_frame: img?.timeline_frame ?? null };
        });

        log(`${REORDER_LOG_PREFIX} midpoint reorder path`, {
          shotId: shortId(shotId),
          movedItemIds: detectItemMove.movedItemIds.map((id) => shortId(id)),
          oldStartIndex: detectItemMove.oldStartIndex,
          newStartIndex: detectItemMove.newStartIndex,
          idFoundInShotGens: detectItemMove.movedItemIds.map((id) => ({
            id: shortId(id),
            found: shotGenerations.some((sg) => sg.id === id),
            frame: shotGenerations.find((sg) => sg.id === id)?.timeline_frame ?? null,
          })),
          newOrderFrames: newOrderItems.slice(0, 6).map((item) => ({
            id: shortId(item.id),
            frame: item.timeline_frame,
          })),
        });

        await moveItemsToMidpoint(
          detectItemMove.movedItemIds,
          detectItemMove.newStartIndex,
          newOrderItems,
        );

        log(`${REORDER_LOG_PREFIX} midpoint reorder persist complete`, {
          shotId: shortId(shotId),
          movedItemIds: detectItemMove.movedItemIds.map((id) => shortId(id)),
        });
        return;
      }

      if (orderedShotImageEntryIds.length !== currentImages.length) {
        const missingIds = orderedShotImageEntryIds.filter((id) => !currentOrder.includes(id));
        normalizeAndPresentError(new Error('Data sync issue - array length mismatch'), {
          context: 'useEnhancedShotImageReorder',
          showToast: false,
          logData: {
            orderedIdsLength: orderedShotImageEntryIds.length,
            currentImagesLength: currentImages.length,
            missingIds: missingIds.map((id) => id.substring(0, 8)),
          },
        });

        if (missingIds.length > 0) {
          toast.error('Please wait a moment and try again');
          return;
        }
      }

      const positionedCurrent = [...currentImages]
        .filter((image) => image.timeline_frame != null)
        .sort((a, b) => (a.timeline_frame ?? 0) - (b.timeline_frame ?? 0));
      const frameSlots = positionedCurrent.map((image) => image.timeline_frame ?? 0);
      const desiredPositionedOrder = orderedShotImageEntryIds.filter((id) => currentOrder.includes(id));

      const absoluteUpdates = desiredPositionedOrder.map((id, index) => ({
        shotGenerationId: id,
        newFrame: frameSlots[index] ?? index * 50,
      }));

      const changedUpdates = absoluteUpdates.filter((update) => {
        const currentFrame = shotGenerations.find((shotGen) => shotGen.id === update.shotGenerationId)?.timeline_frame ?? null;
        return currentFrame !== update.newFrame;
      });

      if (changedUpdates.length === 0) {
        log(`${REORDER_LOG_PREFIX} reorder skipped (no frame changes)`, {
          shotId: shortId(shotId),
          desiredCount: desiredPositionedOrder.length,
        });
        return;
      }

      log(`${REORDER_LOG_PREFIX} absolute batch reorder path`, {
        shotId: shortId(shotId),
        updateCount: changedUpdates.length,
        updates: changedUpdates.map((update) => ({
          shotGenerationId: shortId(update.shotGenerationId),
          newFrame: update.newFrame,
        })),
      });

      await batchExchangePositions(changedUpdates);
      await loadPositions({ reason: 'reorder' });

      log(`${REORDER_LOG_PREFIX} absolute batch reorder persist complete`, {
        shotId: shortId(shotId),
        updateCount: changedUpdates.length,
      });
    } catch (error) {
      normalizeAndPresentError(error, { context: 'useEnhancedShotImageReorder', toastTitle: 'Failed to reorder items' });
      throw error;
    }
  }, [shotId, getImagesForMode, batchExchangePositions, loadPositions, moveItemsToMidpoint, shotGenerations]);

  // Handle item deletion
  // id parameter is shot_generations.id (unique per entry)
  const handleDelete = useCallback(async (id: string) => {
    if (!shotId) {
      throw new Error('No shot ID provided for deletion');
    }

    try {
      const targetItem = shotGenerations.find((shotGen) => shotGen.id === id);
      if (!targetItem) {
        throw new Error('Item not found for deletion');
      }

      await deleteItem(id);
    } catch (error) {
      normalizeAndPresentError(error, { context: 'useEnhancedShotImageReorder', toastTitle: 'Failed to delete item' });
      throw error;
    }
  }, [shotId, shotGenerations, deleteItem]);

  return {
    handleReorder,
    handleDelete,
    isLoading,
    getBatchImages: () => getImagesForMode('batch'),
  };
};
