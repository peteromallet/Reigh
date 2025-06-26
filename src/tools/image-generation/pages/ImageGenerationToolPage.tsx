import React, { useState, useEffect, useRef } from "react";
import ImageGenerationForm, { ImageGenerationFormHandles, PromptEntry } from "../components/ImageGenerationForm";
import ImageGallery, { GeneratedImageWithMetadata, DisplayableMetadata, MetadataLora } from "@/shared/components/ImageGallery";
import SettingsModal from "@/shared/components/SettingsModal";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { useListShots, useAddImageToShot } from "@/shared/hooks/useShots";
import { useLastAffectedShot } from "@/shared/hooks/useLastAffectedShot";
import { useProject } from "@/shared/contexts/ProjectContext";
import { uploadImageToStorage } from '@/shared/lib/imageUploader';
import { nanoid } from 'nanoid';
import { useListAllGenerations, useDeleteGeneration } from "@/shared/hooks/useGenerations";
import { Settings } from "lucide-react";
import { useApiKeys } from '@/shared/hooks/useApiKeys';
import { useQueryClient } from '@tanstack/react-query';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// This interface defines the rich LoRA structure we expect from the form and want to save in metadata
// interface StoredActiveLora { // This might be covered by MetadataLora or internal to the form/hook
//   id: string;
//   name: string;
//   path: string;
//   strength: number; // 0-100
//   previewImageUrl?: string;
// }

// const initializeFalClient = () => { // Handled by the hook / global initializer
//   const API_KEY = localStorage.getItem('fal_api_key') || '0b6f1876-0aab-4b56-b821-b384b64768fa:121392c885a381f93de56d701e3d532f';
//   fal.config({ credentials: API_KEY });
//   return API_KEY;
// };

const placeholderImages: GeneratedImageWithMetadata[] = Array(8).fill(null).map((_, index) => ({
  id: `image-${index}`,
  url: "/placeholder.svg",
  prompt: "Placeholder image",
  metadata: { prompt: "Placeholder image" } as DisplayableMetadata
}));

