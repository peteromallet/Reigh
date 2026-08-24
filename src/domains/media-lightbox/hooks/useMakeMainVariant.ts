/**
 * useMakeMainVariant Hook
 *
 * Handles making the current media the main variant of its parent generation.
 * Supports two cases:
 * 1. Viewing a child generation: creates a variant on the parent with child's content
 * 2. Viewing a non-primary variant: sets that variant as primary
 */

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { VARIANT_TYPE } from '@/shared/constants/variantTypes';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { enqueueVariantInvalidation } from '@/shared/hooks/invalidation/useGenerationInvalidation';
import { getGenerationId } from '@/shared/lib/media/mediaTypeHelpers';
import type { GenerationRow } from '@/domains/generation/types';

interface UseMakeMainVariantProps {
  /** Current media being viewed */
  media: GenerationRow;
  /** Parent generation data (if viewing a child) */
  sourceGenerationData: GenerationRow | null;
  /** Whether viewing a child that can be promoted */
  canMakeMainVariantFromChild: boolean;
  /** Whether viewing a non-primary variant */
  canMakeMainVariantFromVariant: boolean;
  /** Active variant being viewed */
  activeVariant: { id: string; location?: string | null } | null;
  /** Function to set a variant as primary */
  setPrimaryVariant: (variantId: string) => Promise<void>;
  /** Function to refetch variants list */
  refetchVariants: () => void;
  /** Current shot ID */
  shotId: string | null | undefined;
  /** Selected shot ID (from dropdown) */
  selectedShotId: string | null | undefined;
  /** Callback to close lightbox */
  onClose: () => void;
}

interface UseMakeMainVariantReturn {
  /** Whether the make main variant operation is in progress */
  isMakingMainVariant: boolean;
  /** Handler to make current media the main variant */
  handleMakeMainVariant: () => Promise<void>;
}

export function useMakeMainVariant({
  media,
  sourceGenerationData,
  canMakeMainVariantFromChild: _canMakeMainVariantFromChild,
  canMakeMainVariantFromVariant,
  activeVariant,
  setPrimaryVariant,
  refetchVariants,
  shotId,
  selectedShotId,
  onClose,
}: UseMakeMainVariantProps): UseMakeMainVariantReturn {
  const queryClient = useQueryClient();
  const [isMakingMainVariant, setIsMakingMainVariant] = useState(false);

  const handleMakeMainVariant = useCallback(async () => {

    setIsMakingMainVariant(true);
    try {
      // Case 2: We're viewing a non-primary variant - just set it as primary
      if (canMakeMainVariantFromVariant && activeVariant) {
        await setPrimaryVariant(activeVariant.id);
        // Refetch variants to update UI
        refetchVariants();
        return;
      }

      // Case 1: We're viewing a child generation - create variant on parent
      if (!sourceGenerationData || !media.location) {
        return;
      }

      const parentGenId = sourceGenerationData.id;
      // 1. Create a new variant on the parent generation with current media's location
      const { error: insertError } = await supabase().from('generation_variants')
        .insert({
          generation_id: parentGenId,
          location: media.location,
          thumbnail_url: media.thumbUrl || null,
          is_primary: true,
          variant_type: VARIANT_TYPE.CHILD_PROMOTED,
          name: null,
          params: {
            // Use getGenerationId to get actual generations.id
            // media.id from shot queries is shot_generations.id, not generations.id
            source_generation_id: getGenerationId(media),
            promoted_at: new Date().toISOString()
          }
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[VariantClickDebug] Failed to create variant:', insertError);
        throw insertError;
      }

      // 2. Update the parent generation's location and thumbnail
      await supabase().from('generations')
        .update({
          location: media.location,
          thumbnail_url: media.thumbUrl
        })
        .eq('id', parentGenId);

      // Invalidate caches so all views update (timeline, shot editor, galleries, variants list).
      // Use selectedShotId if available (most likely current context), else fall back to shotId.
      await enqueueVariantInvalidation(queryClient, {
        generationId: parentGenId,
        shotId: selectedShotId || shotId || undefined,
        reason: 'child-promoted-to-primary',
      });

      // Close the lightbox (UI will now reflect updated data without refresh)
      onClose();
    } catch (error) {
      normalizeAndPresentError(error, { context: 'useMakeMainVariant', showToast: false });
    } finally {
      setIsMakingMainVariant(false);
    }
  }, [
    sourceGenerationData,
    media,
    onClose,
    canMakeMainVariantFromVariant,
    activeVariant,
    setPrimaryVariant,
    refetchVariants,
    queryClient,
    selectedShotId,
    shotId,
  ]);

  return {
    isMakingMainVariant,
    handleMakeMainVariant,
  };
}
