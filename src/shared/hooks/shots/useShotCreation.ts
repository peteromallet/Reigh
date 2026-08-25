/**
 * Composite shot creation operations.
 * These combine multiple operations (upload, create, add) into unified workflows.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { queryKeys } from '@/shared/lib/queryKeys';
import { useCreateShot } from './useShotsCrud';
import { useAddImageToShot } from './useShotGenerationMutations';
import { processDroppedImages, type ExternalImageDropVariables } from './externalImageDrop';
import type { CreateShotWithGenerationsRpcResult } from '@/shared/hooks/shotCreation/shotCreationTypes';
import { assertDeferredCloudShotOperation } from './shotAuthority';

export const useCreateShotWithGenerations = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      shotName,
      generationIds,
    }: {
      projectId: string;
      shotName: string;
      generationIds: string[];
    }) => {
      assertDeferredCloudShotOperation('create a shot with generations');
      const { data, error } = await supabase().rpc('create_shot_with_generations', {
          p_project_id: projectId,
          p_shot_name: shotName,
          p_generation_ids: generationIds,
        })
        .single();

      if (error) {
        throw error;
      }

      const typedData = data as CreateShotWithGenerationsRpcResult | null;
      if (!typedData?.success) {
        throw new Error('Failed to create shot with generations');
      }

      return typedData;
    },

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.shots.all, variables.projectId],
        refetchType: 'inactive',
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.unified.projectPrefix(variables.projectId),
        refetchType: 'inactive',
      });
    },

    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'useShotCreation', toastTitle: 'Failed to create shot with generations' });
    },
  });
};

export const useHandleExternalImageDrop = () => {
  const createShotMutation = useCreateShot();
  const addImageToShotMutation = useAddImageToShot();

  return useMutation({
    mutationFn: async (variables: ExternalImageDropVariables) => {
      const { currentProjectQueryKey } = variables;
      if (!currentProjectQueryKey) {
        toast.error('Cannot add image(s): current project is not identified.');
        return null;
      }

      try {
        assertDeferredCloudShotOperation('process dropped images for a shot');
        return await processDroppedImages({
          variables,
          projectId: currentProjectQueryKey,
          createShot: createShotMutation.mutateAsync,
          addImageToShot: addImageToShotMutation.mutateAsync,
          addImageToShotWithoutPosition: addImageToShotMutation.mutateAsyncWithoutPosition,
        });
      } catch (error) {
        normalizeAndPresentError(error, { context: 'useShotCreation', toastTitle: 'Failed to process dropped image(s)' });
        return null;
      }
    },
  });
};
