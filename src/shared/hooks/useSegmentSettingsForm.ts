/**
 * useSegmentSettingsForm - Combines useSegmentSettings with form-ready props
 *
 * This hook wraps useSegmentSettings and returns props that can be spread
 * directly onto SegmentSettingsForm, reducing duplication across the 3+
 * components that render segment settings forms.
 *
 * Usage:
 * ```tsx
 * const { formProps, getSettingsForTaskCreation, saveSettings } = useSegmentSettingsForm({
 *   pairShotGenerationId,
 *   shotId,
 *   defaults: { prompt: '', negativePrompt: '', numFrames: 25 },
 * });
 *
 * const handleSubmit = async () => {
 *   await saveSettings();
 *   const settings = getSettingsForTaskCreation();
 *   const taskParams = buildTaskParams(settings, context);
 *   await createTask(taskParams);
 * };
 *
 * return <SegmentSettingsForm {...formProps} onSubmit={handleSubmit} />;
 * ```
 */

import { useMemo, useRef, useCallback, useState } from 'react';
import { useSegmentSettings, UseSegmentSettingsOptions } from './segments';
import type { SegmentSettingsFormProps } from '@/shared/components/SegmentSettingsForm/types';
import type { StructureVideoConfigWithMetadata } from '@/shared/lib/tasks/travelBetweenImages';
import type { TravelGuidanceMode } from '@/shared/lib/tasks/travelGuidance';
import type { SelectedModel } from '@/tools/travel-between-images/modelCapabilities';

interface StructureVideoDefaultsValue {
  mode?: TravelGuidanceMode;
  motionStrength: number;
  treatment: 'adjust' | 'clip';
  uni3cEndPercent: number;
  cannyIntensity?: number;
  depthContrast?: number;
}

interface UseSegmentSettingsFormOptions extends UseSegmentSettingsOptions {
  // These are passed through to the form
  segmentIndex?: number;
  startImageUrl?: string;
  endImageUrl?: string;
  modelName?: string;
  resolution?: string;
  isRegeneration?: boolean;
  buttonLabel?: string;
  showHeader?: boolean;
  queryKeyPrefix?: string;
  maxFrames?: number;
  // Structure video context
  structureVideoType?: TravelGuidanceMode | null;
  structureVideoUrl?: string;
  structureVideoFrameRange?: {
    segmentStart: number;
    segmentEnd: number;
    videoTotalFrames: number;
    videoFps: number;
  };
  /**
   * Callback to update structure video defaults when "Save as Shot Defaults" is clicked.
   * Structure videos are stored separately from tool settings, so the parent must provide this.
   * Returns a Promise so we can await it before showing success.
   */
  onUpdateStructureVideoDefaults?: (updates: {
    selectedModel?: SelectedModel;
    motionStrength?: number;
    treatment?: 'adjust' | 'clip';
    uni3cEndPercent?: number;
    mode?: TravelGuidanceMode;
    cannyIntensity?: number;
    depthContrast?: number;
  }) => Promise<void>;
  structureVideoDefaultsByModel?: Partial<Record<SelectedModel, StructureVideoDefaultsValue>>;

  // Per-segment structure video management (Timeline Mode only)
  /** Whether in timeline mode (shows structure video upload) vs batch mode (preview only) */
  isTimelineMode?: boolean;
  /** Callback to add a structure video for this segment */
  onAddSegmentStructureVideo?: (video: StructureVideoConfigWithMetadata) => void;
  /** Callback to update this segment's structure video */
  onUpdateSegmentStructureVideo?: (updates: Partial<StructureVideoConfigWithMetadata>) => void;
  /** Callback to remove this segment's structure video */
  onRemoveSegmentStructureVideo?: () => void;

  // Navigation to constituent images
  /** Generation ID for the start image (for variant picking) */
  startImageGenerationId?: string;
  /** Generation ID for the end image (for variant picking) */
  endImageGenerationId?: string;
  /** Shot generation ID for the start image (for navigation) */
  startImageShotGenerationId?: string;
  /** Shot generation ID for the end image (for navigation) */
  endImageShotGenerationId?: string;
  /** Callback to navigate to a constituent image by shot_generation.id */
  onNavigateToImage?: (shotGenerationId: string) => void;
}

interface UseSegmentSettingsFormReturn {
  /**
   * Props to spread onto SegmentSettingsForm.
   * Includes: settings, onChange, hasOverride, shotDefaults,
   * onRestoreDefaults, onSaveAsShotDefaults, and display props.
   *
   * Does NOT include: onSubmit, isSubmitting, onFrameCountChange
   * (these are context-specific and must be provided by the parent)
   */
  formProps: Omit<SegmentSettingsFormProps, 'onSubmit' | 'isSubmitting' | 'onFrameCountChange'>;

