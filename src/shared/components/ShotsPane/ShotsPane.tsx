import React, { useState } from 'react';
import ShotGroup from './ShotGroup';
import NewGroupDropZone from './NewGroupDropZone';
import { useListShots } from '@/shared/hooks/useShots';
import { useProject } from "@/shared/contexts/ProjectContext";
import { useSlidingPane } from '@/shared/hooks/useSlidingPane';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { LockIcon, UnlockIcon, ArrowRightIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePanes } from '@/shared/contexts/PanesContext';
import CreateShotModal from '@/tools/video-travel/components/CreateShotModal';
import { useCreateShot, useHandleExternalImageDrop } from '@/shared/hooks/useShots';
import { useCurrentShot } from '@/shared/contexts/CurrentShotContext';
import PaneControlTab from '../PaneControlTab';

const ShotsPane: React.FC = () => {
  const { selectedProjectId } = useProject();
  const { data: shots, isLoading, error } = useListShots(selectedProjectId);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const createShotMutation = useCreateShot();
  const handleExternalImageDropMutation = useHandleExternalImageDrop();
  const navigate = useNavigate();
  const { setCurrentShotId } = useCurrentShot();

  const {
    isGenerationsPaneLocked,
    generationsPaneHeight,
    setIsShotsPaneLocked,
    shotsPaneWidth,
  } = usePanes();

  const { isLocked, isOpen, toggleLock, openPane, paneProps, transformClass, handlePaneEnter, handlePaneLeave } = useSlidingPane({
    side: 'left',
    onLockStateChange: setIsShotsPaneLocked,
  });

  const handleCreateShot = async (shotName: string, files: File[]) => {
    if (!selectedProjectId) {
      alert("Please select a project first.");
      return;
    }

    let createdShotId: string | null = null;

    if (files.length > 0) {
      const result = await handleExternalImageDropMutation.mutateAsync({
        imageFiles: files,
        targetShotId: null,
        currentProjectQueryKey: selectedProjectId,
        currentShotCount: shots?.length ?? 0
      });
      createdShotId = result?.shotId || null;
    } else {
      const newShot = await createShotMutation.mutateAsync({ shotName, projectId: selectedProjectId });
      createdShotId = newShot?.id || null;
    }

    setIsCreateModalOpen(false);

    if (createdShotId) {
      setCurrentShotId(createdShotId);
      navigate('/tools/video-travel', { state: { viaShotClick: true } });
    }
  };

  const bottomOffset = isGenerationsPaneLocked ? generationsPaneHeight : 0;

  return (
    <>
      <PaneControlTab
        side="left"
        isLocked={isLocked}
        isOpen={isOpen}
        toggleLock={toggleLock}
        openPane={openPane}
        paneDimension={shotsPaneWidth}
        bottomOffset={isGenerationsPaneLocked ? generationsPaneHeight : 0}
        handlePaneEnter={handlePaneEnter}
        handlePaneLeave={handlePaneLeave}
      />
      <div
        className="pointer-events-none"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: `${bottomOffset}px`,
          width: `${shotsPaneWidth}px`,
          zIndex: 60,
          transition: 'bottom 300ms ease-in-out',
        }}
      >
        <div
          {...paneProps}
          className={cn(
            `pointer-events-auto absolute top-0 left-0 h-full w-full bg-zinc-900/95 border-r border-zinc-700 shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col`,
            transformClass
          )}
        >
          <div className="p-2 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
            <h2 className="text-lg font-semibold text-zinc-200 ml-2">Shots</h2>
            <div className="flex items-center">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-zinc-400 hover:text-zinc-100"
                onClick={() => {
                  toggleLock(false);
                  setCurrentShotId(null);
                  navigate('/tools/video-travel');
                }}
              >
                See All
                <ArrowRightIcon className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-4 px-3 py-4 flex-grow overflow-y-auto scrollbar-hide">
            <NewGroupDropZone onZoneClick={() => setIsCreateModalOpen(true)} />
            {isLoading && <p className="text-white">Loading shots...</p>}
            {error && <p className="text-red-500">Error loading shots: {error.message}</p>}
            {shots && shots.map(shot => <ShotGroup key={`${shot.id}-${shot.images?.length || 0}`} shot={shot} />)}
          </div>
          <CreateShotModal
            isOpen={isCreateModalOpen}
            onClose={() => setIsCreateModalOpen(false)}
            onSubmit={handleCreateShot}
            isLoading={createShotMutation.isPending || handleExternalImageDropMutation.isPending}
            defaultShotName={`Shot ${(shots?.length ?? 0) + 1}`}
          />
        </div>
      </div>
    </>
  );
};

export default ShotsPane; 