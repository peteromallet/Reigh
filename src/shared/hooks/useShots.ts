import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client'; 
import { Shot, ShotImage, GenerationRow } from '@/types/shots'; 
import { Database } from '@/integrations/supabase/types';
import { uploadImageToStorage } from '@/shared/lib/imageUploader';
import { toast } from 'sonner';

// Define the type for the new shot data returned by Supabase
// This should align with your 'shots' table structure from `supabase/types.ts`
type ShotResponse = Database['public']['Tables']['shots']['Row'];

// Add this new type definition near the top, after other type definitions
export interface ShotGenerationRow {
  id: string;
  shotId: string;
  generationId: string;
  position?: number;
}

// CRUD functions will go here 

// Create a new shot VIA API
interface CreateShotArgs {
  shotName: string;
  projectId: string | null;
}
export const useCreateShot = () => {
  const queryClient = useQueryClient();
  return useMutation<
    Shot, // Expecting the API to return a Shot (or Shot like structure)
    Error, 
    CreateShotArgs,
    { previousShots?: Shot[], projectId?: string | null } 
  >({
    mutationFn: async ({ shotName, projectId }: CreateShotArgs): Promise<Shot> => {
      if (!projectId) {
        console.error('Error creating shot: Project ID is missing');
        throw new Error('Project ID is required to create a shot.');
      }
      
      const response = await fetch('/api/shots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: shotName, projectId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || `Failed to create shot: ${response.statusText}`);
      }
      
      const newShot: Shot = await response.json();
      return newShot; // API should return the created shot in the expected Shot format
    },
    onMutate: async ({ shotName, projectId }) => {
      if (!projectId) return { previousShots: [], projectId: null }; // Handle missing projectId
      await queryClient.cancelQueries({ queryKey: ['shots', projectId] });
      const previousShots = queryClient.getQueryData<Shot[]>(['shots', projectId]);
      
      const optimisticShot: Shot = {
        id: `optimistic-${Date.now()}`,
        name: shotName,
        created_at: new Date().toISOString(),
        images: [],
        project_id: projectId, 
      };
      
      queryClient.setQueryData<Shot[]>(['shots', projectId], (oldShots = []) => 
        [...oldShots, optimisticShot].sort((a,b) => a.name.localeCompare(b.name)) // Keep consistent sort order
      );
      return { previousShots, projectId };
    },
    onError: (err, { projectId }, context) => { 
      console.error('Optimistic update failed, rolling back for createShot:', err);
      if (context?.previousShots && projectId) { // Ensure projectId for rollback key
        queryClient.setQueryData<Shot[]>(['shots', projectId], context.previousShots);
      }
    },
    onSettled: (data, error, { projectId }) => { 
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['shots', projectId] });
      }
      if (!error && data) {
        toast.success(`Shot "${data.name}" created!`);
      }
    },
  });
};

