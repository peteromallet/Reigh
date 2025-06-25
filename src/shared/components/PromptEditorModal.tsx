import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { PromptEntry, PromptInputRow, PromptInputRowProps } from '@/tools/image-generation/components/ImageGenerationForm';
import { ScrollArea } from '@/shared/components/ui/scroll-area';
import { PlusCircle, AlertTriangle, Wand2Icon, Edit, PackagePlus, ArrowUp, Trash2 } from 'lucide-react';
import { PromptGenerationControls, GenerationControlValues as PGC_GenerationControlValues } from '@/tools/image-generation/components/PromptGenerationControls';
import { BulkEditControls, BulkEditParams as BEC_BulkEditParams, BulkEditControlValues as BEC_BulkEditControlValues } from '@/tools/image-generation/components/BulkEditControls';
import { useAIInteractionService } from '@/shared/hooks/useAIInteractionService';
import { AIPromptItem, GeneratePromptsParams, EditPromptParams, AIModelType } from '@/types/ai';
import { Textarea } from '@/shared/components/ui/textarea';
import { Label } from '@/shared/components/ui/label';
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { usePaneAwareModalStyle } from '@/shared/hooks/usePaneAwareModalStyle';

// Debounce utility function
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => func(...args), waitFor);
  };
}

const PROMPT_EDITOR_MODAL_CONTROLS_KEY = 'artfulPaneCraftPromptEditorControlsSettings';

// Use aliased types for internal state if they were named the same
interface GenerationControlValues extends PGC_GenerationControlValues {}
interface BulkEditControlValues extends BEC_BulkEditControlValues {}

interface PersistedEditorControlsSettings {
  generationSettings?: GenerationControlValues;
  bulkEditSettings?: BulkEditControlValues;
  activeTab?: EditorMode;
}

interface PromptToEditState {
  id: string;
  originalText: string;
  instructions: string;
  modelType: AIModelType;
}

export interface PromptEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  prompts: PromptEntry[];
  onSave: (updatedPrompts: PromptEntry[]) => void;
  onAutoSavePrompts: (updatedPrompts: PromptEntry[]) => void;
  generatePromptId: () => string;
  apiKey?: string;
}

type EditorMode = 'generate' | 'bulk-edit';

