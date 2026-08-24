import { getDisplayUrl } from '@/shared/lib/media/mediaUrl';
import {
  readSegmentOverrides,
  type SegmentOverrides,
} from '@/shared/lib/settingsMigration';
import { stripModeFromPhaseConfig } from '@/shared/components/SegmentSettingsForm/segmentSettingsUtils';
import type { PhaseConfig } from '@/shared/types/phaseConfig';
import type { ImagePayload, PairConfigPayload, ShotGenRow } from './types';

/**
 * Extract segment overrides from metadata using migration utility.
 * Legacy formats should be migrated before this service is called.
 */
export function extractPairOverrides(metadata: Record<string, unknown> | null | undefined): {
  overrides: SegmentOverrides;
  enhancedPrompt: string | undefined;
} {
  if (!metadata) {
    return { overrides: {}, enhancedPrompt: undefined };
  }

  const overrides = readSegmentOverrides(metadata);
  const enhancedPrompt = metadata.enhanced_prompt as string | undefined;

  return { overrides, enhancedPrompt };
}

/** Filter shot_generations to positioned image rows with valid locations */
export function filterImageShotGenerations(rows: ShotGenRow[]): ShotGenRow[] {
  return rows.filter(shotGen => {
    const hasValidLocation = shotGen.generation?.location && shotGen.generation.location !== '/placeholder.svg';
    return shotGen.generation &&
           shotGen.timeline_frame != null &&
           shotGen.generation.type !== 'video' &&
           !isVideoExtensionLocation(shotGen.generation.location) &&
           hasValidLocation;
  });
}

