import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readBridgeTaskOutputs } from '@/integrations/astrid/bridgeTaskOutputs';
import { Task } from '@/types/tasks';
import { GenerationRow } from '@/domains/generation/types';
import { extractSourceGenerationId } from '../utils/task-utils';
import { generationQueryKeys } from '@/shared/lib/queryKeys/generations';
import { expandShotData } from '@/shared/lib/shots/shotData';

interface UseImageGenerationOptions {
  task: Task;
  taskParams: { parsed: Record<string, unknown>; promptText: string };
  isImageTask: boolean;
}

/**
 * Hook to fetch generation data for image tasks
 * Checks both generations table and generation_variants table (for edit tasks)
 */
export function useImageGeneration({
  task,
  taskParams,
  isImageTask,
}: UseImageGenerationOptions) {
  // Check if this is a successful image task with output
  const hasGeneratedImage = useMemo(() => {
    return isImageTask && task.status === 'Complete' && !!task.outputLocation;
  }, [isImageTask, task.status, task.outputLocation]);

  // Fetch generation data - checks both generations and generation_variants tables
  const { data: generationResult, isLoading: isLoadingGeneration, error: generationError } = useQuery({
    queryKey: [...generationQueryKeys.forTask(task.id), task.outputLocation],
    queryFn: async () => {
      const outputs = await readBridgeTaskOutputs(task);
      const generation = outputs.find((output) => output.type.includes('image')) ?? outputs[0] ?? null;
      return generation
        ? {
            generation,
            variantId: generation._variant_id,
            variantIsPrimary: generation._variant_is_primary,
          }
        : null;
    },
    enabled: hasGeneratedImage && !!task.outputLocation,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  const actualGeneration = generationResult?.generation || null;

  // Create GenerationRow data for MediaLightbox
  const generationData: GenerationRow | null = useMemo(() => {
    // Fallback: If no generation record exists, create a minimal GenerationRow from outputLocation
    if (isImageTask && hasGeneratedImage && task.outputLocation && !actualGeneration) {
      const sourceGenerationId = extractSourceGenerationId(taskParams.parsed);
      
      return {
        id: task.id,
        location: task.outputLocation,
        imageUrl: task.outputLocation,
        thumbUrl: task.outputLocation,
        type: 'image',
        createdAt: task.createdAt || new Date().toISOString(),
        metadata: task.params || {},
        taskId: task.id,
        generation_id: sourceGenerationId || undefined,
        parent_generation_id: sourceGenerationId || undefined,
        based_on: sourceGenerationId || undefined,
      } as GenerationRow;
    }
    
    if (!hasGeneratedImage || !actualGeneration) return null;
    
    const gen = actualGeneration as Record<string, unknown>;
    const metadata = ((gen.metadata as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
    const basedOnValue =
      (typeof gen.based_on === 'string' ? gen.based_on : null) ||
      (typeof metadata.based_on === 'string' ? metadata.based_on : null) ||
      null;

    // Transform shot associations
    const shotGenerations = expandShotData(
      gen.shot_data as Record<string, unknown> | null | undefined,
    );
    const shotIds = shotGenerations.map((sg) => sg.shot_id);
    const timelineFrames = shotGenerations.reduce<Record<string, number | null>>((acc, sg) => {
      acc[sg.shot_id] = sg.timeline_frame;
      return acc;
    }, {});

    const allShotAssociations = shotGenerations.map((sg) => ({
      shot_id: sg.shot_id,
      position: sg.timeline_frame,
    }));

    const location = typeof actualGeneration.location === 'string' ? actualGeneration.location : null;
    const thumbnailUrl = typeof gen.thumbnail_url === 'string' ? gen.thumbnail_url : undefined;
    const imageUrl = location ?? thumbnailUrl;
    const thumbUrl = thumbnailUrl ?? location ?? undefined;
    const createdAt = (gen.created_at as string | undefined) || new Date().toISOString();

    return {
      id: actualGeneration.id,
      location,
      imageUrl,
      thumbUrl,
      type: (actualGeneration.type ?? 'image') as string,
      createdAt,
      metadata,
      based_on: basedOnValue,
      sourceGenerationId: basedOnValue,
      parent_generation_id: (gen.parent_generation_id as string | undefined) || undefined,
      shotIds,
      timelineFrames,
      all_shot_associations: allShotAssociations,
      name: (gen.name as string | undefined) || undefined,
      // Include variant info if this was found via variant lookup
      _variant_id: generationResult?.variantId || undefined,
      _variant_is_primary: generationResult?.variantIsPrimary || undefined,
    } as GenerationRow;
  }, [hasGeneratedImage, actualGeneration, task, taskParams.parsed, isImageTask, generationResult?.variantId, generationResult?.variantIsPrimary]);

  return {
    generationData,
    actualGeneration,
    isLoadingGeneration,
    generationError,
    hasGeneratedImage,
    // Expose variant ID for passing to lightbox
    variantId: generationResult?.variantId || null,
  };
}
