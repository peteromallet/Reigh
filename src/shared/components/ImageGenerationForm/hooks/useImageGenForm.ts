/**
 * useImageGenForm - All orchestration logic for ImageGenerationForm
 *
 * Thin composition layer that wires together extracted sub-hooks.
 * The component calls this hook and passes the returned values to JSX.
 */

import { useState, useEffect, useRef, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useLoraManager } from '@/domains/lora/hooks/useLoraManager';
import { usePersistentToolState } from '@/shared/hooks/usePersistentToolState';
import { usePublicLoras } from '@/features/resources/hooks/useResources';
import { useAIInteractionService } from '@/shared/hooks/ai/useAIInteractionService';
import { SETTINGS_IDS } from '@/shared/lib/settingsIds';
import { TOOL_IDS } from '@/shared/lib/tooling/toolIds';

import type { LoraModel } from '@/domains/lora/types/lora';
import type { ActiveLora } from '@/domains/lora/types/lora';
import { useGenerationSource } from './useGenerationSource';
import { usePromptManagement } from './usePromptManagement';
import { useReferenceManagement } from './useReferenceManagement';
import { useFormSubmission } from './useFormSubmission';
import { useLoraHandlers } from './useLoraHandlers';
import { useProjectImageSettings } from './useProjectImageSettings';
import { useHiresFixConfig } from './useHiresFixConfig';
import { useShotManagement } from './useShotManagement';
import { useFormContextBuilder } from './useFormContextBuilder';

import { useFormUIState } from '../state/useFormUIState';
import { useRenderLogger, useChangedDepsLogger } from '@/shared/lib/debug/debugRendering';

import {
  type HiresFixConfig,
  type ImageGenShotSettings,
  type PromptEntry,
  type PromptMode,
  getLoraTypeForModel,
  BY_REFERENCE_LORA_TYPE,
} from '../types';
import type { BatchImageGenerationTaskParams } from '@/shared/types/imageGeneration';

interface UseImageGenFormProps {
  onGenerate: (params: BatchImageGenerationTaskParams) => Promise<string[] | void> | string[] | void;
  openaiApiKey?: string;
  onShotChange?: (shotId: string | null) => void;
  initialShotId?: string | null;
}

type PersistentImageGenState = {
  imagesPerPrompt: number;
  selectedLoras: ActiveLora[];
  beforeEachPromptText: string;
  afterEachPromptText: string;
  associatedShotId: string | null;
  promptMode: PromptMode;
  prompts: PromptEntry[];
  masterPrompt: string;
  hiresFixConfig: Partial<HiresFixConfig>;
}

