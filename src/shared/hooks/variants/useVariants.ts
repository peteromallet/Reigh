/**
 * useVariants Hook
 *
 * Centralized hook for fetching and managing variants for a generation.
 * Allows switching between variants and setting the primary variant.
 * Supports realtime updates via RealtimeProvider.
 *
 * Used by: MediaLightbox, InlineEditView, and other components that display variants.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { useAuthSafe } from '@/shared/contexts/AuthContext';
import { coerceVariantType, VARIANT_TYPE, type VariantType } from '@/shared/constants/variantTypes';
import { enqueueVariantInvalidation } from '@/shared/hooks/invalidation/useGenerationInvalidation';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';
import { useAppEventListener } from '@/shared/lib/typedEvents';

/**
 * A variant of a generation (from generation_variants table)
 */
export interface GenerationVariant {
  id: string;
  generation_id: string;
  location: string;
  thumbnail_url: string | null;
  params: Record<string, unknown> | null;
  is_primary: boolean;
  starred: boolean;
  variant_type: VariantType | null;
  name: string | null;
  created_at: string;
  viewed_at: string | null;
}

/**
 * Return type for useVariants hook
 */
interface UseVariantsReturn {
  variants: GenerationVariant[];
  primaryVariant: GenerationVariant | null;
  activeVariant: GenerationVariant | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  setActiveVariantId: (variantId: string | null) => void;
  setPrimaryVariant: (variantId: string) => Promise<void>;
  deleteVariant: (variantId: string) => Promise<void>;
}

interface UseVariantsProps {
  generationId: string | null;
  enabled?: boolean;
}

