/**
 * Shot update hooks.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { Shot } from '@/domains/generation/types';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { shotQueryKeys } from '@/shared/lib/queryKeys/shots';
import {
  cancelShotsQueries,
  findShotsCache,
  invalidateShotsQueries,
  rollbackShotsCaches,
  updateAllShotsCaches,
} from './cacheUtils';
import { assertDeferredCloudShotOperation } from './shotAuthority';

type UpdateShotNameVariables = {
  shotId: string;
  name?: string;
  newName?: string;
  projectId: string;
};

type UpdateShotNameResult = {
  shotId: string;
  name: string;
  projectId: string;
};

type UpdateShotNameContext = {
  previousShots: Shot[] | undefined;
  previousDetail: Shot | undefined;
  projectId: string;
  shotId: string;
};

function resolveShotName({ name, newName }: Pick<UpdateShotNameVariables, 'name' | 'newName'>): string {
  const shotName = newName || name;
  if (!shotName) {
    throw new Error('Shot name is required');
  }
  return shotName;
}

async function mutateShotName({
  shotId,
  name,
  newName,
  projectId,
}: UpdateShotNameVariables): Promise<UpdateShotNameResult> {
  assertDeferredCloudShotOperation('rename a shot');
  const shotName = resolveShotName({ name, newName });
  const { error } = await supabase().from('shots')
    .update({ name: shotName })
    .eq('id', shotId);

  if (error) {
    throw error;
  }

  return { shotId, name: shotName, projectId };
}

function updateShotDetailName(
  queryClient: ReturnType<typeof useQueryClient>,
  shotId: string,
  name: string,
): Shot | undefined {
  const previousDetail = queryClient.getQueryData<Shot>(shotQueryKeys.detail(shotId));
  if (!previousDetail) {
    return previousDetail;
  }

  queryClient.setQueryData(shotQueryKeys.detail(shotId), {
    ...previousDetail,
    name,
  });
  return previousDetail;
}

async function handleUpdateShotNameMutate(
  queryClient: ReturnType<typeof useQueryClient>,
  { shotId, name, newName, projectId }: UpdateShotNameVariables,
): Promise<UpdateShotNameContext> {
  assertDeferredCloudShotOperation('rename a shot');
  const shotName = resolveShotName({ name, newName });

  await cancelShotsQueries(queryClient, projectId);

  const previousShots = findShotsCache(queryClient, projectId);
  const previousDetail = updateShotDetailName(queryClient, shotId, shotName);

  updateAllShotsCaches(queryClient, projectId, (old = []) =>
    old.map((shot) => (shot.id === shotId ? { ...shot, name: shotName } : shot)),
    true,
  );

  return { previousShots, previousDetail, projectId, shotId };
}

function handleUpdateShotNameSuccess(
  queryClient: ReturnType<typeof useQueryClient>,
  { projectId, shotId, name }: UpdateShotNameResult,
): void {
  queryClient.setQueryData<Shot>(shotQueryKeys.detail(shotId), (old) =>
    old ? { ...old, name } : old
  );
  invalidateShotsQueries(queryClient, projectId);
}

function handleUpdateShotNameError(
  queryClient: ReturnType<typeof useQueryClient>,
  error: Error,
  context: UpdateShotNameContext | undefined,
): void {
  if (context?.previousShots && context.projectId) {
    rollbackShotsCaches(queryClient, context.projectId, context.previousShots);
  }
  if (context?.previousDetail && context.shotId) {
    queryClient.setQueryData(shotQueryKeys.detail(context.shotId), context.previousDetail);
  }

  normalizeAndPresentError(error, { context: 'useUpdateShotName', toastTitle: 'Failed to update shot name' });
}

/**
 * Update shot name.
 * Supports both 'name' and 'newName' parameters for backwards compatibility.
 */
export const useUpdateShotName = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: mutateShotName,
    onMutate: (variables) => handleUpdateShotNameMutate(queryClient, variables),
    onSuccess: (result) => handleUpdateShotNameSuccess(queryClient, result),
    onError: (error: Error, _variables, context) =>
      handleUpdateShotNameError(queryClient, error, context),
  });
};
