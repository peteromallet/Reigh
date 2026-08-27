/**
 * useToggleVariantStar Hook
 *
 * Toggles the starred state of a generation variant with optimistic update.
 *
 * Usage:
 *   const { toggleStar } = useToggleVariantStar();
 *   toggleStar({ variantId, generationId, starred: true });
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';
import type { GenerationVariant } from '@/shared/hooks/variants/useVariants';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';

interface ToggleStarParams {
  variantId: string;
  generationId: string;
  starred: boolean;
}

export function useToggleVariantStar() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ variantId, starred }: ToggleStarParams) => {
      const { error } = await supabase().from('generation_variants')
        .update({ starred })
        .eq('id', variantId);

      if (error) {
        normalizeAndPresentError(error, { context: 'useToggleVariantStar', showToast: false });
        throw error;
      }

      return { variantId, starred };
    },
    onMutate: async ({ variantId, generationId, starred }) => {
      const queryKey = generationQueryKeys.variants(generationId);

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previousVariants = queryClient.getQueryData<GenerationVariant[]>(queryKey);

      // Optimistic update
      queryClient.setQueryData<GenerationVariant[]>(queryKey, (old) => {
        if (!old) return old;
        return old.map((v) =>
          v.id === variantId ? { ...v, starred } : v
        );
      });

      return { previousVariants, queryKey };
    },
    onError: (_error, _vars, context) => {
      // Rollback on error
      if (context?.previousVariants) {
        queryClient.setQueryData(context.queryKey, context.previousVariants);
      }
      normalizeAndPresentError(new Error('Failed to toggle star'), { context: 'useToggleVariantStar', showToast: false });
    },
    onSettled: (_data, _error, { generationId }) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({
        queryKey: generationQueryKeys.variants(generationId),
      });
      queryClient.invalidateQueries({
        queryKey: generationQueryKeys.detail(generationId),
      });
    },
  });

  return {
    toggleStar: mutation.mutate,
    isToggling: mutation.isPending,
  };
}
