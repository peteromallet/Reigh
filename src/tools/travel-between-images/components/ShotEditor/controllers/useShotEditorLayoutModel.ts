import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { GenerationRow, Shot } from '@/domains/generation/types';
import type { Project } from '@/types/project';
import type { ShotSettingsContextValue } from '../ShotSettingsContext';
import type { ShotEditorLayoutProps } from '../ShotEditorLayout';
import type { ShotEditorProps, ShotEditorState } from '../state/types';
import type { ShotEditorActions } from '../state/useShotEditorState';
import type { SelectedModel } from '@/tools/travel-between-images/settings';
import {
  type UseShotSettingsValueProps,
} from '../hooks/editor-state/useShotSettingsValue';
import type { useShotEditorMediaAndOutputControllers } from './useShotEditorMediaAndOutputControllers';

type MediaEditingState = ReturnType<
  typeof useShotEditorMediaAndOutputControllers
>['editing']['mediaEditing'];
type JoinWorkflowState = ReturnType<
  typeof useShotEditorMediaAndOutputControllers
>['editing']['joinWorkflow'];
type OutputState = ReturnType<typeof useShotEditorMediaAndOutputControllers>['output'];

interface PromptSettingsSlice {
  prompt: string;
  setPrompt: (prompt: string) => void;
  negativePrompt: string;
  setNegativePrompt: (prompt: string) => void;
}

interface MotionSettingsSlice {
  smoothContinuations?: boolean;
}

interface FrameSettingsSlice {
  batchVideoFrames: number;
  setFrames: (frames: number) => void;
}

interface ModelSettingsSlice {
  selectedModel: SelectedModel;
}

interface GenerationModeSettingsSlice {
  generationMode: 'batch' | 'timeline' | 'by-pair';
  setGenerationMode: (mode: 'batch' | 'timeline' | 'by-pair') => void;
}

interface PhaseConfigSettingsSlice {
  generationTypeMode: 'i2v' | 'vace';
}

