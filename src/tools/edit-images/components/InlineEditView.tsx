import { useCallback } from 'react';
import { GenerationRow } from '@/domains/generation/types';

import { MediaDisplayWithCanvas } from '@/domains/media-lightbox/components/MediaDisplayWithCanvas';
import {
  TopRightControls,
  BottomLeftControls,
  BottomRightControls,
} from '@/domains/media-lightbox/components/ButtonGroups';
import { EditModePanel } from '@/domains/media-lightbox/components/EditModePanel';
import { FloatingToolControls } from '@/domains/media-lightbox/components/FloatingToolControls';
import { AnnotationFloatingControls } from '@/domains/media-lightbox/components/AnnotationFloatingControls';
import { ImageEditProvider } from '@/domains/media-lightbox/contexts/ImageEditContext';
import type { EditModePanelVariantsState } from '@/domains/media-lightbox/components/types';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/components/ui/contracts/cn';
import { TooltipProvider } from '@/shared/components/ui/tooltip';

import {
  useInlineEditState,
  type InlineEditStateResult,
} from '../hooks/useInlineEditState';

const NOOP = () => {};

// ============================================================================
// Types
// ============================================================================

interface InlineEditViewProps {
  media: GenerationRow;
  onClose: () => void;
  onNavigateToGeneration?: (generationId: string) => Promise<void>;
}

// ============================================================================
// InlineEditCanvas — media display with all overlay controls
// ============================================================================

interface InlineEditCanvasProps {
  variant: 'mobile' | 'desktop';
  model: InlineEditCanvasModel;
  media: GenerationRow;
}

interface InlineEditCanvasModel {
  imageEditValue: InlineEditStateResult['imageEditValue'];
  media: {
    effectiveImageUrl: string;
    isVideo: boolean;
    imageDimensions: InlineEditStateResult['canvasEnvironment']['imageDimensions'];
    setImageDimensions: InlineEditStateResult['canvasEnvironment']['setImageDimensions'];
  };
  annotation: {
    selectedShapeId: InlineEditStateResult['inpaintingState']['selectedShapeId'];
    isAnnotateMode: InlineEditStateResult['inpaintingState']['isAnnotateMode'];
    brushStrokes: InlineEditStateResult['inpaintingState']['brushStrokes'];
    getDeleteButtonPosition: InlineEditStateResult['inpaintingState']['getDeleteButtonPosition'];
    handleToggleFreeForm: InlineEditStateResult['inpaintingState']['handleToggleFreeForm'];
    handleDeleteSelected: InlineEditStateResult['inpaintingState']['handleDeleteSelected'];
  };
  generation: {
    handleDownload: InlineEditStateResult['generationState']['handleDownload'];
    localStarred: InlineEditStateResult['generationState']['localStarred'];
    handleToggleStar: InlineEditStateResult['generationState']['handleToggleStar'];
    toggleStarPending: boolean;
  };
  isSpecialEditMode: boolean;
}

function buildInlineEditCanvasModel(state: InlineEditStateResult): InlineEditCanvasModel {
  return {
    imageEditValue: state.imageEditValue,
    media: {
      effectiveImageUrl: state.canvasEnvironment.effectiveImageUrl,
      isVideo: state.canvasEnvironment.isVideo,
      imageDimensions: state.canvasEnvironment.imageDimensions,
      setImageDimensions: state.canvasEnvironment.setImageDimensions,
    },
    annotation: {
      selectedShapeId: state.inpaintingState.selectedShapeId,
      isAnnotateMode: state.inpaintingState.isAnnotateMode,
      brushStrokes: state.inpaintingState.brushStrokes,
      getDeleteButtonPosition: state.inpaintingState.getDeleteButtonPosition,
      handleToggleFreeForm: state.inpaintingState.handleToggleFreeForm,
      handleDeleteSelected: state.inpaintingState.handleDeleteSelected,
    },
    generation: {
      handleDownload: state.generationState.handleDownload,
      localStarred: state.generationState.localStarred,
      handleToggleStar: state.generationState.handleToggleStar,
      toggleStarPending: state.generationState.toggleStarMutation.isPending,
    },
    isSpecialEditMode: state.inpaintingState.isSpecialEditMode,
  };
}

