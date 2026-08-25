/**
 * Shot CRUD operations: create, duplicate, delete, reorder.
 * These operate on the shots table directly.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { Shot } from '@/domains/generation/types';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { enqueueGenerationsInvalidation } from '@/shared/hooks/invalidation/useGenerationInvalidation';
import { isNotFoundError } from '@/shared/constants/supabaseErrors';
import { shotQueryKeys } from '@/shared/lib/queryKeys/shots';
import {
  cancelShotsQueries,
  findShotsCache,
  invalidateShotsQueries,
  updateAllShotsCaches,
  rollbackShotsCaches,
} from './cacheUtils';
import { assertDeferredCloudShotOperation } from './shotAuthority';

// ============================================================================
// DELETE SHOT
// ============================================================================

export const useDeleteShot = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ shotId, projectId }: { shotId: string; projectId: string }) => {
      assertDeferredCloudShotOperation('delete a shot');
      const { error } = await supabase().from('shots')
        .delete()
        .eq('id', shotId);

      if (error) throw error;

      return { shotId, projectId };
    },

    onMutate: async (variables) => {
      assertDeferredCloudShotOperation('delete a shot');
      const { shotId, projectId } = variables;

      // Cancel in-flight queries
      await cancelShotsQueries(queryClient, projectId);

      // Find existing cache data
      const previousShots = findShotsCache(queryClient, projectId);

      // Optimistically remove the shot
      if (previousShots) {
        updateAllShotsCaches(queryClient, projectId, (old) =>
          (old || []).filter(s => s.id !== shotId)
        );
      }

      return { previousShots, projectId, shotId };
    },

    onSuccess: ({ shotId, projectId }) => {
      // Invalidate related queries
      enqueueGenerationsInvalidation(queryClient, shotId, {
        reason: 'delete-shot',
        scope: 'all',
        includeProjectUnified: true,
        projectId,
      });
    },

    onError: (error: Error, _variables, context) => {
      // Rollback optimistic update
      if (context?.previousShots && context.projectId) {
        rollbackShotsCaches(queryClient, context.projectId, context.previousShots);
      }

      normalizeAndPresentError(error, { context: 'useDeleteShot', toastTitle: 'Failed to delete shot' });
    },
  });
};

// ============================================================================
// CREATE SHOT
// ============================================================================

export const useCreateShot = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      projectId,
      aspectRatio,
      shouldSelectAfterCreation = true,
      position,
    }: {
      name: string;
      projectId: string;
      aspectRatio?: string | null;
      shouldSelectAfterCreation?: boolean;
      position?: number;
    }) => {
      assertDeferredCloudShotOperation('create a shot');
      let resolvedPosition = position;

      if (resolvedPosition === undefined) {
        const { data: lastShot, error: lastShotError } = await supabase().from('shots')
          .select('position')
          .eq('project_id', projectId)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle<{ position: number | null }>();

        if (lastShotError && !isNotFoundError(lastShotError)) {
          throw lastShotError;
        }

        const lastPosition = lastShot?.position ?? 0;
        resolvedPosition = lastPosition + 1;
      }

      const { data, error } = await supabase().rpc('insert_shot_at_position', {
          p_project_id: projectId,
          p_shot_name: name,
          p_position: resolvedPosition,
        })
        .single();

      if (error) throw error;

      const result = data as { shot_id: string; success: boolean } | null;
      if (!result?.success || !result.shot_id) {
        throw new Error('Failed to create shot at position');
      }

      // Update shot with aspect ratio if provided
      if (aspectRatio) {
        const { error: updateError } = await supabase().from('shots')
          .update({ aspect_ratio: aspectRatio })
          .eq('id', result.shot_id);

        if (updateError) {
          normalizeAndPresentError(updateError, { context: 'useCreateShot', showToast: false });
        }
      }

      const { data: shotData, error: fetchError } = await supabase().from('shots')
        .select()
        .eq('id', result.shot_id)
        .single();

      if (fetchError) throw fetchError;

      return { shot: { ...shotData, images: [] }, shouldSelectAfterCreation };
    },

    onSuccess: (result, variables) => {
      if (variables.projectId && result.shot) {
        const newShot = result.shot;

        updateAllShotsCaches(queryClient, variables.projectId, (oldShots = []) => {
          // Check if shot already exists
          if (oldShots.some(shot => shot.id === newShot.id)) {
            return oldShots;
          }

          // Insert at correct position
          const newShotPosition = newShot.position || 0;
          const insertionIndex = oldShots.findIndex(
            shot => (shot.position || 0) > newShotPosition
          );

          if (insertionIndex === -1) {
            return [...oldShots, newShot];
          } else {
            const updatedShots = [...oldShots];
            updatedShots.splice(insertionIndex, 0, newShot);
            return updatedShots;
          }
        });

        // Cache the shot individually
        queryClient.setQueryData(shotQueryKeys.detail(newShot.id), newShot);

      }
    },

    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'useCreateShot', toastTitle: 'Failed to create shot' });
    },
  });
};

// ============================================================================
// DUPLICATE SHOT
// ============================================================================

export const useDuplicateShot = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ shotId, projectId }: { shotId: string; projectId: string }) => {
      assertDeferredCloudShotOperation('duplicate a shot');
      const { data, error } = await supabase().rpc('duplicate_shot', {
        original_shot_id: shotId,
        project_id: projectId,
      });

      if (error) throw error;

      const newShotId = data;

      const { data: shotData, error: fetchError } = await supabase().from('shots')
        .select()
        .eq('id', newShotId)
        .single();

      if (fetchError) throw fetchError;

      return shotData;
    },

    onMutate: async (variables) => {
      assertDeferredCloudShotOperation('duplicate a shot');
      const { shotId, projectId } = variables;

      await cancelShotsQueries(queryClient, projectId);

      const previousShots = findShotsCache(queryClient, projectId);
      const originalShot = previousShots?.find(s => s.id === shotId);

      let tempId: string | undefined;

      if (originalShot && previousShots) {
        tempId = `temp-duplicate-${Date.now()}`;
        const duplicateShot: Shot = {
          ...originalShot,
          id: tempId,
          name: `${originalShot.name || 'Shot'} (copy)`,
          position: (originalShot.position || 0) + 1,
          created_at: new Date().toISOString(),
        };

        updateAllShotsCaches(queryClient, projectId, (old = []) => {
          const updated = [...old];
          const idx = updated.findIndex(s => s.id === shotId);
          if (idx !== -1) {
            updated.splice(idx + 1, 0, duplicateShot);
          }
          return updated;
        });
      }

      return { previousShots, projectId, tempId };
    },

    onSuccess: (data, variables, context) => {
      const { projectId } = variables;
      const tempId = context?.tempId;

      if (tempId && data) {
        // Replace temp shot with real one
        updateAllShotsCaches(queryClient, projectId, (old = []) =>
          old.map(shot =>
            shot.id === tempId ? { ...data, images: shot.images || [] } : shot
          )
        );
      }
      invalidateShotsQueries(queryClient, projectId);
    },

    onError: (error: Error, _variables, context) => {
      if (context?.previousShots && context.projectId) {
        rollbackShotsCaches(queryClient, context.projectId, context.previousShots);
      }
      normalizeAndPresentError(error, { context: 'useDuplicateShot', toastTitle: 'Failed to duplicate shot' });
    },
  });
};

// ============================================================================
// REORDER SHOTS
// ============================================================================

export const useReorderShots = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      shotOrders,
    }: {
      projectId: string;
      shotOrders: Array<{ shotId: string; position: number }>;
    }) => {
      assertDeferredCloudShotOperation('reorder shots');
      const promises = shotOrders.map(({ shotId, position }) =>
        supabase().from('shots')
          .update({ position })
          .eq('id', shotId)
          .eq('project_id', projectId)
      );

      const results = await Promise.all(promises);

      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        const errorMessages = errors.map(e => e.error?.message).join(', ');
        throw new Error(`Failed to update some shot positions: ${errorMessages}`);
      }

      return { projectId, shotOrders };
    },

    onMutate: async (variables) => {
      assertDeferredCloudShotOperation('reorder shots');
      const { projectId, shotOrders } = variables;

      await cancelShotsQueries(queryClient, projectId);

      const previousShots = findShotsCache(queryClient, projectId);

      if (previousShots) {
        updateAllShotsCaches(queryClient, projectId, (old = []) => {
          const updated = old.map(shot => {
            const order = shotOrders.find(o => o.shotId === shot.id);
            if (order) {
              return { ...shot, position: order.position };
            }
            return shot;
          });
          // Sort by new positions
          updated.sort((a, b) => (a.position || 0) - (b.position || 0));
          return updated;
        });
      }

      return { previousShots, projectId };
    },

    onError: (error: Error, _variables, context) => {
      if (context?.previousShots && context.projectId) {
        rollbackShotsCaches(queryClient, context.projectId, context.previousShots);
      }
      normalizeAndPresentError(error, { context: 'useReorderShots', toastTitle: 'Failed to reorder shots' });
    },

    onSuccess: ({ projectId }) => {
      invalidateShotsQueries(queryClient, projectId);
    },
  });
};
