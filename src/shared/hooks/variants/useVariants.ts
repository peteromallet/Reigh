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
import { useQuery } from '@tanstack/react-query';
import { AstridLocalClient } from '@/integrations/astrid/client';
import { BridgeRouteError } from '@/integrations/astrid/transport';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability';
import { useAuthSafe } from '@/shared/contexts/AuthContext';
import { coerceVariantType, type VariantType } from '@/shared/constants/variantTypes';
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

      const projectSlug = getProjectSelectionFallbackId();
      if (!projectSlug) return [];

      try {
        const detail = await new AstridLocalClient({ projectSlug }).gallery.get(generationId);

        // Wire order is recency-first; the content route doubles as the
        // thumbnail address (no separate thumb media on the wire).
        return detail.variants.map((variant) => ({
          id: variant.id,
          generation_id: variant.generation_id,
          location: bridgeMediaUrl(projectSlug, variant.media_id),
          thumbnail_url: bridgeMediaUrl(projectSlug, variant.media_id),
          params: variant.params ?? null,
          is_primary: variant.is_primary,
          starred: variant.starred,
          variant_type: coerceVariantType(variant.variant_type),
          name: variant.name ?? null,
          created_at: variant.created_at,
          viewed_at: variant.viewed_at ?? null,
        })) as GenerationVariant[];
      } catch (error) {
        if (error instanceof BridgeRouteError && error.status === 404) {
          return [];
        }
        throw error;
      }
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
  }, [generationId, enabled, isAuthenticated, refetch]);

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

  const setPrimaryVariant = useCallback(
    async (variantId: string) => {
      void variantId;
      throw bridgeCapabilityUnavailable(
        'set primary generation variant',
        'Use an Astrid pack command after variant mutation routes are installed.',
      );
    },
    []
  );

  const deleteVariant = useCallback(
    async (variantId: string) => {
      void variantId;
      throw bridgeCapabilityUnavailable(
        'delete generation variant',
        'Use an Astrid pack command after variant mutation routes are installed.',
      );
    },
    []
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
