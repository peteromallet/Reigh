import React from 'react';
import { GenerationRow } from '@/domains/generation/types';
import { FinalVideoSection } from '../FinalVideoSection';
import { ShotSettingsProvider, ShotSettingsContextValue } from './ShotSettingsContext';
import { HeaderSection } from './sections/HeaderSection';
import type { HeaderSectionCallbacks, HeaderSectionLayout } from './sections/headerSectionTypes';
import { TimelineSection } from './sections/TimelineSection';
import { ModalsSection } from './sections/ModalsSection';
import { GenerationSection } from './sections/GenerationSection';
import type { LoraModel } from '@/domains/lora/types/lora';
import type { ModalSelectedLora } from './types/modalLora';
import {
  getModelSpec,
  resolveGenerationPolicy,
  type SelectedModel,
} from '@/tools/travel-between-images/settings';

export interface ShotEditorLayoutProps {
  contextValue: ShotSettingsContextValue;
  header: HeaderSectionCallbacks & HeaderSectionLayout;

  finalVideo: {
    readOnly?: boolean;
    selectedShotId: string;
    projectId: string;
    effectiveAspectRatio?: string;
    onApplySettingsFromTask?: (taskId: string, replaceImages: boolean, inputImages: string[]) => void;
    onJoinSegmentsClick: () => void;
    selectedOutputId: string | null;
    onSelectedOutputChange: (id: string | null) => void;
    parentGenerations: GenerationRow[];
    initialParentGenerations: GenerationRow[];
    segmentProgress?: { completed: number; total: number };
    isSegmentOutputsLoading: boolean;
    getFinalVideoCount?: (shotId: string | null) => number | null;
    onDeleteFinalVideo: (generationId: string) => void;
    isClearingFinalVideo: boolean;
    videoGalleryRef: React.RefObject<HTMLDivElement>;
    generateVideosCardRef: React.RefObject<HTMLDivElement>;
  };

  timeline: {
    readOnly?: boolean;
    timelineSectionRef?: (node: HTMLDivElement | null) => void;
    isModeReady: boolean;
    settingsError: string | null;
    isPhone: boolean;
    generationMode?: 'batch' | 'timeline' | 'by-pair';
    onGenerationModeChange?: (mode: 'batch' | 'timeline' | 'by-pair') => void;
    batchVideoFrames: number;
    onBatchVideoFramesChange: (frames: number) => void;
    aspectAdjustedColumns: 2 | 3 | 4 | 6;
    pendingFramePositions: Map<string, number>;
    onPendingPositionApplied: (generationId: string) => void;
    onSelectionChange: (hasSelection: boolean) => void;
    prompt: string;
    onPromptChange: (prompt: string) => void;
    negativePrompt: string;
    onNegativePromptChange: (prompt: string) => void;
    selectedModel: SelectedModel;
    generationTypeMode: 'i2v' | 'vace';
    smoothContinuations?: boolean;
    onDragStateChange?: (isDragging: boolean) => void;
    getHasStructureVideo?: (shotId: string | null) => boolean | null;
  };

  generation: {
    readOnly?: boolean;
    ctaContainerRef?: (node: HTMLDivElement | null) => void;
    swapButtonRef: React.RefObject<HTMLButtonElement>;
    joinSegmentsSectionRef: React.RefObject<HTMLDivElement>;
    parentVariantName?: string;
    parentOnVariantNameChange?: (name: string) => void;
    parentIsGeneratingVideo?: boolean;
    parentVideoJustQueued?: boolean;
  };

  modals: {
    isLoraModalOpen: boolean;
    onLoraModalClose: () => void;
    onAddLora: (lora: LoraModel, isManualAction?: boolean, initialStrength?: number) => void;
    onRemoveLora: (loraId: string) => void;
    onUpdateLoraStrength: (loraId: string, strength: number) => void;
    selectedLoras: ModalSelectedLora[];
    selectedModel: SelectedModel;
    isSettingsModalOpen: boolean;
    onSettingsModalOpenChange: (open: boolean) => void;
  };
}

