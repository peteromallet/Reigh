const randomToken = (length: number): string =>
  Math.random().toString(36).slice(2, 2 + length);

const sanitizeExtension = (extension: string): string => {
  const normalized = extension.replace(/^\./, '').trim();
  return normalized.length > 0 ? normalized : 'bin';
};

export function generateUniqueFilename(extension: string): string {
  return `${Date.now()}-${randomToken(8)}.${sanitizeExtension(extension)}`;
}

export function generateThumbnailFilename(): string {
  return `thumb_${Date.now()}_${randomToken(6)}.jpg`;
}

function extensionFromFilename(filename: string): string | null {
  const normalized = filename.trim();
  if (!normalized) {
    return null;
  }

  const filePart = normalized.split(/[\\/]/).pop() ?? normalized;
  const sanitizedFilePart = filePart.split(/[?#]/, 1)[0];
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(sanitizedFilePart);
  if (!extensionMatch?.[1]) {
    return null;
  }

  return extensionMatch[1].toLowerCase();
}

function extensionFromMimeType(mimeType: string): string | null {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  if (!subtype) {
    return null;
  }

  return subtype === 'jpeg' ? 'jpg' : subtype;
}

export function getFileExtension(
  filename: string,
  mimeType?: string,
  defaultExt: string = 'bin'
): string {
  const filenameExtension = extensionFromFilename(filename);
  if (filenameExtension) {
    return filenameExtension;
  }

  if (mimeType) {
    const mimeExt = extensionFromMimeType(mimeType);
    if (mimeExt) return mimeExt;
  }

  return defaultExt;
}

export const storagePaths = {
  upload: (userId: string, filename: string): string =>
    `${userId}/uploads/${filename}`,
  thumbnail: (userId: string, filename: string): string =>
    `${userId}/thumbnails/${filename}`,
  taskOutput: (userId: string, taskId: string, filename: string): string =>
    `${userId}/tasks/${taskId}/${filename}`,
  taskThumbnail: (userId: string, taskId: string, filename: string): string =>
    `${userId}/tasks/${taskId}/thumbnails/${filename}`,
};

export const MEDIA_BUCKET = 'image_uploads';

/**
 * Deterministic public-object address for one uploaded media path.
 *
 * Replaces the supabase-js storage public-URL baking cut in B3: the
 * address form is fixed by the storage service, so minting it needs no
 * client call. Only the deferred legacy upload surfaces still consume this —
 * covered-journey media is created server-side and served via R9 content
 * routes (see `bridgeMediaUrl`).
 */
export function publicMediaObjectUrl(storagePath: string, supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${MEDIA_BUCKET}/${storagePath.replace(/^\/+/, '')}`;
}
