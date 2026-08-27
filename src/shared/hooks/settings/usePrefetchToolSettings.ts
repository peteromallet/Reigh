import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { settingsQueryKeys } from '@/shared/lib/queryKeys/settings';
import { SETTINGS_IDS } from '@/shared/lib/settingsIds';
import {
  fetchToolSettingsSupabase,
  type SettingsFetchResult,
} from '@/shared/settings';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';
import { isDeferredCloudDataAuthority } from '@/app/runtime/dataAuthority';

// Central list of tool IDs we want to preload. Update when you add more tools.
const PREFETCH_TOOL_IDS = [
  SETTINGS_IDS.IMAGE_GENERATION,
  SETTINGS_IDS.TRAVEL_BETWEEN_IMAGES,
  SETTINGS_IDS.PROJECT_IMAGE_SETTINGS, // Shared settings including reference images
];
const EMPTY_SHOT_IDS: string[] = [];

/**
 * Fetch tool settings using the shared service contract (for prefetching).
 */
function fetchSettingsForPrefetch(
  toolId: string,
  ctx: { projectId?: string; shotId?: string },
): Promise<SettingsFetchResult> {
  return fetchToolSettingsSupabase(toolId, ctx, undefined, getSupabaseClient());
}

/**
 * Prefetch tool settings for a project (and optionally its shots) so that
 * individual pages can hydrate synchronously from React-Query cache.
 * Now uses direct Supabase calls for better mobile reliability.
 *
 * @param projectId selected project id
 * @param shotIds  array of shot ids belonging to the project (optional)
 */
export function usePrefetchToolSettings(projectId?: string | null, shotIds: string[] = EMPTY_SHOT_IDS) {
  const queryClient = useQueryClient();
  const isLocalMode = hasLocalModeUrlParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  const isDeferredCloudMode = isDeferredCloudDataAuthority();
  const shotIdsKey = shotIds.join(',');
  const shotIdsForPrefetch = useMemo(
    () => (shotIdsKey ? shotIdsKey.split(',') : EMPTY_SHOT_IDS),
    [shotIdsKey],
  );

  useEffect(() => {
    if (!projectId || isLocalMode || !isDeferredCloudMode) {
      return;
    }

    // Prefetch project-level settings for each tool.
    PREFETCH_TOOL_IDS.forEach((toolId) => {
      queryClient.prefetchQuery({
        queryKey: settingsQueryKeys.tool(toolId, projectId, undefined),
        queryFn: () => fetchSettingsForPrefetch(toolId, { projectId }),
        staleTime: 5 * 60 * 1000, // keep fresh for 5 min (same as useToolSettings)
      }).then(() => {
      }).catch((error) => {
        normalizeAndPresentError(error, { context: 'usePrefetchToolSettings', showToast: false });
      });
    });

    // Prefetch shot-level settings when shot IDs are provided.
    if (shotIdsForPrefetch.length) {
      shotIdsForPrefetch.forEach((shotId) => {
        PREFETCH_TOOL_IDS.forEach((toolId) => {
          queryClient.prefetchQuery({
            queryKey: settingsQueryKeys.tool(toolId, projectId, shotId),
            queryFn: () => fetchSettingsForPrefetch(toolId, { projectId, shotId }),
            staleTime: 5 * 60 * 1000,
          });
        });
      });
    }
  }, [isDeferredCloudMode, isLocalMode, projectId, shotIdsForPrefetch, queryClient]);
}
