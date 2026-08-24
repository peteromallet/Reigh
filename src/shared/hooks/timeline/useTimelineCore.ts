/**
 * useTimelineCore - Core hook for timeline position management
 *
 * This is the single source of truth for timeline positions and operations.
 * It consolidates functionality from:
 * - useEnhancedShotPositions (position operations)
 * - useTimelinePositionUtils (batch operations, normalization)
 * - useBatchReorder (reordering)
 *
 * Architecture:
 * - Data: Uses useShotImages for the canonical data source
 * - Derived: Provides filtered/sorted positioned items via useMemo
 * - Operations: Uses atomic RPCs (delete_and_normalize, unposition_and_normalize, reorder_normalized)
 * - Pair Data: Reads/writes pair prompt overrides via metadata.segmentOverrides
 */

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import type { GenerationRow } from '@/domains/generation/types';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { useShotImages } from '@/shared/hooks/shots/useShotImages';
import { useEnqueueGenerationsInvalidation } from '@/shared/hooks/invalidation/useGenerationInvalidation';
import { isVideoGeneration } from '@/shared/lib/typeGuards';
import { calculateNextAvailableFrame, extractExistingFrames, DEFAULT_FRAME_SPACING } from '@/shared/lib/timelinePositionCalculator';
import {
  createTimelineWriteQueueLogger,
  runSerializedTimelineWrite,
  runTimelineWriteWithTimeout,
} from '@/shared/lib/timelineWriteQueue';
import { persistTimelineFrameBatch } from '@/shared/lib/timelineFrameBatchPersist';
import { useTimelinePairOperations } from './useTimelineCore.pairOperations';
import { useTimelineEnhancedPromptOperations } from './useTimelineCore.enhancedPromptOperations';
import type { TimelineCoreResult } from './useTimelineCore.types';

const TIMELINE_CORE_LOG_PREFIX = '[TimelineCorePersist]';
const log = import.meta.env.DEV ? (...args: Parameters<typeof console.log>) => console.log(...args) : () => {};

function shortId(id: string | null | undefined): string | null {
  return id ? id.slice(0, 8) : null;
}

// ============================================================================
// Types
// ============================================================================

export type { ShotGeneration, PositionMetadata } from './useTimelineCore.types';

// ============================================================================
// Hook Implementation
// ============================================================================

type InvalidateGenerationsFn = ReturnType<typeof useEnqueueGenerationsInvalidation>;

interface TimelinePositionOperations {
  updatePosition: TimelineCoreResult['updatePosition'];
  commitPositions: TimelineCoreResult['commitPositions'];
  reorder: TimelineCoreResult['reorder'];
  normalize: TimelineCoreResult['normalize'];
}

interface TimelineItemOperations {
  deleteItem: TimelineCoreResult['deleteItem'];
  unpositionItem: TimelineCoreResult['unpositionItem'];
  addItem: TimelineCoreResult['addItem'];
}

function hasValidLocation(generation: GenerationRow): boolean {
  const location = generation.imageUrl || generation.location;
  return !!location && location !== '/placeholder.svg';
}

function useTimelineDerivedItems(generations: GenerationRow[] | undefined) {
  const positionedItems = useMemo(() => {
    if (!generations) return [];

    return generations
      .filter(
        (generation) =>
          generation.timeline_frame != null
          && generation.timeline_frame >= 0
          && !isVideoGeneration(generation)
          && hasValidLocation(generation)
      )
      .sort((a, b) => (a.timeline_frame ?? 0) - (b.timeline_frame ?? 0));
  }, [generations]);

  const unpositionedItems = useMemo(() => {
    if (!generations) return [];

    return generations.filter(
      (generation) =>
        generation.timeline_frame == null
        && !isVideoGeneration(generation)
        && hasValidLocation(generation)
    );
  }, [generations]);

  return { positionedItems, unpositionedItems };
}

