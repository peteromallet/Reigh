import React from 'react';
import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { Shot } from '@/domains/generation/types';
import { SortableShotItem, type DropOptions } from './SortableShotItem';
import { type GenerationDropData } from '@/shared/lib/dnd/dragDrop';
import { useShotFinalVideos } from '../../hooks/video/useShotFinalVideos';
import {
  NewShotDropZoneCard,
  PendingSkeletonShotCard,
  ShotListEmptyState,
  ShotListErrorState,
  ShotListLoadingState,
} from './components/ShotListDisplayStates';
import { useShotListDisplayController } from './hooks/useShotListDisplayController';

interface ShotListDisplayProps {
  readOnly?: boolean;
  projectId: string;
  onSelectShot: (shot: Shot) => void;
  onCreateNewShot?: () => void;
  shots?: Shot[];
  isHidden?: (shot: Shot) => boolean;
  onToggleHidden?: (shot: Shot) => void;
  sortMode?: 'ordered' | 'newest' | 'oldest';
  onSortModeChange?: (mode: 'ordered' | 'newest' | 'oldest') => void;
  highlightedShotId?: string | null;
  onGenerationDropOnShot?: (shotId: string, data: GenerationDropData, options?: DropOptions) => Promise<void>;
  onGenerationDropForNewShot?: (data: GenerationDropData) => Promise<void>;
  onFilesDropForNewShot?: (files: File[]) => Promise<void>;
  onFilesDropOnShot?: (shotId: string, files: File[], options?: DropOptions) => Promise<void>;
  onSkeletonSetupReady?: (setup: (imageCount: number) => void, clear: () => void) => void;
}

export const ShotListDisplay: React.FC<ShotListDisplayProps> = ({
  readOnly = false,
  projectId,
  onSelectShot,
  onCreateNewShot,
  shots: propShots,
  isHidden,
  onToggleHidden,
  sortMode = 'ordered',
  onSortModeChange,
  highlightedShotId,
  onGenerationDropOnShot,
  onGenerationDropForNewShot,
  onFilesDropForNewShot,
  onFilesDropOnShot,
  onSkeletonSetupReady,
}) => {
  const {
    shotsLoading,
    shotsError,
    shots,
    currentProject,
    effectiveProjectId,
    sensors,
    handleDragStart,
    handleDragEnd,
    sortableItems,
    pendingNewShot,
    isDragDisabled,
  } = useShotListDisplayController({
    projectId,
    shots: propShots,
    sortMode,
    onGenerationDropForNewShot,
    onFilesDropForNewShot,
    onSkeletonSetupReady,
  });

  const { finalVideoMap } = useShotFinalVideos(effectiveProjectId);

  if (shotsLoading || shots === undefined) {
    return <ShotListLoadingState />;
  }

  if (shotsError) {
    return <ShotListErrorState errorMessage={shotsError.message} onCreateNewShot={onCreateNewShot} />;
  }

  if (!shots || shots.length === 0) {
    return <ShotListEmptyState onCreateNewShot={onCreateNewShot} />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sortableItems}
        strategy={rectSortingStrategy}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-x-6 md:gap-y-5 pb-6 md:pb-8 px-4 pt-4 pb-2">
          {(onGenerationDropForNewShot || onFilesDropForNewShot) && (
            <NewShotDropZoneCard
              isNewShotProcessing={pendingNewShot.isNewShotProcessing}
              isNewShotDropTarget={pendingNewShot.isNewShotDropTarget}
              newShotDropType={pendingNewShot.newShotDropType}
              onDragEnter={pendingNewShot.handleNewShotDragEnter}
              onDragOver={pendingNewShot.handleNewShotDragOver}
              onDragLeave={pendingNewShot.handleNewShotDragLeave}
              onDrop={pendingNewShot.handleNewShotDrop}
              onClick={pendingNewShot.isNewShotProcessing ? undefined : onCreateNewShot}
            />
          )}

          {pendingNewShot.pendingSkeletonShot && (
            <PendingSkeletonShotCard pendingSkeletonShot={pendingNewShot.pendingSkeletonShot} />
          )}

          {shots.map((shot, index) => {
            return (
              <SortableShotItem
                key={shot.id}
                shot={shot}
                onSelectShot={() => onSelectShot(shot)}
                onDuplicateShot={() => onSortModeChange?.('newest')}
                isHidden={isHidden?.(shot) ?? false}
                onToggleHidden={onToggleHidden ? () => onToggleHidden(shot) : undefined}
                currentProjectId={effectiveProjectId}
                isDragDisabled={isDragDisabled}
                disabledReason={sortMode !== 'ordered' ? 'Only available in ordered mode' : undefined}
                shouldLoadImages={true}
                shotIndex={index}
                projectAspectRatio={currentProject?.aspectRatio}
                isHighlighted={highlightedShotId === shot.id}
                onGenerationDrop={readOnly ? undefined : onGenerationDropOnShot}
                onFilesDrop={readOnly ? undefined : onFilesDropOnShot}
                readOnly={readOnly}
                initialPendingUploads={shot.id === pendingNewShot.newlyCreatedShotId ? pendingNewShot.newlyCreatedShotExpectedImages : 0}
                initialPendingBaselineNonVideoCount={shot.id === pendingNewShot.newlyCreatedShotId ? pendingNewShot.newlyCreatedShotBaselineNonVideoCount : undefined}
                onInitialPendingUploadsConsumed={shot.id === pendingNewShot.newlyCreatedShotId ? pendingNewShot.clearNewlyCreatedShot : undefined}
                dataTour={index === 0 ? 'first-shot' : undefined}
                finalVideo={finalVideoMap.get(shot.id)}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
};
