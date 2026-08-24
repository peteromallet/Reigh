import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { queryKeys } from '@/shared/lib/queryKeys';
import type { GenerationRow } from '@/domains/generation/types';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import type { useEnqueueGenerationsInvalidation } from '@/shared/hooks/invalidation/useGenerationInvalidation';
import type { TimelineCoreResult } from './useTimelineCore.types';

type InvalidateGenerationsFn = ReturnType<typeof useEnqueueGenerationsInvalidation>;

type TimelineEnhancedPromptOperations = Pick<
  TimelineCoreResult,
  'getEnhancedPrompt' | 'clearEnhancedPrompt' | 'clearAllEnhancedPrompts'
>;

export function useTimelineEnhancedPromptOperations(
  shotId: string | null,
  positionedItems: GenerationRow[],
  invalidateGenerations: InvalidateGenerationsFn,
  queryClient: ReturnType<typeof useQueryClient>,
): TimelineEnhancedPromptOperations {
  const getEnhancedPrompt = useCallback<TimelineCoreResult['getEnhancedPrompt']>(
    (shotGenerationId) => {
      const item = positionedItems.find((generation) => generation.id === shotGenerationId);
      if (!item?.metadata) {
        return undefined;
      }

      const metadata = item.metadata as Record<string, unknown>;
      return metadata.enhanced_prompt as string | undefined;
    },
    [positionedItems],
  );

  const clearEnhancedPrompt = useCallback<TimelineCoreResult['clearEnhancedPrompt']>(
    async (shotGenerationId) => {
      if (!shotId) {
        return;
      }

      try {
        const item = positionedItems.find((generation) => generation.id === shotGenerationId);
        if (!item) {
          return;
        }

        const currentMetadata = (item.metadata as Record<string, unknown>) || {};
        const updatedMetadata = {
          ...currentMetadata,
          enhanced_prompt: '',
        };

        queryClient.setQueryData<GenerationRow[]>(
          queryKeys.generations.byShot(shotId),
          (oldData) => oldData?.map((row) => (
            row.id === shotGenerationId
              ? { ...row, metadata: updatedMetadata }
              : row
          )),
        );

        const { error } = await supabase().from('shot_generations')
          .update({ metadata: updatedMetadata })
          .eq('id', shotGenerationId);

        if (error) {
          invalidateGenerations(shotId, { reason: 'clear-enhanced-prompt-error', scope: 'metadata' });
          throw error;
        }

        invalidateGenerations(shotId, { reason: 'clear-enhanced-prompt', scope: 'metadata' });
      } catch (err) {
        throw normalizeAndPresentError(err, {
          context: 'useTimelineCore.clearEnhancedPrompt',
          showToast: false,
        });
      }
    },
    [shotId, positionedItems, invalidateGenerations, queryClient],
  );

  const clearAllEnhancedPrompts = useCallback<TimelineCoreResult['clearAllEnhancedPrompts']>(async () => {
    if (!shotId) {
      return;
    }

    try {
      const itemsWithEnhancedPrompt = positionedItems.filter((generation) => {
        const metadata = generation.metadata as Record<string, unknown>;
        return !!metadata?.enhanced_prompt;
      });

      if (itemsWithEnhancedPrompt.length === 0) {
        return;
      }

      const results = await Promise.all(
        itemsWithEnhancedPrompt
          .filter((item) => item.id)
          .map((item) => {
            const currentMetadata = (item.metadata as Record<string, unknown>) || {};
            return supabase().from('shot_generations')
              .update({
                metadata: {
                  ...currentMetadata,
                  enhanced_prompt: '',
                },
              })
              .eq('id', item.id);
          }),
      );

      const firstError = results.find((result) => result.error)?.error;
      if (firstError) {
        invalidateGenerations(shotId, { reason: 'clear-all-enhanced-prompts-error', scope: 'metadata' });
        throw firstError;
      }

      invalidateGenerations(shotId, { reason: 'clear-all-enhanced-prompts', scope: 'metadata' });
    } catch (err) {
      throw normalizeAndPresentError(err, {
        context: 'useTimelineCore.clearAllEnhancedPrompts',
        showToast: false,
      });
    }
  }, [shotId, positionedItems, invalidateGenerations]);

  return {
    getEnhancedPrompt,
    clearEnhancedPrompt,
    clearAllEnhancedPrompts,
  };
}