interface UseShotEditorLayoutModelParams {
  core: {
    selectedShot: Shot | undefined;
    selectedShotId: string;
    projectId: string;
    selectedProjectId: string;
    effectiveAspectRatio: string | undefined;
    projects: Project[];
    state: ShotEditorState;
    actions: ShotEditorActions;
    queryClient: QueryClient;
  };
  controllers: {
    mediaEditing: MediaEditingState;
    joinWorkflow: JoinWorkflowState;
    output: Pick<
      OutputState,
      | 'selectedOutputId'
      | 'setSelectedOutputId'
      | 'parentGenerations'
      | 'segmentProgress'
      | 'isSegmentOutputsLoading'
      | 'joinSegmentSlots'
    >;
    generationActions: UseShotSettingsValueProps['generationActions'];
    shotActions: UseShotSettingsValueProps['shotActions'];
    generationController: {
      isGenerationDisabled: UseShotSettingsValueProps['generationMode']['isGenerationDisabled'];
      isSteerableMotionEnqueuing: UseShotSettingsValueProps['generationMode']['isSteerableMotionEnqueuing'];
      steerableMotionJustQueued: UseShotSettingsValueProps['generationMode']['steerableMotionJustQueued'];
      currentMotionSettings: UseShotSettingsValueProps['generationMode']['currentMotionSettings'];
      handleAcceleratedChange: UseShotSettingsValueProps['generationMode']['onAcceleratedChange'];
      handleRandomSeedChange: UseShotSettingsValueProps['generationMode']['onRandomSeedChange'];
      handleGenerateBatch: UseShotSettingsValueProps['generationHandlers']['handleGenerateBatch'];
      handleBatchVideoPromptChangeWithClear: UseShotSettingsValueProps['generationHandlers']['handleBatchVideoPromptChangeWithClear'];
      handleStepsChange: UseShotSettingsValueProps['generationHandlers']['handleStepsChange'];
      clearAllEnhancedPrompts: UseShotSettingsValueProps['generationHandlers']['clearAllEnhancedPrompts'];
      enhancementProgress: UseShotSettingsValueProps['generationMode']['enhancementProgress'];
    };
    imageManagement: {
      handleReorderImagesInShot: UseShotSettingsValueProps['handleImageReorder'];
      handleImageUpload: UseShotSettingsValueProps['handleImageUpload'];
      handlePendingPositionApplied: ShotEditorLayoutProps['timeline']['onPendingPositionApplied'];
      handleDeleteFinalVideo: ShotEditorLayoutProps['finalVideo']['onDeleteFinalVideo'];
      isClearingFinalVideo: boolean;
    };
    bridge: {
      handleSelectionChangeLocal: ShotEditorLayoutProps['timeline']['onSelectionChange'];
    };
    loraManager: UseShotSettingsValueProps['loraManager'];
    availableLoras: UseShotSettingsValueProps['availableLoras'];
    shots: Shot[] | undefined;
  };
  settings: {
    promptSettings: PromptSettingsSlice;
    motionSettings: MotionSettingsSlice;
    frameSettings: FrameSettingsSlice;
    modelSettings: ModelSettingsSlice;
    phaseConfigSettings: PhaseConfigSettingsSlice;
    generationModeSettings: GenerationModeSettingsSlice;
    isPhone: boolean;
    aspectAdjustedColumns: number;
    accelerated: boolean;
    randomSeed: boolean;
  };
  contextValue: ShotSettingsContextValue;
  sections: {
    onBack: ShotEditorProps['onBack'];
    onPreviousShot: ShotEditorProps['onPreviousShot'];
    onNextShot: ShotEditorProps['onNextShot'];
    hasPrevious: ShotEditorProps['hasPrevious'];
    hasNext: ShotEditorProps['hasNext'];
    onUpdateShotName: ShotEditorProps['onUpdateShotName'];
    headerContainerRef: ShotEditorProps['headerContainerRef'];
    timelineSectionRef: ShotEditorProps['timelineSectionRef'];
    ctaContainerRef: ShotEditorProps['ctaContainerRef'];
    isSticky: ShotEditorProps['isSticky'];
    parentVariantName: ShotEditorProps['variantName'];
    parentOnVariantNameChange: ShotEditorProps['onVariantNameChange'];
    parentIsGeneratingVideo: ShotEditorProps['isGeneratingVideo'];
    parentVideoJustQueued: ShotEditorProps['videoJustQueued'];
    getFinalVideoCount: ShotEditorProps['getFinalVideoCount'];
    getHasStructureVideo: ShotEditorProps['getHasStructureVideo'];
    onDragStateChange?: (isDragging: boolean) => void;
    refs: {
      centerSectionRef: React.RefObject<HTMLDivElement>;
      videoGalleryRef: React.RefObject<HTMLDivElement>;
      generateVideosCardRef: React.RefObject<HTMLDivElement>;
      joinSegmentsSectionRef: React.RefObject<HTMLDivElement>;
      swapButtonRef: React.RefObject<HTMLButtonElement>;
    };
    initialParentGenerations: GenerationRow[];
    applySettingsFromTask: ShotEditorLayoutProps['finalVideo']['onApplySettingsFromTask'];
  };
}

export interface BuildShotEditorContextInputArgs {
  core: UseShotEditorLayoutModelParams['core'];
  images: {
    allShotImages: GenerationRow[];
    timelineImages: GenerationRow[];
    unpositionedImages: GenerationRow[];
    contextImages: GenerationRow[];
    videoOutputs: GenerationRow[];
    simpleFilteredImages: GenerationRow[];
  };
  controllers: UseShotEditorLayoutModelParams['controllers'];
  settings: UseShotEditorLayoutModelParams['settings'];
  dimensions: UseShotSettingsValueProps['dimensions'];
}

export interface BuildShotEditorScreenModelArgs
  extends BuildShotEditorContextInputArgs {
  sections: UseShotEditorLayoutModelParams['sections'];
}

interface ShotEditorScreenModel {
  contextInput: UseShotSettingsValueProps;
  layoutParams: Omit<UseShotEditorLayoutModelParams, 'contextValue'>;
}

