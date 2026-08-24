import { useMemo } from 'react';
import type { DisplayableMetadata } from '@/shared/types/displayableMetadata';
import { getDisplayNameFromUrl } from '@/domains/lora/lib/loraUtils';

type Variant = 'hover' | 'modal' | 'panel';

interface UseImageGenerationDetailsViewModelInput {
  metadata: DisplayableMetadata;
  variant: Variant;
  isMobile: boolean;
}

interface DisplayLora {
  name: string;
  strength: string;
}

interface StyleReferenceViewModel {
  image: string;
  styleStrength?: number;
  subjectStrength?: number;
  sceneStrength?: number;
  imageWidth: number;
  imageHeight: number;
}

interface ImageGenerationDetailsViewModel {
  config: {
    textSize: string;
    fontWeight: string;
    iconSize: string;
    labelCase: string;
    gridCols: string;
    promptLength: number;
    negativePromptLength: number;
    loraNameLength: number;
    maxLoras: number;
  };
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  resolution?: string;
  dimensions?: string;
  steps?: number;
  hiresScale?: number;
  hiresSteps?: number;
  hiresDenoise?: number;
  lightningPhase1?: number;
  lightningPhase2?: number;
  lorasToDisplay: DisplayLora[];
  hasAdditionalSettings: boolean;
  isQwenImageEdit: boolean;
  qwenSourceImage?: string;
  styleReference?: StyleReferenceViewModel;
  userProvidedImageFilename?: string;
}

const variantConfig: Record<Variant, Omit<ImageGenerationDetailsViewModel['config'], 'promptLength' | 'negativePromptLength'> & {
  promptLength: number | ((isMobile: boolean) => number);
  negativePromptLength: number | ((isMobile: boolean) => number);
}> = {
  hover: {
    textSize: 'text-xs',
    fontWeight: 'font-light',
    iconSize: 'h-2.5 w-2.5',
    labelCase: 'uppercase tracking-wide',
    gridCols: 'grid-cols-1',
    promptLength: 100,
    negativePromptLength: 80,
    loraNameLength: 25,
    maxLoras: 2,
  },
  modal: {
    textSize: 'text-sm',
    fontWeight: 'font-light',
    iconSize: 'h-3 w-3',
    labelCase: 'uppercase tracking-wide',
    gridCols: 'grid-cols-2',
    promptLength: 150,
    negativePromptLength: 150,
    loraNameLength: 30,
    maxLoras: 10,
  },
  panel: {
    textSize: 'text-sm',
    fontWeight: 'font-light',
    iconSize: 'h-3 w-3',
    labelCase: 'uppercase tracking-wide',
    gridCols: 'grid-cols-2',
    promptLength: (mobile) => mobile ? 100 : 150,
    negativePromptLength: (mobile) => mobile ? 100 : 150,
    loraNameLength: 40,
    maxLoras: 10,
  },
};

function resolveLength(
  value: number | ((isMobile: boolean) => number),
  isMobile: boolean,
): number {
  return typeof value === 'function' ? value(isMobile) : value;
}

function parseResolutionDimensions(...values: Array<string | undefined>): number | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const match = value.match(/(\d+)[×x](\d+)/);
    if (!match) {
      continue;
    }
    const [, width, height] = match;
    const parsedWidth = Number.parseInt(width, 10);
    const parsedHeight = Number.parseInt(height, 10);
    if (parsedWidth > 0 && parsedHeight > 0) {
      return parsedWidth / parsedHeight;
    }
  }
  return undefined;
}

function formatLoraStrengthPercent(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return '100%';
  }
  return `${(numeric * 100).toFixed(0)}%`;
}

function deriveUserProvidedImageFilename(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }
  const segments = url.split('/');
  return segments[segments.length - 1] || 'Image provided';
}