const PromptEditorModal: React.FC<PromptEditorModalProps> = ({
  isOpen, onClose, prompts: initialPrompts, onSave, 
  onAutoSavePrompts,
  generatePromptId,
  apiKey,
}) => {
  const [internalPrompts, setInternalPrompts] = useState<PromptEntry[]>([]);
  const [promptToEdit, setPromptToEdit] = useState<PromptToEditState | null>(null);
  const actualCanUseAI = !!apiKey;
  const [activeTab, setActiveTab] = useState<EditorMode>('generate');
  const [activePromptIdForFullView, setActivePromptIdForFullView] = useState<string | null>(null);
  const modalStyle = usePaneAwareModalStyle();
  
  // Scroll state and ref
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const [generationControlValues, setGenerationControlValues] = useState<GenerationControlValues>({
    overallPromptText: '', specificPromptsText: '', rulesToRememberText: '',
    numberToGenerate: 3, includeExistingContext: false, addSummary: true,
  });
  const [bulkEditControlValues, setBulkEditControlValues] = useState<BulkEditControlValues>({
    editInstructions: '', modelType: 'standard' as AIModelType,
  });

  // Scroll handler
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (event.currentTarget) {
      setShowScrollToTop(event.currentTarget.scrollTop > 200);
    }
  }, []);

  // Scroll to top function
  const scrollToTop = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const debouncedAutoSavePrompts = useCallback(
    debounce((promptsToSave: PromptEntry[]) => {
      console.log(`[PromptEditorModal] Auto-saving prompts to parent. Count: ${promptsToSave.length}`, JSON.stringify(promptsToSave.map(p => ({id: p.id, text: p.fullPrompt.substring(0,30)+'...'}))));
      onAutoSavePrompts(promptsToSave);
    }, 1500),
    [onAutoSavePrompts]
  );

  // Effect to initialize modal state (prompts and control settings) when it *first* opens
  useEffect(() => {
    if (isOpen) {
      setShowScrollToTop(false);
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      console.log("[PromptEditorModal] Modal is OPENING. Initializing state from props and localStorage.");
      setPromptToEdit(null); // Ensure individual edit modal is not open from a previous interaction
      
      // 1. Set internal prompts from initialPrompts (deep copy)
      console.log(`[PromptEditorModal] Initializing internalPrompts from initialPrompts on open. Current initialPrompts count: ${initialPrompts.length}`);
      setInternalPrompts(initialPrompts.map(p => ({ ...p })));
      
      // 2. Load control settings from localStorage (only on initial open)
      const savedSettingsRaw = localStorage.getItem(PROMPT_EDITOR_MODAL_CONTROLS_KEY);
      if (savedSettingsRaw) {
        console.log("[PromptEditorModal] Found saved control settings in localStorage.");
        try {
          const savedSettings = JSON.parse(savedSettingsRaw) as PersistedEditorControlsSettings;
          if (savedSettings.generationSettings) {
            console.log("[PromptEditorModal] Loading generation settings from localStorage:", savedSettings.generationSettings);
            setGenerationControlValues(prev => ({ ...prev, ...savedSettings.generationSettings, addSummary: savedSettings.generationSettings.addSummary !== undefined ? savedSettings.generationSettings.addSummary : true }));
          }
          if (savedSettings.bulkEditSettings) {
            console.log("[PromptEditorModal] Loading bulk edit settings from localStorage:", savedSettings.bulkEditSettings);
            setBulkEditControlValues(prev => ({ ...prev, ...savedSettings.bulkEditSettings }));
          }
          if (savedSettings.activeTab) {
            console.log("[PromptEditorModal] Loading active tab from localStorage:", savedSettings.activeTab);
            setActiveTab(savedSettings.activeTab);
          }
        } catch (e) { 
          console.error("[PromptEditorModal] Failed to parse control settings from localStorage on open:", e); 
        }
      } else {
        console.log("[PromptEditorModal] No saved control settings found in localStorage on initial open. Defaults will be used (addSummary:true).");
        setGenerationControlValues({
            overallPromptText: '', specificPromptsText: '', rulesToRememberText: '',
            numberToGenerate: 3, includeExistingContext: false, addSummary: true,
        });
      }
      setActivePromptIdForFullView(null);
    }
  }, [isOpen]); 

  // Effect to sync internalPrompts if initialPrompts prop changes WHILE modal is already open.
  // This handles cases where parent form might update prompts for reasons external to this modal's auto-save loop,
  // or to reflect the result of an auto-save without re-initializing control fields.
  useEffect(() => {
    if (isOpen) {
        if (initialPrompts !== internalPrompts) { 
            console.log(`[PromptEditorModal] initialPrompts prop changed while modal is open. Syncing internalPrompts. New count: ${initialPrompts.length}`);
            setInternalPrompts(initialPrompts.map(p => ({ ...p })));
        }
    }
  }, [initialPrompts, isOpen]);

  const debouncedSaveControlSettings = useCallback(
    debounce((settings: PersistedEditorControlsSettings) => {
      localStorage.setItem(PROMPT_EDITOR_MODAL_CONTROLS_KEY, JSON.stringify(settings));
      console.log("[PromptEditorModal] Control settings saved to localStorage (debounced).", JSON.stringify(settings));
    }, 1000),
    []
  );

  useEffect(() => {
    if (isOpen) {
      debouncedSaveControlSettings({
        generationSettings: generationControlValues,
        bulkEditSettings: bulkEditControlValues,
        activeTab: activeTab,
      });
    }
  }, [generationControlValues, bulkEditControlValues, activeTab, isOpen, debouncedSaveControlSettings]);

  const handleGenerationValuesChange = useCallback((values: GenerationControlValues) => setGenerationControlValues(values), []);
  const handleBulkEditValuesChange = useCallback((values: BulkEditControlValues) => setBulkEditControlValues(values), []);

  const { 
    generatePrompts: aiGeneratePrompts, 
    editPromptWithAI: aiEditPrompt, 
    generateSummary: aiGenerateSummary,
    isLoading: isAILoading, 
    isGenerating: isAIGenerating, 
    isEditing: isAIEditing 
  } = useAIInteractionService({ apiKey, generatePromptId });

  const handleFinalSaveAndClose = () => {
    console.log(`[PromptEditorModal] 'Close' button clicked. Saving prompts. Count: ${internalPrompts.length}`, JSON.stringify(internalPrompts.map(p => ({id: p.id, text: p.fullPrompt.substring(0,30)+'...'}))));
    onSave(internalPrompts);
    onAutoSavePrompts(internalPrompts);
    if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
    }
    setShowScrollToTop(false);
    onClose();
  };

  const handleInternalUpdatePrompt = useCallback((id: string, updates: Partial<Omit<PromptEntry, 'id'>>) => {
    setInternalPrompts(currentPrompts => {
      const newPrompts = currentPrompts.map(p => (p.id === id ? { ...p, ...updates } : p));
      console.log(`[PromptEditorModal] Prompt updated (manual edit). ID: ${id}, Updates: ${JSON.stringify(updates)}. New list count: ${newPrompts.length}`);
      if (isOpen) debouncedAutoSavePrompts(newPrompts);
      return newPrompts;
    });
  }, [isOpen, debouncedAutoSavePrompts]);
  
  const handleInternalRemovePrompt = (id: string) => {
    setInternalPrompts(currentPrompts => {
      const newPrompts = currentPrompts.filter(p => p.id !== id);
      console.log(`[PromptEditorModal] Prompt removed (manual). ID: ${id}. New list count: ${newPrompts.length}`);
      if (isOpen) debouncedAutoSavePrompts(newPrompts);
      return newPrompts;
    });
  };

  const handleInternalAddBlankPrompt = () => {
    const newPromptEntry: PromptEntry = { id: generatePromptId(), fullPrompt: '', shortPrompt: '' };
    setInternalPrompts(currentPrompts => {
      const newPrompts = [...currentPrompts, newPromptEntry];
      console.log(`[PromptEditorModal] Blank prompt added (manual). New prompt ID: ${newPromptEntry.id}. New list count: ${newPrompts.length}`);
      if (isOpen) debouncedAutoSavePrompts(newPrompts);
      return newPrompts;
    });
  };

  const handleRemoveAllPrompts = () => {
    console.log(`[PromptEditorModal] Removing all prompts. Current count: ${internalPrompts.length}`);
    setInternalPrompts([]);
    if (isOpen) debouncedAutoSavePrompts([]);
    toast.info("All prompts have been deleted.");
  };

  const handleGenerateAndAddPrompts = async (params: GeneratePromptsParams) => {
    if (!actualCanUseAI) { toast.error("API Key required for AI generation."); return; }
    console.log("[PromptEditorModal] AI Generation: Attempting to generate prompts. Params:", JSON.stringify(params));
    
    // Store whether summaries were requested initially to decide if we need to auto-generate them later
    const summariesInitiallyRequested = params.addSummaryForNewPrompts;
    
    const rawResults = await aiGeneratePrompts(params);
    console.log("[PromptEditorModal] AI Generation: Raw AI results:", JSON.stringify(rawResults));
    
    const newEntries: PromptEntry[] = rawResults.map(item => ({
      id: item.id,
      fullPrompt: item.text,
      shortPrompt: item.shortText, // This will be populated if summariesInitiallyRequested was true
    }));
    console.log(`[PromptEditorModal] AI Generation: Parsed ${newEntries.length} new PromptEntry items:`, JSON.stringify(newEntries.map(p => ({id: p.id, text: p.fullPrompt.substring(0,30)+'...'}))));
    
    // Add new prompts to the state first
    let newlyAddedPromptIds: string[] = [];
    setInternalPrompts(currentPrompts => {
      const updatedPrompts = [...currentPrompts, ...newEntries];
      newlyAddedPromptIds = newEntries.map(e => e.id); // Capture IDs of newly added prompts
      console.log(`[PromptEditorModal] AI Generation: Added ${newEntries.length} prompts to internal list. New total: ${updatedPrompts.length}`);
      if (isOpen) debouncedAutoSavePrompts(updatedPrompts);
      return updatedPrompts;
    });

    // If summaries were NOT initially requested (i.e., user wants fast gen, summary later)
    // AND the AI interaction service is set to add summaries, AND we actually have new prompts:
    // Iterate through the newly added prompts and generate summaries for those that don't have one.
    if (!summariesInitiallyRequested && params.addSummaryForNewPrompts && newEntries.length > 0) {
      console.log("[PromptEditorModal] AI Generation: Summaries were not generated with initial batch, but addSummary is true. Generating summaries for new prompts.");
      for (const entry of newEntries) {
        if (!entry.shortPrompt && entry.fullPrompt) { // Only generate if no shortPrompt and fullPrompt exists
          try {
            console.log(`[PromptEditorModal] AI Generation: Attempting to generate summary for new prompt ID: ${entry.id}`);
            const summary = await aiGenerateSummary(entry.fullPrompt);
            if (summary) {
              console.log(`[PromptEditorModal] AI Generation: Summary generated for prompt ID: ${entry.id}: "${summary}"`);
              setInternalPrompts(currentPrompts => {
                const updatedPrompts = currentPrompts.map(p => 
                  p.id === entry.id ? { ...p, shortPrompt: summary } : p
                );
                // Note: Auto-save will be triggered by the setInternalPrompts that included the full new entries.
                // We don't need to call it again here for just summary updates to avoid thrashing.
                // The final save or next auto-save cycle will pick this up.
                return updatedPrompts;
              });
            } else {
              console.warn(`[PromptEditorModal] AI Generation: Summary generation returned empty for prompt ID: ${entry.id}.`);
            }
          } catch (error) {
            console.error(`[PromptEditorModal] AI Generation: Error generating summary for prompt ID: ${entry.id}:`, error);
            // Optionally, toast an error for this specific summary generation
          }
        }
      }
      // After all potential summary updates, trigger one final auto-save if there were new prompts that needed summaries.
      // This ensures the parent gets the summarized versions.
      setInternalPrompts(currentPrompts => {
        if (isOpen) debouncedAutoSavePrompts(currentPrompts);
        return currentPrompts;
      });
    }
  };
  

  const handleBulkEditPrompts = async (params: BEC_BulkEditParams) => {
    if (!actualCanUseAI) { toast.error("API Key required for AI editing."); return; }
    if (internalPrompts.length === 0) { toast.info("No prompts to edit."); return; }
    console.log("[PromptEditorModal] AI Bulk Edit: Starting bulk edit. Params:", JSON.stringify(params));
    
    const promptsToUpdate = internalPrompts.map(p => ({ id: p.id, text: p.fullPrompt }));
    const editRequests = promptsToUpdate.map(p => ({
      originalPromptText: p.text,
      editInstructions: params.editInstructions,
      modelType: params.modelType,
    }));

    // We will update prompts one by one to show progress and handle partial failures
    let successCount = 0;
    const originalPromptIds = promptsToUpdate.map(p => p.id);

    for (let i = 0; i < editRequests.length; i++) {
      const request = editRequests[i];
      const promptIdToUpdate = originalPromptIds[i];
      try {
        console.log(`[PromptEditorModal] AI Bulk Edit: Editing prompt ID: ${promptIdToUpdate}. Instructions: "${request.editInstructions}"`);
        const result = await aiEditPrompt(request);
        
        if (result.success && result.newText) {
          setInternalPrompts(currentPrompts => {
            const updatedPrompts = currentPrompts.map(p => 
              p.id === promptIdToUpdate ? { ...p, fullPrompt: result.newText!, shortPrompt: result.newShortText || '' } : p
            );
            if (isOpen) debouncedAutoSavePrompts(updatedPrompts);
            return updatedPrompts;
          });
          successCount++;
          console.log(`[PromptEditorModal] AI Bulk Edit: Successfully edited prompt ID: ${promptIdToUpdate}. New text (start): "${result.newText.substring(0, 50)}..."`);
        } else {
          console.warn(`[PromptEditorModal] AI Bulk Edit: Edit returned no result or failed for prompt ID: ${promptIdToUpdate}. Success: ${result.success}`);
        }
      } catch (error) {
        console.error(`[PromptEditorModal] AI Bulk Edit: Error editing prompt ID: ${promptIdToUpdate}:`, error);
        toast.error(`Error editing prompt ${promptIdToUpdate.substring(0,8)}...`);
        // Continue to the next prompt
      }
    }
    toast.success(`Bulk edit complete. ${successCount} of ${promptsToUpdate.length} prompts updated.`);
    console.log(`[PromptEditorModal] AI Bulk Edit: Finished. ${successCount} / ${promptsToUpdate.length} prompts processed successfully.`);
  };

  const openEditWithAIForm = (promptId: string, currentText: string) => {
    setPromptToEdit({ id: promptId, originalText: currentText, instructions: '', modelType: 'standard' });
  };

  const handleConfirmEditWithAI = async () => {
    if (!promptToEdit || !actualCanUseAI) {
      toast.error("Cannot perform AI edit. Missing data or API key.");
      return;
    }
    console.log(`[PromptEditorModal] AI Individual Edit: Attempting to edit prompt ID: ${promptToEdit.id}. Instructions: "${promptToEdit.instructions}"`);
    
    try {
      const result = await aiEditPrompt({
        originalPromptText: promptToEdit.originalText,
        editInstructions: promptToEdit.instructions,
        modelType: promptToEdit.modelType,
      });

      if (result.success && result.newText) {
        console.log(`[PromptEditorModal] AI Individual Edit: Successfully edited prompt ID: ${promptToEdit.id}. New text (start): "${result.newText.substring(0,50)}..."`);
        setInternalPrompts(currentPrompts => {
          const updatedPrompts = currentPrompts.map(p =>
            p.id === promptToEdit.id ? { ...p, fullPrompt: result.newText!, shortPrompt: result.newShortText || '' } : p
          );
          if (isOpen) debouncedAutoSavePrompts(updatedPrompts);
          return updatedPrompts;
        });
        toast.success("Prompt updated with AI assistance.");
      } else {
        console.warn(`[PromptEditorModal] AI Individual Edit: Edit returned no result or failed for prompt ID: ${promptToEdit.id}. Success: ${result.success}`);
        toast.info("AI edit did not return a result or failed.");
      }
    } catch (error) {
      console.error(`[PromptEditorModal] AI Individual Edit: Error editing prompt ID: ${promptToEdit.id}:`, error);
      toast.error("Error editing prompt with AI.");
    } finally {
      setPromptToEdit(null); // Close the individual edit form
    }
  };

  if (!isOpen) return null;

  const toggleFullView = (promptId: string) => {
    setActivePromptIdForFullView(currentId => currentId === promptId ? null : promptId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleFinalSaveAndClose()}>
      <DialogContent style={modalStyle} className="max-w-4xl flex flex-col p-0">
        <DialogHeader className="p-6 pb-0 flex-shrink-0">
          <DialogTitle>Prompt Editor</DialogTitle>
          <DialogDescription>
            Manage your prompts. Use the 'Generate' tab to create new prompts with AI, or the 'Bulk Edit' tab to refine existing ones.
            {!actualCanUseAI && (
                 <div className="mt-2 p-2 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 rounded-md">
                    <div className="flex items-center">
                        <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2" />
                        <span>AI features are disabled. Please enter an API key in settings.</span>
                    </div>
                </div>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorMode)} className="px-6">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="generate" disabled={!actualCanUseAI}><Wand2Icon className="mr-2 h-4 w-4" />Generate New</TabsTrigger>
              <TabsTrigger value="bulk-edit" disabled={!actualCanUseAI}><Edit className="mr-2 h-4 w-4" />Bulk Edit All</TabsTrigger>
            </TabsList>
            <TabsContent value="generate">
              <PromptGenerationControls 
                onGenerate={handleGenerateAndAddPrompts} 
                isGenerating={isAIGenerating}
                initialValues={generationControlValues}
                onValuesChange={handleGenerationValuesChange}
                hasApiKey={actualCanUseAI}
                existingPromptsForContext={internalPrompts.map(p => ({ id: p.id, text: p.fullPrompt, shortText: p.shortPrompt, hidden: false}))}
              />
            </TabsContent>
            <TabsContent value="bulk-edit">
              <BulkEditControls 
                onBulkEdit={handleBulkEditPrompts} 
                isEditing={isAIEditing}
                initialValues={bulkEditControlValues}
                onValuesChange={handleBulkEditValuesChange}
                hasApiKey={actualCanUseAI}
                numberOfPromptsToEdit={internalPrompts.length}
              />
            </TabsContent>
          </Tabs>
          
          <div className="px-6 text-sm text-muted-foreground mb-2 flex justify-between items-center">
            <span>Editing {internalPrompts.length} prompt(s). Changes are auto-saved.</span>
            {internalPrompts.length > 0 && (
              <Button variant="destructive" size="sm" onClick={handleRemoveAllPrompts} className="ml-auto">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete All Prompts
              </Button>
            )}
          </div>
          <div className="border-t border-b">
            <div className="p-6">
              {internalPrompts.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  No prompts yet. Add one manually or use AI generation.
                </div>
              )}
              {internalPrompts.map((prompt, index) => (
                <div key={prompt.id} className="mb-3 p-3 border rounded-md shadow-sm bg-background hover:shadow-md transition-shadow duration-150 ease-in-out relative group">
                  <PromptInputRow
                    promptEntry={prompt}
                    index={index}
                    onUpdate={(id, field, value) => {
                      const updatePayload: Partial<Omit<PromptEntry, 'id'>> = {};
                      if (field === 'fullPrompt') updatePayload.fullPrompt = value;
                      if (field === 'shortPrompt') updatePayload.shortPrompt = value;
                      handleInternalUpdatePrompt(id, updatePayload);
                    }}
                    onRemove={() => handleInternalRemovePrompt(prompt.id)}
                    canRemove={internalPrompts.length > 1}
                    isGenerating={isAILoading}
                    hasApiKey={true}
                    onEditWithAI={() => openEditWithAIForm(prompt.id, prompt.fullPrompt)}
                    onSetActiveForFullView={setActivePromptIdForFullView}
                    isActiveForFullView={activePromptIdForFullView === prompt.id}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {promptToEdit && (
          <Dialog open={!!promptToEdit} onOpenChange={(open) => !open && setPromptToEdit(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Prompt with AI</DialogTitle>
                <DialogDescription>Refine the prompt using AI. Provide instructions below.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="original-text" className="text-right">Original</Label>
                  <Textarea id="original-text" value={promptToEdit.originalText} readOnly className="col-span-3 max-h-32" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-instructions" className="text-right">Instructions</Label>
                  <Textarea
                    id="edit-instructions"
                    value={promptToEdit.instructions}
                    onChange={(e) => setPromptToEdit(prev => prev ? { ...prev, instructions: e.target.value } : null)}
                    className="col-span-3"
                    placeholder="e.g., make it more poetic, add details about lighting, change subject to..."
                  />
                </div>
                {/* Model type selection could be added here if needed */}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPromptToEdit(null)}>Cancel</Button>
                <Button onClick={handleConfirmEditWithAI} disabled={isAIEditing || !promptToEdit.instructions}>
                  {isAIEditing ? "Editing..." : "Confirm Edit"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        <DialogFooter className="p-6 pt-2 border-t">
           <Button variant="outline" onClick={handleInternalAddBlankPrompt} className="mr-auto">
            <PackagePlus className="mr-2 h-4 w-4" /> Add Blank Prompt
          </Button>
          <DialogClose asChild>
            <Button variant="outline" onClick={onClose}>Cancel (No Save)</Button>
          </DialogClose>
          <Button onClick={handleFinalSaveAndClose}>Save & Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PromptEditorModal; 