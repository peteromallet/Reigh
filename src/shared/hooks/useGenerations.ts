import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { GeneratedImageWithMetadata } from '@/shared/components/ImageGallery';

// 1. Fetch Generations using API endpoint
const fetchGenerations = async (projectId: string): Promise<GeneratedImageWithMetadata[]> => {
  // Request a larger limit than the API default (24) so the gallery can display more images.
  // TODO: In the future we might replace this with proper pagination / infinite scroll.
  const response = await fetch(`/api/generations?projectId=${projectId}&limit=1000`);
  if (!response.ok) {
    throw new Error(`Failed to fetch generations: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Convert API response to GeneratedImageWithMetadata format
  return data.items.map((item: any) => ({
    id: item.id,
    url: item.location || '', // API uses 'location' field
    prompt: item.params?.prompt || '',
    seed: item.params?.seed,
    metadata: item.params || {},
    createdAt: item.createdAt,
    isVideo: item.type?.includes('video'),
  }));
};

export const useListAllGenerations = (projectId: string | null) => {
  return useQuery<GeneratedImageWithMetadata[], Error>({
    queryKey: ['generations', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      return await fetchGenerations(projectId);
    },
    enabled: !!projectId,
  });
};

// 2. Delete Generation
const deleteGeneration = async (generationId: string) => {
  const response = await fetch(`/api/generations/${generationId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Failed to delete and could not parse error' }));
    throw new Error(errorData.message || `Failed to delete generation: ${response.statusText}`);
  }
  // The API might return a confirmation message, which we can use or ignore.
  // For this hook, we don't need to return anything on success.
};

export const useDeleteGeneration = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteGeneration,
    onSuccess: (_, generationId) => {
      toast.success("Generation deleted successfully.");
      queryClient.invalidateQueries({ queryKey: ['generations'] });
    },
    onError: (error: Error) => {
      toast.error("Failed to delete generation.", {
        description: error.message,
      });
    },
  });
};

// 3. Create Generation (as part of a task)
interface CreateGenerationParams {
    projectId: string;
    imageUrl: string;
    prompt: string;
    metadata?: any;
}

const createGeneration = async ({ projectId, imageUrl, prompt, metadata }: CreateGenerationParams) => {
    const response = await fetch('/api/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            projectId,
            imageUrl,
            fileName: 'generated_image',
            fileType: 'image/png',
            prompt,
        }),
    });
    
    if (!response.ok) {
        throw new Error(`Failed to create generation: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
}

export const useCreateGeneration = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: createGeneration,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['generations'] });
            toast.success("New generation record created.");
        },
        onError: (error: Error) => {
            toast.error("Failed to create generation record.", {
                description: error.message,
            });
        }
    });
}; 