import type {
  StructureGuidanceConfig,
  StructureVideoConfigWithMetadata,
} from '@/shared/lib/tasks/travelBetweenImages';
import type { PhaseConfig } from '@/shared/types/phaseConfig';
import type { LoraModel } from '@/domains/lora/types/lora';
import type { AuthoredVideoMetadata } from '@/shared/lib/media/videoUploader';
import type { SelectedModel } from '@/tools/travel-between-images/settings';
import type { TravelGuidanceMode } from '@/shared/lib/tasks/travelGuidance';
import type { PresetMetadata } from '@/shared/types/presetMetadata';

export interface TaskData {
  params: Record<string, unknown>;
  orchestrator: Record<string, unknown>;
}

export type FetchTaskResult =
  | { status: 'found'; taskData: TaskData }
  | { status: 'missing' };

export interface ExtractedPromptSettings {
  prompt?: string;
  prompts?: string[];
  negativePrompt?: string;
  negativePrompts?: string[];
}

export interface ExtractedGenerationSettings {
  steps?: number;
  frames?: number;
  segmentFramesExpanded?: number[];
  context?: number;
  model?: string;
  guidanceScale?: number;
  selectedModel?: SelectedModel;
}

export interface ExtractedImageSettings {
  inputImages?: string[];
}

export interface ExtractedModeSettings {
  generationMode?: 'batch' | 'timeline' | 'by-pair';
  generationTypeMode?: 'i2v' | 'vace';
  smoothContinuations?: boolean;
  advancedMode?: boolean;
  motionMode?: 'basic' | 'presets' | 'advanced';
}

export interface ExtractedAdvancedSettings {
  phaseConfig?: PhaseConfig;
  selectedPhasePresetId?: string | null;
  turboMode?: boolean;
  enhancePrompt?: boolean;
}

export interface ExtractedTextAddonSettings {
  textBeforePrompts?: string;
  textAfterPrompts?: string;
}

export interface ExtractedMotionSettings {
  amountOfMotion?: number;
}

export interface ExtractedLoraSettings {
  loras?: Array<{ path: string; strength: number }>;
}

export interface ExtractedStructureVideoSettings {
  presentInTask: boolean;
  structureGuidance?: StructureGuidanceConfig;
  structureVideos?: StructureVideoConfigWithMetadata[];
}

export interface ExtractedSettings {
  prompts: ExtractedPromptSettings;
  generation: ExtractedGenerationSettings;
  images: ExtractedImageSettings;
  modes: ExtractedModeSettings;
  advanced: ExtractedAdvancedSettings;
  textAddons: ExtractedTextAddonSettings;
  motion: ExtractedMotionSettings;
  loras: ExtractedLoraSettings;
  structure: ExtractedStructureVideoSettings;
}

export interface ApplyResult {
  success: boolean;
  settingName: string;
  error?: string;
  details?: Record<string, unknown> | string;
}

export interface ApplyModelContext {
  steerableMotionSettings: { model_name: string };
  onSteerableMotionSettingsChange: (settings: { model_name?: string; negative_prompt?: string }) => void;
  onSelectedModelChange?: (model: SelectedModel) => void;
}

export interface ApplyPromptContext {
  onBatchVideoPromptChange: (prompt: string) => void;
  onSteerableMotionSettingsChange: (settings: { model_name?: string; negative_prompt?: string }) => void;
  updatePairPromptsByIndex?: (index: number, prompt: string, negativePrompt: string) => Promise<void>;
}

export interface ApplyGenerationContext {
  onBatchVideoFramesChange: (frames: number) => void;
  onBatchVideoStepsChange: (steps: number) => void;
  onGuidanceScaleChange?: (guidanceScale: number) => void;
}

export interface ApplyModeContext {
  onGenerationModeChange: (mode: 'batch' | 'timeline' | 'by-pair') => void;
  onAdvancedModeChange: (advanced: boolean) => void;
  onMotionModeChange?: (mode: 'basic' | 'advanced') => void;
  onGenerationTypeModeChange?: (mode: 'i2v' | 'vace') => void;
  onSmoothContinuationsChange?: (enabled: boolean) => void;
}

export interface ApplyAdvancedContext {
  onPhaseConfigChange: (config: PhaseConfig) => void;
  onPhasePresetSelect?: (presetId: string, config: PhaseConfig, presetMetadata?: PresetMetadata) => void;
  onPhasePresetRemove?: () => void;
  onTurboModeChange?: (turbo: boolean) => void;
  onEnhancePromptChange?: (enhance: boolean) => void;
}

export interface ApplyTextAddonContext {
  onTextBeforePromptsChange?: (text: string) => void;
  onTextAfterPromptsChange?: (text: string) => void;
}

export interface ApplyMotionContext {
  onAmountOfMotionChange?: (motion: number) => void;
}

export interface ApplyStructureVideoContext {
  onStructureVideoInputChange: (
    videoPath: string | null,
    metadata: AuthoredVideoMetadata | null,
    treatment: 'adjust' | 'clip',
    motionStrength: number,
    structureType: TravelGuidanceMode,
    resourceId?: string,
  ) => void;
}

export interface ApplyLoraContext {
  loraManager: {
    setSelectedLoras?: (loras: Array<{
      id: string;
      name: string;
      path: string;
      strength: number;
      [key: string]: unknown;
    }>) => void;
    handleAddLora: (lora: LoraModel, showToast: boolean, strength: number) => void;
  };
  availableLoras: LoraModel[];
}
