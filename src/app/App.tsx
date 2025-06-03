import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { Toaster as Sonner } from "@/shared/components/ui/sonner";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useHandleExternalImageDrop, useCreateShot, useAddImageToShot, useListShots } from "@/shared/hooks/useShots";
import { NEW_GROUP_DROPPABLE_ID } from '@/shared/components/ShotsPane/NewGroupDropZone';
import { useToast } from "@/shared/hooks/use-toast";
import { LastAffectedShotProvider } from "@/shared/contexts/LastAffectedShotContext";
import { useLastAffectedShot } from "@/shared/hooks/useLastAffectedShot";
import { AppRoutes } from "./routes";
import { ProjectProvider, useProject } from "@/shared/contexts/ProjectContext";

const queryClient = new QueryClient();

// New inner component that uses the context
const AppInternalContent = () => {
  const { setLastAffectedShotId } = useLastAffectedShot();
  const { selectedProjectId } = useProject();
  const { data: shotsFromHook, isLoading: isLoadingShots } = useListShots(selectedProjectId);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const { toast } = useToast();
  
  const createShotMutation = useCreateShot();
  const addImageToShotMutation = useAddImageToShot();
  const { handleDrop: handleExternalImageDrop } = useHandleExternalImageDrop();

  const handleDragEnd = async (event: DragEndEvent) => {
    console.log('handleDragEnd triggered.', {
      activeId: event.active?.id,
      overId: event.over?.id,
    });
    const { active, over } = event;

    if (!selectedProjectId) {
      toast({ title: "Action failed", description: "No project selected. Please select a project first.", variant: "destructive" });
      return;
    }

    if (!over) {
      return;
    }

    const draggableItem = active.data.current;
    const droppableZone = over.data.current;

    if (!draggableItem || !droppableZone) {
      console.warn('Drag and drop data missing', { active, over });
      return;
    }

    const generationId = draggableItem.generationId;
    const imageUrl = draggableItem.imageUrl;
    const thumbUrl = draggableItem.thumbUrl;
    const isExternalFile = draggableItem.isExternalFile;
    const externalFile = draggableItem.externalFile;

    if (isExternalFile && externalFile) {
      if (droppableZone.type === 'new-group-zone' || droppableZone.type === 'shot-group') {
        const targetShotId = droppableZone.type === 'shot-group' ? droppableZone.shotId : null;
        const currentShotsCount = shotsFromHook?.length || 0;
        
        const result = await handleExternalImageDrop(externalFile, targetShotId, selectedProjectId, currentShotsCount);
        if (result && result.shotId) {
          setLastAffectedShotId(result.shotId);
        }
        return;
      }
    }

    if (!generationId) {
      console.warn('generationId missing from draggable item', draggableItem);
      return;
    }

    console.log(`Attempting to process drop: generationId=${generationId}, droppableType=${droppableZone.type}, droppableId=${over.id}, shotId=${droppableZone.shotId}`);

    try {
      if (droppableZone.type === 'shot-group') {
        const shotId = droppableZone.shotId;
        if (!shotId) {
          console.warn('shotId missing from shot-group droppable', droppableZone);
          return;
        }
        await addImageToShotMutation.mutateAsync({ 
          shot_id: shotId, 
          generation_id: generationId,
          imageUrl: imageUrl,
          thumbUrl: thumbUrl,
          project_id: selectedProjectId,
        });
        setLastAffectedShotId(shotId);

      } else if (over.id === NEW_GROUP_DROPPABLE_ID && droppableZone.type === 'new-group-zone') {
        const currentShotCount = shotsFromHook ? shotsFromHook.length : 0;
        const newShotName = `Shot ${currentShotCount + 1}`;
        
        const newShot = await createShotMutation.mutateAsync({ shotName: newShotName, projectId: selectedProjectId });
        if (newShot && newShot.id) {
          await addImageToShotMutation.mutateAsync({ 
            shot_id: newShot.id,
            generation_id: generationId,
            imageUrl: imageUrl,
            thumbUrl: thumbUrl,
            project_id: selectedProjectId,
          });
          setLastAffectedShotId(newShot.id);
        } else {
          throw new Error('Failed to create new shot or new shot ID is missing.');
        }
      }
    } catch (error) {
      console.error('Error handling drop:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      toast({ title: "Failed to process drop.", description: errorMessage, variant: "destructive" });
    }
  };

  return (
    <TooltipProvider>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <AppRoutes />
        <Sonner />
      </DndContext>
    </TooltipProvider>
  );
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LastAffectedShotProvider>
        <ProjectProvider>
          <AppInternalContent />
        </ProjectProvider>
      </LastAffectedShotProvider>
    </QueryClientProvider>
  );
}

export default App;