export function useImageGenerationDetailsViewModel({
  metadata,
  variant,
  isMobile,
}: UseImageGenerationDetailsViewModelInput): ImageGenerationDetailsViewModel {
  return useMemo(() => {
    const baseConfig = variantConfig[variant];
    const config = {
      ...baseConfig,
      promptLength: resolveLength(baseConfig.promptLength, isMobile),
      negativePromptLength: resolveLength(baseConfig.negativePromptLength, isMobile),
    };

    const prompt = metadata.prompt
      || metadata.originalParams?.orchestrator_details?.prompt;

    const negativePrompt = metadata.originalParams?.orchestrator_details?.negative_prompt
      || metadata.negative_prompt;

    const model = metadata.model || metadata.originalParams?.model || metadata.originalParams?.orchestrator_details?.model;
    const resolution = metadata.originalParams?.orchestrator_details?.resolution || metadata.resolution;
    const dimensions = metadata.width && metadata.height ? `${metadata.width}×${metadata.height}` : resolution;

    const steps = metadata.steps || metadata.originalParams?.steps;
    const hiresScale = metadata.hires_scale || metadata.originalParams?.hires_scale;
    const hiresSteps = metadata.hires_steps || metadata.originalParams?.hires_steps;
    const hiresDenoise = metadata.hires_denoise || metadata.originalParams?.hires_denoise;
    const lightningPhase1 = metadata.lightning_lora_strength_phase_1 || metadata.originalParams?.lightning_lora_strength_phase_1;
    const lightningPhase2 = metadata.lightning_lora_strength_phase_2 || metadata.originalParams?.lightning_lora_strength_phase_2;

    const additionalLoras = metadata.originalParams?.orchestrator_details?.additional_loras;
    const activeLoras = metadata.activeLoras;

    const lorasToDisplay = activeLoras && activeLoras.length > 0
      ? activeLoras.map((lora) => ({
          name: getDisplayNameFromUrl(lora.path, undefined, lora.name || lora.id) || 'Unknown',
          strength: `${lora.strength}%`,
        }))
      : additionalLoras && Object.keys(additionalLoras).length > 0
        ? Object.entries(additionalLoras).map(([url, strength]) => ({
            name: getDisplayNameFromUrl(url) || 'Unknown',
            strength: formatLoraStrengthPercent(strength),
          }))
        : [];

    const hasAdditionalSettings = metadata.depthStrength !== undefined
      || metadata.softEdgeStrength !== undefined
      || Boolean(metadata.userProvidedImageUrl);

    const isQwenImageEdit = metadata.tool_type === 'qwen_image_edit'
      || metadata.qwen_endpoint === 'qwen-image-edit'
      || metadata.originalParams?.qwen_endpoint === 'qwen-image-edit';

    const qwenSourceImage = metadata.image || metadata.originalParams?.image;

    const styleImage = metadata.style_reference_image || metadata.originalParams?.style_reference_image;
    const styleStrength = metadata.style_reference_strength ?? metadata.originalParams?.style_reference_strength;
    const subjectStrength = metadata.subject_strength ?? metadata.originalParams?.subject_strength;
    const sceneStrength = metadata.scene_reference_strength ?? metadata.originalParams?.scene_reference_strength;

    let styleReference: StyleReferenceViewModel | undefined;
    if (styleImage && styleImage !== '') {
      const aspectRatio = parseResolutionDimensions(
        metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : undefined,
        metadata.resolution,
        metadata.originalParams?.resolution,
        dimensions,
        resolution,
      ) ?? 1;

      const imageWidth = 120;
      const imageHeight = imageWidth / aspectRatio;
      styleReference = {
        image: styleImage,
        styleStrength: styleStrength ?? undefined,
        subjectStrength: subjectStrength ?? undefined,
        sceneStrength: sceneStrength ?? undefined,
        imageWidth,
        imageHeight,
      };
    }

    return {
      config,
      prompt: prompt ?? undefined,
      negativePrompt: negativePrompt ?? undefined,
      model: model ?? undefined,
      resolution: resolution ?? undefined,
      dimensions: dimensions ?? undefined,
      steps: steps ?? undefined,
      hiresScale: hiresScale ?? undefined,
      hiresSteps: hiresSteps ?? undefined,
      hiresDenoise: hiresDenoise ?? undefined,
      lightningPhase1: lightningPhase1 ?? undefined,
      lightningPhase2: lightningPhase2 ?? undefined,
      lorasToDisplay,
      hasAdditionalSettings,
      isQwenImageEdit,
      qwenSourceImage: qwenSourceImage ?? undefined,
      styleReference,
      userProvidedImageFilename: deriveUserProvidedImageFilename(metadata.userProvidedImageUrl ?? undefined),
    };
  }, [isMobile, metadata, variant]);
}