function InlineEditCanvas({ variant, model, media }: InlineEditCanvasProps) {
  const isMobileVariant = variant === 'mobile';

  return (
    <ImageEditProvider value={model.imageEditValue}>
      <MediaDisplayWithCanvas
        effectiveImageUrl={model.media.effectiveImageUrl}
        thumbUrl={media.thumbUrl || media.imageUrl}
        isVideo={model.media.isVideo}
        onImageLoad={model.media.setImageDimensions}
        variant={isMobileVariant ? "mobile-stacked" : "desktop-side-panel"}
        containerClassName={isMobileVariant ? "w-full h-full" : "max-w-full max-h-full"}
        debugContext={isMobileVariant ? "Mobile Inline" : "InlineEdit"}
        imageDimensions={model.media.imageDimensions}
      />

      {!isMobileVariant && (
        <AnnotationFloatingControls
          selectedShapeId={model.annotation.selectedShapeId}
          isAnnotateMode={model.annotation.isAnnotateMode}
          brushStrokes={model.annotation.brushStrokes}
          getDeleteButtonPosition={model.annotation.getDeleteButtonPosition}
          onToggleFreeForm={model.annotation.handleToggleFreeForm}
          onDeleteSelected={model.annotation.handleDeleteSelected}
          positionStrategy="absolute"
        />
      )}

      {model.isSpecialEditMode && (
        <FloatingToolControls
          variant={isMobileVariant ? "mobile" : "tablet"}
        />
      )}

      <TopRightControls
        showDownload={true}
        handleDownload={model.generation.handleDownload}
      />

      <BottomLeftControls
        localStarred={model.generation.localStarred}
        handleToggleStar={model.generation.handleToggleStar}
        toggleStarPending={model.generation.toggleStarPending}
      />

      <BottomRightControls
        showAddToReferences={false}
      />
    </ImageEditProvider>
  );
}

// ============================================================================
// InlineEditSidebar — EditModePanel or fallback placeholder
// ============================================================================

interface InlineEditSidebarProps {
  variant: 'mobile' | 'desktop';
  model: InlineEditSidebarModel;
  onClose: () => void;
  onNavigateToGeneration?: (generationId: string) => Promise<void>;
}

interface InlineEditSidebarModel {
  isSpecialEditMode: boolean;
  isCloudMode: boolean;
  currentMediaId: string;
  generation: {
    handleUnifiedGenerate: InlineEditStateResult['generationState']['handleUnifiedGenerate'];
    handleGenerateAnnotatedEdit: InlineEditStateResult['generationState']['handleGenerateAnnotatedEdit'];
    handleGenerateReposition: InlineEditStateResult['generationState']['handleGenerateReposition'];
    handleSaveAsVariant: InlineEditStateResult['generationState']['handleSaveAsVariant'];
    handleGenerateImg2Img: InlineEditStateResult['generationState']['handleGenerateImg2Img'];
    img2imgLoraManager: InlineEditStateResult['generationState']['img2imgLoraManager'];
  };
  availableLoras: InlineEditStateResult['availableLoras'];
  imageEditValue: InlineEditStateResult['imageEditValue'];
  variantsState: EditModePanelVariantsState;
  actions: {
    enterInpaintMode: () => void;
    enterMagicEditMode: () => void;
  };
}

function buildInlineEditSidebarModel(state: InlineEditStateResult): InlineEditSidebarModel {
  return {
    isSpecialEditMode: state.inpaintingState.isSpecialEditMode,
    isCloudMode: state.canvasEnvironment.isCloudMode,
    currentMediaId: state.media.id,
    generation: {
      handleUnifiedGenerate: state.generationState.handleUnifiedGenerate,
      handleGenerateAnnotatedEdit: state.generationState.handleGenerateAnnotatedEdit,
      handleGenerateReposition: state.generationState.handleGenerateReposition,
      handleSaveAsVariant: state.generationState.handleSaveAsVariant,
      handleGenerateImg2Img: state.generationState.handleGenerateImg2Img,
      img2imgLoraManager: state.generationState.img2imgLoraManager,
    },
    availableLoras: state.availableLoras,
    imageEditValue: state.imageEditValue,
    variantsState: {
      variants: state.variants.variants,
      activeVariant: state.variants.activeVariant,
      handleVariantSelect: state.variants.setActiveVariantId,
      handleMakePrimary: state.variants.setPrimaryVariant,
      isLoadingVariants: state.variants.isLoading,
      handleDeleteVariant: state.variants.deleteVariant,
      pendingTaskCount: 0,
      unviewedVariantCount: 0,
      onMarkAllViewed: NOOP,
    },
    actions: {
      enterInpaintMode: () => {
        state.inpaintingState.setIsInpaintMode(true);
        state.inpaintingState.setEditMode('inpaint');
      },
      enterMagicEditMode: state.inpaintingState.handleEnterMagicEditMode,
    },
  };
}