interface ShotEditorLayoutSectionsArgs {
  core: UseShotEditorLayoutModelParams['core'];
  controllers: UseShotEditorLayoutModelParams['controllers'];
  settings: UseShotEditorLayoutModelParams['settings'];
  sections: UseShotEditorLayoutModelParams['sections'];
  contextValue: ShotSettingsContextValue;
  handleJoinSegmentsClick: () => void;
}

export function buildShotEditorContextInput({
  core,
  images,
  controllers,
  settings,
  dimensions,
}: BuildShotEditorContextInputArgs): UseShotSettingsValueProps {
  return {
    selectedShot: core.selectedShot!,
    selectedShotId: core.selectedShotId,
    projectId: core.projectId,
    selectedProjectId: core.selectedProjectId,
    effectiveAspectRatio: core.effectiveAspectRatio,
    projects: core.projects,
    state: core.state,
    actions: core.actions,
    loraManager: controllers.loraManager,
    availableLoras: controllers.availableLoras,
    allShotImages: images.allShotImages,
    timelineImages: images.timelineImages,
    unpositionedImages: images.unpositionedImages,
    contextImages: images.contextImages,
    videoOutputs: images.videoOutputs,
    simpleFilteredImages: images.simpleFilteredImages,
    structureVideo: {
      travelGuidanceByModel: controllers.mediaEditing.travelGuidanceByModel,
      structureGuidance: controllers.mediaEditing.structureGuidance,
      structureVideoPath: controllers.mediaEditing.structureVideoPath,
      structureVideoMetadata: controllers.mediaEditing.structureVideoMetadata,
      structureVideoTreatment: controllers.mediaEditing.structureVideoTreatment,
      structureVideoMotionStrength: controllers.mediaEditing.structureVideoMotionStrength,
      structureVideoType: controllers.mediaEditing.structureVideoType,
      structureVideoResourceId: controllers.mediaEditing.structureVideoResourceId,
      structureVideoUni3cEndPercent: controllers.mediaEditing.structureVideoUni3cEndPercent,
      structureVideoDefaultsByModel: controllers.mediaEditing.structureVideoDefaultsByModel,
      isLoading: controllers.mediaEditing.isStructureVideoSettingsLoading,
      structureVideos: controllers.mediaEditing.structureVideos,
      addStructureVideo: controllers.mediaEditing.addStructureVideo,
      updateStructureVideo: controllers.mediaEditing.updateStructureVideo,
      removeStructureVideo: controllers.mediaEditing.removeStructureVideo,
      clearAllStructureVideos: controllers.mediaEditing.clearAllStructureVideos,
      setStructureVideos: controllers.mediaEditing.setStructureVideos,
      updateStructureGuidanceControls: controllers.mediaEditing.updateStructureGuidanceControls,
    },
    structureVideoHandlers: {
      handleStructureVideoMotionStrengthChange:
        controllers.mediaEditing.handleStructureVideoMotionStrengthChange,
      handleStructureTypeChangeFromMotionControl:
        controllers.mediaEditing.handleStructureTypeChangeFromMotionControl,
      handleUni3cEndPercentChange:
        controllers.mediaEditing.handleUni3cEndPercentChange,
      handleStructureVideoInputChange:
        controllers.mediaEditing.handleStructureVideoInputChange,
    },
    audio: {
      audioUrl: controllers.mediaEditing.audioUrl,
      audioMetadata: controllers.mediaEditing.audioMetadata,
      handleAudioChange: controllers.mediaEditing.handleAudioChange,
      isLoading: controllers.mediaEditing.isAudioSettingsLoading,
    },
    generationActions: controllers.generationActions,
    handleImageReorder: controllers.imageManagement.handleReorderImagesInShot,
    handleImageUpload: controllers.imageManagement.handleImageUpload,
    shots: controllers.shots,
    shotActions: controllers.shotActions,
    generationMode: {
      generateMode: controllers.joinWorkflow.generateMode,
      setGenerateMode: controllers.joinWorkflow.setGenerateMode,
      toggleGenerateModePreserveScroll:
        controllers.joinWorkflow.toggleGenerateModePreserveScroll,
      isGenerationDisabled:
        controllers.generationController.isGenerationDisabled,
      isSteerableMotionEnqueuing:
        controllers.generationController.isSteerableMotionEnqueuing,
      steerableMotionJustQueued:
        controllers.generationController.steerableMotionJustQueued,
      currentMotionSettings:
        controllers.generationController.currentMotionSettings,
      accelerated: settings.accelerated,
      onAcceleratedChange:
        controllers.generationController.handleAcceleratedChange,
      randomSeed: settings.randomSeed,
      onRandomSeedChange:
        controllers.generationController.handleRandomSeedChange,
      enhancementProgress:
        controllers.generationController.enhancementProgress,
    },
    generationHandlers: {
      handleGenerateBatch:
        controllers.generationController.handleGenerateBatch,
      handleBatchVideoPromptChangeWithClear:
        controllers.generationController.handleBatchVideoPromptChangeWithClear,
      handleStepsChange: controllers.generationController.handleStepsChange,
      clearAllEnhancedPrompts:
        controllers.generationController.clearAllEnhancedPrompts,
    },
    joinState: {
      joinSettings: {
        settings: controllers.joinWorkflow.joinSettings.settings,
        updateField: controllers.joinWorkflow.joinSettings.updateField,
        updateFields: controllers.joinWorkflow.joinSettings.updateFields,
      },
      joinLoraManager: controllers.joinWorkflow.joinLoraManager,
      joinValidationData: controllers.joinWorkflow.joinValidationData,
      handleJoinSegments: controllers.joinWorkflow.handleJoinSegments,
      isJoiningClips: controllers.joinWorkflow.isJoiningClips,
      joinClipsSuccess: controllers.joinWorkflow.joinClipsSuccess,
      handleRestoreJoinDefaults:
        controllers.joinWorkflow.handleRestoreJoinDefaults,
      joinSegmentSlots: controllers.output.joinSegmentSlots,
    },
    dimensions,
    queryClient: core.queryClient,
  };
}

