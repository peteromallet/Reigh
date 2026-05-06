/**
 * Storage operations for complete_task
 * Handles file uploads, thumbnail generation, and URL retrieval
 */

import { getContentType } from './params.ts';
import type { ParsedRequest } from './request.ts';
import { buildArtifactLifecycleMetadata, storagePaths, MEDIA_BUCKET } from '../_shared/storagePaths.ts';

// ===== TYPES =====

interface StorageBucket {
  getPublicUrl(path: string, options?: { transform?: { width: number; height: number; resize: string; quality: number } }): { data: { publicUrl: string } };
  list(
    path?: string,
    options?: { limit?: number; offset?: number; search?: string },
  ): Promise<{ data: Array<{ name: string }> | null; error: { message: string } | null }>;
  upload(
    path: string,
    data: unknown,
    options: { contentType: string; upsert: boolean; metadata?: Record<string, unknown> },
  ): Promise<{ error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

interface SupabaseStorageClient {
  storage: { from(bucket: string): StorageBucket };
}

interface StorageResult {
  publicUrl: string;
  objectPath: string;
  thumbnailUrl: string | null;
}

// ===== STORAGE OPERATIONS =====

/**
 * Handle all storage operations based on upload mode
 * Returns the public URLs for the main file and thumbnail
 */
export async function handleStorageOperations(
  supabase: SupabaseStorageClient,
  parsedRequest: ParsedRequest,
  userId: string,
  _isServiceRole: boolean
): Promise<StorageResult> {
  let publicUrl: string;
  let objectPath: string;
  let thumbnailUrl: string | null = null;

  if (parsedRequest.storagePath) {
    // MODE 3/4: File already in storage
    objectPath = parsedRequest.storagePath;
    const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath);
    publicUrl = urlData.publicUrl;

    // Get thumbnail URL if path provided
    if (parsedRequest.thumbnailStoragePath) {
      const { data: thumbnailUrlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(parsedRequest.thumbnailStoragePath);
      thumbnailUrl = thumbnailUrlData.publicUrl;
    }
  } else {
    // MODE 1: Upload file from base64
    const effectiveContentType = parsedRequest.fileContentType || getContentType(parsedRequest.filename);
    // Use canonical artifact path: {userId}/tasks/{taskId}/final/{filename}
    objectPath = storagePaths.taskOutput(userId, parsedRequest.taskId, parsedRequest.filename);

    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(objectPath, parsedRequest.fileData as unknown, {
        contentType: effectiveContentType,
        upsert: true,
        metadata: buildArtifactLifecycleMetadata({
          artifactClass: 'final',
          taskId: parsedRequest.taskId,
          contentType: effectiveContentType,
        }),
      });

    if (uploadError) {
      console.warn('Storage upload error:', uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath);
    publicUrl = urlData.publicUrl;

    // Handle thumbnail
    thumbnailUrl = await handleThumbnail(
      supabase,
      parsedRequest,
      userId,
      parsedRequest.taskId,
      publicUrl
    );
  }

  return { publicUrl, objectPath, thumbnailUrl };
}

/**
 * Handle thumbnail upload or generation
 */
async function handleThumbnail(
  supabase: SupabaseStorageClient,
  parsedRequest: ParsedRequest,
  userId: string,
  taskId: string,
  mainFileUrl: string
): Promise<string | null> {
  // If thumbnail was provided, upload it
  if (parsedRequest.thumbnailData && parsedRequest.thumbnailFilename) {
    try {
      // Use canonical thumbnail artifact path: {userId}/tasks/{taskId}/thumbnails/{filename}
      const thumbnailPath = storagePaths.taskThumbnail(userId, taskId, parsedRequest.thumbnailFilename);
      const { error: thumbnailUploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(thumbnailPath, parsedRequest.thumbnailData as unknown, {
          contentType: parsedRequest.thumbnailContentType || getContentType(parsedRequest.thumbnailFilename),
          upsert: true,
          metadata: buildArtifactLifecycleMetadata({
            artifactClass: 'thumbnail',
            taskId,
            contentType: parsedRequest.thumbnailContentType || getContentType(parsedRequest.thumbnailFilename),
          }),
        });

      if (thumbnailUploadError) {
        console.warn('Storage thumbnail upload error:', thumbnailUploadError);
        return null;
      }

      const { data: thumbnailUrlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(thumbnailPath);
      return thumbnailUrlData.publicUrl;
    } catch (thumbnailError) {
      console.warn('Storage thumbnail processing error:', thumbnailError);
      return null;
    }
  }

  // Auto-generate thumbnail for images using Supabase transforms
  const contentType = getContentType(parsedRequest.filename);
  if (contentType.startsWith("image/")) {
    // Pass objectPath for SDK-based transforms (objectPath is available from the caller context)
    const objectPath = storagePaths.taskOutput(userId, taskId, parsedRequest.filename);
    return generateThumbnail(supabase, parsedRequest.fileData!, userId, taskId, mainFileUrl, objectPath);
  }

  return null;
}

/**
 * Auto-generate a thumbnail URL using Supabase Image Transformations
 * Uses the SDK's transform option for proper URL generation
 * Falls back to main image URL if transforms aren't available (requires Pro plan)
 *
 * @see https://supabase.com/docs/guides/storage/serving/image-transformations
 */
function generateThumbnail(
  supabase: SupabaseStorageClient,
  _sourceBytes: Uint8Array,
  _userId: string,
  _taskId: string,
  mainImageUrl: string,
  objectPath?: string
): string {

  // If we have the object path, use the SDK's transform option (recommended)
  if (objectPath) {
    try {
      const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath, {
        transform: {
          width: 400,
          height: 400,
          resize: 'contain',
          quality: 80,
        },
      });
      if (data?.publicUrl) {
        return data.publicUrl;
      }
    } catch {
      return mainImageUrl;
    }
  }

  // Fallback: Use main image URL (works on all plans, just no resizing)
  // This is fine for most use cases - browser will handle display sizing
  return mainImageUrl;
}

/**
 * Build a public URL for a storage path, verifying object existence first.
 */
export async function getStoragePublicUrl(
  supabase: SupabaseStorageClient,
  storagePath: string
): Promise<{ exists: boolean; publicUrl?: string }> {
  try {
    const normalizedPath = storagePath.replace(/^\/+/, '').replace(/\/+$/, '');
    const fileNameStartIndex = normalizedPath.lastIndexOf('/') + 1;
    const folderPath = fileNameStartIndex > 0 ? normalizedPath.slice(0, fileNameStartIndex - 1) : '';
    const fileName = normalizedPath.slice(fileNameStartIndex);

    if (!fileName) {
      return { exists: false };
    }

    const { data: objects, error: listError } = await supabase.storage.from(MEDIA_BUCKET).list(folderPath, {
      limit: 1,
      search: fileName,
    });
    if (listError) {
      return { exists: false };
    }

    const exists = !!objects?.some((object) => object.name === fileName);
    if (!exists) {
      return { exists: false };
    }

    const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(normalizedPath);
    if (!urlData?.publicUrl) {
      return { exists: false };
    }
    return { exists: true, publicUrl: urlData.publicUrl };
  } catch (error) {
    console.warn('Storage file verification error:', error);
    return { exists: false };
  }
}

/**
 * Clean up uploaded file (e.g., on DB error)
 */
export async function cleanupFile(
  supabase: SupabaseStorageClient,
  objectPath: string
): Promise<void> {
  try {
    await supabase.storage.from(MEDIA_BUCKET).remove([objectPath]);
  } catch (error) {
    console.warn('Storage cleanup failed:', error);
    return;
  }
}
