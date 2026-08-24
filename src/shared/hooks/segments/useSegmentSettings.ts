/**
 * useSegmentSettings - Composed hook for segment settings management
 *
 * Manages segment settings for video regeneration with:
 * - Data fetching (pair metadata, shot settings)
 * - Local editing with auto-save
 * - Settings merging (segment overrides > shot defaults)
 * - Override tracking
 * - Persistence operations
 *
 * This hook composes:
 * - usePairMetadata (query)
 * - useShotVideoSettings (query)
 * - useSegmentMutations (mutations)
 * - useServerForm (local state + auto-save)
 *
 * @example
 * ```tsx
 * const { settings, updateSettings, saveSettings, isDirty } = useSegmentSettings({
 *   pairShotGenerationId,
 *   shotId,
 *   defaults: { prompt: '', negativePrompt: '', numFrames: 25 },
 * });
 * ```
 */

import { useMemo, useCallback } from 'react';
import { useServerForm } from '../useServerForm';
import { usePairMetadata } from './usePairMetadata';
import { useShotVideoSettings } from './useShotVideoSettings';
import { useSegmentMutations } from './useSegmentMutations';
import { readSegmentOverrides } from '@/shared/lib/settingsMigration';
import type { SegmentSettings, ShotBatchSettings } from '@/shared/components/SegmentSettingsForm/segmentSettingsUtils';
import type {
  SegmentOverrideFlags,
  SegmentShotDefaults,
} from '@/shared/components/SegmentSettingsForm/types';
import type { PairMetadata } from '@/shared/components/SegmentSettingsForm/segmentSettingsMigration';
import type { ShotVideoSettings } from '@/shared/lib/settingsMigration';
import type { TravelGuidanceMode } from '@/shared/lib/tasks/travelGuidance';
import type { SelectedModel } from '@/tools/travel-between-images/settings';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Segment settings with nullable fields for "clear override" semantics.
 *
 * When a field is `null`, it means "remove the segment-level override and
 * inherit from shot defaults". This is used by `createClearedSettings` and
 * consumed by `buildMetadataUpdate` which interprets null as "delete this key".
 *
 * At runtime, `getSettingsForTaskCreation` resolves nulls to shot defaults via `??`.
 */
type ClearableSegmentSettings = {
  [K in keyof SegmentSettings]: SegmentSettings[K] | null;
};

/** Form state keeps the structured SegmentSettings contract while satisfying
 * the server-form's object-state boundary. */
type SegmentFormSettings = SegmentSettings & Record<string, unknown>;

export interface UseSegmentSettingsOptions {
  /** Shot generation ID for pair-specific settings */
  pairShotGenerationId?: string | null;
  /** Shot ID for batch settings */
  shotId?: string | null;
  /** Default values (hardcoded fallbacks) */
  defaults: {
    prompt: string;
    negativePrompt: string;
    /** Frame count from timeline positions (source of truth) */
    numFrames?: number;
    /** Whether new generations should become primary variant */
    makePrimaryVariant?: boolean;
  };
  /** Structure video defaults for this segment */
  structureVideoDefaults?: {
    mode?: TravelGuidanceMode;
    motionStrength: number;
    treatment: 'adjust' | 'clip';
    uni3cEndPercent: number;
    cannyIntensity?: number;
    depthContrast?: number;
  } | null;
  structureVideoDefaultsByModel?: Partial<Record<SelectedModel, NonNullable<UseSegmentSettingsOptions['structureVideoDefaults']>>>;
  /** Callback to update structure video defaults */
  onUpdateStructureVideoDefaults?: (updates: {
    selectedModel?: SegmentSettings['selectedModel'];
    motionStrength?: number;
    treatment?: 'adjust' | 'clip';
    uni3cEndPercent?: number;
    mode?: TravelGuidanceMode;
    cannyIntensity?: number;
    depthContrast?: number;
  }) => Promise<void>;
}