// List all shots with their full image details for a specific project VIA API
export const useListShots = (projectId: string | null) => {
  return useQuery<Shot[], Error>({
    queryKey: ['shots', projectId], 
    queryFn: async () => {
      if (!projectId) return []; 

      // API Call to fetch shots
      const response = await fetch(`/api/shots?projectId=${projectId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error('[API Error UseListShots] Error fetching shots for project:', projectId, errorData.message); 
        throw new Error(errorData.message || `Failed to fetch shots: ${response.statusText}`);
      }
      
      const data: Shot[] = await response.json();
      // The API now returns data in the client's expected Shot[] structure, including transformed images
      // So, direct transformation here is no longer needed if API does it correctly.
      return data;
    },
    enabled: !!projectId, 
  });
};

// Type for the arguments of useAddImageToShot mutation
interface AddImageToShotArgs {
  shot_id: string;
  generation_id: string; 
  project_id: string | null; // For invalidating correct query
  position?: number; 
  imageUrl?: string; // For optimistic update
  thumbUrl?: string; // For optimistic update
}

// Type for the response from adding an image to a shot
type ShotImageResponse = Database['public']['Tables']['shot_images']['Row'];

// Helper function to create a generation record for an externally uploaded image VIA API
const createGenerationForUploadedImage = async (
  imageUrl: string,
  fileName: string,
  fileType: string,
  fileSize: number,
  projectId: string | null
): Promise<Database['public']['Tables']['generations']['Row']> => {
  if (!projectId) {
    throw new Error('Project ID is required to create a generation record.');
  }
  
  const promptForGeneration = `External image: ${fileName || 'untitled'}`;
  
  
  const response = await fetch('/api/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl,
      fileName,
      fileType,
      fileSize,
      projectId,
      prompt: promptForGeneration,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    console.error('[useShots] createGenerationForUploadedImage (API): Error creating generation:', errorData);
    throw new Error(errorData.message || `Failed to create generation record: ${response.statusText}`);
  }
  
  const newGeneration: Database['public']['Tables']['generations']['Row'] = await response.json();
  console.log('[useShots] createGenerationForUploadedImage (API): Successfully created generation:', newGeneration);
  return newGeneration;
};

// Add an image to a shot VIA API
export const useAddImageToShot = () => {
  const queryClient = useQueryClient();
  return useMutation<
    ShotGenerationRow, // Updated type
    Error,
    AddImageToShotArgs,
    { previousShots?: Shot[], projectId?: string | null }
  >({
    mutationFn: async ({ shot_id, generation_id, position, project_id }: AddImageToShotArgs):
      Promise<ShotGenerationRow> => { // Updated return type
      // This is the original, correct signature for useAddImageToShot's mutationFn
      const response = await fetch('/api/shots/shot_generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotId: shot_id, generationId: generation_id, position }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error('[useShots] useAddImageToShot (API): Error adding image to shot:', errorData);
        throw new Error(errorData.message || `Failed to add image to shot: ${response.statusText}`);
      }
      
      const newShotGenerationEntry = await response.json();
      console.log('[useShots] useAddImageToShot (API): Successfully added image to shot:', newShotGenerationEntry);
      return newShotGenerationEntry;
    },
    onMutate: async (args) => {
      if (!args.project_id) return { previousShots: [], projectId: null };
      await queryClient.cancelQueries({ queryKey: ['shots', args.project_id] });
      const previousShots = queryClient.getQueryData<Shot[]>(['shots', args.project_id]);
      
      queryClient.setQueryData<Shot[]>(['shots', args.project_id], (oldShots = []) => 
        oldShots.map(shot => {
          if (shot.id === args.shot_id) {
            const newImage: GenerationRow = {
              shotImageEntryId: `optimistic-sg-${Date.now()}`,
              id: args.generation_id,
              imageUrl: args.imageUrl, 
              thumbUrl: args.thumbUrl || args.imageUrl,
              metadata: {}, 
            };
            return {
              ...shot,
              images: shot.images ? [...shot.images, newImage] : [newImage],
            };
          }
          return shot;
        })
      );
      return { previousShots, projectId: args.project_id };
    },
    onError: (err, args, context) => {
      console.error('Optimistic update failed for addImageToShot:', err);
      if (context?.previousShots && context.projectId) {
        queryClient.setQueryData<Shot[]>(['shots', context.projectId], context.previousShots);
      }
      // Ensure toast is shown for add image error
      toast.error(`Failed to add image: ${err.message}`);
    },
    onSettled: (data, error, args) => {
      if (args.project_id) {
        queryClient.invalidateQueries({ queryKey: ['shots', args.project_id] });
      }
      // Removed toast.success notification
    },
  });
};

// Type for the arguments of useRemoveImageFromShot mutation
interface RemoveImageFromShotArgs {
  shot_id: string;
  generation_id: string;
  project_id: string | null; // For invalidating correct query and optimistic updates
}

// Remove an image from a shot VIA API
export const useRemoveImageFromShot = () => {
  const queryClient = useQueryClient();
  return useMutation<
    void, 
    Error,
    RemoveImageFromShotArgs,
    { previousShots?: Shot[], project_id?: string | null, shot_id?: string, generation_id?: string }
  >({
    mutationFn: async ({ shot_id, generation_id, project_id }) => { 
      const response = await fetch(`/api/shots/${shot_id}/generations/${generation_id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || `Failed to remove image from shot: ${response.statusText}`);
      }
    },
    onMutate: async ({ shot_id, generation_id, project_id }) => {
      if (!project_id) return { previousShots: [], project_id: null };
      await queryClient.cancelQueries({ queryKey: ['shots', project_id] });
      const previousShots = queryClient.getQueryData<Shot[]>(['shots', project_id]);

      queryClient.setQueryData<Shot[]>(['shots', project_id], (oldShots = []) =>
        oldShots.map(shot => {
          if (shot.id === shot_id) {
            return {
              ...shot,
              images: shot.images ? shot.images.filter(img => img.id !== generation_id) : [],
            };
          }
          return shot;
        })
      );
      return { previousShots, project_id, shot_id, generation_id }; 
    },
    onError: (err, args, context) => {
      console.error('Optimistic update failed for removeImageFromShot:', err);
      if (context?.previousShots && context.project_id) { 
        queryClient.setQueryData<Shot[]>(['shots', context.project_id], context.previousShots);
      }
      toast.error(`Failed to remove image: ${err.message}`);
    },
    onSettled: (data, error, { project_id, shot_id, generation_id }) => { 
      if (project_id) {
        queryClient.invalidateQueries({ queryKey: ['shots', project_id] });
      }
    },
  });
};

