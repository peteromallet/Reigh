import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { queryKeys } from '@/shared/lib/queryKeys';
import type { GenerationRow } from '@/domains/generation/types';
import { toJson } from '@/shared/lib/supabaseTypeHelpers';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import type { useEnqueueGenerationsInvalidation } from '@/shared/hooks/invalidation/useGenerationInvalidation';
import { readSegmentOverrides, writeSegmentOverrides } from '@/shared/lib/settingsMigration';
import type { TimelineCoreResult } from './useTimelineCore.types';

type InvalidateGenerationsFn = ReturnType<typeof useEnqueueGenerationsInvalidation>;

type TimelinePairOperations = Pick<
  TimelineCoreResult,
  | 'pairPrompts'
  | 'updatePairPrompts'
  | 'updatePairPromptsByIndex'
  | 'getSegmentOverrides'
  | 'updateSegmentOverrides'
>;

export function useTimelinePairOperations(
  shotId: string | null,
  positionedItems: GenerationRow[],
  invalidateGenerations: InvalidateGenerationsFn,
  queryClient: ReturnType<typeof useQueryClient>,
): TimelinePairOperations {
  const pairPrompts = useMemo<TimelineCoreResult['pairPrompts']>(() => {
    if (positionedItems.length === 0) {
      return {};
    }

    const promptsByPair: Record<number, { prompt: string; negativePrompt: string }> = {};
    for (let index = 0; index < positionedItems.length - 1; index += 1) {
      const firstItem = positionedItems[index];
      const overrides = readSegmentOverrides(firstItem.metadata as Record<string, unknown> | null);

      if (overrides.prompt || overrides.negativePrompt) {
        promptsByPair[index] = {
          prompt: overrides.prompt || '',
          negativePrompt: overrides.negativePrompt || '',
        };
      }
    }

    return promptsByPair;
  }, [positionedItems]);

  const updatePairPrompts = useCallback<TimelineCoreResult['updatePairPrompts']>(
    async (shotGenerationId, prompt, negativePrompt) => {
      if (!shotId) {
        return;
      }

      try {
        const item = positionedItems.find((generation) => generation.id === shotGenerationId);
        if (!item) {
          throw new Error(`Item ${shotGenerationId} not found`);
        }

        const currentOverrides = readSegmentOverrides(item.metadata as Record<string, unknown> | null);
        const updatedMetadata = writeSegmentOverrides(item.metadata as Record<string, unknown> | null, {
          ...currentOverrides,
          prompt,
          negativePrompt,
        });
        const { error } = await supabase().from('shot_generations')
          .update({ metadata: toJson(updatedMetadata) })
          .eq('id', shotGenerationId);

        if (error) {
          throw error;
        }
        invalidateGenerations(shotId, { reason: 'update-pair-prompts', scope: 'metadata' });
        queryClient.invalidateQueries({ queryKey: queryKeys.segments.pairMetadata(shotGenerationId) });
      } catch (err) {
        throw normalizeAndPresentError(err, {
          context: 'useTimelineCore.updatePairPrompts',
          toastTitle: 'Failed to update pair prompts',
          showToast: false,
        });
      }
    },
    [shotId, positionedItems, invalidateGenerations, queryClient],
  );

  const updatePairPromptsByIndex = useCallback<TimelineCoreResult['updatePairPromptsByIndex']>(
    async (pairIndex, prompt, negativePrompt) => {
      if (pairIndex >= positionedItems.length - 1) {
        return;
      }

      const firstItem = positionedItems[pairIndex];
      if (!firstItem.id) {
        return;
      }
      await updatePairPrompts(firstItem.id, prompt, negativePrompt);
    },
    [positionedItems, updatePairPrompts],
  );

  const getSegmentOverrides = useCallback<TimelineCoreResult['getSegmentOverrides']>(
    (pairIndex) => {
      if (pairIndex >= positionedItems.length - 1) {
        return {};
      }

      const firstItem = positionedItems[pairIndex];
      return readSegmentOverrides(firstItem.metadata as Record<string, unknown> | null);
    },
    [positionedItems],
  );

  const updateSegmentOverrides = useCallback<TimelineCoreResult['updateSegmentOverrides']>(
    async (pairIndex, overrides) => {
      if (!shotId || pairIndex >= positionedItems.length - 1) {
        return;
      }

      const firstItem = positionedItems[pairIndex];
      if (!firstItem.id) {
        return;
      }

      try {
        const currentOverrides = readSegmentOverrides(firstItem.metadata as Record<string, unknown> | null);
        const updatedMetadata = writeSegmentOverrides(firstItem.metadata as Record<string, unknown> | null, {
          ...currentOverrides,
          ...overrides,
        });
        const { error } = await supabase().from('shot_generations')
          .update({ metadata: toJson(updatedMetadata) })
          .eq('id', firstItem.id);

        if (error) {
          throw error;
        }
        invalidateGenerations(shotId, { reason: 'update-segment-overrides', scope: 'metadata' });
      } catch (err) {
        throw normalizeAndPresentError(err, {
          context: 'useTimelineCore.updateSegmentOverrides',
          toastTitle: 'Failed to update segment overrides',
          showToast: false,
        });
      }
    },
    [shotId, positionedItems, invalidateGenerations],
  );

  return {
    pairPrompts,
    updatePairPrompts,
    updatePairPromptsByIndex,
    getSegmentOverrides,
    updateSegmentOverrides,
  };
}