/** Tracks which fields have pair-level overrides */
type FieldOverrides = SegmentOverrideFlags;

/** Shot-level default values (for showing as placeholder) */
type ShotDefaults = SegmentShotDefaults;

interface UseSegmentSettingsReturn {
  /** Current settings (merged from all sources + user edits) */
  settings: SegmentSettings;
  /** Update settings (local state only) */
  updateSettings: (updates: Partial<SegmentSettings>) => void;
  /** Save current settings to database */
  saveSettings: () => Promise<boolean>;
  /** Reset to merged defaults (discards local edits) */
  resetSettings: () => Promise<void>;
  /** Save current settings as shot-level defaults */
  saveAsShotDefaults: () => Promise<boolean>;
  /** Save a single field's current value as shot default */
  saveFieldAsDefault: (field: keyof SegmentSettings, value: unknown) => Promise<boolean>;
  /** Get effective settings for task creation (settings merged with shot defaults) */
  getSettingsForTaskCreation: () => SegmentSettings;
  /** Whether data is still loading */
  isLoading: boolean;
  /** Whether user has made local edits */
  isDirty: boolean;
  /** Raw pair metadata (for debugging) */
  pairMetadata: PairMetadata | null;
  /** Raw shot batch settings (for debugging) */
  shotBatchSettings: ShotBatchSettings | null;
  /** Which fields have pair-level overrides */
  hasOverride: FieldOverrides | undefined;
  /** Shot-level default values (for showing as placeholder) */
  shotDefaults: ShotDefaults;
  /** AI-generated enhanced prompt */
  enhancedPrompt: string | undefined;
  /** Base prompt used for enhancement */
  basePromptForEnhancement: string | undefined;
  /** Clear the enhanced prompt */
  clearEnhancedPrompt: () => Promise<boolean>;
  /** User's enhance prompt preference */
  enhancePromptEnabled: boolean | undefined;
  /** Save enhance prompt preference */
  saveEnhancePromptEnabled: (enabled: boolean) => Promise<boolean>;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Detect which fields have segment-level overrides.
 */
function detectOverrides(
  pairMetadata: PairMetadata | null | undefined,
  localData: Partial<SegmentSettings> | null,
  isLoading: boolean
): FieldOverrides | undefined {
  if (isLoading) return undefined;

  const pairOverrides = readSegmentOverrides(pairMetadata as Record<string, unknown> | null);

  const hasFieldOverride = (field: string): boolean => {
    // Check local state first (for immediate UI feedback)
    if (localData !== null && field in localData) {
      return (localData as Record<string, unknown>)[field] !== undefined;
    }
    // Fall back to DB state
    return (pairOverrides as Record<string, unknown>)[field] !== undefined;
  };

  return {
    prompt: hasFieldOverride('prompt'),
    negativePrompt: hasFieldOverride('negativePrompt'),
    textBeforePrompts: hasFieldOverride('textBeforePrompts'),
    textAfterPrompts: hasFieldOverride('textAfterPrompts'),
    motionMode: hasFieldOverride('motionMode'),
    amountOfMotion: hasFieldOverride('amountOfMotion'),
    phaseConfig: hasFieldOverride('phaseConfig'),
    loras: hasFieldOverride('loras'),
    selectedPhasePresetId: hasFieldOverride('selectedPhasePresetId'),
    selectedModel: hasFieldOverride('selectedModel'),
    guidanceScale: hasFieldOverride('guidanceScale'),
    inferenceSteps: hasFieldOverride('inferenceSteps'),
    guidanceMode: hasFieldOverride('guidanceMode'),
    guidanceStrength: hasFieldOverride('guidanceStrength'),
    guidanceTreatment: hasFieldOverride('guidanceTreatment'),
    guidanceUni3cEndPercent: hasFieldOverride('guidanceUni3cEndPercent'),
    guidanceCannyIntensity: hasFieldOverride('guidanceCannyIntensity'),
    guidanceDepthContrast: hasFieldOverride('guidanceDepthContrast'),
    smoothContinuations: hasFieldOverride('smoothContinuations'),
  };
}

/**
 * Build merged settings from segment overrides only.
 * Returns settings with undefined for fields without overrides.
 */
function buildMergedSettings(
  pairMetadata: PairMetadata | null | undefined,
  defaults: UseSegmentSettingsOptions['defaults']
): SegmentFormSettings {
  const pairOverrides = readSegmentOverrides(pairMetadata as Record<string, unknown> | null);

  return {
    prompt: pairOverrides.prompt ?? defaults.prompt,
    negativePrompt: pairOverrides.negativePrompt ?? defaults.negativePrompt,
    textBeforePrompts: pairOverrides.textBeforePrompts,
    textAfterPrompts: pairOverrides.textAfterPrompts,
    motionMode: pairOverrides.motionMode ?? 'basic',
    amountOfMotion: pairOverrides.amountOfMotion ?? 50,
    phaseConfig: pairOverrides.phaseConfig,
    selectedPhasePresetId: pairOverrides.selectedPhasePresetId ?? null,
    loras: pairOverrides.loras ?? [],
    numFrames: defaults.numFrames ?? 25,
    randomSeed: pairOverrides.randomSeed ?? true,
    seed: pairOverrides.seed,
    makePrimaryVariant: defaults.makePrimaryVariant ?? true,
    selectedModel: pairOverrides.selectedModel,
    guidanceScale: pairOverrides.guidanceScale,
    inferenceSteps: pairOverrides.inferenceSteps,
    guidanceMode: pairOverrides.guidanceMode,
    guidanceStrength: pairOverrides.guidanceStrength,
    guidanceTreatment: pairOverrides.guidanceTreatment,
    guidanceUni3cEndPercent: pairOverrides.guidanceUni3cEndPercent,
    guidanceCannyIntensity: pairOverrides.guidanceCannyIntensity,
    guidanceDepthContrast: pairOverrides.guidanceDepthContrast,
    smoothContinuations: pairOverrides.smoothContinuations,
  };
}

/**
 * Build shot defaults object for display.
 */
function buildShotDefaults(
  shotSettings: ShotVideoSettings | null | undefined,
  structureVideoDefaults?: UseSegmentSettingsOptions['structureVideoDefaults'],
): ShotDefaults {
  return {
    prompt: shotSettings?.prompt || '',
    negativePrompt: shotSettings?.negativePrompt || '',
    motionMode: shotSettings?.motionMode || 'basic',
    amountOfMotion: shotSettings?.amountOfMotion ?? 50,
    phaseConfig: shotSettings?.phaseConfig,
    loras: shotSettings?.loras || [],
    selectedPhasePresetId: shotSettings?.selectedPhasePresetId ?? null,
    textBeforePrompts: shotSettings?.textBeforePrompts || '',
    textAfterPrompts: shotSettings?.textAfterPrompts || '',
    selectedModel: shotSettings?.selectedModel ?? 'wan-2.2',
    guidanceScale: shotSettings?.guidanceScale,
    inferenceSteps: undefined, // No shot-level default for inference steps
    guidanceMode: structureVideoDefaults?.mode,
    guidanceStrength: structureVideoDefaults?.motionStrength,
    guidanceTreatment: structureVideoDefaults?.treatment,
    guidanceUni3cEndPercent: structureVideoDefaults?.uni3cEndPercent,
    guidanceCannyIntensity: structureVideoDefaults?.cannyIntensity,
    guidanceDepthContrast: structureVideoDefaults?.depthContrast,
    smoothContinuations: shotSettings?.smoothContinuations ?? false,
    generationTypeMode: shotSettings?.generationTypeMode ?? 'i2v',
  };
}

/**
 * Create cleared settings for reset operation.
 *
 * Returns settings with nullable fields where `null` means "clear the override
 * and inherit from shot defaults". The form's saveData and buildMetadataUpdate
 * handle null values by removing the corresponding keys from storage.
 */
function createClearedSettings(
  numFrames: number,
  makePrimaryVariant: boolean
): ClearableSegmentSettings {
  return {
    prompt: '',
    negativePrompt: '',
    textBeforePrompts: '',
    textAfterPrompts: '',
    motionMode: null,
    amountOfMotion: null,
    phaseConfig: null,
    selectedPhasePresetId: null,
    loras: null,
    numFrames,
    randomSeed: true,
    seed: null,
    makePrimaryVariant,
    selectedModel: null,
    inferenceSteps: null,
    guidanceScale: null,
    guidanceMode: null,
    guidanceStrength: null,
    guidanceTreatment: null,
    guidanceUni3cEndPercent: null,
    guidanceCannyIntensity: null,
    guidanceDepthContrast: null,
    smoothContinuations: null,
  };
}

// =============================================================================
// MAIN HOOK
// =============================================================================

export function useSegmentSettings({
  pairShotGenerationId,
  shotId,
  defaults,
  structureVideoDefaults,
  structureVideoDefaultsByModel,
  onUpdateStructureVideoDefaults,
}: UseSegmentSettingsOptions): UseSegmentSettingsReturn {
  // 1. Fetch server data
  const { data: pairMetadata, isLoading: loadingPair } = usePairMetadata(pairShotGenerationId);
  const { data: shotVideoSettings, isLoading: loadingShot } = useShotVideoSettings(shotId);

  // 2. Get mutations
  const mutations = useSegmentMutations({ pairShotGenerationId, shotId });

  // 3. Compute merged settings from server data
  const mergedSettings = useMemo(
    () => buildMergedSettings(pairMetadata, defaults),
    [pairMetadata, defaults]
  );

  const effectiveSelectedModelForGuidance = useMemo(
    () => mergedSettings.selectedModel
      ?? shotVideoSettings?.selectedModel
      ?? 'wan-2.2',
    [mergedSettings.selectedModel, shotVideoSettings?.selectedModel],
  );

  const effectiveStructureVideoDefaults = useMemo(
    () => structureVideoDefaultsByModel?.[effectiveSelectedModelForGuidance] ?? structureVideoDefaults,
    [effectiveSelectedModelForGuidance, structureVideoDefaults, structureVideoDefaultsByModel],
  );

  // 4. Shot defaults for placeholders
  const shotDefaults = useMemo(
    () => buildShotDefaults(shotVideoSettings, effectiveStructureVideoDefaults),
    [effectiveStructureVideoDefaults, shotVideoSettings]
  );

  // 5. Use server form pattern for local edits + auto-save
  const form = useServerForm<SegmentSettings, SegmentFormSettings>({
    serverData: mergedSettings,
    isLoading: loadingPair || loadingShot,
    toLocal: (server) => ({ ...server }),
    save: (local) => mutations.savePairMetadata(local),
    autoSaveMs: 500,
    contextKey: pairShotGenerationId || undefined,
    validate: (updates, current) => {
      // Enforce: basic mode without a preset = no phase config.
      // When a preset IS selected, its phaseConfig must be preserved.
      if (updates.motionMode === 'basic') {
        const hasPreset = updates.selectedPhasePresetId ?? current.selectedPhasePresetId;
        if (!hasPreset) {
          return { ...updates, phaseConfig: undefined };
        }
      }
      return updates;
    },
  });

  // 6. Compute overrides (considering local state for immediate UI feedback)
  const hasOverride = useMemo(
    () => detectOverrides(pairMetadata, form.localData, loadingPair),
    [pairMetadata, form.localData, loadingPair]
  );

  // 7. Reset settings (clear all overrides)
  const resetSettings = useCallback(async () => {
    const cleared = createClearedSettings(
      defaults.numFrames ?? 25,
      defaults.makePrimaryVariant ?? true
    );

    // Save cleared settings, then clear enhanced prompt.
    // ClearableSegmentSettings uses null to indicate "clear override" - the save
    // function interprets nulls correctly via buildMetadataUpdate.
    await form.saveData(cleared as SegmentFormSettings);
    await mutations.clearEnhancedPrompt();
    form.reset();
  }, [form, mutations, defaults]);

  // 8. Get effective settings for task creation (merges with shot defaults)
  const getSettingsForTaskCreation = useCallback((): SegmentSettings => {
    const currentSettings = form.data;
    return {
      prompt: currentSettings.prompt ?? shotDefaults.prompt,
      negativePrompt: currentSettings.negativePrompt ?? shotDefaults.negativePrompt,
      textBeforePrompts: currentSettings.textBeforePrompts ?? shotDefaults.textBeforePrompts,
      textAfterPrompts: currentSettings.textAfterPrompts ?? shotDefaults.textAfterPrompts,
      motionMode: currentSettings.motionMode ?? shotDefaults.motionMode,
      amountOfMotion: currentSettings.amountOfMotion ?? shotDefaults.amountOfMotion,
      phaseConfig: currentSettings.phaseConfig ?? shotDefaults.phaseConfig,
      selectedPhasePresetId: currentSettings.selectedPhasePresetId ?? shotDefaults.selectedPhasePresetId,
      loras: currentSettings.loras ?? shotDefaults.loras,
      numFrames: currentSettings.numFrames,
      randomSeed: currentSettings.randomSeed,
      seed: currentSettings.seed,
      makePrimaryVariant: currentSettings.makePrimaryVariant,
      selectedModel: currentSettings.selectedModel ?? shotDefaults.selectedModel,
      guidanceScale: currentSettings.guidanceScale ?? shotDefaults.guidanceScale,
      inferenceSteps: currentSettings.inferenceSteps ?? shotDefaults.inferenceSteps,
      guidanceMode: currentSettings.guidanceMode ?? shotDefaults.guidanceMode,
      guidanceStrength: currentSettings.guidanceStrength ?? shotDefaults.guidanceStrength,
      guidanceTreatment: currentSettings.guidanceTreatment ?? shotDefaults.guidanceTreatment,
      guidanceUni3cEndPercent: currentSettings.guidanceUni3cEndPercent ?? shotDefaults.guidanceUni3cEndPercent,
      guidanceCannyIntensity: currentSettings.guidanceCannyIntensity ?? shotDefaults.guidanceCannyIntensity,
      guidanceDepthContrast: currentSettings.guidanceDepthContrast ?? shotDefaults.guidanceDepthContrast,
      smoothContinuations: currentSettings.smoothContinuations ?? shotDefaults.smoothContinuations,
    };
  }, [form.data, shotDefaults]);

  // 9. Save as shot defaults with structure video handling
  const saveAsShotDefaults = useCallback(async (): Promise<boolean> => {
    const result = await mutations.saveAsShotDefaults(form.data, shotDefaults);

    if (result && onUpdateStructureVideoDefaults) {
      const hasStructureOverrides =
        form.data.guidanceMode !== undefined ||
        form.data.guidanceStrength !== undefined ||
        form.data.guidanceTreatment !== undefined ||
        form.data.guidanceUni3cEndPercent !== undefined ||
        form.data.guidanceCannyIntensity !== undefined ||
        form.data.guidanceDepthContrast !== undefined;

      if (hasStructureOverrides) {
        await onUpdateStructureVideoDefaults({
          selectedModel: form.data.selectedModel ?? shotDefaults.selectedModel,
          mode: form.data.guidanceMode ?? effectiveStructureVideoDefaults?.mode,
          motionStrength:
            form.data.guidanceStrength ?? effectiveStructureVideoDefaults?.motionStrength,
          treatment: form.data.guidanceTreatment ?? effectiveStructureVideoDefaults?.treatment,
          uni3cEndPercent:
            form.data.guidanceUni3cEndPercent ?? effectiveStructureVideoDefaults?.uni3cEndPercent,
          cannyIntensity:
            form.data.guidanceCannyIntensity ?? effectiveStructureVideoDefaults?.cannyIntensity,
          depthContrast:
            form.data.guidanceDepthContrast ?? effectiveStructureVideoDefaults?.depthContrast,
        });

        // Clear structure overrides from segment
        form.update({
          guidanceMode: undefined,
          guidanceStrength: undefined,
          guidanceTreatment: undefined,
          guidanceUni3cEndPercent: undefined,
          guidanceCannyIntensity: undefined,
          guidanceDepthContrast: undefined,
        });
      }
    }

    return result;
  }, [effectiveStructureVideoDefaults, form, mutations, onUpdateStructureVideoDefaults, shotDefaults]);

  const saveFieldAsDefault = useCallback(async (
    field: keyof SegmentSettings,
    value: unknown,
  ): Promise<boolean> => {
    if (
      field === 'guidanceMode'
      || field === 'guidanceStrength'
      || field === 'guidanceTreatment'
      || field === 'guidanceUni3cEndPercent'
      || field === 'guidanceCannyIntensity'
      || field === 'guidanceDepthContrast'
    ) {
      if (!onUpdateStructureVideoDefaults) {
        return false;
      }

      await onUpdateStructureVideoDefaults({
        selectedModel: form.data.selectedModel ?? shotDefaults.selectedModel,
        ...(field === 'guidanceMode' ? { mode: value as TravelGuidanceMode } : {}),
        ...(field === 'guidanceStrength' ? { motionStrength: value as number } : {}),
        ...(field === 'guidanceTreatment' ? { treatment: value as 'adjust' | 'clip' } : {}),
        ...(field === 'guidanceUni3cEndPercent' ? { uni3cEndPercent: value as number } : {}),
        ...(field === 'guidanceCannyIntensity' ? { cannyIntensity: value as number } : {}),
        ...(field === 'guidanceDepthContrast' ? { depthContrast: value as number } : {}),
      });
      return true;
    }

    return mutations.saveFieldAsDefault(field, value);
  }, [form.data.selectedModel, mutations, onUpdateStructureVideoDefaults, shotDefaults.selectedModel]);

  // 9. Extract enhanced prompt from metadata
  const enhancedPrompt = pairMetadata?.enhanced_prompt?.trim() || undefined;
  const basePromptForEnhancement = pairMetadata?.base_prompt_for_enhancement?.trim() || undefined;
  const enhancePromptEnabled = pairMetadata?.enhance_prompt_enabled;

  // 10. Convert shot settings to legacy ShotBatchSettings format for compatibility
  const shotBatchSettings = useMemo((): ShotBatchSettings | null => {
    if (!shotVideoSettings) return null;
    return {
      amountOfMotion: shotVideoSettings.amountOfMotion / 100,
      motionMode: shotVideoSettings.motionMode,
      selectedLoras: shotVideoSettings.loras,
      phaseConfig: shotVideoSettings.phaseConfig,
      prompt: shotVideoSettings.prompt,
      negativePrompt: shotVideoSettings.negativePrompt,
    };
  }, [shotVideoSettings]);

  return {
    // Form state
    settings: form.data,
    updateSettings: (updates) => form.update({ ...updates }),
    saveSettings: form.save,
    resetSettings,
    isDirty: form.isDirty,
    isLoading: form.isLoading,

    // Override tracking
    hasOverride,
    shotDefaults,

    // Shot-level operations
    saveAsShotDefaults,
    saveFieldAsDefault,

    // Task creation
    getSettingsForTaskCreation,

    // Enhanced prompt
    enhancedPrompt,
    basePromptForEnhancement,
    clearEnhancedPrompt: mutations.clearEnhancedPrompt,
    enhancePromptEnabled,
    saveEnhancePromptEnabled: mutations.saveEnhancePromptEnabled,

    // For debugging/compatibility
    pairMetadata: pairMetadata ?? null,
    shotBatchSettings,
  };
}
