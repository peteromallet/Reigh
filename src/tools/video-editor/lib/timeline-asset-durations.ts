import type { GenerationDropData } from '@/shared/lib/dnd/dragDrop';
import type { AssetRegistryEntry } from '@/tools/video-editor/types';

export type VideoDurationContract = {
  assetDurationSeconds: number | null;
  clipSpanSeconds: number | null;
};

export function readPositiveDurationSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function getRegistryAssetDurationSeconds(assetEntry: AssetRegistryEntry | undefined): number | null {
  return readPositiveDurationSeconds(assetEntry?.duration);
}

export function isVideoGenerationDrop(data: GenerationDropData): boolean {
  const contentType = typeof data.metadata?.content_type === 'string'
    ? data.metadata.content_type
    : null;

  return contentType?.startsWith('video/')
    || data.variantType === 'video'
    || /\.(mp4|mov|webm|m4v)$/i.test(data.imageUrl);
}

export function getDroppedGenerationAssetDurationSeconds(data: GenerationDropData): number | null {
  if (!isVideoGenerationDrop(data)) {
    return null;
  }

  return readPositiveDurationSeconds(data.metadata?.duration)
    ?? readPositiveDurationSeconds(data.metadata?.duration_seconds)
    ?? readPositiveDurationSeconds(data.metadata?.original_duration);
}

export function getDroppedGenerationClipSpanSeconds(data: GenerationDropData): number {
  if (!isVideoGenerationDrop(data)) {
    return 5;
  }

  return getDroppedGenerationAssetDurationSeconds(data) ?? 5;
}

export function getFinalVideoDropDurationContract(
  assetDurationSeconds: number | null,
): VideoDurationContract {
  return {
    assetDurationSeconds,
    clipSpanSeconds: assetDurationSeconds ?? 5,
  };
}