export function buildShotEditorScreenModel({
  core,
  images,
  controllers,
  settings,
  dimensions,
  sections,
}: BuildShotEditorScreenModelArgs): ShotEditorScreenModel {
  return {
    contextInput: buildShotEditorContextInput({
      core,
      images,
      controllers,
      settings,
      dimensions,
    }),
    layoutParams: {
      core,
      controllers,
      settings,
      sections,
    },
  };
}

function buildShotEditorLayoutSections({
  core,
  controllers,
  settings,
  sections,
  contextValue,
  handleJoinSegmentsClick,
}: ShotEditorLayoutSectionsArgs): ShotEditorLayoutProps {
  return {
    contextValue,
    header: {
      onBack: sections.onBack,
      onPreviousShot: sections.onPreviousShot,
      onNextShot: sections.onNextShot,
      hasPrevious: sections.hasPrevious,
      hasNext: sections.hasNext,
      onUpdateShotName: sections.onUpdateShotName,
      onNameClick: controllers.mediaEditing.handleNameClick,
      onNameSave: controllers.mediaEditing.handleNameSave,
      onNameCancel: controllers.mediaEditing.handleNameCancel,
      onNameKeyDown: controllers.mediaEditing.handleNameKeyDown,
      headerContainerRef: sections.headerContainerRef,
      centerSectionRef: sections.refs.centerSectionRef,
      isSticky: sections.isSticky,
    },
    finalVideo: {
      selectedShotId: core.selectedShotId,
      projectId: core.projectId,
      effectiveAspectRatio: core.effectiveAspectRatio,
      onApplySettingsFromTask: sections.applySettingsFromTask,
      onJoinSegmentsClick: handleJoinSegmentsClick,
      selectedOutputId: controllers.output.selectedOutputId,
      onSelectedOutputChange: controllers.output.setSelectedOutputId,
      parentGenerations: controllers.output.parentGenerations,
      initialParentGenerations: sections.initialParentGenerations,
      segmentProgress: controllers.output.segmentProgress,
      isSegmentOutputsLoading: controllers.output.isSegmentOutputsLoading,
      getFinalVideoCount: sections.getFinalVideoCount,
      onDeleteFinalVideo: controllers.imageManagement.handleDeleteFinalVideo,
      isClearingFinalVideo: controllers.imageManagement.isClearingFinalVideo,
      videoGalleryRef: sections.refs.videoGalleryRef,
      generateVideosCardRef: sections.refs.generateVideosCardRef,
    },
    timeline: {
      timelineSectionRef: sections.timelineSectionRef,
      isModeReady: core.state.isModeReady,
      settingsError: core.state.settingsError,
      isPhone: settings.isPhone,
      generationMode: settings.generationModeSettings.generationMode,
      onGenerationModeChange:
        settings.generationModeSettings.setGenerationMode,
      batchVideoFrames: settings.frameSettings.batchVideoFrames,
      onBatchVideoFramesChange: settings.frameSettings.setFrames,
      aspectAdjustedColumns: settings.aspectAdjustedColumns as 2 | 3 | 4 | 6,
      pendingFramePositions: core.state.pendingFramePositions,
      onPendingPositionApplied:
        controllers.imageManagement.handlePendingPositionApplied,
      onSelectionChange: controllers.bridge.handleSelectionChangeLocal,
      prompt: settings.promptSettings.prompt,
      onPromptChange: settings.promptSettings.setPrompt,
      negativePrompt: settings.promptSettings.negativePrompt,
      onNegativePromptChange: settings.promptSettings.setNegativePrompt,
      selectedModel: settings.modelSettings.selectedModel,
      generationTypeMode: settings.phaseConfigSettings.generationTypeMode,
      smoothContinuations: settings.motionSettings.smoothContinuations,
      onDragStateChange: sections.onDragStateChange,
      getHasStructureVideo: sections.getHasStructureVideo,
    },
    generation: {
      ctaContainerRef: sections.ctaContainerRef,
      swapButtonRef: sections.refs.swapButtonRef,
      joinSegmentsSectionRef: sections.refs.joinSegmentsSectionRef,
      parentVariantName: sections.parentVariantName,
      parentOnVariantNameChange: sections.parentOnVariantNameChange,
      parentIsGeneratingVideo: sections.parentIsGeneratingVideo,
      parentVideoJustQueued: sections.parentVideoJustQueued,
    },
    modals: {
      isLoraModalOpen: controllers.loraManager.isLoraModalOpen,
      onLoraModalClose: () =>
        controllers.loraManager.setIsLoraModalOpen(false),
      onAddLora: controllers.loraManager.handleAddLora,
      onRemoveLora: controllers.loraManager.handleRemoveLora,
      onUpdateLoraStrength:
        controllers.loraManager.handleLoraStrengthChange,
      selectedLoras: controllers.loraManager.selectedLoras,
      selectedModel: settings.modelSettings.selectedModel,
      isSettingsModalOpen: core.state.isSettingsModalOpen,
      onSettingsModalOpenChange: core.actions.setSettingsModalOpen,
    },
  };
}

export function useShotEditorLayoutModel({
  core,
  controllers,
  settings,
  contextValue,
  sections,
}: UseShotEditorLayoutModelParams): ShotEditorLayoutProps {
  const handleJoinSegmentsClick = useCallback(() => {
    controllers.joinWorkflow.setGenerateMode('join');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = sections.refs.generateVideosCardRef.current;
        if (!target) {
          return;
        }

        const rect = target.getBoundingClientRect();
        const scrollTop = window.scrollY + rect.top - 20;
        window.scrollTo({ top: scrollTop, behavior: 'smooth' });
      });
    });
  }, [controllers.joinWorkflow, sections.refs.generateVideosCardRef]);

  return buildShotEditorLayoutSections({
    core,
    controllers,
    settings,
    sections,
    contextValue,
    handleJoinSegmentsClick,
  });
}