export const useVariants = ({
  generationId,
  enabled = true,
}: UseVariantsProps): UseVariantsReturn => {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthSafe();
  const [activeVariantId, setActiveVariantIdInternal] = useState<string | null>(null);
  
  // Stable callback - no deps needed since we just forward to internal setter
  const setActiveVariantId = useCallback((variantId: string | null) => {
    setActiveVariantIdInternal(variantId);
  }, []);

  // Fetch variants for this generation
  const {
    data: variants = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: generationId ? generationQueryKeys.variants(generationId) : ['generation-variants', null],
    queryFn: async () => {
      if (!generationId) return [];

      const { data, error } = await supabase().from('generation_variants')
        .select('*')
        .eq('generation_id', generationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[useVariants] Error fetching variants:', error);
        throw error;
      }

      return (data || []).map((variant) => ({
        ...variant,
        variant_type: coerceVariantType(variant.variant_type),
      })) as GenerationVariant[];
    },
    enabled: enabled && !!generationId && isAuthenticated,
    staleTime: 30000, // 30 seconds
  });

  // Listen for realtime variant changes and refetch when our generationId is affected
  const handleVariantChange = useCallback((detail: { affectedGenerationIds: string[] }) => {
    if (!generationId || !enabled || !isAuthenticated) return;
    const affectedIds = detail?.affectedGenerationIds || [];
    if (affectedIds.includes(generationId)) {
      refetch();
    }
  }, [generationId, enabled, refetch]);

  useAppEventListener('realtime:variant-change-batch', handleVariantChange);

  // Find the primary variant
  const primaryVariant = useMemo(() => {
    return variants.find((v) => v.is_primary) || null;
  }, [variants]);

  // Get the active variant (selected or primary, fallback to first variant)
  const activeVariant = useMemo(() => {
    if (activeVariantId) {
      const found = variants.find((v) => v.id === activeVariantId);
      if (found) {
        return found;
      }
    }
    // Fall back to primary, then first variant if no primary exists
    return primaryVariant || variants[0] || null;
  }, [variants, activeVariantId, primaryVariant]);

  // Initialize active variant to primary (or first variant) when variants load
  // NOTE: Using useEffect, not useMemo - side effects should not be in useMemo
  useEffect(() => {
    if (!activeVariantId && variants.length > 0) {
      const variantToSelect = primaryVariant || variants[0];
      if (variantToSelect) {
        setActiveVariantIdInternal(variantToSelect.id);
      }
    }
  }, [primaryVariant, variants, activeVariantId]);

  // Mutation to set a variant as primary
  const setPrimaryMutation = useMutation({
    mutationFn: async (variantId: string) => {

      // Update the variant to be primary
      // The database trigger will handle unsetting the old primary
      const { error } = await supabase().from('generation_variants')
        .update({ is_primary: true })
        .eq('id', variantId);

      if (error) {
        console.error('[useVariants] Error setting primary variant:', error);
        throw error;
      }

      return variantId;
    },
    onSuccess: async (variantId) => {

      // Invalidate caches using centralized function
      if (generationId) {
        await enqueueVariantInvalidation(queryClient, {
          generationId,
          reason: 'set-primary-variant',
        });
      }

      // SINGLE-SEGMENT PROPAGATION: If this is a child of a single-segment parent,
      // also create a variant on the parent so the main generation updates
      try {
        // Get the promoted variant's location and thumbnail
        const { data: promotedVariant } = await supabase().from('generation_variants')
          .select('location, thumbnail_url, params')
          .eq('id', variantId)
          .single();

        if (!promotedVariant || !generationId) return;

        // Check if this generation is a child with a parent
        const { data: generation } = await supabase().from('generations')
          .select('is_child, parent_generation_id')
          .eq('id', generationId)
          .single();

        if (!generation?.is_child || !generation?.parent_generation_id) return;

        // Count how many children the parent has
        const { count: childCount } = await supabase().from('generations')
          .select('id', { count: 'exact', head: true })
          .eq('parent_generation_id', generation.parent_generation_id)
          .eq('is_child', true);

        // Only propagate for single-segment parents
        if (childCount !== 1) {
          return;
        }

        // Create a new variant on the parent with the promoted video
        // Exclude task-specific fields that shouldn't propagate to parent
        const {
          source_task_id: _sourceTaskId,
          child_generation_id: _childGenId,
          ...paramsToPropagate
        } = (promotedVariant.params || {}) as Record<string, unknown>;

        const { error: insertError } = await supabase().from('generation_variants')
          .insert({
            generation_id: generation.parent_generation_id,
            location: promotedVariant.location,
            thumbnail_url: promotedVariant.thumbnail_url,
            is_primary: true, // DB trigger will unset old primary
            variant_type: VARIANT_TYPE.TRAVEL_SEGMENT,
            params: {
              ...paramsToPropagate,
              propagated_from_child: generationId,
              propagated_from_variant: variantId,
            },
          });

        if (insertError) {
          normalizeAndPresentError(insertError, { context: 'useVariants', showToast: false });
        } else {
          // Invalidate parent's variant cache
          await enqueueVariantInvalidation(queryClient, {
            generationId: generation.parent_generation_id,
            reason: 'single-segment-propagation',
          });
        }
      } catch (err) {
        console.error('[useVariants] Error in single-segment propagation:', err);
        // Don't throw - this is a nice-to-have, not critical
      }
    },
    onError: (error) => {
      normalizeAndPresentError(error, { context: 'useVariants.setPrimaryVariant', toastTitle: 'Failed to set primary variant' });
    },
  });

  const setPrimaryVariant = useCallback(
    async (variantId: string) => {
      await setPrimaryMutation.mutateAsync(variantId);
    },
    [setPrimaryMutation]
  );

  // Mutation to delete a variant
  const deleteVariantMutation = useMutation({
    mutationFn: async (variantId: string) => {

      // Check if variant is primary or original - don't allow deleting either
      const variant = variants.find(v => v.id === variantId);
      if (variant?.is_primary) {
        throw new Error('Cannot delete the primary variant');
      }
      if (variant?.variant_type === 'original') {
        throw new Error('Cannot delete the original variant');
      }

      const { error } = await supabase().from('generation_variants')
        .delete()
        .eq('id', variantId);

      if (error) {
        console.error('[useVariants] Error deleting variant:', error);
        throw error;
      }

      return variantId;
    },
    onSuccess: async (variantId) => {

      // If deleted variant was active, switch to primary
      if (activeVariantId === variantId) {
        setActiveVariantId(primaryVariant?.id || null);
      }

      // Invalidate caches
      if (generationId) {
        await enqueueVariantInvalidation(queryClient, {
          generationId,
          reason: 'delete-variant',
        });
      }
    },
    onError: (error) => {
      normalizeAndPresentError(error, { context: 'useVariants.deleteVariant', toastTitle: 'Failed to delete variant' });
    },
  });

  const deleteVariant = useCallback(
    async (variantId: string) => {
      await deleteVariantMutation.mutateAsync(variantId);
    },
    [deleteVariantMutation]
  );

  return {
    variants,
    primaryVariant,
    activeVariant,
    isLoading,
    error: error as Error | null,
    refetch,
    setActiveVariantId,
    setPrimaryVariant,
    deleteVariant,
  };
};