  /**
   * Get effective settings for task creation (merged with shot defaults).
   * Call this when building task params.
   */
  getSettingsForTaskCreation: ReturnType<typeof useSegmentSettings>['getSettingsForTaskCreation'];

  /**
   * Save current settings to database.
   * Call this before creating a task.
   */
  saveSettings: ReturnType<typeof useSegmentSettings>['saveSettings'];

  /**
   * Update settings (for external triggers like loading variant params).
   */
  updateSettings: ReturnType<typeof useSegmentSettings>['updateSettings'];

  /**
   * Current settings (for reading values outside the form).
   */
  settings: ReturnType<typeof useSegmentSettings>['settings'];

  /**
   * Loading state.
   */
  isLoading: boolean;

  /**
   * Whether settings have been modified.
   */
  isDirty: boolean;

  /**
   * Effective enhance prompt enabled value (persisted preference ?? false).
   * Use this for display. For submit handlers, use enhancePromptRef.current
   * to avoid stale closure issues.
   */
  effectiveEnhanceEnabled: boolean;

  /**
   * Ref for synchronous access to enhance prompt state in submit handlers.
   * Avoids stale closure when user toggles and immediately submits.
   */
  enhancePromptRef: React.MutableRefObject<boolean>;

  /**
   * Handle enhance prompt toggle. Updates ref synchronously and persists to DB.
   */
  handleEnhancePromptChange: (enabled: boolean) => void;

}

interface UseEnhancePromptToggleInput {
  enhancePromptEnabled: boolean | undefined;
  saveEnhancePromptEnabled: (enabled: boolean) => Promise<boolean>;
}

interface SegmentSettingsFormPropsInput {
  settings: ReturnType<typeof useSegmentSettings>['settings'];
  updateSettings: ReturnType<typeof useSegmentSettings>['updateSettings'];
  hasOverride: ReturnType<typeof useSegmentSettings>['hasOverride'];
  shotDefaults: ReturnType<typeof useSegmentSettings>['shotDefaults'];
  isDirty: ReturnType<typeof useSegmentSettings>['isDirty'];
  resetSettings: ReturnType<typeof useSegmentSettings>['resetSettings'];
  saveAsShotDefaults: ReturnType<typeof useSegmentSettings>['saveAsShotDefaults'];
  saveFieldAsDefault: ReturnType<typeof useSegmentSettings>['saveFieldAsDefault'];
  enhancedPrompt: ReturnType<typeof useSegmentSettings>['enhancedPrompt'];
  basePromptForEnhancement: ReturnType<typeof useSegmentSettings>['basePromptForEnhancement'];
  clearEnhancedPrompt: ReturnType<typeof useSegmentSettings>['clearEnhancedPrompt'];
  effectiveEnhanceEnabled: boolean;
  handleEnhancePromptChange: (enabled: boolean) => void;
  options: UseSegmentSettingsFormOptions;
}

function useEnhancePromptToggle({
  saveEnhancePromptEnabled,
}: UseEnhancePromptToggleInput): {
  effectiveEnhanceEnabled: boolean;
  enhancePromptRef: React.MutableRefObject<boolean>;
  handleEnhancePromptChange: (enabled: boolean) => void;
} {
  // Always start with enhance prompt disabled — don't persist preference across form opens.
  const [localEnabled, setLocalEnabled] = useState(false);
  const enhancePromptRef = useRef(false);
  enhancePromptRef.current = localEnabled;

  const handleEnhancePromptChange = useCallback((enabled: boolean) => {
    enhancePromptRef.current = enabled;
    setLocalEnabled(enabled);
    saveEnhancePromptEnabled(enabled);
  }, [saveEnhancePromptEnabled]);

  return {
    effectiveEnhanceEnabled: localEnabled,
    enhancePromptRef,
    handleEnhancePromptChange,
  };
}