function useTimelinePositionOperations(
  shotId: string | null,
  positionedItems: GenerationRow[],
  invalidateGenerations: InvalidateGenerationsFn
): TimelinePositionOperations {
  const logQueuePhase = useMemo(
    () => createTimelineWriteQueueLogger({ logPrefix: TIMELINE_CORE_LOG_PREFIX, log }),
    [],
  );

  const updatePosition = useCallback<TimelineCoreResult['updatePosition']>(
    async (shotGenerationId, newFrame) => {
      if (!shotId) return;

      await runSerializedTimelineWrite(
        shotId,
        'timeline-core-update-position',
        async (signal) => {
          try {
            await runTimelineWriteWithTimeout(
              'timeline-core-update-position-write',
              async (signal) => {
                const { error } = await supabase().from('shot_generations')
                  .update({
                    timeline_frame: newFrame,
                    metadata: { user_positioned: true },
                  })
                  .eq('id', shotGenerationId)
                  .abortSignal(signal);

                if (error) {
                  throw error;
                }
              },
              {
                upstreamSignal: signal,
                onTimeout: ({ timeoutMs, pendingMs }) => {
                  log(`${TIMELINE_CORE_LOG_PREFIX} single update timed out`, {
                    shotId: shortId(shotId),
                    shotGenerationId: shortId(shotGenerationId),
                    newFrame,
                    timeoutMs,
                    pendingMs,
                  });
                },
              },
            );
            invalidateGenerations(shotId, { reason: 'position-update', scope: 'images' });
          } catch (err) {
            throw normalizeAndPresentError(err, { context: 'useTimelineCore.updatePosition', toastTitle: 'Failed to update position' });
          }
        },
        logQueuePhase,
      );
    },
    [shotId, invalidateGenerations, logQueuePhase]
  );

  const commitPositions = useCallback<TimelineCoreResult['commitPositions']>(
    async (updates) => {
      if (!shotId || updates.length === 0) return;

      await runSerializedTimelineWrite(
        shotId,
        'timeline-core-commit-positions',
        async (signal) => {
          try {
            await persistTimelineFrameBatch({
              shotId,
              updates: updates.map((update) => ({
                shotGenerationId: update.shotGenerationId,
                timelineFrame: update.newFrame,
                metadata: { user_positioned: true },
              })),
              operationLabel: 'timeline-core-commit-positions',
              timeoutOperationName: 'timeline-core-commit-positions-rpc',
              signal,
              logPrefix: TIMELINE_CORE_LOG_PREFIX,
              log,
            });

            invalidateGenerations(shotId, { reason: 'positions-commit', scope: 'all' });
          } catch (err) {
            throw normalizeAndPresentError(err, { context: 'useTimelineCore.commitPositions', toastTitle: 'Failed to update positions' });
          }
        },
        logQueuePhase,
      );
    },
    [shotId, invalidateGenerations, logQueuePhase]
  );

  const reorder = useCallback<TimelineCoreResult['reorder']>(
    async (newOrder) => {
      if (!shotId || newOrder.length === 0) return;

      try {
        const { error } = await supabase().rpc('reorder_normalized', {
          p_shot_id: shotId,
          p_new_order: newOrder,
        });

        if (error) throw error;
        invalidateGenerations(shotId, { reason: 'reorder', scope: 'all' });
      } catch (err) {
        throw normalizeAndPresentError(err, { context: 'useTimelineCore.reorder', toastTitle: 'Failed to reorder items' });
      }
    },
    [shotId, invalidateGenerations]
  );

  const normalize = useCallback<TimelineCoreResult['normalize']>(async () => {
    if (!shotId || positionedItems.length === 0) return;

    try {
      const currentOrder = positionedItems
        .map((generation) => generation.id)
        .filter(Boolean) as string[];
      const { error } = await supabase().rpc('reorder_normalized', {
        p_shot_id: shotId,
        p_new_order: currentOrder,
      });

      if (error) throw error;
      invalidateGenerations(shotId, { reason: 'normalize', scope: 'all' });
    } catch (err) {
      throw normalizeAndPresentError(err, {
        context: 'useTimelineCore.normalize',
        toastTitle: 'Failed to normalize timeline',
      });
    }
  }, [shotId, positionedItems, invalidateGenerations]);

  return { updatePosition, commitPositions, reorder, normalize };
}

