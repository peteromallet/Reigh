import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import type { PromptEntry } from './ImageGenerationForm/types';
import { useProjectSelectionContext } from '@/shared/contexts/ProjectContext';
import { useIsMobile } from '@/shared/hooks/mobile';
import { useExtraLargeModal } from '@/shared/hooks/useModal';
import { useScrollFade } from '@/shared/hooks/useScrollFade';
import { useTouchDragDetection } from '@/shared/hooks/useTouchDragDetection';
import { PromptEditorAIPanel } from './PromptEditorModal/components/PromptEditorAIPanel';
import { PromptEditorPromptList } from './PromptEditorModal/components/PromptEditorPromptList';
import { PromptEditorFooter } from './PromptEditorModal/components/PromptEditorFooter';
import { useAIInteractionService } from '@/shared/hooks/ai/useAIInteractionService';
import { usePersistentPromptSettings } from './PromptEditorModal/hooks/usePersistentPromptSettings';
import { usePromptEditing } from './PromptEditorModal/hooks/usePromptEditing';
type EditorMode = 'generate' | 'remix' | 'bulk-edit';

interface PromptEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  prompts: PromptEntry[];
  onSave: (updatedPrompts: PromptEntry[]) => void;
  generatePromptId: () => string;
  openWithAIExpanded?: boolean;
  onGenerateAndQueue?: (prompts: PromptEntry[]) => void;
}

const PromptEditorModal: React.FC<PromptEditorModalProps> = React.memo(({
  isOpen,
  onClose,
  prompts: initialPrompts,
  onSave,
  generatePromptId,
  openWithAIExpanded = false,
  onGenerateAndQueue,
}) => {
  const [activePromptIdForFullView, setActivePromptIdForFullView] = useState<string | null>(null);
  const [isAIPromptSectionExpanded, setIsAIPromptSectionExpanded] = useState(false);

  const isMobile = useIsMobile();
  const { isDragging, handleTouchStart } = useTouchDragDetection();
  const modalContentRef = useRef<HTMLDivElement>(null);

  const modal = useExtraLargeModal('promptEditor');
  const { selectedProjectId } = useProjectSelectionContext();
  const { showFade, scrollRef } = useScrollFade({
    isOpen,
    debug: false,
    preloadFade: modal.isMobile,
  });

  const {
    activeTab,
    generationControlValues,
    bulkEditControlValues,
    handleGenerationValuesChange,
    handleBulkEditValuesChange,
    handleActiveTabChange,
  } = usePersistentPromptSettings({ selectedProjectId });

  const {
    generatePrompts,
    editPromptWithAI,
    generateSummary,
    isGenerating,
    isEditing,
    isLoading,
  } = useAIInteractionService({ generatePromptId });

  const {
    internalPrompts,
    handleFinalSaveAndClose,
    handlePromptFieldUpdate,
    handleInternalRemovePrompt,
    handleInternalAddBlankPrompt,
    handleRemoveAllPrompts,
    handleGenerateAndAddPrompts,
    handleGenerateAndQueue,
    handleBulkEditPrompts,
  } = usePromptEditing({
    isOpen,
    initialPrompts,
    onSave,
    onClose,
    scrollRef,
    selectedProjectId,
    generatePromptId,
    onGenerateAndQueue,
    aiGeneratePrompts: generatePrompts,
    aiEditPrompt: (params) => editPromptWithAI({
      originalPromptText: params.originalPromptText,
      editInstructions: params.editInstructions,
      modelType: params.modelType === 'smart' ? 'smart' : 'standard',
    }),
    aiGenerateSummary: generateSummary,
  });

  useEffect(() => {
    if (isOpen) {
      setActivePromptIdForFullView(null);
      setIsAIPromptSectionExpanded(openWithAIExpanded);
    }
  }, [isOpen, openWithAIExpanded, selectedProjectId]);

  const handleInsideInteraction = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    if (!activePromptIdForFullView) {
      return;
    }

    const target = event.target as Element;
    if (modalContentRef.current && modalContentRef.current.contains(target)) {
      const clickedActiveField = target.closest(`[data-prompt-id="${activePromptIdForFullView}"]`);
      if (!clickedActiveField) {
        setActivePromptIdForFullView(null);
      }
    }
  }, [activePromptIdForFullView]);

  const handleToggleAIPromptSection = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault();
    if (!isDragging.current) {
      setIsAIPromptSectionExpanded((previous) => !previous);
    }
  }, [isDragging]);

  const handleModalClose = useCallback((open: boolean) => {
    if (!open) {
      handleFinalSaveAndClose();
    }
  }, [handleFinalSaveAndClose]);

  return (
    <Dialog open={isOpen} onOpenChange={handleModalClose}>
      <DialogContent
        className={`${modal.className} gap-2`}
        style={modal.style}
        ref={modalContentRef}
      >
        <div className={modal.headerClass}>
          <DialogHeader className={`${modal.isMobile ? 'px-2 pt-2 pb-2' : 'px-6 pt-4 pb-2'} flex-shrink-0`}>
            <DialogTitle>Prompt Editor</DialogTitle>
          </DialogHeader>
        </div>

        <div
          ref={scrollRef}
          onClickCapture={handleInsideInteraction}
          onTouchStartCapture={handleInsideInteraction}
          className={`${modal.scrollClass} ${modal.isMobile ? 'pt-2' : 'pt-6'}`}
        >
          <PromptEditorAIPanel
            isMobile={modal.isMobile}
            expanded={isAIPromptSectionExpanded}
            onExpandedChange={setIsAIPromptSectionExpanded}
            onToggle={handleToggleAIPromptSection}
            onTouchStart={handleTouchStart}
            activeTab={activeTab}
            onActiveTabChange={(mode) => handleActiveTabChange(mode as EditorMode)}
            prompts={internalPrompts}
            generation={{
              onGenerate: handleGenerateAndAddPrompts,
              onGenerateAndQueue: onGenerateAndQueue ? handleGenerateAndQueue : undefined,
              isGenerating,
              values: generationControlValues,
              onValuesChange: handleGenerationValuesChange,
            }}
            bulkEdit={{
              onBulkEdit: handleBulkEditPrompts,
              isEditing,
              values: bulkEditControlValues,
              onValuesChange: handleBulkEditValuesChange,
            }}
          />

          <PromptEditorPromptList
            prompts={internalPrompts}
            isMobile={isMobile}
            isLoading={isLoading}
            activePromptIdForFullView={activePromptIdForFullView}
            onActivePromptChange={setActivePromptIdForFullView}
            onUpdatePromptField={handlePromptFieldUpdate}
            onRemovePrompt={handleInternalRemovePrompt}
          />
        </div>

        <PromptEditorFooter
          showFade={showFade}
          footerClass={modal.footerClass}
          isMobile={modal.isMobile}
          prompts={internalPrompts}
          onAddBlankPrompt={handleInternalAddBlankPrompt}
          onRemoveAllPrompts={handleRemoveAllPrompts}
          onClose={handleFinalSaveAndClose}
        />
      </DialogContent>
    </Dialog>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.isOpen === nextProps.isOpen &&
    prevProps.prompts.length === nextProps.prompts.length &&
    JSON.stringify(prevProps.prompts) === JSON.stringify(nextProps.prompts)
  );
});

export { PromptEditorModal };