function useBuiltSegmentSettingsFormProps(input: SegmentSettingsFormPropsInput) {
  const {
    settings,
    updateSettings,
    hasOverride,
    shotDefaults,
    isDirty,
    resetSettings,
    saveAsShotDefaults,
    saveFieldAsDefault,
    enhancedPrompt,
    basePromptForEnhancement,
    clearEnhancedPrompt,
    effectiveEnhanceEnabled,
    handleEnhancePromptChange,
    options,
  } = input;

  const {
    segmentIndex,
    startImageUrl,
    endImageUrl,
    modelName,
    resolution,
    isRegeneration = false,
    buttonLabel,
    showHeader = false,
    queryKeyPrefix,
    maxFrames,
    structureVideoType,
    structureVideoDefaults,
    structureVideoUrl,
    structureVideoFrameRange,
    isTimelineMode,
    onAddSegmentStructureVideo,
    onUpdateSegmentStructureVideo,
    onRemoveSegmentStructureVideo,
    startImageGenerationId,
    endImageGenerationId,
    startImageShotGenerationId,
    endImageShotGenerationId,
    onNavigateToImage,
  } = options;

  return useMemo(() => ({
    settings,
    onChange: updateSettings,
    hasOverride,
    shotDefaults,
    isDirty,
    onRestoreDefaults: resetSettings,
    onSaveAsShotDefaults: saveAsShotDefaults,
    onSaveFieldAsDefault: saveFieldAsDefault,
    enhancedPrompt,
    basePromptForEnhancement,
    onClearEnhancedPrompt: clearEnhancedPrompt,
    enhancePromptEnabled: effectiveEnhanceEnabled,
    onEnhancePromptChange: handleEnhancePromptChange,
    segmentIndex,
    startImageUrl,
    endImageUrl,
    modelName,
    resolution,
    isRegeneration,
    buttonLabel,
    showHeader,
    queryKeyPrefix,
    maxFrames,
    structureVideoType,
    structureVideoDefaults: structureVideoDefaults ?? undefined,
    structureVideoUrl,
    structureVideoFrameRange,
    isTimelineMode,
    onAddSegmentStructureVideo,
    onUpdateSegmentStructureVideo,
    onRemoveSegmentStructureVideo,
    startImageGenerationId,
    endImageGenerationId,
    startImageShotGenerationId,
    endImageShotGenerationId,
    onNavigateToImage,
  }), [
    settings,
    updateSettings,
    hasOverride,
    shotDefaults,
    isDirty,
    resetSettings,
    saveAsShotDefaults,
    saveFieldAsDefault,
    enhancedPrompt,
    basePromptForEnhancement,
    clearEnhancedPrompt,
    effectiveEnhanceEnabled,
    handleEnhancePromptChange,
    segmentIndex,
    startImageUrl,
    endImageUrl,
    modelName,
    resolution,
    isRegeneration,
    buttonLabel,
    showHeader,
    queryKeyPrefix,
    maxFrames,
    structureVideoType,
    structureVideoDefaults,
    structureVideoUrl,
    structureVideoFrameRange,
    isTimelineMode,
    onAddSegmentStructureVideo,
    onUpdateSegmentStructureVideo,
    onRemoveSegmentStructureVideo,
    startImageGenerationId,
    endImageGenerationId,
    startImageShotGenerationId,
    endImageShotGenerationId,
    onNavigateToImage,
  ]);
}

export function useSegmentSettingsForm(
  options: UseSegmentSettingsFormOptions
): UseSegmentSettingsFormReturn {
  const {
    pairShotGenerationId,
    shotId,
    defaults,
    structureVideoDefaults,
    structureVideoDefaultsByModel,
    onUpdateStructureVideoDefaults,
  } = options;

  // Get all segment settings data
  const {
    settings,
    updateSettings,
    saveSettings,
    resetSettings,
    saveAsShotDefaults,
    saveFieldAsDefault,
    getSettingsForTaskCreation,
    isLoading,
    isDirty,
    hasOverride,
    shotDefaults,
    enhancedPrompt,
    basePromptForEnhancement,
    clearEnhancedPrompt,
    enhancePromptEnabled,
    saveEnhancePromptEnabled,
  } = useSegmentSettings({
    pairShotGenerationId,
    shotId,
    defaults,
    structureVideoDefaults,
    structureVideoDefaultsByModel,
    onUpdateStructureVideoDefaults,
  });

  const {
    effectiveEnhanceEnabled,
    enhancePromptRef,
    handleEnhancePromptChange,
  } = useEnhancePromptToggle({
    enhancePromptEnabled,
    saveEnhancePromptEnabled,
  });

  const formProps = useBuiltSegmentSettingsFormProps({
    settings,
    updateSettings,
    hasOverride,
    shotDefaults,
    isDirty,
    resetSettings,
    saveAsShotDefaults,
    saveFieldAsDefault,
    enhancedPrompt,
    basePromptForEnhancement,
    clearEnhancedPrompt,
    effectiveEnhanceEnabled,
    handleEnhancePromptChange,
    options,
  });

  return {
    formProps,
    getSettingsForTaskCreation,
    saveSettings,
    updateSettings,
    settings,
    isLoading,
    isDirty,
    // Enhance prompt consolidated API
    effectiveEnhanceEnabled,
    enhancePromptRef,
    handleEnhancePromptChange,
  };
}