export function useImageGenForm({
  onGenerate,
  openaiApiKey,
  onShotChange,
  initialShotId,
}: UseImageGenFormProps) {
  // ============================================================================
  // UI State (reducer for modal states, session tracking)
  // ============================================================================
  const { uiState, uiActions } = useFormUIState();
  useRenderLogger('useImageGenForm');

  const [imagesPerPrompt, setImagesPerPrompt] = useState(8);
  const [promptMultiplier, setPromptMultiplier] = useState(1);
  const { hiresFixConfig, setHiresFixConfig } = useHiresFixConfig();

  // Text to prepend/append to every prompt
  const [beforeEachPromptText, setBeforeEachPromptText] = useState("");
  const [afterEachPromptText, setAfterEachPromptText] = useState("");
  // Prompt mode: automated vs managed (default to automated)
  const [promptMode, setPromptMode] = useState<PromptMode>('automated');
  // Local state for prompts when no shot is selected
  const [noShotPrompts, setNoShotPrompts] = useState<PromptEntry[]>([]);
  const [noShotMasterPrompt, setNoShotMasterPrompt] = useState('');

  // Optimistic button state for immediate feedback: idle -> submitting -> success -> idle
  const [submitButtonState, setSubmitButtonState] = useState<'idle' | 'submitting' | 'success'>('idle');
  const submitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => () => { if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current); }, []);
  const automatedSubmitButton = useMemo(() => ({
    isSubmitting: submitButtonState === 'submitting',
    isSuccess: submitButtonState === 'success',
    state: submitButtonState,
    trigger: () => {
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
      setSubmitButtonState('submitting');
      submitTimeoutRef.current = setTimeout(() => {
        setSubmitButtonState('success');
        submitTimeoutRef.current = setTimeout(() => setSubmitButtonState('idle'), 2000);
      }, 1000);
    },
    reset: () => {
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
      setSubmitButtonState('idle');
    },
  }), [submitButtonState]);

  // Define generatePromptId before using it in hooks
  const promptIdCounter = useRef(1);
  const generatePromptId = useCallback(() => `prompt-${promptIdCounter.current++}`, []);

  // AI interaction service for automated prompt generation
  const { generatePrompts: aiGeneratePrompts } = useAIInteractionService({
    generatePromptId,
  });

  // Fetch public LoRAs from all users
  const { data: availableLoras } = usePublicLoras();

  // Associated shot for image generation (owned here because both
  // useProjectImageSettings and usePersistentToolState need it before useShotManagement)
  const [associatedShotId, setAssociatedShotId] = useState<string | null>(null);

  const {
    selectedProjectId,
    projectAspectRatio,
    projectResolution,
    privacyDefaults,
    isLocalGenerationEnabled,
    projectImageSettings,
    updateProjectImageSettings,
    isLoadingProjectSettings,
    effectiveShotId,
    referencePointers,
    referenceCount,
    selectedReferenceIdByShot,
    selectedReferenceId,
    hydratedReferences,
    displayedReferenceId,
    selectedReference,
    isReferenceDataLoading,
  } = useProjectImageSettings(associatedShotId);

  // Mark that we've visited this page in the session
  useEffect(() => {
    try {
      if (!uiState.hasVisitedImageGeneration && typeof window !== 'undefined') {
        window.sessionStorage.setItem('hasVisitedImageGeneration', 'true');
        uiActions.setHasVisited(true);
      }
    } catch { /* Ignore sessionStorage errors */ }
  }, [uiState.hasVisitedImageGeneration, uiActions]);

  // LoRA management using the modularized hook with new generalized approach
  const loraManager = useLoraManager(availableLoras, {
    projectId: selectedProjectId ?? undefined,
    persistenceScope: 'project',
    enableProjectPersistence: true,
    persistenceKey: SETTINGS_IDS.PROJECT_LORAS,
    enableTriggerWords: true,
    onPromptUpdate: setAfterEachPromptText,
    currentPrompt: afterEachPromptText,
    disableAutoLoad: true,
  });

  // Project-level settings (NOT shot-specific)
  const setSelectedLorasForPersistence: Dispatch<SetStateAction<ActiveLora[]>> = useCallback((nextValue) => {
    if (typeof nextValue === 'function') {
      loraManager.setSelectedLoras(nextValue(loraManager.selectedLoras));
      return;
    }

    loraManager.setSelectedLoras(nextValue);
  }, [loraManager]);

  // Track which stateMapping values are changing — helps diagnose render loops caused
  // by unstable references (inline objects/arrays) triggering usePersistentToolState's effects.
  // Enable with: window.debugConfig.enable('renderLogging')
  useChangedDepsLogger('useImageGenForm[stateMapping]', {
    imagesPerPrompt,
    beforeEachPromptText,
    afterEachPromptText,
    associatedShotId,
    promptMode,
    noShotPrompts,
    noShotMasterPrompt,
    hiresFixConfig,
    'loraManager.selectedLoras': loraManager.selectedLoras,
    setSelectedLorasForPersistence,
  });

  const { ready, markAsInteracted } = usePersistentToolState<PersistentImageGenState>(
    TOOL_IDS.IMAGE_GENERATION,
    { projectId: selectedProjectId ?? undefined },
    {
      imagesPerPrompt: [imagesPerPrompt, setImagesPerPrompt],
      selectedLoras: [loraManager.selectedLoras, setSelectedLorasForPersistence],
      beforeEachPromptText: [beforeEachPromptText, setBeforeEachPromptText],
      afterEachPromptText: [afterEachPromptText, setAfterEachPromptText],
      associatedShotId: [associatedShotId, setAssociatedShotId],
      promptMode: [promptMode, setPromptMode],
      prompts: [noShotPrompts, setNoShotPrompts],
      masterPrompt: [noShotMasterPrompt, setNoShotMasterPrompt],
      hiresFixConfig: [hiresFixConfig, setHiresFixConfig],
    }
  );

  // ============================================================================
  // Shot Management (extracted hook)
  // ============================================================================
  // Note: associatedShotId/setAssociatedShotId are owned here (not in useShotManagement)
  // because useProjectImageSettings and usePersistentToolState both need them before
  // shot management can be initialized.

  const {
    shots,
    shotPromptSettings,
    isCreatingShot,
    navigateToShot,
    handleShotChange,
    handleCreateShot,
  } = useShotManagement({
    selectedProjectId,
    associatedShotId,
    setAssociatedShotId,
    noShotMasterPrompt,
    promptMode,
    ready,
    markAsInteracted,
    onShotChange,
    initialShotId,
    uiActions,
  });

  const updateShotPromptField = useCallback((field: string, value: unknown) => {
    shotPromptSettings.updateField(
      field as keyof ImageGenShotSettings,
      value as ImageGenShotSettings[keyof ImageGenShotSettings],
    );
  }, [shotPromptSettings]);

  // ============================================================================
  // Generation Source & Model Selection (extracted hook)
  // ============================================================================
  const {
    generationSource,
    selectedTextModel,
    generationSourceRef,
    selectedTextModelRef,
    handleGenerationSourceChange,
    handleTextModelChange,
  } = useGenerationSource({
    projectImageSettings: projectImageSettings ?? undefined,
    isLoadingProjectSettings,
    updateProjectImageSettings,
    markAsInteracted,
    loraManager: {
      selectedLoras: loraManager.selectedLoras,
      setSelectedLoras: loraManager.setSelectedLoras,
    },
    setHiresFixConfig,
  });

  // ============================================================================
  // Prompt Management (extracted hook)
  // ============================================================================
  const promptManagementResult = usePromptManagement({
    associatedShotId,
    effectiveShotId,
    shotPromptSettings: {
      entityId: shotPromptSettings.entityId,
      status: shotPromptSettings.status,
      settings: shotPromptSettings.settings,
      updateField: updateShotPromptField,
    },
    noShotPrompts,
    setNoShotPrompts,
    noShotMasterPrompt,
    setNoShotMasterPrompt,
    promptMode,
    setPromptMode,
    beforeEachPromptText,
    setBeforeEachPromptText,
    afterEachPromptText,
    setAfterEachPromptText,
    ready,
    markAsInteracted,
    generatePromptId,
    promptIdCounter,
  });
  const {
    prompts, masterPromptText, effectivePromptMode, currentBeforePromptText,
    currentAfterPromptText, actionablePromptsCount, setPrompts,
    setEffectivePromptMode, handleSavePromptsFromModal,
  } = promptManagementResult;

  // ============================================================================
  // Reference Management (extracted hook)
  // ============================================================================
  const referenceManagementResult = useReferenceManagement({
    selectedProjectId: selectedProjectId ?? undefined,
    effectiveShotId,
    selectedReferenceId,
    selectedReferenceIdByShot,
    referencePointers,
    hydratedReferences,
    selectedReference,
    isLoadingProjectSettings,
    isLocalGenerationEnabled,
    updateProjectImageSettings,
    markAsInteracted,
    privacyDefaults,
    associatedShotId,
    shotPromptSettings: {
      updateField: updateShotPromptField,
    },
    setHiresFixConfig,
  });
  const {
    styleReferenceStrength, subjectStrength, subjectDescription, inThisScene,
    inThisSceneStrength, referenceMode, styleBoostTerms,
    styleReferenceImageGeneration,
  } = referenceManagementResult;

  const effectiveSubjectDescription = subjectDescription.trim() || 'this character';

  // ============================================================================
  // Form Submission (extracted hook)
  // ============================================================================
  const {
    handleSubmit,
    handleGenerateAndQueue,
    handleUseExistingPrompts,
    handleNewPromptsLikeExisting,
  } = useFormSubmission({
    formState: {
      selectedProjectId: selectedProjectId ?? undefined,
      prompts,
      imagesPerPrompt,
      promptMultiplier,
      associatedShotId,
      currentBeforePromptText,
      currentAfterPromptText,
      styleBoostTerms,
      isLocalGenerationEnabled,
      hiresFixConfig,
      effectivePromptMode,
      masterPromptText,
      actionablePromptsCount,
    },
    promptConfig: {
      generationSourceRef,
      selectedTextModelRef,
      selectedLoras: loraManager.selectedLoras,
      styleReferenceImageGeneration,
      styleReferenceStrength,
      subjectStrength,
      effectiveSubjectDescription,
      inThisScene,
      inThisSceneStrength,
      referenceMode,
    },
    effects: {
      aiGeneratePrompts,
      onGenerate,
      setPrompts,
      automatedSubmitButton,
    },
  });

  // ============================================================================
  // LORA Handlers (extracted hook)
  // ============================================================================
  const {
    handleAddLora,
    handleRemoveLora,
    handleLoraStrengthChange,
  } = useLoraHandlers({
    loraManager: {
      selectedLoras: loraManager.selectedLoras,
      handleAddLora: loraManager.handleAddLora,
      handleRemoveLora: loraManager.handleRemoveLora,
      handleLoraStrengthChange: loraManager.handleLoraStrengthChange,
      handleLoadProjectLoras: loraManager.handleLoadProjectLoras,
    },
    markAsInteracted,
    generationSource,
    selectedTextModel,
    projectImageSettings: projectImageSettings ?? null,
    updateProjectImageSettings,
  });

  // Optimize event handlers with useCallback to prevent recreating on each render
  const handleSliderChange = useCallback((setter: Dispatch<SetStateAction<number>>) => (value: number) => {
    markAsInteracted();
    setter(value);
  }, [markAsInteracted]);

  // Pre-compute LoRA modal props (moves computation out of JSX)
  const mappedSelectedLoras = useMemo(() =>
    loraManager.selectedLoras.map(lora => {
      const fullLora = availableLoras?.find(l => l['Model ID'] === lora.id);
      return {
        ...fullLora,
        "Model ID": lora.id,
        Name: lora.name,
        strength: lora.strength,
      } as LoraModel & { strength: number };
    }), [loraManager.selectedLoras, availableLoras]);

  const loraType = generationSource === 'just-text' ? getLoraTypeForModel(selectedTextModel) : BY_REFERENCE_LORA_TYPE;

  // ============================================================================
  // Context Value (for sections to pull from)
  // ============================================================================
  const contextValue = useFormContextBuilder({
    uiState,
    uiActions,
    core: { selectedProjectId, associatedShotId, effectiveShotId, isGenerating: automatedSubmitButton.isSubmitting, ready },
    promptManagement: promptManagementResult,
    referenceManagement: referenceManagementResult,
    references: { hydratedReferences, displayedReferenceId },
    loras: { selectedLoras: loraManager.selectedLoras, availableLoras: availableLoras ?? [], handleAddLora, handleRemoveLora, handleLoraStrengthChange },
    markAsInteracted,
  });

  return {
    // Context value for provider
    contextValue,

    // Form submission
    handleSubmit,

    // State + setters
    shots,
    associatedShotId,
    setAssociatedShotId,
    imagesPerPrompt,
    setImagesPerPrompt,
    promptMultiplier,
    setPromptMultiplier,
    hiresFixConfig,
    setHiresFixConfig,
    selectedProjectId,

    // Computed
    generationSource,
    selectedTextModel,
    effectivePromptMode,
    actionablePromptsCount,
    projectResolution,
    projectAspectRatio,
    isLocalGenerationEnabled,
    isReferenceDataLoading,
    referenceCount,

    // Prompt management
    prompts,
    setEffectivePromptMode,
    handleSavePromptsFromModal,
    generatePromptId,
    markAsInteracted,
    handleGenerateAndQueue,

    // Shot handling
    handleShotChange,
    handleCreateShot,
    isCreatingShot,
    navigateToShot,

    // Generation source
    handleGenerationSourceChange,
    handleTextModelChange,

    // Submission button state
    automatedSubmitButton,
    handleUseExistingPrompts,
    handleNewPromptsLikeExisting,
    handleSliderChange,

    // LoRA
    loraManager,
    availableLoras,
    mappedSelectedLoras,
    loraType,
    handleAddLora,
    handleRemoveLora,
    handleLoraStrengthChange,

    // UI
    uiState,
    uiActions,

    // Pass-through from props
    openaiApiKey,
  };
}
