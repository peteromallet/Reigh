/**
 * Media dimension extraction utilities
 *
 * Shared by ImageLightbox and VideoLightbox to compute image dimensions
 * from generation params/metadata (resolution, aspect ratio).
 */

import { ASPECT_RATIO_TO_RESOLUTION, findClosestAspectRatio, parseRatio } from '@/shared/lib/media/aspectRatios';
import type { GenerationParams } from '@/domains/generation/types';

/**
 * Parse a "WxH" resolution string into { width, height }.
 */
export function resolutionToDimensions(resolution: string): { width: number; height: number } | null {
  if (!resolution || typeof resolution !== 'string' || !resolution.includes('x')) return null;
  const [w, h] = resolution.split('x').map(Number);
  if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
    return { width: w, height: h };
  }
  return null;
}

/**
 * Convert an aspect ratio string (e.g. "16:9") to pixel dimensions
 * by finding the closest known resolution mapping.
 */
export function aspectRatioToDimensions(aspectRatio: string): { width: number; height: number } | null {
  if (!aspectRatio) return null;
  const directResolution = ASPECT_RATIO_TO_RESOLUTION[aspectRatio];
  if (directResolution) return resolutionToDimensions(directResolution);
  const ratio = parseRatio(aspectRatio);
  if (!isNaN(ratio)) {
    const closestAspectRatio = findClosestAspectRatio(ratio);
    const closestResolution = ASPECT_RATIO_TO_RESOLUTION[closestAspectRatio];
    if (closestResolution) return resolutionToDimensions(closestResolution);
  }
  return null;
}

interface MediaLike {
  params?: GenerationParams | Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

/**
 * Extract dimensions from a media object by checking, in priority order:
 *   1. metadata.width/height
 *   2. Various resolution fields (params, metadata, orchestrator_details)
 *   3. Various aspect_ratio fields
 *
 * @param media - The media object with params/metadata
 * @param extended - When true, checks extended resolution/aspect-ratio sources
 *                   (orchestrator_details, custom_aspect_ratio). ImageLightbox uses
 *                   extended=true, VideoLightbox uses extended=false.
 */
export function extractDimensionsFromMedia(
  media: MediaLike | null | undefined,
  extended = false,
): { width: number; height: number } | null {
  if (!media) return null;

  const params = media.params as GenerationParams | undefined;
  const metadata = media.metadata as Record<string, unknown> | undefined;
  const persistedAspectRatio = media.params && typeof media.params === 'object' && 'aspect_ratio' in media.params
    ? media.params.aspect_ratio
    : undefined;

  // Check metadata for width/height (these may exist as extended metadata fields)
  if (metadata?.width && metadata?.height && typeof metadata.width === 'number' && typeof metadata.height === 'number') {
    return { width: metadata.width, height: metadata.height };
  }

  // Build resolution sources - extended adds orchestrator_details and more param paths
  const resolutionSources: unknown[] = [
    params?.resolution,
    (params as Record<string, unknown>)?.originalParams,
    metadata?.resolution,
  ];

  if (extended) {
    resolutionSources.push(
      (params as Record<string, unknown>)?.orchestrator_details,
      (metadata?.originalParams as Record<string, unknown> | undefined)?.resolution,
      ((metadata?.originalParams as Record<string, unknown> | undefined)?.orchestrator_details as Record<string, unknown> | undefined)?.resolution,
    );
  }

  for (const res of resolutionSources) {
    if (typeof res === 'string') {
      const dims = resolutionToDimensions(res);
      if (dims) return dims;
    }
  }

  // Build aspect ratio sources
  const aspectRatioSources: unknown[] = [
    params?.aspectRatio,
    persistedAspectRatio,
    metadata?.aspect_ratio,
  ];

  if (extended) {
    aspectRatioSources.push(
      (params as Record<string, unknown>)?.custom_aspect_ratio,
      (params as Record<string, unknown>)?.originalParams,
      (params as Record<string, unknown>)?.orchestrator_details,
      (metadata?.originalParams as Record<string, unknown> | undefined)?.aspect_ratio,
      ((metadata?.originalParams as Record<string, unknown> | undefined)?.orchestrator_details as Record<string, unknown> | undefined)?.aspect_ratio,
    );
  }

  for (const ar of aspectRatioSources) {
    if (ar && typeof ar === 'string') {
      const dims = aspectRatioToDimensions(ar);
      if (dims) return dims;
    }
  }

  return null;
}
