import React, { useState, useEffect, useMemo, useContext } from 'react';
import { useProject } from '@/shared/contexts/ProjectContext';
import { useListAllGenerations, useDeleteGeneration } from '@/shared/hooks/useGenerations';
import ImageGallery from '@/shared/components/ImageGallery';
import { useListShots, useAddImageToShot } from '@/shared/hooks/useShots';
import { LastAffectedShotContext } from '@/shared/contexts/LastAffectedShotContext';
import { Button } from '@/shared/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const GENERATIONS_PER_PAGE = 48; // Show more on the full page

const GenerationsPage: React.FC = () => {
  const { selectedProjectId } = useProject();
  const [page, setPage] = useState(1);
  const { data: allGenerations, isLoading, isError, error } = useListAllGenerations(selectedProjectId);
  const { data: shotsData } = useListShots(selectedProjectId);
  const lastAffectedShotContext = useContext(LastAffectedShotContext);
  const { lastAffectedShotId = null, setLastAffectedShotId = () => {} } = lastAffectedShotContext || {};
  const queryClient = useQueryClient();
  const addImageToShotMutation = useAddImageToShot();
  const deleteGenerationMutation = useDeleteGeneration();

  // Client-side pagination
  const paginatedData = useMemo(() => {
    if (!allGenerations) return { items: [], totalPages: 0, currentPage: page };
    
    const startIndex = (page - 1) * GENERATIONS_PER_PAGE;
    const endIndex = startIndex + GENERATIONS_PER_PAGE;
    const items = allGenerations.slice(startIndex, endIndex);
    const totalPages = Math.ceil(allGenerations.length / GENERATIONS_PER_PAGE);
    
    return { items, totalPages, currentPage: page };
  }, [allGenerations, page]);

  useEffect(() => {
    // If there is no "last affected shot" but there are shots available,
    // default to the first shot in the list (which is the most recent).
    if (!lastAffectedShotId && shotsData && shotsData.length > 0) {
      setLastAffectedShotId(shotsData[0].id);
    }
  }, [lastAffectedShotId, shotsData, setLastAffectedShotId]);

  const handleDeleteGeneration = (id: string) => {
    deleteGenerationMutation.mutate(id);
  };

  const handleAddToShot = (generationId: string, imageUrl?: string) => {
    if (!lastAffectedShotId) {
      toast.error("No shot selected", {
        description: "Please select a shot in the gallery or create one first.",
      });
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      addImageToShotMutation.mutate({
        shot_id: lastAffectedShotId,
        generation_id: generationId,
        project_id: selectedProjectId!,
      }, {
        onSuccess: () => {
          toast.success("Image added to shot");
          resolve(true);
        },
        onError: (error) => {
          toast.error("Failed to add image to shot", {
            description: error.message,
          });
          resolve(false);
        }
      });
    });
  };

  const handleNextPage = () => {
    if (page < paginatedData.totalPages) {
      setPage(page + 1);
    }
  };

  const handlePrevPage = () => {
    setPage(Math.max(1, page - 1));
  };

  // Reset to page 1 when project changes
  useEffect(() => {
    setPage(1);
  }, [selectedProjectId]);

  if (!selectedProjectId) {
    return <div className="container mx-auto p-4 text-center">Please select a project to view generations.</div>;
  }

  return (
    <div className="container mx-auto p-4 flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">All Generations</h1>
        {/* Pagination Controls */}
        {paginatedData.totalPages > 1 && (
          <div className="flex items-center space-x-2">
              <span className="text-sm text-zinc-600">
                  Page {paginatedData.currentPage} of {paginatedData.totalPages}
              </span>
              <Button variant="outline" size="sm" onClick={handlePrevPage} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                  Previous
              </Button>
              <Button variant="outline" size="sm" onClick={handleNextPage} disabled={page >= paginatedData.totalPages}>
                  Next
                  <ChevronRight className="h-4 w-4" />
              </Button>
          </div>
        )}
      </div>
      
      {isLoading && <div className="text-center py-10">Loading generations...</div>}
      {isError && <div className="text-center py-10 text-red-500">Error loading generations: {error?.message}</div>}
      
      {paginatedData.items.length > 0 ? (
        <div className="flex-grow">
          <ImageGallery
            images={paginatedData.items}
            onDelete={handleDeleteGeneration}
            isDeleting={deleteGenerationMutation.isPending ? deleteGenerationMutation.variables as string : null}
            allShots={shotsData || []}
            lastShotId={lastAffectedShotId || undefined}
            onAddToLastShot={handleAddToShot}
            offset={(page - 1) * GENERATIONS_PER_PAGE}
            totalCount={allGenerations?.length || paginatedData.items.length}
          />
        </div>
      ) : (
        !isLoading && <div className="text-center py-10 text-zinc-500">No generations found for this project.</div>
      )}
    </div>
  );
};

export default GenerationsPage; 