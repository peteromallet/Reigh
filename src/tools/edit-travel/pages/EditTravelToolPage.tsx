import React, { useState, useEffect, useRef, useCallback, useContext } from "react";
import { Button } from "@/shared/components/ui/button";
import ImageGallery, { GeneratedImageWithMetadata, DisplayableMetadata } from "@/shared/components/ImageGallery";
import SettingsModal from "@/shared/components/SettingsModal";
import { PromptEntry } from "@/tools/image-generation/components/ImageGenerationForm";
import PromptEditorModal from "@/shared/components/PromptEditorModal";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useListShots, useAddImageToShot } from "@/shared/hooks/useShots";
import { useListAllGenerations, useDeleteGeneration } from "@/shared/hooks/useGenerations";
import { LastAffectedShotContext } from "@/shared/contexts/LastAffectedShotContext";
import { nanoid } from "nanoid";
import { AlertTriangle, Settings } from "lucide-react";
import { fileToDataURL, dataURLtoFile } from "@/shared/lib/utils";
import { useProject } from "@/shared/contexts/ProjectContext";
import { uploadImageToStorage } from '@/shared/lib/imageUploader';
import { useQueryClient } from "@tanstack/react-query";
import { findClosestAspectRatio } from "@/shared/lib/aspectRatios";
import ShotsPane from '@/shared/components/ShotsPane/ShotsPane';
import EditTravelForm from "../components/EditTravelForm";
import usePersistentState from "@/shared/hooks/usePersistentState";
import { useApiKeys } from '@/shared/hooks/useApiKeys';

// Local definition for Json type
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

const EDIT_TRAVEL_INPUT_FILE_KEY = 'editTravelInputFile';
const EDIT_TRAVEL_PROMPTS_KEY = 'editTravelPrompts';
const EDIT_TRAVEL_IMAGES_PER_PROMPT_KEY = 'editTravelImagesPerPrompt';
const EDIT_TRAVEL_GENERATION_MODE_KEY = 'editTravelGenerationMode';
const MAX_LOCAL_STORAGE_ITEM_LENGTH = 4 * 1024 * 1024;

const EDIT_TRAVEL_FLUX_SOFT_EDGE_STRENGTH_KEY = 'editTravelFluxSoftEdgeStrength';
const EDIT_TRAVEL_FLUX_DEPTH_STRENGTH_KEY = 'editTravelFluxDepthStrength';
const EDIT_TRAVEL_RECONSTRUCT_VIDEO_KEY = 'editTravelReconstructVideo';