function isVideoExtensionLocation(location: string | null): boolean {
  return location !== null && /\.(?:mp4|webm|mov|m4v|avi)(?:$|[?#])/i.test(location);
}

export function buildImagePayload(allShotGenerations: ShotGenRow[]): ImagePayload {
  const filteredForUrls = filterImageShotGenerations(allShotGenerations)
    .sort((a, b) => (a.timeline_frame ?? 0) - (b.timeline_frame ?? 0));

  const freshImagesWithIds = filteredForUrls
    .map(shotGen => ({
      location: shotGen.generation?.location,
      generationId: shotGen.generation?.id || shotGen.generation_id,
      primaryVariantId: shotGen.generation?.primary_variant_id || undefined,
      shotGenerationId: shotGen.id,
    }))
    .filter(item => Boolean(item.location));

  const filteredImages = freshImagesWithIds.filter(item => {
    const url = getDisplayUrl(item.location);
    return Boolean(url) && url !== '/placeholder.svg';
  });

  const absoluteImageUrls = filteredImages
    .map(item => getDisplayUrl(item.location))
    .filter((url): url is string => Boolean(url) && url !== '/placeholder.svg');

  // Only include mapped ID arrays when ALL items have the ID.
  // A partial array (some IDs missing) would fail the cardinality check
  // against image_urls, and a partial mapping is useless to the backend anyway.
  const allGenerationIds = filteredImages.map(item => item.generationId);
  const allVariantIds = filteredImages.map(item => item.primaryVariantId);
  const allPairShotGenIds = filteredImages.slice(0, -1).map(item => item.shotGenerationId);

  return {
    absoluteImageUrls,
    imageGenerationIds: allGenerationIds.every(Boolean)
      ? (allGenerationIds as string[])
      : [],
    imageVariantIds: allVariantIds.every(Boolean)
      ? (allVariantIds as string[])
      : [],
    pairShotGenerationIds: allPairShotGenIds.every(Boolean)
      ? (allPairShotGenIds as string[])
      : [],
  };
}

function buildPairMotionSettings(
  overrides: SegmentOverrides,
): Record<string, unknown> | null {
  const hasMotionOverrides = overrides.motionMode !== undefined || overrides.amountOfMotion !== undefined;
  const hasStructureOverrides = overrides.guidanceStrength !== undefined ||
    overrides.guidanceTreatment !== undefined ||
    overrides.guidanceUni3cEndPercent !== undefined ||
    overrides.guidanceCannyIntensity !== undefined ||
    overrides.guidanceDepthContrast !== undefined;

  if (!hasMotionOverrides && !hasStructureOverrides) {
    return null;
  }

  return {
    ...(overrides.amountOfMotion !== undefined && { amount_of_motion: overrides.amountOfMotion / 100 }),
    ...(overrides.motionMode !== undefined && { motion_mode: overrides.motionMode }),
    ...(overrides.guidanceStrength !== undefined && { structure_motion_strength: overrides.guidanceStrength }),
    ...(overrides.guidanceTreatment !== undefined && { structure_treatment: overrides.guidanceTreatment }),
    ...(overrides.guidanceUni3cEndPercent !== undefined && { uni3c_end_percent: overrides.guidanceUni3cEndPercent }),
    ...(overrides.guidanceCannyIntensity !== undefined && { structure_canny_intensity: overrides.guidanceCannyIntensity }),
    ...(overrides.guidanceDepthContrast !== undefined && { structure_depth_contrast: overrides.guidanceDepthContrast }),
  };
}

export function buildTimelinePairConfig(
  allShotGenerations: ShotGenRow[],
  batchVideoFrames: number,
  defaultNegativePrompt: string,
  frameOverlapValue: number = 10,
): PairConfigPayload {
  const pairPrompts: Record<number, { prompt: string; negativePrompt: string }> = {};
  const enhancedPrompts: Record<number, string> = {};
  const pairPhaseConfigsOverrides: Record<number, PhaseConfig> = {};
  const pairLorasOverrides: Record<number, Array<{ path: string; strength: number }>> = {};
  const pairMotionSettingsOverrides: Record<number, Record<string, unknown>> = {};
  const pairNumFramesOverrides: Record<number, number> = {};

  const filteredShotGenerations = filterImageShotGenerations(allShotGenerations);
  const sortedPositions = filteredShotGenerations
    .filter(shotGen => shotGen.timeline_frame != null && shotGen.timeline_frame >= 0)
    .map(shotGen => ({
      id: shotGen.generation?.id || shotGen.generation_id || shotGen.id,
      pos: shotGen.timeline_frame!,
    }))
    .sort((a, b) => a.pos - b.pos);

  for (let i = 0; i < filteredShotGenerations.length - 1; i++) {
    const firstItem = filteredShotGenerations[i];
    const metadata = firstItem.metadata as Record<string, unknown> | null;
    const { overrides, enhancedPrompt } = extractPairOverrides(metadata);

    if (overrides.prompt || overrides.negativePrompt) {
      pairPrompts[i] = {
        prompt: overrides.prompt || '',
        negativePrompt: overrides.negativePrompt || '',
      };
    }
    if (enhancedPrompt) enhancedPrompts[i] = enhancedPrompt;

    const isBasicMode = overrides.motionMode === 'basic';
    if (!isBasicMode && overrides.phaseConfig) {
      pairPhaseConfigsOverrides[i] = overrides.phaseConfig;
    }

    if (overrides.loras && overrides.loras.length > 0) {
      pairLorasOverrides[i] = overrides.loras.map(lora => ({
        path: lora.path,
        strength: lora.strength,
      }));
    }

    const pairMotionSettings = buildPairMotionSettings(overrides);
    if (pairMotionSettings) {
      pairMotionSettingsOverrides[i] = pairMotionSettings;
    }

    if (overrides.numFrames !== undefined) {
      pairNumFramesOverrides[i] = overrides.numFrames;
    }
  }

  const frameGaps: number[] = [];
  for (let i = 0; i < sortedPositions.length - 1; i++) {
    frameGaps.push(sortedPositions[i + 1].pos - sortedPositions[i].pos);
  }

  return {
    basePrompts: frameGaps.length > 0
      ? frameGaps.map((_, index) => pairPrompts[index]?.prompt?.trim() || '')
      : [''],
    segmentFrames: frameGaps.length > 0
      ? frameGaps.map((gap, index) => pairNumFramesOverrides[index] ?? gap)
      : [batchVideoFrames],
    frameOverlap: frameGaps.length > 0 ? frameGaps.map(() => frameOverlapValue) : [frameOverlapValue],
    negativePrompts: frameGaps.length > 0
      ? frameGaps.map((_, index) => pairPrompts[index]?.negativePrompt?.trim() || defaultNegativePrompt)
      : [defaultNegativePrompt],
    enhancedPromptsArray: frameGaps.length > 0
      ? frameGaps.map((_, index) => enhancedPrompts[index] || '')
      : [],
    pairPhaseConfigsArray: frameGaps.length > 0
      ? frameGaps.map((_, index) => pairPhaseConfigsOverrides[index] ? stripModeFromPhaseConfig(pairPhaseConfigsOverrides[index]) : null)
      : [],
    pairLorasArray: frameGaps.length > 0
      ? frameGaps.map((_, index) => pairLorasOverrides[index] || null)
      : [],
    pairMotionSettingsArray: frameGaps.length > 0
      ? frameGaps.map((_, index) => pairMotionSettingsOverrides[index] || null)
      : [],
  };
}

export function buildBatchPairConfig(
  absoluteImageUrls: string[],
  batchVideoFrames: number,
  defaultNegativePrompt: string,
  frameOverlapValue: number = 10,
): PairConfigPayload {
  const numPairs = Math.max(0, absoluteImageUrls.length - 1);
  return {
    basePrompts: numPairs > 0 ? Array(numPairs).fill('') : [''],
    negativePrompts: numPairs > 0 ? Array(numPairs).fill(defaultNegativePrompt) : [defaultNegativePrompt],
    segmentFrames: numPairs > 0 ? Array(numPairs).fill(batchVideoFrames) : [batchVideoFrames],
    frameOverlap: numPairs > 0 ? Array(numPairs).fill(frameOverlapValue) : [frameOverlapValue],
    pairPhaseConfigsArray: numPairs > 0 ? Array(numPairs).fill(null) : [],
    pairLorasArray: numPairs > 0 ? Array(numPairs).fill(null) : [],
    pairMotionSettingsArray: numPairs > 0 ? Array(numPairs).fill(null) : [],
    enhancedPromptsArray: numPairs > 0 ? Array(numPairs).fill('') : [],
  };
}

export function buildByPairConfig(
  allShotGenerations: ShotGenRow[],
  batchVideoFrames: number,
  defaultNegativePrompt: string,
  frameOverlapValue: number = 10,
): PairConfigPayload {
  const filteredShotGenerations = filterImageShotGenerations(allShotGenerations)
    .sort((a, b) => (a.timeline_frame ?? 0) - (b.timeline_frame ?? 0));
  const pairCount = Math.max(0, filteredShotGenerations.length - 1);

  if (pairCount === 0) {
    return {
      basePrompts: [''],
      segmentFrames: [batchVideoFrames],
      frameOverlap: [frameOverlapValue],
      negativePrompts: [defaultNegativePrompt],
      enhancedPromptsArray: [],
      pairPhaseConfigsArray: [],
      pairLorasArray: [],
      pairMotionSettingsArray: [],
    };
  }

  const basePrompts: string[] = [];
  const segmentFrames: number[] = [];
  const frameOverlap: number[] = [];
  const negativePrompts: string[] = [];
  const enhancedPromptsArray: string[] = [];
  const pairPhaseConfigsArray: Array<PhaseConfig | null> = [];
  const pairLorasArray: Array<Array<{ path: string; strength: number }> | null> = [];
  const pairMotionSettingsArray: Array<Record<string, unknown> | null> = [];

  for (let i = 0; i < pairCount; i += 1) {
    const metadata = filteredShotGenerations[i]?.metadata as Record<string, unknown> | null;
    const { overrides, enhancedPrompt } = extractPairOverrides(metadata);

    basePrompts.push(overrides.prompt?.trim() || '');
    segmentFrames.push(overrides.numFrames ?? batchVideoFrames);
    frameOverlap.push(frameOverlapValue);
    negativePrompts.push(overrides.negativePrompt?.trim() || defaultNegativePrompt);
    enhancedPromptsArray.push(enhancedPrompt || '');

    const isBasicMode = overrides.motionMode === 'basic';
    pairPhaseConfigsArray.push(!isBasicMode && overrides.phaseConfig ? stripModeFromPhaseConfig(overrides.phaseConfig) : null);
    pairLorasArray.push(
      overrides.loras?.length
        ? overrides.loras.map((lora) => ({ path: lora.path, strength: lora.strength }))
        : null,
    );
    pairMotionSettingsArray.push(buildPairMotionSettings(overrides));
  }

  return {
    basePrompts,
    segmentFrames,
    frameOverlap,
    negativePrompts,
    enhancedPromptsArray,
    pairPhaseConfigsArray,
    pairLorasArray,
    pairMotionSettingsArray,
  };
}
