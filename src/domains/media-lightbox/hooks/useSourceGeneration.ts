import { useEffect, useMemo } from 'react';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { GenerationRow } from '@/domains/generation/types';
import { expandShotData } from '@/shared/lib/shots/shotData';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import { bridgeDetailToGenerationRecord } from '@/integrations/supabase/repositories/generationRepository';
import { useGenerationDetail } from '@/shared/hooks/generations/useGenerationDetail';

interface UseSourceGenerationParams {
  media: GenerationRow;
  onOpenExternalGeneration?: (generationId: string, derivedContext?: string[]) => Promise<void>;
}

export interface SourceVariantData {
  id: string;
  location: string;
  thumbnail_url: string | null;
  variant_type: string | null;
  is_primary: boolean;
}

/** Enriched generation data with shot associations */
interface SourceGenerationWithAssociations extends GenerationRow {
  all_shot_associations: Array<{ shot_id: string; timeline_frame: number | null }>;
}

interface UseSourceGenerationReturn {
  sourceGenerationData: SourceGenerationWithAssociations | null;
  sourcePrimaryVariant: SourceVariantData | null;
}

/**
 * Hook to fetch and manage source generation (based_on) data
 * Fetches the generation that this media was derived from, plus its primary variant
 */
export const useSourceGeneration = ({
  media
}: UseSourceGenerationParams): UseSourceGenerationReturn => {
  const metadataBasedOnId = (media.metadata as Record<string, unknown> | null)?.based_on as string | undefined;
  const effectiveBasedOnId = media.based_on || metadataBasedOnId || null;
  const detailQuery = useGenerationDetail(effectiveBasedOnId);

  useEffect(() => {
    if (detailQuery.error) {
      normalizeAndPresentError(detailQuery.error, { context: 'useSourceGeneration', showToast: false });
    }
  }, [detailQuery.error]);

  const { sourceGenerationData, sourcePrimaryVariant } = useMemo(() => {
    const projectSlug = getProjectSelectionFallbackId();
    const detail = detailQuery.data;
    if (!projectSlug || !detail) {
      return {
        sourceGenerationData: null,
        sourcePrimaryVariant: null,
      };
    }

    const record = bridgeDetailToGenerationRecord(detail, projectSlug);
    const sourceData: SourceGenerationWithAssociations = {
      ...record as unknown as GenerationRow,
      all_shot_associations: expandShotData(record.shot_data as Record<string, unknown> | null | undefined),
    };
    const primaryVariant = detail.variants.find((variant) => variant.is_primary) ?? null;

    return {
      sourceGenerationData: sourceData,
      sourcePrimaryVariant: primaryVariant ? {
        id: primaryVariant.id,
        location: bridgeMediaUrl(projectSlug, primaryVariant.media_id),
        thumbnail_url: bridgeMediaUrl(projectSlug, primaryVariant.media_id),
        variant_type: primaryVariant.variant_type ?? null,
        is_primary: primaryVariant.is_primary,
      } : null,
    };
  }, [detailQuery.data]);

  return {
    sourceGenerationData,
    sourcePrimaryVariant
  };
};
