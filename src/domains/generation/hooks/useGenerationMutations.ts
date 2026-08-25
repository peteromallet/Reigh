/**
 * Generation Mutations
 * ====================
 *
 * Mutation hooks for creating, updating, deleting, and starring generations.
 * Extracted from useProjectGenerations.ts to separate query and mutation concerns.
 *
 * ## Exports
 * - `useDeleteGeneration` — Delete a generation
 * - `useDeleteVariant` — Delete a variant from generation_variants
 * - `useUpdateGenerationLocation` — Update a generation's location/thumbnail
 * - `useCreateGeneration` — Create a new generation (external upload)
 * - `useToggleGenerationStar` — Star/unstar with optimistic updates
 *
 * @module useGenerationMutations
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isDeferredCloudDataAuthority } from '@/app/runtime/dataAuthority.ts';
import type { Json } from '@/integrations/supabase/jsonTypes';
import {
  createExternalUploadGeneration,
  deleteGenerationInProject,
  deleteVariantInProject,
  updateGenerationLocationInProject,
  updateGenerationStarInProject,
  type ExternalUploadGenerationParams,
} from '@/integrations/supabase/repositories/generationMutationsRepository';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { dispatchAppEvent } from '@/shared/lib/typedEvents';
import {
  applyOptimisticGenerationStarUpdate,
  rollbackOptimisticGenerationStarUpdate,
} from '@/shared/hooks/invalidation/generationStarCacheCoordinator';
import type { GenerationRow } from '@/domains/generation/types';
import { coerceGenerationRowDto, mapGenerationRowDtoToRow } from '@/domains/generation/mappers/generationRowMapper';
import { resourceQueryKeys } from '@/shared/lib/queryKeys/resources';
import { settingsQueryKeys } from '@/shared/lib/queryKeys/settings';
import { SETTINGS_IDS } from '@/shared/lib/settingsIds';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability';

// ===== Helper Functions (internal) =====

interface ScopedGenerationInput {
  id: string;
  projectId: string;
}

interface ScopedVariantInput {
  id: string;
  projectId: string;
}

interface CreateGenerationInput {
  imageUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  projectId: string;
  prompt: string;
  thumbnailUrl?: string;
  resolution?: string;
  aspectRatio?: string;
}

function assertDeferredCloudGenerationMutation(operation: string): void {
  if (isDeferredCloudDataAuthority()) {
    return;
  }

  throw bridgeCapabilityUnavailable(
    operation,
    'Use an Astrid pack command after generation mutation routes are installed.',
  );
}

function buildExternalUploadGenerationParams(input: CreateGenerationInput): ExternalUploadGenerationParams {
  return {
    prompt: input.prompt,
    extra: {
      source: 'external_upload',
      original_filename: input.fileName,
      file_type: input.fileType,
      file_size: input.fileSize,
    },
    ...(input.resolution ? { resolution: input.resolution } : {}),
    ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
  };
}

/**
 * Update generation location via the scoped repository adapter.
 * @internal Used by useUpdateGenerationLocation hook.
 */
async function updateGenerationLocation(
  params: ScopedGenerationInput & { location: string; thumbnailUrl?: string },
): Promise<void> {
  await updateGenerationLocationInProject({
    id: params.id,
    projectId: params.projectId,
    location: params.location,
    thumbnailUrl: params.thumbnailUrl,
  });
}

/**
 * Create a new generation via the repository boundary.
 * @internal Used by useCreateGeneration hook.
 */
async function createGeneration(params: CreateGenerationInput): Promise<GenerationRow> {
  const generationParams = buildExternalUploadGenerationParams(params);

  const data = await createExternalUploadGeneration({
    imageUrl: params.imageUrl,
    thumbnailUrl: params.thumbnailUrl || params.imageUrl,
    fileType: params.fileType || 'image',
    projectId: params.projectId,
    generationParams,
  });

  const row = coerceGenerationRowDto(data as Json | Record<string, unknown>);
  if (!row) {
    throw new Error('Created generation row has unexpected shape');
  }
  return mapGenerationRowDtoToRow(row);
}

/**
 * Star/unstar a generation via the scoped repository adapter.
 * @internal Used by useToggleGenerationStar hook.
 */
async function toggleGenerationStar(params: ScopedGenerationInput & { starred: boolean }): Promise<void> {
  await updateGenerationStarInProject(params);
}

// ===== Mutation Hooks =====

/**
 * Delete a generation with project-scoped verification.
 */
async function deleteGenerationScoped(input: ScopedGenerationInput): Promise<void> {
  assertDeferredCloudGenerationMutation('delete a generation');
  await deleteGenerationInProject(input);
}

/**
 * Delete a variant with project-scoped verification via its parent generation.
 */
async function deleteVariantScoped(input: ScopedVariantInput): Promise<void> {
  assertDeferredCloudGenerationMutation('delete a generation variant');
  await deleteVariantInProject(input);
}

export function useDeleteGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteGenerationScoped,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: resourceQueryKeys.all });
      queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.tool(
          SETTINGS_IDS.PROJECT_IMAGE_SETTINGS,
          variables.projectId,
          undefined,
        ),
      });
    },
    onError: (error: Error) => {
      normalizeAndPresentError(error, {
        context: 'useDeleteGeneration',
        toastTitle: 'Failed to delete generation',
      });
    },
  });
}

/**
 * Delete a variant from generation_variants table.
 * Use this for edit tools (edit-images, edit-video, character-animate) that create variants.
 */
export function useDeleteVariant() {
  return useMutation({
    mutationFn: deleteVariantScoped,
    onError: (error: Error) => {
      normalizeAndPresentError(error, {
        context: 'useDeleteVariant',
        toastTitle: 'Failed to delete variant',
      });
    },
  });
}

export function useUpdateGenerationLocation() {
  return useMutation({
    mutationFn: ({ id, location, thumbnailUrl, projectId }: {
      id: string;
      location: string;
      thumbnailUrl?: string;
      projectId: string;
    }) => {
      return updateGenerationLocation({ id, location, thumbnailUrl, projectId });
    },
    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'useUpdateGenerationLocation', toastTitle: 'Failed to update generation' });
    },
  });
}

export function useCreateGeneration() {
  return useMutation({
    mutationFn: createGeneration,
    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'useCreateGeneration', toastTitle: 'Failed to create generation' });
    },
  });
}

export function useToggleGenerationStar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, starred, projectId }: { id: string; starred: boolean; projectId: string; shotId?: string }) => {
      assertDeferredCloudGenerationMutation('toggle a generation star');
      return toggleGenerationStar({ id, starred, projectId });
    },
    onMutate: async ({ id, starred, shotId }) => {
      assertDeferredCloudGenerationMutation('toggle a generation star');
      return applyOptimisticGenerationStarUpdate(queryClient, {
        generationId: id,
        starred,
        shotId,
      });
    },
    onError: (error: Error, _variables, context) => {
      rollbackOptimisticGenerationStarUpdate(queryClient, context);
      normalizeAndPresentError(error, { context: 'useToggleGenerationStar', toastTitle: 'Failed to toggle star' });
    },
    onSuccess: (_data, variables) => {
      // Emit custom event so Timeline knows to refetch star data
      if (variables.shotId) {
        dispatchAppEvent('generation-star-updated', {
          generationId: variables.id, shotId: variables.shotId!, starred: variables.starred,
        });
      }
    },
  });
}
