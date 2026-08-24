/**
 * Loose type for objects that might have generation_id and/or id.
 * Use this when dealing with untyped or loosely-typed media objects.
 */
import type { GenerationRow } from '@/domains/generation/types';

interface MaybeHasGenerationId {
  generation_id?: string | null;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
}

const NON_PRELOADABLE_URL_MARKERS = ['_joined_frame.jpg'] as const;

/**
 * Get the canonical generation ID from a media item.
 * Handles both direct generations (id) and variants (generation_id).
 * Also checks metadata.generation_id for compatibility with various data shapes.
 *
 * Priority: generation_id > metadata.generation_id > id
 *
 * @example
 * // Instead of: (media as unknown).generation_id || media.id
 * const genId = getGenerationId(media);
 */
export function getGenerationId(
  media: MaybeHasGenerationId | null | undefined
): string | null {
  if (!media) return null;
  const metadataGenerationId = typeof media.metadata?.generation_id === 'string'
    ? media.metadata.generation_id
    : null;
  return media.generation_id || metadataGenerationId || media.id || null;
}

/**
 * Centralized preload eligibility contract for URL-based media entries.
 */
export function isPreloadableMediaUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  return !NON_PRELOADABLE_URL_MARKERS.some((marker) => url.includes(marker));
}

/**
 * Media item with various URL properties (normalized across sources)
 */
interface MediaWithUrls {
  location?: string | null;
  url?: string | null;
  thumbnail_url?: string | null;
  thumbUrl?: string | null;
  imageUrl?: string | null;
}

function getFirstNonEmptyUrl(...urls: Array<string | null | undefined>): string | undefined {
  for (const url of urls) {
    if (typeof url !== 'string') {
      continue;
    }

    const trimmed = url.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

export function getMediaUrl(media: MediaWithUrls | null | undefined): string | undefined {
  if (!media) return undefined;
  return getFirstNonEmptyUrl(media.location, media.url, media.imageUrl);
}

export function getThumbnailUrl(media: MediaWithUrls | null | undefined): string | undefined {
  if (!media) return undefined;
  return getFirstNonEmptyUrl(media.thumbnail_url, media.thumbUrl);
}

/** Transform a variant to a GenerationRow shape for lightbox display. */
export function variantToGenerationRow(
  media: {
    id: string;
    url: string;
    thumbUrl?: string;
    createdAt?: string;
    starred?: boolean;
    metadata?: { prompt?: string; tool_type?: string; variant_type?: string; generation_id?: string | null };
    generation_id?: string | null;
  },
  mediaType: 'video' | 'image',
): GenerationRow {
  const generationId = getGenerationId(media) ?? media.id;

  return {
    id: media.id,
    generation_id: generationId,
    location: media.url,
    thumbUrl: media.thumbUrl,
    type: mediaType,
    createdAt: media.createdAt,
    params: {
      prompt: media.metadata?.prompt,
      extra: {
        tool_type: media.metadata?.tool_type,
        variant_type: media.metadata?.variant_type,
        variant_id: media.id,
      },
    },
    starred: media.starred ?? false,
  };
}
