import React, { useState, useEffect } from 'react';
import { Shot, GenerationRow } from '../../../types/shots'; // Corrected import path
import { useUpdateShotName, useDeleteShot, useDuplicateShot } from '../../../shared/hooks/useShots'; // Import new hooks
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { Pencil, Trash2, Check, X, Copy } from 'lucide-react'; // Icons
import { toast } from 'sonner';

interface VideoShotDisplayProps {
  shot: Shot;
  onSelectShot: (shotId: string) => void;
  currentProjectId: string | null; // Needed for mutations
}

const VideoShotDisplay: React.FC<VideoShotDisplayProps> = ({ shot, onSelectShot, currentProjectId }) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editableName, setEditableName] = useState(shot.name);

  const updateShotNameMutation = useUpdateShotName();
  const deleteShotMutation = useDeleteShot();
  const duplicateShotMutation = useDuplicateShot();

  useEffect(() => {
    setEditableName(shot.name); // Reset editable name if shot prop changes
  }, [shot.name]);

  const handleNameEditToggle = () => {
    if (isEditingName) {
      // If was editing and toggling off without saving via button, consider it a cancel
      setEditableName(shot.name); // Reset to original name
    }
    setIsEditingName(!isEditingName);
  };

  const handleSaveName = async () => {
    if (!currentProjectId) {
      toast.error('Cannot update shot: Project ID is missing.');
      return;
    }
    if (editableName.trim() === '') {
      toast.error('Shot name cannot be empty.');
      setEditableName(shot.name); // Reset to original if submitted empty
      setIsEditingName(false);
      return;
    }
    if (editableName.trim() === shot.name) {
      setIsEditingName(false); // No change, just exit edit mode
      return;
    }

    try {
      await updateShotNameMutation.mutateAsync(
        { shotId: shot.id, newName: editableName.trim(), projectId: currentProjectId }, // Pass projectId
        {
          onSuccess: () => {
            toast.success(`Shot "${editableName.trim()}" updated.`);
            // Optimistic update already handles UI, or rely on query invalidation
          },
          onError: (error) => {
            toast.error(`Failed to update shot: ${error.message}`);
            setEditableName(shot.name); // Revert on error
          },
        }
      );
    } finally {
      setIsEditingName(false);
    }
  };

  const handleDeleteShot = async () => {
    if (!currentProjectId) {
      toast.error('Cannot delete shot: Project ID is missing.');
      return;
    }
    // Simple confirm, can be replaced with a nicer modal
    if (window.confirm(`Are you sure you want to delete shot "${shot.name}"?`)) {
      try {
        await deleteShotMutation.mutateAsync(
          { shotId: shot.id, projectId: currentProjectId }, // Pass projectId
          {
            onSuccess: () => {
              toast.success(`Shot "${shot.name}" deleted.`);
              // Optimistic update or query invalidation handles UI removal
            },
            onError: (error) => {
              toast.error(`Failed to delete shot: ${error.message}`);
            },
          }
        );
      } catch (error) {
        // This catch is likely redundant if mutation's onError is used, but good for safety
        console.error("Error during deleteShotMutation call:", error);
      }
    }
  };

  const handleDuplicateShot = async () => {
    if (!currentProjectId) {
      toast.error('Cannot duplicate shot: Project ID is missing.');
      return;
    }
    try {
      await duplicateShotMutation.mutateAsync({
        shotId: shot.id,
        projectId: currentProjectId,
      });
    } catch (error) {
      console.error("Error during duplicateShotMutation call:", error);
      toast.error(`Failed to duplicate shot: ${(error as Error).message}`);
    }
  };

  const imagesOnly = shot.images?.filter(image => image.type !== 'video_travel_output') || [];
  const imagesToShow: GenerationRow[] = imagesOnly.slice(0, 5);

  return (
    <div 
      key={shot.id} 
      className="mb-6 p-4 border rounded-lg hover:shadow-lg transition-shadow duration-200 relative cursor-pointer"
      onClick={() => onSelectShot(shot.id)}
    >
      <div className="flex justify-between items-start mb-3">
        {isEditingName ? (
          <div className="flex items-center gap-2 flex-grow" onClick={(e) => e.stopPropagation()}>
            <Input 
              value={editableName}
              onChange={(e) => setEditableName(e.target.value)}
              onBlur={handleSaveName} // Save on blur
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') {
                  setEditableName(shot.name);
                  setIsEditingName(false);
                }
              }}
              className="text-xl font-medium h-9"
              autoFocus
            />
            <Button variant="ghost" size="icon" onClick={handleSaveName} className="h-9 w-9">
              <Check className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleNameEditToggle} className="h-9 w-9">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <h3 
            className="text-xl font-medium hover:text-primary flex-grow mr-2"
          >
            {shot.name}
          </h3>
        )}
        <div className="flex items-center space-x-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {!isEditingName && (
             <Button variant="ghost" size="icon" onClick={handleNameEditToggle} className="h-8 w-8">
                <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleDuplicateShot} 
            className="h-8 w-8" 
            disabled={duplicateShotMutation.isPending}
            title="Duplicate shot"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDeleteShot} className="text-destructive hover:text-destructive-foreground hover:bg-destructive h-8 w-8">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      <div className="flex space-x-2 overflow-x-auto pb-2">
        {imagesToShow.length > 0 ? (
          imagesToShow.map((image, index) => (
            <div 
              key={image.shotImageEntryId || `img-${index}`} 
              className="flex-shrink-0 w-32 h-32 rounded overflow-hidden border animate-in fade-in-up"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <img 
                src={image.thumbUrl || image.imageUrl || '/placeholder.svg'} 
                alt={`Shot image ${index + 1} for ${shot.name}`}
                className="w-full h-full object-cover"
              />
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground italic">No images in this shot yet.</p>
        )}
        {imagesOnly.length > 5 && (
          <div className="flex-shrink-0 w-32 h-32 rounded border bg-muted flex items-center justify-center">
            <p className="text-sm text-muted-foreground text-center">+{imagesOnly.length - 5} more</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoShotDisplay; 