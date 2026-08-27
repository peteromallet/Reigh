/** Media-type predicates shared by bridge-backed and in-memory galleries. */

import { hasVideoExtension } from '@/shared/lib/typeGuards';

export interface MediaTypeFilterItem {
  type?: string | null;
  contentType?: string | null;
  local_file_mime?: string | null;
  isVideo?: boolean;
  url?: string | null;
  location?: string | null;
  thumbUrl?: string | null;
}

function hasMimePrefix(value: string | null | undefined, prefix: 'image' | 'video'): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith(`${prefix}/`);
}

function normalizedType(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasImageExtension(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(?:avif|bmp|gif|heic|heif|jpeg|jpg|png|tif|tiff|webp)(?:[?#]|$)/i.test(url);
}

/** Return true only when the item has an actual video signal. */
export function isVideoMedia(item: MediaTypeFilterItem): boolean {
  if (item.isVideo === true) return true;

  const type = normalizedType(item.type);
  if (type === 'video' || type.startsWith('video/')) return true;
  if (hasMimePrefix(item.contentType, 'video') || hasMimePrefix(item.local_file_mime, 'video')) {
    return true;
  }

  return [item.url, item.location, item.thumbUrl].some((url) => hasVideoExtension(url));
}

/**
 * Return true only for image media. Audio and other non-video media must not
 * be inferred as images merely because they are not videos.
 */
export function isImageMedia(item: MediaTypeFilterItem): boolean {
  if (isVideoMedia(item)) return false;

  const type = normalizedType(item.type);
  const hasImageType = type === 'image'
    || type === 'single_image'
    || type.startsWith('image/');

  return hasImageType
    || hasMimePrefix(item.contentType, 'image')
    || hasMimePrefix(item.local_file_mime, 'image')
    || [item.url, item.location, item.thumbUrl].some((url) => hasImageExtension(url));
}
