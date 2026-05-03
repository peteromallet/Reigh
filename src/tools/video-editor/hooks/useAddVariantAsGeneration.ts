import { useCallback, useState } from 'react';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { hasVideoExtension } from '@/shared/lib/typeGuards';
import { usePromoteVariantToGeneration } from '@/shared/hooks/variants/usePromoteVariantToGeneration';
import { loadPrimaryVariantForGeneration } from '@/tools/video-editor/adapters/reigh/variantPromotionLookup';
import type { GenerationVariant } from '@/shared/hooks/variants/useVariants';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/DataProviderContext';
import { buildDuplicateClipEdit } from '@/tools/video-editor/lib/duplicate-clip';
import { planGenerationAssetRegistration } from '@/tools/video-editor/lib/timeline-asset-plans';
import {
  useTimelineEditorOps,
  useTimelineMutableAdapters,
} from '@/tools/video-editor/hooks/timelineStore';

export interface UseAddVariantAsGenerationResult {
  addVariantAsGenerationAfterClip: (clipId: string, variant: GenerationVariant) => Promise<void>;
  isPending: (clipId: string, variantId: string) => boolean;
}

/**
 * Promotes a specific variant to a new generation and inserts it on the timeline
 * immediately after the given clip (mirrors handleDuplicateGenerationClip but uses
 * an arbitrary variant rather than the current primary).
 */
export function useAddVariantAsGeneration(): UseAddVariantAsGenerationResult {
  const runtime = useVideoEditorRuntime();
  const selectedProjectId = runtime.project.projectId;
  const { applyEdit, registerGenerationAsset } = useTimelineEditorOps();
  const { dataRef } = useTimelineMutableAdapters();
  const promoteVariant = usePromoteVariantToGeneration();
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  const setPendingKey = useCallback((key: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  const addVariantAsGenerationAfterClip = useCallback(async (clipId: string, variant: GenerationVariant) => {
    if (!selectedProjectId) {
      runtime.toast.error('Select a project before adding a generation.');
      return;
    }

    const current = dataRef?.current;
    if (!current) return;

    const sourceMeta = current.meta[clipId];
    const sourceAssetKey = sourceMeta?.asset;
    const sourceAssetEntry = sourceAssetKey ? current.registry.assets[sourceAssetKey] : undefined;

    const key = `${clipId}:${variant.id}`;
    setPendingKey(key, true);
    try {
      const promoted = await promoteVariant.mutateAsync({
        variantId: variant.id,
        projectId: selectedProjectId,
      });

      // The DB trigger trg_auto_create_variant_after_generation creates the new
      // generation's primary variant synchronously — fetch it so we can bind the
      // asset to a real variant id (not the source's).
      const primaryRow = await loadPrimaryVariantForGeneration(promoted.id);

      const newVariantId = primaryRow?.id ?? variant.id;
      const newLocation = primaryRow?.location ?? promoted.location ?? variant.location;
      const newThumb = primaryRow?.thumbnail_url ?? promoted.thumbnail_url ?? variant.thumbnail_url ?? null;

      const isVideo = hasVideoExtension(newLocation);
      const variantType: 'image' | 'video' = isVideo ? 'video' : 'image';
      const contentType = sourceAssetEntry?.type
        ?? (isVideo ? 'video/mp4' : 'image/png');
      const registrationPlan = planGenerationAssetRegistration({
        generationId: promoted.id,
        variantId: newVariantId,
        variantType,
        imageUrl: newLocation,
        thumbUrl: newThumb ?? newLocation,
        assetDurationSeconds: typeof sourceAssetEntry?.duration === 'number' ? sourceAssetEntry.duration : undefined,
        metadata: { content_type: contentType },
      });
      if (!registrationPlan.ok) {
        throw new Error('Failed to plan the new generation asset.');
      }

      const latest = dataRef?.current;
      if (!latest) {
        throw new Error('Timeline state was unavailable before registering the asset.');
      }

      const edit = buildDuplicateClipEdit(latest, clipId, registrationPlan.assetId);
      if (!edit) {
        throw new Error('Failed to insert the new clip on the timeline.');
      }

      const newAssetKey = registerGenerationAsset({
        assetId: registrationPlan.assetId,
        generationId: promoted.id,
        variantId: newVariantId,
        variantType,
        imageUrl: newLocation,
        thumbUrl: newThumb ?? newLocation,
        durationSeconds: typeof sourceAssetEntry?.duration === 'number' ? sourceAssetEntry.duration : undefined,
        metadata: { content_type: contentType },
      });

      if (!newAssetKey) {
        throw new Error('Failed to register the new generation as an asset.');
      }

      applyEdit({
        type: 'rows',
        rows: edit.rows,
        metaUpdates: edit.metaUpdates,
        clipOrderOverride: edit.clipOrderOverride,
      }, {
        selectedClipId: edit.clipId,
        selectedTrackId: edit.trackId,
        semantic: true,
      });
    } catch (error) {
      normalizeAndPresentError(error, {
        context: 'video-editor:add-variant-as-generation',
        toastTitle: 'Failed to add variant as generation',
      });
    } finally {
      setPendingKey(key, false);
    }
  }, [applyEdit, dataRef, promoteVariant, registerGenerationAsset, runtime.toast, selectedProjectId, setPendingKey]);

  const isPending = useCallback(
    (clipId: string, variantId: string) => pending.has(`${clipId}:${variantId}`),
    [pending],
  );

  return { addVariantAsGenerationAfterClip, isPending };
}