// Delete a shot VIA API
export const useDeleteShot = () => {
  const queryClient = useQueryClient();
  return useMutation<
    void, // DELETE typically returns 204 No Content, so no specific data on success
    Error,
    { shotId: string; projectId: string | null },
    { previousShots?: Shot[]; projectId?: string | null }
  >({
    mutationFn: async ({ shotId, projectId }) => { // projectId is mainly for client-side cache operations
      const response = await fetch(`/api/shots/${shotId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        // For 404, server sends { message: 'Shot not found' }
        // For other errors, it might be different or no JSON body.
        const errorData = await response.json().catch(() => ({ message: `Failed to delete shot: ${response.statusText}` }));
        throw new Error(errorData.message);
      }
      // No explicit return needed for success as it's a 204 or similar
    },
    onMutate: async ({ shotId, projectId }) => {
      if (!projectId) return { previousShots: [], projectId };
      await queryClient.cancelQueries({ queryKey: ['shots', projectId] });
      const previousShots = queryClient.getQueryData<Shot[]>(['shots', projectId]);
      queryClient.setQueryData<Shot[]>(['shots', projectId], (old = []) => old.filter(s => s.id !== shotId));
      return { previousShots, projectId };
    },
    onError: (err, { shotId, projectId }, context) => { // Corrected args access
      if (context?.previousShots && context.projectId) {
        queryClient.setQueryData<Shot[]>(['shots', context.projectId], context.previousShots);
      }
      // Toasting is handled by the component calling mutateAsync in VideoShotDisplay
      // toast.error(`Failed to delete shot: ${err.message}`); // Can be added here too if general
    },
    onSettled: (data, error, { projectId, shotId }) => { // Corrected args access
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['shots', projectId] });
      }
      // Toasting is handled by the component calling mutateAsync in VideoShotDisplay
      // if (!error) {
      //   toast.success(`Shot deleted successfully.`); // Can be added here too if general
      // }
    },
  });
};

// Type for updating shot name
interface UpdateShotNameArgs {
  shotId: string;
  newName: string;
  projectId: string | null;
}

// Update shot name VIA API
export const useUpdateShotName = () => {
  const queryClient = useQueryClient();
  return useMutation<
    Shot, // Expecting the API to return a simplified Shot-like structure after update
    Error, 
    UpdateShotNameArgs,
    { previousShots?: Shot[]; projectId?: string | null } 
  >({
    mutationFn: async ({ shotId, newName, projectId }: UpdateShotNameArgs): Promise<Shot> => {
      const response = await fetch(`/api/shots/${shotId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || `Failed to update shot name: ${response.statusText}`);
      }
      
      const updatedShot: Shot = await response.json(); // API returns the updated shot (basic fields)
      return updatedShot;
    },
    onMutate: async ({ shotId, newName, projectId }) => {
      if (!projectId) return { previousShots: [], projectId };
      await queryClient.cancelQueries({ queryKey: ['shots', projectId] });
      const previousShots = queryClient.getQueryData<Shot[]>(['shots', projectId]);

      queryClient.setQueryData<Shot[]>(['shots', projectId], (oldShots = []) => 
        oldShots.map(shot => 
          shot.id === shotId ? { ...shot, name: newName.trim() } : shot
        )
      );
      return { previousShots, projectId };
    },
    onError: (err, { shotId, newName, projectId }, context) => { // Corrected args access
      console.error('Optimistic update for shot name failed, rolling back:', err);
      if (context?.previousShots && context.projectId) {
        queryClient.setQueryData<Shot[]>(['shots', context.projectId], context.previousShots);
      }
    },
    onSettled: (data, error, { projectId, newName }) => { // Corrected args access
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['shots', projectId] });
      }
      // Toasting is handled by the component calling mutateAsync via its own onSuccess/onError
      // Or can be added here if a general toast is always desired for this hook
      // if (!error && data) { // data here is the updatedShot from mutationFn
      //   toast.success(`Shot "${data.name}" updated successfully.`);
      // }
    },
  });
};

// Args for updating image order
interface UpdateShotImageOrderArgs {
  shotId: string;
  orderedGenerationIds: string[];
  projectId: string | null;
}

