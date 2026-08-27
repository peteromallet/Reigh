import { useQuery } from '@tanstack/react-query';

import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';

export function useLastVideoGeneration(selectedShotId?: string): string | null {
  const { data } = useQuery({
    queryKey: generationQueryKeys.lastVideo(selectedShotId ?? ''),
    queryFn: async () => {
      if (!selectedShotId) {
        return null;
      }

      const { data: shotGenerationRows, error } = await supabase().from('shot_generations')
        .select(`
          generation:generations!shot_generations_generation_id_generations_id_fk (
            id,
            location,
            type,
            created_at
          )
        `)
        .eq('shot_id', selectedShotId);

      if (error || !shotGenerationRows) {
        return null;
      }

      const asRecord = (value: unknown): Record<string, unknown> | null =>
        value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

      const videos = shotGenerationRows
        .filter((row) => {
          const generation = asRecord(row.generation);
          return typeof generation?.type === 'string' && generation.type.includes('video');
        })
        .sort((a, b) => {
          const generationA = asRecord(a.generation);
          const generationB = asRecord(b.generation);
          const dateA = new Date((generationA?.created_at as string) || 0).getTime();
          const dateB = new Date((generationB?.created_at as string) || 0).getTime();
          return dateB - dateA;
        });

      const firstGeneration = asRecord(videos[0]?.generation);
      return (firstGeneration?.location as string | null) ?? null;
    },
    // Local document shots have no relational shot_generations row. Their
    // media is supplied by the Astrid timeline adapter, so do not invoke the
    // retired Supabase lookup while rendering the established shot editor.
    enabled: !!selectedShotId && !hasLocalModeUrlParams(
      typeof window === 'undefined' ? '' : window.location.search,
    ),
    staleTime: 30_000,
  });

  return data ?? null;
}