const ImageGenerationToolPage = () => {
  const [generatedImages, setGeneratedImages] = useState<GeneratedImageWithMetadata[]>(placeholderImages);
  // const [isGenerating, setIsGenerating] = useState(false); // From hook
  // const [currentPromptIndex, setCurrentPromptIndex] = useState<number | null>(null); // Part of hook's progress
  // const [currentImageCount, setCurrentImageCount] = useState<number>(0); // Part of hook's progress
  const [showPlaceholders, setShowPlaceholders] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isUpscalingImageId, setIsUpscalingImageId] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const { apiKeys, getApiKey } = useApiKeys();

  const imageGenerationFormRef = useRef<ImageGenerationFormHandles>(null);
  // const cancelGenerationRef = useRef(false); // Handled by hook
  // const currentSubscriptionRef = useRef<any>(null); // Handled by hook
  // const [generationProgress, setGenerationProgress] = useState<FalGenerationProgress | null>(null); // From hook

  const { selectedProjectId } = useProject();
  const { data: shots, isLoading: isLoadingShots, error: shotsError } = useListShots(selectedProjectId);
  const addImageToShotMutation = useAddImageToShot();
  const { lastAffectedShotId, setLastAffectedShotId } = useLastAffectedShot();
  const { data: generatedImagesData, isLoading: isLoadingGenerations } = useListAllGenerations(selectedProjectId);
  const deleteGenerationMutation = useDeleteGeneration();

  const queryClient = useQueryClient();

  useEffect(() => {
    if (generatedImagesData) {
      setGeneratedImages(generatedImagesData);
      setShowPlaceholders(generatedImagesData.length === 0);
    } else {
      setGeneratedImages(placeholderImages);
      setShowPlaceholders(true);
    }
  }, [generatedImagesData]);

  useEffect(() => {
    setShowPlaceholders(!isLoadingGenerations && (!generatedImagesData || generatedImagesData.length === 0));
  }, [generatedImagesData, isLoadingGenerations]);

  const handleDeleteImage = async (id: string) => {
    deleteGenerationMutation.mutate(id);
  };

  const handleUpscaleImage = async (imageId: string, imageUrl: string, currentMetadata?: DisplayableMetadata) => {
    setIsUpscalingImageId(imageId);
    const toastId = `upscale-${imageId}`;
    toast.info("Sending request to DEBUG upscale function...", { id: toastId });

    try {
      const { data: functionData, error: functionError } = await supabase.functions.invoke("hello-debug", {
        body: { imageUrl },
      });

      if (functionError) {
        console.error("Supabase Edge Function error:", functionError);
        let errorMessage = functionError.message;
        try {
          const parsedError = JSON.parse(functionError.message);
          if (parsedError && parsedError.error) {
            errorMessage = parsedError.error;
          }
        } catch (e) { /* Ignore if parsing fails */ }
        throw new Error(`Upscale request failed: ${errorMessage}`);
      }

      console.log("Debug function response data:", functionData);

      if (!functionData || !functionData.upscaledImageUrl) {
        console.error("Debug Edge function returned unexpected data:", functionData);
        if (functionData && functionData.message && functionData.message.includes("imageUrl is missing")) {
          throw new Error("Debug function reports: imageUrl is missing in payload.");
        }
        throw new Error("Debug upscale completed but did not return a valid image URL or expected message.");
      }

      const upscaledImageUrl = functionData.upscaledImageUrl;
      toast.success(`Debug upscale successful! Mock URL: ${upscaledImageUrl}. Message: ${functionData.message}`, { id: toastId, duration: 5000 });

      const newMetadata: DisplayableMetadata = {
        ...(currentMetadata || {}),
        upscaled: true,
        original_image_url: imageUrl, 
      };

      const { data: updatedData, error: updateError } = await supabase
        .from('generations' as any)
        .update({ 
          image_url: upscaledImageUrl, 
          metadata: newMetadata as Json 
        })
        .eq('id', imageId)
        .select()
        .single();

      if (updateError) {
        console.error("Supabase DB update error:", updateError);
        throw new Error(`Failed to save upscaled image to database: ${updateError.message}`);
      }

      if (updatedData) {
          setGeneratedImages(prevImages =>
            prevImages.map(img => 
              img.id === imageId 
                ? { ...img, url: upscaledImageUrl!, metadata: newMetadata } 
                : img
            )
          );
        toast.success("Upscaled image saved and gallery updated.", { id: toastId });
      }

    } catch (error) {
      console.error("Error during upscale process:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during upscaling.";
      toast.error(errorMessage, { id: toastId });
    } finally {
      setIsUpscalingImageId(null);
    }
  };

  const handleNewGenerate = async (formData: any) => {
    if (!selectedProjectId) {
      toast.error("No project selected. Please select a project before generating images.");
      return;
    }

    setIsCreatingTask(true);

    const { generationMode, ...restOfFormData } = formData;

    // Clear placeholders if needed
    if (showPlaceholders && restOfFormData.prompts.length * restOfFormData.imagesPerPrompt > 0) {
      setGeneratedImages([]);
      setShowPlaceholders(false);
    }

    if (generationMode === 'wan-local') {
      // Process all prompts for wan-local mode
      const totalTasks = restOfFormData.prompts.length * restOfFormData.imagesPerPrompt;
      
      const lorasMapped: Array<{ path: string; strength: number }> = (restOfFormData.loras || []).map((lora: any) => ({
        path: lora.path,
        strength: parseFloat(lora.scale ?? lora.strength) || 0.0,
      }));

      let successCount = 0;
      let errorCount = 0;

      try {
        // Create tasks for each prompt x imagesPerPrompt
        for (const promptEntry of restOfFormData.prompts) {
          for (let imageIndex = 0; imageIndex < restOfFormData.imagesPerPrompt; imageIndex++) {
            const requestPayload: any = {
              project_id: selectedProjectId,
              prompt: promptEntry.fullPrompt,
              resolution: restOfFormData.determinedApiImageSize || undefined,
              seed: 11111 + (successCount * 100), // Vary seed for each image
              loras: lorasMapped,
            };

            try {
              const response = await fetch('/api/single-image/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload),
              });

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }));
                throw new Error(errorData.message || `HTTP error ${response.status}`);
              }

              const newTask = await response.json();
              successCount++;
              console.log(`[wan-local] Task ${successCount}/${totalTasks} created:`, newTask.id);
            } catch (taskError: any) {
              console.error(`[wan-local] Error creating task for prompt "${promptEntry.shortPrompt || promptEntry.fullPrompt.substring(0, 50)}...":`, taskError);
              errorCount++;
            }
          }
        }

        if (successCount > 0) {
          toast.success(`${successCount} image generation tasks queued successfully! ${errorCount > 0 ? `(${errorCount} failed)` : ''} Check the Tasks pane for progress.`);
        } else {
          toast.error(`Failed to create any tasks. ${errorCount} errors occurred.`);
        }
      } catch (err: any) {
        console.error('[ImageGenerationToolPage] Error creating wan-local tasks:', err);
        toast.error(`Failed to create tasks: ${err.message || 'Unknown API error'}`);
      } finally {
        setIsCreatingTask(false);
      }

      return; // early exit for wan-local
    }

    // Existing FAL-based generation for flux-api (default)
    let userImageUrl: string | null = null;
    if (restOfFormData.startingImage) {
      try {
        toast.info('Uploading starting image...');
        userImageUrl = await uploadImageToStorage(restOfFormData.startingImage);
        if (!userImageUrl) {
          toast.error('Starting image upload failed. Please try again.');
          setIsCreatingTask(false);
          return;
        }
        toast.success('Starting image uploaded!');
      } catch (uploadError: any) {
        console.error('[ImageGenerationToolPage] Error uploading starting image:', uploadError);
        toast.error(`Failed to upload starting image: ${uploadError.message || 'Unknown error'}`);
        setIsCreatingTask(false);
        return;
      }
    } else if (restOfFormData.appliedStartingImageUrl) {
      userImageUrl = restOfFormData.appliedStartingImageUrl;
    }

    const taskPayload = {
      project_id: selectedProjectId,
      task_type: 'image_generation_fal',
      params: {
        ...restOfFormData,
        user_image_url: userImageUrl,
        loras: (restOfFormData.loras || []).map((lora: any) => ({
          path: lora.path,
          strength: lora.strength,
        })),
      },
      status: 'Pending',
    };

    try {
      const { data: newTask, error } = await supabase.from('tasks').insert(taskPayload).select().single();

      if (error) throw error;

      if (newTask) {
        toast.success(`Image generation task created (ID: ${newTask.id.substring(0,8)}...). Check the Tasks pane for progress.`);
      }
    } catch (err: any) {
      console.error('Error creating image generation task:', err);
      toast.error(`Failed to create task: ${err.message || 'Unknown API error'}`);
    } finally {
      setIsCreatingTask(false);
    }
  };

  // const handleCancelGeneration = () => { // Now using cancelGeneration from the hook
  //   console.log("[Index.tsx] handleCancelGeneration called.");
  //   toast.info("Cancelling image generation...");
  //   cancelGenerationRef.current = true;
  //   if (currentSubscriptionRef.current && typeof currentSubscriptionRef.current.unsubscribe === 'function') {
  //     currentSubscriptionRef.current.unsubscribe();
  //     console.log("[Index.tsx] Fal subscription cancelled via unsubscribe().");
  //   }
  //   currentSubscriptionRef.current = null; 
  //   setIsGenerating(false); 
  //   setGenerationProgress(null); 
  // };

  // REMOVE OLD handleGenerate function (lines 212-393 approx)
  // ... old handleGenerate logic was here ...

  const handleApplySettingsFromGallery = (settings: DisplayableMetadata) => {
    if (imageGenerationFormRef.current) {
      imageGenerationFormRef.current.applySettings(settings);
      toast.info("Settings applied to the form.");
    }
  };

  const handleImageSaved = async (imageId: string, newImageUrl: string) => {
    try {
      // Update the database record
      const { error } = await supabase
        .from('generations')
        .update({ image_url: newImageUrl })
        .eq('id', imageId);

      if (error) {
        console.error("Error updating image URL in database:", error);
        toast.error("Failed to update image in database.");
        return;
      }

      // Update local state
      setGeneratedImages(prevImages =>
        prevImages.map(img => 
          img.id === imageId 
            ? { ...img, url: newImageUrl } 
            : img
        )
      );

      // Invalidate the generations query to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['generations', selectedProjectId] });

      toast.success("Image updated successfully!");
    } catch (error) {
      console.error("Error saving flipped image:", error);
      toast.error("Failed to update image.");
    }
  };

  const falApiKey = getApiKey('fal_api_key');
  const openaiApiKey = getApiKey('openai_api_key');
  const hasValidFalApiKey = true;

  const targetShotIdForButton = lastAffectedShotId || (shots && shots.length > 0 ? shots[0].id : undefined);
  const targetShotNameForButtonTooltip = targetShotIdForButton 
    ? (shots?.find(s => s.id === targetShotIdForButton)?.name || 'Selected Shot')
    : (shots && shots.length > 0 ? shots[0].name : 'Last Shot');

  const handleAddImageToTargetShot = async (generationId: string, imageUrl?: string, thumbUrl?: string): Promise<boolean> => {
    if (!targetShotIdForButton) {
      toast.error("No target shot available to add to. Create a shot first or interact with one.");
      return false;
    }
    if (!generationId) {
        toast.error("Image has no ID, cannot add to shot.");
        return false;
    }
    if (!selectedProjectId) {
        toast.error("No project selected. Cannot add image to shot.");
        return false;
    }
    try {
      await addImageToShotMutation.mutateAsync({
        shot_id: targetShotIdForButton,
        generation_id: generationId,
        imageUrl: imageUrl,
        thumbUrl: thumbUrl,
        project_id: selectedProjectId, 
      });
      setLastAffectedShotId(targetShotIdForButton);
      return true;
    } catch (error) {
      console.error("Error adding image to target shot:", error);
      toast.error("Failed to add image to shot.");
      return false;
    }
  };

  const validShots = shots || [];

  // Update the condition for showing the form, and disable generate button if task is being created
  const canGenerate = hasValidFalApiKey && !isCreatingTask; // And selectedProjectId is implicitly checked in handleNewGenerate

  const isGenerating = isCreatingTask; // Simplified generating state

  const imagesToShow = showPlaceholders 
    ? placeholderImages 
    : [...(generatedImagesData || [])];

  return (
    <div className="flex flex-col h-screen">
      <header className="flex justify-between items-center mb-6 sticky top-0 bg-background/90 backdrop-blur-md py-4 z-10">
        <h1 className="text-3xl font-bold">Image Generation</h1>
        <Button variant="ghost" onClick={() => setShowSettingsModal(true)}>
          <Settings className="h-5 w-5" />
          <span className="sr-only">Settings</span>
        </Button>
      </header>

      {!hasValidFalApiKey && (
        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-center text-sm text-muted-foreground">
            You need a valid API key to use this tool.
          </p>
          <Button className="mt-4">
            <a href="https://fal.ai/signup" target="_blank" rel="noopener noreferrer">
              Sign Up for Fal
            </a>
          </Button>
        </div>
      )}

      {/* Render only if API key is valid */}
      {hasValidFalApiKey && (
        <>
          <div className="mb-8 p-6 border rounded-lg shadow-sm bg-card">
            <ImageGenerationForm 
              ref={imageGenerationFormRef} 
              onGenerate={handleNewGenerate} // Use the new handler
              isGenerating={isGenerating} // isCreatingTask from handleNewGenerate
              hasApiKey={!!falApiKey} // Still relevant for UI
              apiKey={falApiKey} // Potentially for display or direct use by form
              openaiApiKey={openaiApiKey}
            />
          </div>

          {isCreatingTask && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) { /* handleCancelGeneration() */ } }}>
              <div className="bg-background p-8 rounded-lg shadow-2xl w-full max-w-md text-center" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-2xl font-semibold mb-4">Creating Image Generation Task...</h2>
                <p className="mb-2">Task ID: {/* generationProgress?.taskId */}</p>
                <p className="mb-4">Overall progress: {/* generationProgress?.progressPercentage */}%</p>
                <Button variant="destructive" onClick={(e) => { if (e.target === e.currentTarget) { /* handleCancelGeneration() */ } }}>Cancel Task</Button>
              </div>
            </div>
          )}

          <div className="mt-8">
            <ImageGallery 
              images={imagesToShow}
              onDelete={handleDeleteImage} 
              isDeleting={deleteGenerationMutation.isPending ? deleteGenerationMutation.variables as string : null}
              onApplySettings={handleApplySettingsFromGallery}
              onAddToLastShot={handleAddImageToTargetShot}
              allShots={shots || []}
              lastShotId={lastAffectedShotId}
              currentToolType="image-generation"
              onImageSaved={handleImageSaved}
            />
          </div>
        </>
      )}

      {/* Settings Modal */}
      <SettingsModal 
          isOpen={showSettingsModal}
          onOpenChange={setShowSettingsModal}
        />
    </div>
  );
};

export default ImageGenerationToolPage;