// Hook to update the order of images in a shot VIA API
export const useUpdateShotImageOrder = () => {
  const queryClient = useQueryClient();
  return useMutation<
    void, 
    Error,
    UpdateShotImageOrderArgs,
    { previousShots?: Shot[], projectId?: string | null }
  >({
    mutationFn: async ({ shotId, orderedGenerationIds, projectId }) => {
      const response = await fetch(`/api/shots/${shotId}/generations/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedGenerationIds }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || `Failed to update image order: ${response.statusText}`);
      }
    },
    onMutate: async ({ shotId, orderedGenerationIds, projectId }) => {
      if (!projectId) return { previousShots: [], projectId: null };
      await queryClient.cancelQueries({ queryKey: ['shots', projectId] });
      const previousShots = queryClient.getQueryData<Shot[]>(['shots', projectId]);

      queryClient.setQueryData<Shot[]>(['shots', projectId], (oldShots = []) =>
        oldShots.map(shot => {
          if (shot.id === shotId) {
            if (!shot.images) return shot; 
            const imageMap = new Map(shot.images.map(img => [img.id, img]));
            const reorderedImages = orderedGenerationIds
              .map(id => imageMap.get(id))
              .filter(img => img !== undefined) as GenerationRow[];
            return { ...shot, images: reorderedImages };
          }
          return shot;
        })
      );
      return { previousShots, projectId };
    },
    onError: (err, args, context) => {
      console.error('Optimistic update failed for updateShotImageOrder:', err);
      if (context?.previousShots && context.projectId) {
        queryClient.setQueryData<Shot[]>(['shots', context.projectId], context.previousShots);
      }
      toast.error(`Failed to reorder images: ${err.message}`);
    },
    onSettled: (data, error, { projectId, shotId }) => {
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['shots', projectId] });
      }
    },
  });
};

// Hook to handle dropping an external image file to create a new shot or add to an existing one
export const useHandleExternalImageDrop = () => {
  const createShotMutation = useCreateShot();
  const addImageToShotMutation = useAddImageToShot();
  // IMPORTANT: This hook needs access to the current project_id.
  // This should ideally come from a context, e.g., useProject().
  // For now, I'll assume it's passed as an argument or a higher-level component handles it.
  // Let's modify it to accept projectId.

  const handleDrop = async (
    imageFile: File, 
    targetShotId: string | null, 
    currentProjectQueryKey: string | null, // This is a placeholder for actual projectId
    currentShotCount: number
  ): Promise<{ shotId: string; generationId: string } | null> => {
    
    if (!currentProjectQueryKey) { // Should be actual projectId
        toast.error("Cannot add image: current project is not identified.");
        return null;
    }
    const projectIdForOperation = currentProjectQueryKey; // Use the passed projectId

    let newShotId = targetShotId;
    let newGeneration: Database['public']['Tables']['generations']['Row'] | null = null;

    try {
      // 1. Upload the image to Supabase Storage
      const imageUrl = await uploadImageToStorage(imageFile);
      if (!imageUrl) {
        toast.error("Failed to upload image to storage.");
        return null;
      }
      toast.success("Image uploaded to storage!");

      // 2. Create a generation record for the uploaded image
      try {
        console.log('[useShots] useHandleExternalImageDrop: Creating generation record for', imageUrl); // [VideoLoadSpeedIssue]
        newGeneration = await createGenerationForUploadedImage(imageUrl, imageFile.name, imageFile.type, imageFile.size, projectIdForOperation);
        console.log('[useShots] useHandleExternalImageDrop: Generation record created, ID:', newGeneration.id); // [VideoLoadSpeedIssue]
      } catch (generationError) {
        toast.error(`Failed to create generation data: ${(generationError as Error).message}`);
        return null;
      }

      if (!newGeneration || !newGeneration.id) {
        toast.error("Failed to create generation record or ID is missing.");
        return null;
      }

      // 3. Create a new shot if targetShotId is null (e.g., dropped on NewGroupDropZone)
      if (!newShotId) {
        const newShotName = `Shot ${currentShotCount + 1}`;
        const createdShot = await createShotMutation.mutateAsync({ shotName: newShotName, projectId: projectIdForOperation });
        if (createdShot && createdShot.id) {
          newShotId = createdShot.id;
          toast.success(`New shot "${newShotName}" created!`);
        } else {
          toast.error("Failed to create new shot.");
          return null;
        }
      }

      // 4. Add the generation to the shot (either new or existing)
      await addImageToShotMutation.mutateAsync({
        shot_id: newShotId,
        generation_id: newGeneration.id as string, // generation.id is string from DB schema
        project_id: projectIdForOperation, // Pass projectId here
        imageUrl: newGeneration.image_url || undefined,
        thumbUrl: newGeneration.image_url || undefined, // Assuming same for now
        // position can be set if needed
      });
      toast.success(`Image added to shot "${newShotId.substring(0,6)}..."!`);
      return { shotId: newShotId, generationId: newGeneration.id as string };

    } catch (error) {
      console.error('[useShots] Error handling external image drop:', error); // [VideoLoadSpeedIssue]
      toast.error(`Failed to process dropped image: ${(error as Error).message}`);
      return null;
    }
  };
  return { handleDrop }; 
}; 