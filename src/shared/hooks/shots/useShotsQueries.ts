/**
 * Shot query hooks for fetching shot data.
 */

import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { GenerationRow } from '@/domains/generation/types';
import { mapShotGenerationToRow } from './mappers';
import { getGenerationId } from '@/shared/lib/media/mediaTypeHelpers';
import { queryKeys } from '@/shared/lib/queryKeys';
import { isDeferredCloudDataAuthority } from '@/app/runtime/dataAuthority';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';
import { assertDeferredCloudShotOperation } from './shotAuthority';

function canReadCloudShots(): boolean {
  return isDeferredCloudDataAuthority() && !hasLocalModeUrlParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
}
// ============================================================================
// LIST SHOTS
// ============================================================================

/**
 * List all shots for a specific project with configurable image loading.
 * @param projectId - The project to fetch shots for
 * @param options.maxImagesPerShot - Limit images per shot (0 = unlimited, default)
 */
export const useListShots = (
  projectId?: string | null,
  options: { maxImagesPerShot?: number } = {}
) => {
  const { maxImagesPerShot = 0 } = options;

  return useQuery({
    queryKey: queryKeys.shots.list(projectId ?? '', maxImagesPerShot),
    queryFn: async () => {
      assertDeferredCloudShotOperation('read shots');
      if (!projectId) {
        return [];
      }

      // Get shots ordered by position
      const { data: shots, error: shotsError } = await supabase().from('shots')
        .select('*')
        .eq('project_id', projectId)
        .order('position', { ascending: true });

      if (shotsError) {
        throw shotsError;
      }

      if (!shots || shots.length === 0) {
        return [];
      }

      // Fetch all shot_generations in a single query instead of one per shot
      const shotIds = shots.map(shot => shot.id);
      const { data: allShotGenerations, error: sgError } = await supabase().from('shot_generations')
        .select(`
          id,
          shot_id,
          timeline_frame,
          generation_id,
          generation:generations!shot_generations_generation_id_generations_id_fk (
            id,
            location,
            thumbnail_url,
            type,
            created_at,
            starred,
            name,
            based_on,
            params,
            primary_variant_id,
            primary_variant:generation_variants!generations_primary_variant_id_fkey (
              location,
              thumbnail_url
            )
          )
        `)
        .in('shot_id', shotIds)
        .order('timeline_frame', { ascending: true, nullsFirst: false });

      if (sgError) {
        throw sgError;
      }

      // Group by shot_id
      const imagesByShot: Record<string, GenerationRow[]> = {};
      for (const sg of allShotGenerations ?? []) {
        const mapped = mapShotGenerationToRow(sg);
        if (!mapped) continue;
        const shotId = sg.shot_id;
        if (!imagesByShot[shotId]) imagesByShot[shotId] = [];
        imagesByShot[shotId].push(mapped);
      }

      // Apply maxImagesPerShot client-side if needed
      if (maxImagesPerShot > 0) {
        for (const shotId of Object.keys(imagesByShot)) {
          imagesByShot[shotId] = imagesByShot[shotId].slice(0, maxImagesPerShot);
        }
      }

      // Attach images to shots with pre-computed stats
      return shots.map(shot => {
        const images = imagesByShot[shot.id] || [];

        // Count UNIQUE generation_ids
        const uniqueGenIds = new Set<string>();
        const unpositionedGenIds = new Set<string>();

        images.forEach(img => {
          const genId = getGenerationId(img);
          if (!genId) return;
          uniqueGenIds.add(genId);
          if (img.timeline_frame == null) unpositionedGenIds.add(genId);
        });

        const unpositionedCount = unpositionedGenIds.size;

        return {
          ...shot,
          images,
          imageCount: uniqueGenIds.size,
          positionedImageCount: uniqueGenIds.size - unpositionedCount,
          unpositionedImageCount: unpositionedCount,
          hasUnpositionedImages: unpositionedCount > 0,
        };
      });
    },
    enabled: !!projectId && canReadCloudShots(),
    staleTime: 1000 * 60 * 5, // 5 minutes
    placeholderData: (previousData) => previousData,
  });
};

// ============================================================================
// PROJECT IMAGE STATS
// ============================================================================

/**
 * Fetch project-wide image stats (total images, images without shots).
 */
export const useProjectImageStats = (projectId?: string | null) => {
  return useQuery({
    queryKey: projectId ? queryKeys.projectStats.images(projectId) : ['project-image-stats', null],
    queryFn: async () => {
      assertDeferredCloudShotOperation('read project shot image stats');
      if (!projectId) return { allCount: 0, noShotCount: 0 };

      // Get total unique generations in project
      const { count: allCount, error: allErr } = await supabase().from('generations')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .not('location', 'is', null);

      if (allErr) throw allErr;

      // Get count of generations without ANY shot
      const { count: noShotCount, error: noShotErr } = await supabase().from('generations')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .not('location', 'is', null)
        .or('shot_data.is.null,shot_data.eq.{}');

      if (noShotErr) throw noShotErr;

      return {
        allCount: allCount || 0,
        noShotCount: noShotCount || 0,
      };
    },
    enabled: !!projectId && canReadCloudShots(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};