const EditTravelToolPage = () => {
  const [prompts, setPrompts] = usePersistentState<PromptEntry[]>('editTravelPrompts', []);
  const [imagesPerPrompt, setImagesPerPrompt] = usePersistentState<number>('editTravelImagesPerPrompt', 1);
  const [generationMode, setGenerationMode] = usePersistentState<'kontext' | 'flux'>('editTravelGenerationMode', 'kontext');
  const [fluxSoftEdgeStrength, setFluxSoftEdgeStrength] = usePersistentState<number>('editTravelFluxSoftEdgeStrength', 0.2);
  const [fluxDepthStrength, setFluxDepthStrength] = usePersistentState<number>('editTravelFluxDepthStrength', 0.6);
  const [reconstructVideo, setReconstructVideo] = usePersistentState<boolean>('editTravelReconstructVideo', true);

  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputFilePreviewUrl, setInputFilePreviewUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [showPlaceholders, setShowPlaceholders] = useState(true);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [isClientSideReconstructing, setIsClientSideReconstructing] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  
  const { getApiKey } = useApiKeys();
  
  const kontextCancelGenerationRef = useRef(false);
  const kontextCurrentSubscriptionRef = useRef<any>(null);
  const reconstructionCancelRef = useRef(false);
  
  const { selectedProjectId } = useProject();
  const queryClient = useQueryClient();

  const { data: shots } = useListShots(selectedProjectId);
  const { data: generatedImages, isLoading: isLoadingGenerations } = useListAllGenerations(selectedProjectId);
  const addImageToShotMutation = useAddImageToShot();
  const deleteGenerationMutation = useDeleteGeneration();
  
  const lastAffectedShotContext = useContext(LastAffectedShotContext);
  const { lastAffectedShotId = null, setLastAffectedShotId = () => {} } = lastAffectedShotContext || {};

  const generatePromptId = useCallback(() => nanoid(), []);
  
  const isOverallGenerating = isCreatingTask || isClientSideReconstructing;

  const lorasForFlux = [
    { path: "Shakker-Labs/FLUX.1-dev-LoRA-add-details", scale: "0.78" },
    { path: "Shakker-Labs/FLUX.1-dev-LoRA-AntiBlur", scale: "0.43" },
    { path: "strangerzonehf/Flux-Super-Realism-LoRA", scale: "0.40" },
    { path: "kudzueye/boreal-flux-dev-v2", scale: "0.06" }
  ];

  useEffect(() => {
    const savedFileRaw = localStorage.getItem('editTravelInputFile');
    if (savedFileRaw) {
      try {
        const savedFileData = JSON.parse(savedFileRaw);
        if (savedFileData?.dataUrl && savedFileData?.name && savedFileData?.type) {
          const restoredFile = dataURLtoFile(savedFileData.dataUrl, savedFileData.name, savedFileData.type);
          if (restoredFile) setInputFile(restoredFile);
        }
      } catch (error) {
        console.error("Error loading input file from localStorage:", error);
        localStorage.removeItem('editTravelInputFile');
      }
    }
  }, [selectedProjectId]);

  useEffect(() => {
    setShowPlaceholders(!isLoadingGenerations && (!generatedImages || generatedImages.length === 0));
  }, [generatedImages, isLoadingGenerations]);

  useEffect(() => {
    let previewObjectUrl: string | null = null;
    if (inputFile) {
      previewObjectUrl = URL.createObjectURL(inputFile);
      setInputFilePreviewUrl(previewObjectUrl);
      setVideoDuration(null);

      if (inputFile.type.startsWith('image/')) {
        const img = new Image();
        const imageLoadUrl = URL.createObjectURL(inputFile);
        img.onload = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            const numericalRatio = img.naturalWidth / img.naturalHeight;
            setAspectRatio(findClosestAspectRatio(numericalRatio));
          }
          URL.revokeObjectURL(imageLoadUrl);
        };
        img.src = imageLoadUrl;
      } else if (inputFile.type.startsWith('video/')) {
        const video = document.createElement('video');
        const videoLoadUrl = URL.createObjectURL(inputFile);
        video.onloadedmetadata = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            const numericalRatio = video.videoWidth / video.videoHeight;
            setAspectRatio(findClosestAspectRatio(numericalRatio));
            setVideoDuration(video.duration);
          }
          URL.revokeObjectURL(videoLoadUrl);
        };
        video.preload = 'metadata';
        video.src = videoLoadUrl;
      }
    } else {
      setInputFilePreviewUrl(null);
      setAspectRatio("1:1"); 
      setVideoDuration(null);
    }

    return () => {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    };
  }, [inputFile]);
  
  const handleFileChange = (files: File[]) => {
    const file = files?.[0] || null;
    setInputFile(file);
    if (file) {
      fileToDataURL(file)
        .then(dataUrl => {
            const itemToStore = { dataUrl, name: file.name, type: file.type };
            localStorage.setItem('editTravelInputFile', JSON.stringify(itemToStore));
        })
        .catch(error => {
          console.error("Error processing file for localStorage:", error);
          toast.error("Could not save input file locally.");
        });
    } else {
      localStorage.removeItem('editTravelInputFile');
    }
  };
  
  const handleSavePrompts = (updatedPrompts: PromptEntry[]) => setPrompts(updatedPrompts);
  
  const handleGenerate = async () => {
    if (!selectedProjectId || !inputFile) {
      toast.error("Project and input file are required.");
      return;
    }

    setIsCreatingTask(true);
    let uploadedInputUrl: string;

    try {
      toast.info("Uploading input file...");
      uploadedInputUrl = await uploadImageToStorage(inputFile);
      toast.success("Input file uploaded!");
    } catch (uploadError: any) {
      console.error("Error uploading input file:", uploadError);
      toast.error(`Failed to upload input file: ${uploadError.message || 'Unknown error'}`);
      setIsCreatingTask(false);
      return;
    }

    const activePrompts = prompts.filter(p => p.fullPrompt.trim() !== "");
    const commonTaskParams = {
      input_file_url: uploadedInputUrl,
      original_input_filename: inputFile.name,
      prompts: activePrompts.map(p => ({ id: p.id, fullPrompt: p.fullPrompt, shortPrompt: p.shortPrompt })),
      images_per_prompt: imagesPerPrompt,
      aspect_ratio: aspectRatio,
      reconstruct_video: inputFile.type.startsWith('video/') && reconstructVideo,
    };

    const taskType = `edit_travel_${generationMode}`;
    const specificParams = generationMode === 'flux' 
      ? { ...commonTaskParams, loras: lorasForFlux, depthStrength: fluxDepthStrength, softEdgeStrength: fluxSoftEdgeStrength }
      : commonTaskParams;
    
    try {
      const { data: newTask, error } = await supabase.from('tasks').insert({
        project_id: selectedProjectId,
        task_type: taskType, 
        params: specificParams,
        status: 'Pending',
      }).select().single();

      if (error) throw error;

      if (newTask) {        
        toast.success(`${generationMode.charAt(0).toUpperCase() + generationMode.slice(1)} task created (ID: ${newTask.id.substring(0,8)}...).`);
        if (showPlaceholders) setShowPlaceholders(false);
        queryClient.invalidateQueries({ queryKey: ['shots', selectedProjectId] });
      }
    } catch (err: any) {
      console.error(`Error creating ${generationMode} task:`, err);
      toast.error(`Failed to create task: ${err.message || 'Unknown API error'}`);
    } finally {
      setIsCreatingTask(false);
    }
  };
  
  const handleCancelGeneration = () => {
    kontextCancelGenerationRef.current = true;
    if (kontextCurrentSubscriptionRef.current?.unsubscribe) {
        kontextCurrentSubscriptionRef.current.unsubscribe();
    }
    kontextCurrentSubscriptionRef.current = null;
    setIsCreatingTask(false); 
    
    reconstructionCancelRef.current = true; 
    setIsClientSideReconstructing(false); 
  };
  
  const handleAddImageToTargetShot = async (generationId: string, imageUrl?: string, thumbUrl?: string): Promise<boolean> => {
    const targetShot = lastAffectedShotId || (shots && shots.length > 0 ? shots[0].id : undefined);
    if (!targetShot || !selectedProjectId) {
      toast.error("No target shot or project available.");
      return false;
    }
    try {
      await addImageToShotMutation.mutateAsync({ 
        shot_id: targetShot, 
        generation_id: generationId, 
        imageUrl, 
        thumbUrl, 
        project_id: selectedProjectId
      });
      setLastAffectedShotId(targetShot);
      return true;
    } catch (error: any) { 
        toast.error("Failed to add image to shot: " + error.message); 
        return false; 
    }
  };

  const falApiKey = getApiKey('fal_api_key');
  const openaiApiKey = getApiKey('openai_api_key');
  const hasValidFalApiKey = !!falApiKey && falApiKey.trim() !== '';
  const effectiveFps = videoDuration && prompts.length > 1 && videoDuration > 0 ? (prompts.length -1) / videoDuration : 0;
  const MemoizedShotsPane = React.memo(ShotsPane);
  const canGenerate = !!selectedProjectId && !!inputFile && prompts.filter(p => p.fullPrompt.trim() !== "").length > 0 && !isCreatingTask;
  const imagesToShow = showPlaceholders && (!generatedImages || generatedImages.length === 0) 
    ? Array(4).fill(null).map((_,idx) => ({id: `ph-${idx}`, url: "/placeholder.svg", prompt: "Placeholder"})) 
    : [...(generatedImages || [])].reverse();

  return (
    <div className="container mx-auto p-4 relative">
      <header className="flex justify-between items-center mb-6 sticky top-0 bg-background/90 backdrop-blur-md py-4 z-10">
        <h1 className="text-3xl font-bold">Edit Travel Tool</h1>
        <Button variant="ghost" size="icon" onClick={() => setIsSettingsModalOpen(true)} className="h-10 w-10" title="Settings">
          <Settings className="h-5 w-5" />
        </Button>
      </header>

      {!hasValidFalApiKey && (
         <div className="mb-4 p-3 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 rounded-md flex items-center">
            <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2" />
            <span>FAL API Key is not set. Please add it in Settings to enable generation.</span>
        </div>
      )}

      <EditTravelForm
        prompts={prompts}
        onManagePrompts={() => setIsPromptEditorOpen(true)}
        openaiApiKey={openaiApiKey}
        falApiKey={falApiKey}
        onFileChange={handleFileChange}
        onFileRemove={() => setInputFile(null)}
        inputFilePreviewUrl={inputFilePreviewUrl}
        inputFileName={inputFile?.name}
        isOverallGenerating={isOverallGenerating}
        videoDuration={videoDuration}
        effectiveFps={effectiveFps}
        reconstructVideo={reconstructVideo}
        onReconstructVideoChange={setReconstructVideo}
        isClientSideReconstructing={isClientSideReconstructing}
        imagesPerPrompt={imagesPerPrompt}
        onImagesPerPromptChange={setImagesPerPrompt}
        generationMode={generationMode}
        onGenerationModeChange={setGenerationMode}
        fluxSoftEdgeStrength={fluxSoftEdgeStrength}
        onFluxSoftEdgeStrengthChange={setFluxSoftEdgeStrength}
        fluxDepthStrength={fluxDepthStrength}
        onFluxDepthStrengthChange={setFluxDepthStrength}
        onGenerate={handleGenerate}
        canGenerate={canGenerate}
        isCreatingTask={isCreatingTask}
        inputFile={inputFile}
      />

      {(isOverallGenerating) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background p-8 rounded-lg shadow-2xl w-full max-w-md text-center">
              <h2 className="text-2xl font-semibold mb-4">
                {isClientSideReconstructing ? "Reconstructing Video..." : "Generating..."}
              </h2>
              <p className="mb-4">
                {isClientSideReconstructing 
                    ? "Combining edited frames and audio. This may take some time." 
                    : "Processing your request. This may take a moment."}
              </p>
              <div className="w-full bg-muted rounded-full h-2.5 mb-6 relative overflow-hidden">
                <div className="bg-primary h-2.5 rounded-full absolute animate-ping" style={{ width: `100%`, animationDuration: '1.5s'}}/>
              </div>
              <Button variant="destructive" onClick={handleCancelGeneration}>Cancel Generation</Button>
            </div>
          </div>
      )}
      
      <ImageGallery 
        images={imagesToShow}
        onDelete={(id) => deleteGenerationMutation.mutate(id)} 
        onAddToLastShot={handleAddImageToTargetShot}
        allShots={shots || []}
        lastShotId={lastAffectedShotId}
        currentToolType="edit-travel" 
        initialFilterState={true}
      />
      
      <MemoizedShotsPane />

      {isPromptEditorOpen && (
        <PromptEditorModal
          isOpen={isPromptEditorOpen}
          onClose={() => setIsPromptEditorOpen(false)}
          prompts={prompts}
          onSave={handleSavePrompts}
          generatePromptId={generatePromptId}
          apiKey={openaiApiKey || falApiKey || undefined}
        />
      )}
      
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onOpenChange={setIsSettingsModalOpen}
      />
    </div>
  );
};

export default EditTravelToolPage; 
