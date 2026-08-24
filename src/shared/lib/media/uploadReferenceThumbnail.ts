import { generateClientThumbnail } from '@/shared/media/clientThumbnailGenerator';
import { generateThumbnailFilename } from '@/shared/lib/storagePaths';
import { uploadThumbnailBlobToStorage } from '@/shared/lib/media/imageUploader';

interface UploadReferenceThumbnailInput {
  file: File;
}

export class ReferenceThumbnailUploadError extends Error {
  public readonly cause?: unknown;

  constructor(
    public readonly kind: 'auth' | 'upload',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'ReferenceThumbnailUploadError';
    this.cause = options?.cause;
  }
}

export async function uploadReferenceThumbnail(
  input: UploadReferenceThumbnailInput,
): Promise<string> {
  const thumbnailResult = await generateClientThumbnail(input.file, 300, 0.8);
  const thumbnailFilename = generateThumbnailFilename();
  try {
    return await uploadThumbnailBlobToStorage(
      thumbnailResult.thumbnailBlob,
      thumbnailFilename,
      'image/jpeg',
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'User not authenticated') {
      throw new ReferenceThumbnailUploadError('auth', 'User not authenticated', { cause: error });
    }

    throw new ReferenceThumbnailUploadError(
      'upload',
      'Failed to upload thumbnail image',
      { cause: error },
    );
  }
}
