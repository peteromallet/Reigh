import React, { useState, useEffect } from 'react';
import ShotEditor, { SteerableMotionSettings } from '../components/ShotEditor';
import { useListShots, useCreateShot, useHandleExternalImageDrop } from '@/shared/hooks/useShots';
import { Shot } from '@/types/shots';
import { Button } from '@/shared/components/ui/button';
import { useProject } from "@/shared/contexts/ProjectContext";
import CreateShotModal from '../components/CreateShotModal';
import ShotListDisplay from '../components/ShotListDisplay';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentShot } from '@/shared/contexts/CurrentShotContext';
import { LoraModel } from '@/shared/components/LoraSelectorModal';
// import { useLastAffectedShot } from '@/shared/hooks/useLastAffectedShot';

// Placeholder data or logic to fetch actual data for VideoEditLayout
// This will need to be fleshed out based on VideoEditLayout's requirements
export interface ActiveLora {
  id: string;
  name: string;
  path: string;
  strength: number;
  previewImageUrl?: string;
}

const VideoTravelToolPage: React.FC = () => {
  const { selectedProjectId } = useProject();
  const { data: shots, isLoading, error, refetch: refetchShots } = useListShots(selectedProjectId);
  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);
  const { currentShotId, setCurrentShotId } = useCurrentShot();
  const createShotMutation = useCreateShot();
  const handleExternalImageDropMutation = useHandleExternalImageDrop();
  const [isCreateShotModalOpen, setIsCreateShotModalOpen] = useState(false);
  const queryClient = useQueryClient();
  // const { lastAffectedShotId, setLastAffectedShotId } = useLastAffectedShot(); // Keep for later if needed
  const [isLoraModalOpen, setIsLoraModalOpen] = useState(false);
  const [availableLoras, setAvailableLoras] = useState<LoraModel[]>([]);
  const [selectedLoras, setSelectedLoras] = useState<ActiveLora[]>([]);

  // Add state for video generation settings
  const [videoControlMode, setVideoControlMode] = useState<'individual' | 'batch'>('batch');
  const [batchVideoPrompt, setBatchVideoPrompt] = useState('');
  const [batchVideoFrames, setBatchVideoFrames] = useState(30);
  const [batchVideoContext, setBatchVideoContext] = useState(10);
  const [batchVideoSteps, setBatchVideoSteps] = useState(4);
  const [dimensionSource, setDimensionSource] = useState<'project' | 'firstImage' | 'custom'>('firstImage');
  const [customWidth, setCustomWidth] = useState<number | undefined>();
  const [customHeight, setCustomHeight] = useState<number | undefined>();
  const [enhancePrompt, setEnhancePrompt] = useState<boolean>(false);
  const [videoPairConfigs, setVideoPairConfigs] = useState<any[]>([]);
  const [steerableMotionSettings, setSteerableMotionSettings] = useState<SteerableMotionSettings>({
    negative_prompt: '',
    model_name: 'vace_14B',
    seed: 789,
    debug: true,
    apply_reward_lora: false,
    colour_match_videos: true,
    apply_causvid: true,
    fade_in_duration: '{"low_point":0.0,"high_point":1.0,"curve_type":"ease_in_out","duration_factor":0.0}',
    fade_out_duration: '{"low_point":0.0,"high_point":1.0,"curve_type":"ease_in_out","duration_factor":0.0}',
    after_first_post_generation_saturation: 1,
    after_first_post_generation_brightness: 0,
  });

  useEffect(() => {
    fetch('/data/loras.json')
      .then(response => response.json())
      .then(data => {
        const allLoras = Object.values(data).flat();
        setAvailableLoras(allLoras as LoraModel[]);
      })
      .catch(error => console.error("Error fetching LoRA data:", error));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      if (selectedShot) {
        setSelectedShot(null);
        setVideoPairConfigs([]);
        setCurrentShotId(null);
      }
      return;
    }
    if (shots) {
      if (selectedShot) {
        const updatedShotFromList = shots.find(s => s.id === selectedShot.id && s.project_id === selectedProjectId);
        if (updatedShotFromList) {
          if (JSON.stringify(selectedShot) !== JSON.stringify(updatedShotFromList)) {
            setSelectedShot(updatedShotFromList);
          }
        } else {
          setSelectedShot(null);
          setVideoPairConfigs([]);
          setCurrentShotId(null);
        }
      }
    } else if (!isLoading && selectedShot) {
      setSelectedShot(null);
      setVideoPairConfigs([]);
      setCurrentShotId(null);
    }
  }, [shots, selectedShot, selectedProjectId, isLoading, setCurrentShotId]);

  useEffect(() => {
    if (selectedShot?.images && selectedShot.images.length >= 2) {
      const nonVideoImages = selectedShot.images.filter(img => !img.type?.includes('video'));
      if (nonVideoImages.length >= 2) {
        const pairs = [];
        for (let i = 0; i < nonVideoImages.length - 1; i++) {
          pairs.push({
            id: `${nonVideoImages[i].id}_${nonVideoImages[i + 1].id}`,
            imageA: nonVideoImages[i],
            imageB: nonVideoImages[i + 1],
            prompt: '',
            frames: 30,
            context: 10,
          });
        }
        setVideoPairConfigs(pairs);
      }
    }
  }, [selectedShot?.images]);

  // Auto-select shot if currentShotId is set and shot is available
  useEffect(() => {
    // Case 1: No current shot ID - clear selection
    if (!currentShotId) {
      if (selectedShot) {
        setSelectedShot(null);
        setVideoPairConfigs([]);
      }
      return;
    }

    // Case 2: Wait for shots to load
    if (!shots) {
      return;
    }

    // Case 3: Only update if we need to select a different shot
    if (selectedShot?.id !== currentShotId) {
      const shotToSelect = shots.find(shot => shot.id === currentShotId);
      if (shotToSelect) {
        setSelectedShot(shotToSelect);
      } else {
        // Shot not found, clear selection
        setSelectedShot(null);
        setVideoPairConfigs([]);
      }
    }
  }, [currentShotId, shots]); // Removed selectedShot from deps to avoid loops

  const handleShotSelect = (shot: Shot) => {
    setSelectedShot(shot);
    setCurrentShotId(shot.id);
  };

  const handleBackToShotList = () => {
    setSelectedShot(null);
    setVideoPairConfigs([]);
    setCurrentShotId(null);
  };

  const handleModalSubmitCreateShot = async (name: string, files: File[]) => {
    if (!selectedProjectId) {
      console.error("[VideoTravelToolPage] Cannot create shot: No project selected");
      return;
    }

    try {
      let newShot: Shot;
      
      if (files.length > 0) {
        // Use the multi-purpose hook if there are files
        const result = await handleExternalImageDropMutation.mutateAsync({
          imageFiles: files, 
          targetShotId: null, 
          currentProjectQueryKey: selectedProjectId, 
          currentShotCount: shots?.length ?? 0
        });
        
        if (result?.shotId) {
          // Find the created shot from the shots list after refetching
          const { data: updatedShots } = await refetchShots();
          const createdShot = updatedShots?.find(s => s.id === result.shotId);
          if (createdShot) {
            newShot = createdShot;
          } else {
            throw new Error("Created shot not found after refetch");
          }
        } else {
          throw new Error("Failed to create shot with files");
        }
      } else {
        // Otherwise, just create an empty shot
        newShot = await createShotMutation.mutateAsync({
          shotName: name,
          projectId: selectedProjectId,
        });
        
        // Refetch shots to update the list
        await refetchShots();
      }
      
      // Select the newly created shot
      setSelectedShot(newShot);
      setCurrentShotId(newShot.id);
      
      // Close the modal
      setIsCreateShotModalOpen(false);
    } catch (error) {
      console.error("[VideoTravelToolPage] Error creating shot:", error);
    }
  };

  const handleShotImagesUpdate = () => {
    if (selectedProjectId && selectedShot?.id) {
      // Invalidate and refetch the shots query to get updated data
      queryClient.invalidateQueries({ queryKey: ['shots', selectedProjectId] });
    }
  };

  const handleSteerableMotionSettingsChange = (settings: Partial<typeof steerableMotionSettings>) => {
    setSteerableMotionSettings(prev => ({
      ...prev,
      ...settings
    }));
  };

  const handleAddLora = (loraToAdd: LoraModel) => {
    if (selectedLoras.find(sl => sl.id === loraToAdd["Model ID"])) {
      console.log(`LoRA already added.`);
      return;
    }
    if (loraToAdd["Model Files"] && loraToAdd["Model Files"].length > 0) {
      setSelectedLoras(prevLoras => [
        ...prevLoras,
        {
          id: loraToAdd["Model ID"],
          name: loraToAdd.Name !== "N/A" ? loraToAdd.Name : loraToAdd["Model ID"],
          path: loraToAdd["Model Files"][0].url,
          strength: 1.0,
          previewImageUrl: loraToAdd.Images && loraToAdd.Images.length > 0 ? loraToAdd.Images[0].url : undefined,
        },
      ]);
      console.log(`LoRA added.`);
    } else {
      console.error("Selected LoRA has no model file specified.");
    }
  };

  const handleRemoveLora = (loraIdToRemove: string) => {
    setSelectedLoras(prevLoras => prevLoras.filter(lora => lora.id !== loraIdToRemove));
  };

  const handleLoraStrengthChange = (loraId: string, newStrength: number) => {
    setSelectedLoras(prevLoras =>
      prevLoras.map(lora => (lora.id === loraId ? { ...lora, strength: newStrength } : lora))
    );
  };

  if (!selectedProjectId) {
    return <div className="p-4">Please select a project first.</div>;
  }

  if (error) {
    return <div className="p-4">Error loading shots: {error.message}</div>;
  }

  return (
    <div className="container mx-auto p-4">
      {!selectedShot ? (
        <>
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">Video Travel Tool</h1>
            <Button onClick={() => setIsCreateShotModalOpen(true)}>Create New Shot</Button>
          </div>
          <ShotListDisplay
            shots={shots || []}
            onSelectShot={handleShotSelect}
            currentProjectId={selectedProjectId}
          />
        </>
      ) : (
        <ShotEditor
          selectedShot={selectedShot}
          projectId={selectedProjectId}
          videoPairConfigs={videoPairConfigs}
          videoControlMode={videoControlMode}
          batchVideoPrompt={batchVideoPrompt}
          batchVideoFrames={batchVideoFrames}
          batchVideoContext={batchVideoContext}
          orderedShotImages={selectedShot.images || []}
          onShotImagesUpdate={handleShotImagesUpdate}
          onBack={handleBackToShotList}
          onVideoControlModeChange={setVideoControlMode}
          onPairConfigChange={(pairId, field, value) => {
            setVideoPairConfigs(prev => prev.map(p => p.id === pairId ? { ...p, [field]: value } : p));
          }}
          onBatchVideoPromptChange={setBatchVideoPrompt}
          onBatchVideoFramesChange={setBatchVideoFrames}
          onBatchVideoContextChange={setBatchVideoContext}
          batchVideoSteps={batchVideoSteps}
          onBatchVideoStepsChange={setBatchVideoSteps}
          dimensionSource={dimensionSource}
          onDimensionSourceChange={setDimensionSource}
          customWidth={customWidth}
          onCustomWidthChange={setCustomWidth}
          customHeight={customHeight}
          onCustomHeightChange={setCustomHeight}
          steerableMotionSettings={steerableMotionSettings}
          onSteerableMotionSettingsChange={handleSteerableMotionSettingsChange}
          onGenerateAllSegments={() => {}}
          selectedLoras={selectedLoras}
          onAddLora={handleAddLora}
          onRemoveLora={handleRemoveLora}
          onLoraStrengthChange={handleLoraStrengthChange}
          availableLoras={availableLoras}
          isLoraModalOpen={isLoraModalOpen}
          setIsLoraModalOpen={setIsLoraModalOpen}
          enhancePrompt={enhancePrompt}
          onEnhancePromptChange={setEnhancePrompt}
        />
      )}

      <CreateShotModal 
        isOpen={isCreateShotModalOpen}
        onClose={() => setIsCreateShotModalOpen(false)}
        onSubmit={handleModalSubmitCreateShot}
        isLoading={createShotMutation.isPending || handleExternalImageDropMutation.isPending}
        defaultShotName={`Shot ${(shots?.length ?? 0) + 1}`}
      />
    </div>
  );
};

export default VideoTravelToolPage; 