function InlineEditSidebar({ variant, model, onClose }: InlineEditSidebarProps) {
  const sidebarContent = model.isSpecialEditMode ? (
    <EditModePanel
      variant={variant === 'mobile' ? 'mobile' : 'desktop'}
      hideInfoEditToggle={true}
      simplifiedHeader={true}
      currentMediaId={model.currentMediaId}
      actions={{
        handleUnifiedGenerate: model.generation.handleUnifiedGenerate,
        handleGenerateAnnotatedEdit: model.generation.handleGenerateAnnotatedEdit,
        handleGenerateReposition: model.generation.handleGenerateReposition,
        handleSaveAsVariant: model.generation.handleSaveAsVariant,
        handleGenerateImg2Img: model.generation.handleGenerateImg2Img,
      }}
      lora={{
        img2imgLoraManager: model.generation.img2imgLoraManager,
        availableLoras: model.availableLoras,
      }}
      upscale={{ isCloudMode: model.isCloudMode }}
      coreState={{ onClose }}
      imageEditState={model.imageEditValue}
      variantsState={model.variantsState}
    />
  ) : (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-y-4">
      <h3 className="text-xl font-medium">Image Editor</h3>
      <p className="text-muted-foreground">Select an option to start editing</p>

      <div className="grid grid-cols-1 gap-4 w-full max-w-xs">
        <Button onClick={() => {
          model.actions.enterInpaintMode();
        }} className="w-full">
          Inpaint / Erase
        </Button>

        <Button onClick={model.actions.enterMagicEditMode} variant="secondary" className="w-full">
          Magic Edit
        </Button>
      </div>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">{sidebarContent}</div>
    </div>
  );
}

// ============================================================================
// InlineEditView — layout orchestrator (mobile vs desktop)
// ============================================================================

export function InlineEditView({ media, onClose, onNavigateToGeneration }: InlineEditViewProps) {
  const state = useInlineEditState(media, onNavigateToGeneration);
  const handleClose = useCallback(() => {
    void state.imageEditValue.flushTextFields();
    onClose();
  }, [state.imageEditValue, onClose]);
  const canvasModel = buildInlineEditCanvasModel(state);
  const sidebarModel = buildInlineEditSidebarModel(state);
  const isMobile = state.canvasEnvironment.isMobile;

  if (isMobile) {
    return (
      <TooltipProvider delayDuration={500}>
        <div className="w-full flex flex-col bg-transparent">
          <div
              className="flex items-center justify-center relative bg-black w-full shrink-0 rounded-t-2xl overflow-hidden"
              style={{ height: '45dvh', touchAction: 'pan-y' }}
            >
              <InlineEditCanvas variant="mobile" model={canvasModel} media={media} />
            </div>

            <div
              className={cn(
                "bg-background border-t border-border relative z-[60] w-full rounded-b-2xl pb-8"
              )}
              style={{ minHeight: '55dvh' }}
            >
              <InlineEditSidebar
                variant="mobile"
                model={sidebarModel}
                onClose={handleClose}
                onNavigateToGeneration={onNavigateToGeneration}
              />
            </div>
          </div>
        </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={500}>
      <div className="w-full h-full flex bg-transparent overflow-hidden">
        <div
            className="flex-1 flex items-center justify-center relative bg-black rounded-l-xl overflow-hidden"
            style={{ width: '60%', height: '100%' }}
          >
            <InlineEditCanvas variant="desktop" model={canvasModel} media={media} />
          </div>

          <div
            className={cn(
              "bg-background border-l border-border overflow-y-auto relative z-[60] rounded-r-xl"
            )}
            style={{ width: '40%', height: '100%' }}
          >
            <InlineEditSidebar
              variant="desktop"
              model={sidebarModel}
              onClose={handleClose}
              onNavigateToGeneration={onNavigateToGeneration}
            />
          </div>
        </div>
      </TooltipProvider>
  );
}
