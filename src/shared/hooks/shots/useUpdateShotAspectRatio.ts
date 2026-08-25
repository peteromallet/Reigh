import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Shot } from '@/domains/generation/types';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { queryKeys } from '@/shared/lib/queryKeys';
import { toJson } from '@/shared/lib/supabaseTypeHelpers';
import { TOOL_IDS } from '@/shared/lib/tooling/toolIds';
import { assertDeferredCloudShotOperation } from './shotAuthority';

const SHOT_ASPECT_RATIO_UPDATE_DEBOUNCE_MS = 300;

type UpdateShotAspectRatioOptions = {
  immediate?: boolean;
};

type PersistShotAspectRatioArgs = {
  shotId: string;
  projectId: string;
  newAspectRatio: string;
};

function updateShotAspectRatioCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  shotId: string,
  projectId: string,
  newAspectRatio: string,
) {
  [0, 2].forEach((maxImages) => {
    queryClient.setQueryData(
      queryKeys.shots.list(projectId, maxImages),
      (oldData: Shot[] | undefined) => {
        if (!oldData) {
          return oldData;
        }

        return oldData.map((shot) =>
          shot.id === shotId ? { ...shot, aspect_ratio: newAspectRatio } : shot
        );
      },
    );
  });
}

export function useUpdateShotAspectRatio() {
  const queryClient = useQueryClient();
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingUpdate = useCallback(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }
  }, []);

  const handleFailure = useCallback((error: unknown, projectId: string) => {
    try {
      normalizeAndPresentError(error, { context: 'ShotEditorHeader' });
    } catch {
      // Error normalization should not block callers from continuing.
    }

    try {
      void queryClient
        .invalidateQueries({ queryKey: queryKeys.shots.list(projectId) })
        .catch(() => undefined);
    } catch {
      // Query invalidation is best-effort in error paths.
    }
  }, [queryClient]);

  const persistShotAspectRatio = useCallback(async ({
    shotId,
    projectId,
    newAspectRatio,
  }: PersistShotAspectRatioArgs): Promise<boolean> => {
    assertDeferredCloudShotOperation('update a shot aspect ratio');
    try {
      const { data: currentShot, error: selectError } = await supabase()
        .from('shots')
        .select('settings')
        .eq('id', shotId)
        .single();

      if (selectError) {
        throw selectError;
      }

      const currentSettings = (currentShot?.settings as Record<string, unknown>) || {};
      const travelSettings = (currentSettings[TOOL_IDS.TRAVEL_BETWEEN_IMAGES] || {}) as Record<string, unknown>;

      const updatedTravelSettings = {
        ...travelSettings,
        dimensionSource: 'firstImage',
        customWidth: undefined,
        customHeight: undefined,
      };

      const { error: updateError } = await supabase()
        .from('shots')
        .update({
          aspect_ratio: newAspectRatio,
          settings: toJson({
            ...currentSettings,
            [TOOL_IDS.TRAVEL_BETWEEN_IMAGES]: updatedTravelSettings,
          }),
        })
        .eq('id', shotId);

      if (updateError) {
        throw updateError;
      }

      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.tool(TOOL_IDS.TRAVEL_BETWEEN_IMAGES, projectId, shotId),
      });

      return true;
    } catch (error) {
      handleFailure(error, projectId);
      return false;
    }
  }, [handleFailure, queryClient]);

  const updateShotAspectRatio = useCallback(async (
    shotId: string,
    projectId: string,
    newAspectRatio: string,
    options: UpdateShotAspectRatioOptions = {},
  ): Promise<boolean> => {
    clearPendingUpdate();
    assertDeferredCloudShotOperation('update a shot aspect ratio');

    if (options.immediate) {
      try {
        updateShotAspectRatioCaches(queryClient, shotId, projectId, newAspectRatio);
        return await persistShotAspectRatio({ shotId, projectId, newAspectRatio });
      } catch (error) {
        handleFailure(error, projectId);
        return false;
      }
    }

    updateShotAspectRatioCaches(queryClient, shotId, projectId, newAspectRatio);
    updateTimeoutRef.current = setTimeout(() => {
      updateTimeoutRef.current = null;
      void persistShotAspectRatio({ shotId, projectId, newAspectRatio });
    }, SHOT_ASPECT_RATIO_UPDATE_DEBOUNCE_MS);

    return true;
  }, [clearPendingUpdate, handleFailure, persistShotAspectRatio, queryClient]);

  useEffect(() => clearPendingUpdate, [clearPendingUpdate]);

  return { updateShotAspectRatio };
}