export const ShotEditorLayout: React.FC<ShotEditorLayoutProps> = ({
  contextValue,
  header,
  finalVideo,
  timeline,
  generation,
  modals,
}) => {
  const timelinePolicy = resolveGenerationPolicy(getModelSpec(timeline.selectedModel), {
    smoothContinuations: timeline.smoothContinuations ?? false,
    requestedExecutionMode: timeline.generationTypeMode,
  });

  return (
    <ShotSettingsProvider value={contextValue}>
      <div className="flex flex-col gap-y-4 pb-4">
        <HeaderSection
          callbacks={{
            onBack: header.onBack,
            onPreviousShot: header.onPreviousShot,
            onNextShot: header.onNextShot,
            hasPrevious: header.hasPrevious,
            hasNext: header.hasNext,
            onUpdateShotName: header.onUpdateShotName,
            onNameClick: header.onNameClick,
            onNameSave: header.onNameSave,
            onNameCancel: header.onNameCancel,
            onNameKeyDown: header.onNameKeyDown,
          }}
          layout={{
            headerContainerRef: header.headerContainerRef,
            centerSectionRef: header.centerSectionRef,
            isSticky: header.isSticky,
            readOnly: header.readOnly,
          }}
        />

        <div ref={finalVideo.videoGalleryRef} className="flex flex-col gap-4">
          <fieldset disabled={Boolean(finalVideo.readOnly)} className={finalVideo.readOnly ? 'opacity-70' : undefined}>
            <FinalVideoSection
            shotId={finalVideo.selectedShotId}
            projectId={finalVideo.projectId}
            projectAspectRatio={finalVideo.effectiveAspectRatio}
            onApplySettingsFromTask={finalVideo.onApplySettingsFromTask}
            onJoinSegmentsClick={finalVideo.onJoinSegmentsClick}
            selectedParentId={finalVideo.selectedOutputId}
            onSelectedParentChange={finalVideo.onSelectedOutputChange}
            parentGenerations={finalVideo.parentGenerations.length > 0 ? finalVideo.parentGenerations : finalVideo.initialParentGenerations}
            segmentProgress={finalVideo.segmentProgress}
            isParentLoading={finalVideo.isSegmentOutputsLoading && finalVideo.initialParentGenerations.length === 0}
            getFinalVideoCount={finalVideo.getFinalVideoCount}
            onDelete={finalVideo.onDeleteFinalVideo}
            isDeleting={finalVideo.isClearingFinalVideo}
            />
          </fieldset>
        </div>

        <div className="flex flex-col gap-4">
          <TimelineSection
            readOnly={timeline.readOnly}
            timelineSectionRef={timeline.timelineSectionRef}
            isModeReady={timeline.isModeReady}
            settingsError={timeline.settingsError}
            isMobile={timeline.isPhone}
            generationMode={timeline.generationMode}
            onGenerationModeChange={timeline.onGenerationModeChange}
            batchVideoFrames={timeline.batchVideoFrames}
            onBatchVideoFramesChange={timeline.onBatchVideoFramesChange}
            columns={timeline.aspectAdjustedColumns}
            pendingPositions={timeline.pendingFramePositions}
            onPendingPositionApplied={timeline.onPendingPositionApplied}
            onSelectionChange={timeline.onSelectionChange}
            defaultPrompt={timeline.prompt}
            onDefaultPromptChange={timeline.onPromptChange}
            defaultNegativePrompt={timeline.negativePrompt}
            onDefaultNegativePromptChange={timeline.onNegativePromptChange}
            maxFrameLimit={timelinePolicy.continuation.enabled
              ? timelinePolicy.continuation.maxOutputFrames
              : getModelSpec(timeline.selectedModel).maxFrames}
            smoothContinuations={timeline.smoothContinuations}
            selectedOutputId={finalVideo.selectedOutputId}
            onSelectedOutputChange={finalVideo.onSelectedOutputChange}
            onDragStateChange={timeline.onDragStateChange}
            cachedHasStructureVideo={timeline.getHasStructureVideo?.(finalVideo.selectedShotId) ?? false}
          />

          <GenerationSection
            readOnly={generation.readOnly}
            refs={{
              generateVideosCardRef: finalVideo.generateVideosCardRef,
              ctaContainerRef: generation.ctaContainerRef,
              swapButtonRef: generation.swapButtonRef,
              joinSegmentsSectionRef: generation.joinSegmentsSectionRef,
            }}
            cta={{
              parentVariantName: generation.parentVariantName,
              parentOnVariantNameChange: generation.parentOnVariantNameChange,
              parentIsGeneratingVideo: generation.parentIsGeneratingVideo,
              parentVideoJustQueued: generation.parentVideoJustQueued,
            }}
          />
        </div>

        <ModalsSection
          isLoraModalOpen={modals.isLoraModalOpen}
          onLoraModalClose={modals.onLoraModalClose}
          onAddLora={modals.onAddLora}
          onRemoveLora={modals.onRemoveLora}
          onUpdateLoraStrength={modals.onUpdateLoraStrength}
          selectedLoras={modals.selectedLoras}
          selectedModel={modals.selectedModel}
          isSettingsModalOpen={modals.isSettingsModalOpen}
          onSettingsModalOpenChange={modals.onSettingsModalOpenChange}
        />
      </div>
    </ShotSettingsProvider>
  );
};
