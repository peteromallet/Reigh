/**
 * useShotVideoSettings - Query hook for shot-level video settings
 *
 * Fetches settings from shots.settings['travel-between-images'].
 * These serve as defaults for all segments in the shot.
 */

import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { shotQueryKeys } from '@/shared/lib/queryKeys/shots';
import { readShotSettings, type ShotVideoSettings } from '@/shared/lib/settingsMigration';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { TOOL_IDS } from '@/shared/lib/tooling/toolIds';
import { assertDeferredCloudShotOperation } from '@/shared/hooks/shots/shotAuthority';

interface UseShotVideoSettingsReturn {
  data: ShotVideoSettings | null | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

export function useShotVideoSettings(
  shotId: string | null | undefined
): UseShotVideoSettingsReturn {
  const query = useQuery({
    queryKey: shotQueryKeys.batchSettings(shotId || ''),
    queryFn: async (): Promise<ShotVideoSettings | null> => {
      assertDeferredCloudShotOperation('read shot video settings');
      if (!shotId) return null;

      const { data, error } = await supabase().from('shots')
        .select('settings')
        .eq('id', shotId)
        .single();

      if (error) {
        normalizeAndPresentError(error, {
          context: 'useShotVideoSettings.fetch',
          showToast: false,
          logData: { shotId },
        });
        throw error;
      }

      const allSettings = data?.settings as Record<string, unknown>;
      const rawSettings = (allSettings?.[TOOL_IDS.TRAVEL_BETWEEN_IMAGES] ?? {}) as Record<string, unknown>;

      return readShotSettings(rawSettings);
    },
    enabled: !!shotId,
    staleTime: 0, // Always refetch - settings can change from BatchSettingsForm
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
