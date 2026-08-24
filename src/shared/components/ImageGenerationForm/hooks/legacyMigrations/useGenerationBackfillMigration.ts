import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import type { StyleReferenceMetadata } from '@/features/resources/hooks/useResources';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { useSpecificResources } from '@/shared/hooks/useSpecificResources';
import { invalidateShotsQueries } from '@/shared/hooks/shots/cacheUtils';
import { placeGeneration } from '@/shared/lib/placement/placementService';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';
import { resourceQueryKeys } from '@/shared/lib/queryKeys/resources';
import { toJson } from '@/shared/lib/supabaseTypeHelpers';
import type { ReferenceImage } from '../../types';

interface GenerationBackfillMigrationInput {
  selectedProjectId: string | null;
  effectiveShotId: string;
  referencePointers: ReferenceImage[];
}

// SUNSET: 2026-09-01 — remove after all owned style-reference resources have generation_id backfilled.
export function useGenerationBackfillMigration(input: GenerationBackfillMigrationInput): void {
  const {
    selectedProjectId,
    effectiveShotId,
    referencePointers,
  } = input;

  const queryClient = useQueryClient();
  const migrationStateRef = useRef<Record<string, boolean>>({});
  const resourcePointers = useMemo(
    () => referencePointers.filter((pointer): pointer is ReferenceImage & { resourceId: string } => !!pointer.resourceId),
    [referencePointers],
  );
  const resourceIds = useMemo(
    () => [...new Set(resourcePointers.map(pointer => pointer.resourceId))],
    [resourcePointers],
  );
  const specificResources = useSpecificResources(resourceIds);

  useEffect(() => {
    const migrationKey = selectedProjectId && effectiveShotId !== 'none'
      ? `${selectedProjectId}:${effectiveShotId}`
      : null;

    if (!migrationKey) {
      return;
    }

    if (migrationStateRef.current[migrationKey]) {
      return;
    }

    if (referencePointers.length === 0) {
      migrationStateRef.current[migrationKey] = true;
      return;
    }

    if (resourcePointers.length !== referencePointers.length) {
      return;
    }

    if (specificResources.isLoading) {
      return;
    }

    const resources = specificResources.data ?? [];
    if (resources.length < resourceIds.length) {
      return;
    }

    const migrateMissingGenerationIds = async () => {
      migrationStateRef.current[migrationKey] = true;

      try {
        const {
          data: { user },
        } = await supabase().auth.getUser();

        if (!user || !selectedProjectId) {
          return;
        }

        let migratedAny = false;

        for (const resource of resources) {
          if (resource.generation_id) {
            continue;
          }

          if ((resource.userId || resource.user_id) !== user.id) {
            continue;
          }

          const metadata = resource.metadata as StyleReferenceMetadata;
          const originalUrl = metadata.styleReferenceImageOriginal || metadata.styleReferenceImage;
          if (!originalUrl) {
            continue;
          }

          const thumbnailUrl = metadata.thumbnailUrl || originalUrl;
          const generationId = crypto.randomUUID();

          try {
            const { error: generationError } = await supabase()
              .from('generations')
              .insert({
                id: generationId,
                location: originalUrl,
                thumbnail_url: thumbnailUrl,
                type: 'uploaded-reference',
                project_id: selectedProjectId,
              });

            if (generationError) {
              throw generationError;
            }

            try {
              await placeGeneration({
                projectSlug: selectedProjectId ?? '',
                shotId: effectiveShotId,
                generationId,
              });
            } catch (error) {
              await supabase()
                .from('generations')
                .delete()
                .eq('id', generationId)
                .eq('project_id', selectedProjectId);
              throw error;
            }

            const { error: resourceError } = await supabase()
              .from('resources')
              .update({
                generation_id: generationId,
                metadata: toJson({
                  ...metadata,
                  generationId,
                }),
              })
              .eq('id', resource.id)
              .eq('user_id', user.id);

            if (resourceError) {
              await supabase()
                .from('generations')
                .delete()
                .eq('id', generationId)
                .eq('project_id', selectedProjectId);
              throw resourceError;
            }

            migratedAny = true;
            await queryClient.invalidateQueries({ queryKey: resourceQueryKeys.detail(resource.id) });
            await queryClient.invalidateQueries({ queryKey: generationQueryKeys.detail(generationId) });
          } catch (error) {
            normalizeAndPresentError(error, {
              context: 'useGenerationBackfillMigration.migrateResource',
              showToast: false,
              logData: { resourceId: resource.id, projectId: selectedProjectId },
            });
            migrationStateRef.current[migrationKey] = false;
            return;
          }
        }

        if (migratedAny) {
          invalidateShotsQueries(queryClient, selectedProjectId);
          await queryClient.invalidateQueries({ queryKey: generationQueryKeys.byShotAll });
        }
      } catch (error) {
        normalizeAndPresentError(error, {
          context: 'useGenerationBackfillMigration',
          showToast: false,
          logData: { projectId: selectedProjectId, shotId: effectiveShotId },
        });
        migrationStateRef.current[migrationKey] = false;
      }
    };

    void migrateMissingGenerationIds();
  }, [
    effectiveShotId,
    queryClient,
    referencePointers,
    resourceIds.length,
    resourcePointers.length,
    selectedProjectId,
    specificResources.data,
    specificResources.isLoading,
  ]);
}