function useTimelineItemOperations(
  shotId: string | null,
  positionedItems: GenerationRow[],
  invalidateGenerations: InvalidateGenerationsFn
): TimelineItemOperations {
  const deleteItem = useCallback<TimelineCoreResult['deleteItem']>(
    async (shotGenerationId) => {
      if (!shotId) return;

      try {
        const { error } = await supabase().rpc('delete_and_normalize', {
          p_shot_id: shotId,
          p_shot_generation_id: shotGenerationId,
        });

        if (error) throw error;
        invalidateGenerations(shotId, { reason: 'delete-item', scope: 'all', includeShots: true });
      } catch (err) {
        throw normalizeAndPresentError(err, { context: 'useTimelineCore.deleteItem', toastTitle: 'Failed to delete item' });
      }
    },
    [shotId, invalidateGenerations]
  );

  const unpositionItem = useCallback<TimelineCoreResult['unpositionItem']>(
    async (shotGenerationId) => {
      if (!shotId) return;

      try {
        const { error } = await supabase().rpc('unposition_and_normalize', {
          p_shot_id: shotId,
          p_shot_generation_id: shotGenerationId,
        });

        if (error) throw error;
        invalidateGenerations(shotId, { reason: 'unposition-item', scope: 'all' });
      } catch (err) {
        throw normalizeAndPresentError(err, { context: 'useTimelineCore.unpositionItem', toastTitle: 'Failed to remove from timeline' });
      }
    },
    [shotId, invalidateGenerations]
  );

  const addItem = useCallback<TimelineCoreResult['addItem']>(
    async (generationId, options) => {
      if (!shotId) return null;

      const nextFrame = options?.timelineFrame !== undefined
        ? options.timelineFrame
        : calculateNextAvailableFrame(extractExistingFrames(positionedItems));

      try {
        const { data, error } = await supabase().from('shot_generations')
          .insert({
            shot_id: shotId,
            generation_id: generationId,
            timeline_frame: nextFrame,
            metadata: {
              user_positioned: true,
              created_by_mode: 'batch',
              frame_spacing: DEFAULT_FRAME_SPACING,
            },
          })
          .select('id')
          .single();

        if (error) throw error;
        invalidateGenerations(shotId, { reason: 'add-item', scope: 'all' });
        return data?.id || null;
      } catch (err) {
        throw normalizeAndPresentError(err, { context: 'useTimelineCore.addItem', toastTitle: 'Failed to add item to timeline' });
      }
    },
    [shotId, positionedItems, invalidateGenerations]
  );

  return { deleteItem, unpositionItem, addItem };
}

export function useTimelineCore(shotId: string | null): TimelineCoreResult {
  const queryClient = useQueryClient();
  const invalidateGenerations = useEnqueueGenerationsInvalidation();
  const {
    data: generations,
    isLoading,
    error,
    refetch,
  } = useShotImages(shotId);
  const { positionedItems, unpositionedItems } = useTimelineDerivedItems(generations);
  const { updatePosition, commitPositions, reorder, normalize } = useTimelinePositionOperations(
    shotId,
    positionedItems,
    invalidateGenerations
  );
  const { deleteItem, unpositionItem, addItem } = useTimelineItemOperations(
    shotId,
    positionedItems,
    invalidateGenerations
  );
  const {
    pairPrompts,
    updatePairPrompts,
    updatePairPromptsByIndex,
    getSegmentOverrides,
    updateSegmentOverrides,
  } = useTimelinePairOperations(shotId, positionedItems, invalidateGenerations, queryClient);
  const {
    getEnhancedPrompt,
    clearEnhancedPrompt,
    clearAllEnhancedPrompts,
  } = useTimelineEnhancedPromptOperations(shotId, positionedItems, invalidateGenerations, queryClient);

  return {
    generations,
    positionedItems,
    unpositionedItems,
    isLoading,
    error: error || null,
    updatePosition,
    commitPositions,
    reorder,
    deleteItem,
    unpositionItem,
    addItem,
    pairPrompts,
    updatePairPrompts,
    updatePairPromptsByIndex,
    getSegmentOverrides,
    updateSegmentOverrides,
    getEnhancedPrompt,
    clearEnhancedPrompt,
    clearAllEnhancedPrompts,
    normalize,
    refetch: () => refetch(),
  };
}
