import type { Database } from '@/integrations/supabase/databasePublicTypes';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability';
import { createExternalUploadGeneration } from '@/integrations/supabase/repositories/generationMutationsRepository';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { uploadBlobToStorage, uploadImageToStorage } from '@/shared/lib/media/imageUploader';
import { extractVideoPosterFrame } from '@/shared/lib/media/videoPosterExtractor';
import { uploadVideoToStorage } from '@/shared/lib/media/videoUploader';
import type { PersistedLocalMediaHandle } from '@/shared/lib/media/localHandleStore';
import {
  generateClientThumbnail,
  uploadImageWithThumbnail,
} from '@/shared/media/clientThumbnailGenerator';

type GenerationRow = Database['public']['Tables']['generations']['Row'];
type GenerationParams = Parameters<typeof createExternalUploadGeneration>[0]['generationParams'];

interface CreateGenerationForUploadedImageInput {
  imageFile: File;
  projectId: string;
  onProgress?: (progress: number) => void;
}

interface CreateGenerationForUploadedVideoInput {
  videoFile: File;
  projectId: string;
  onProgress?: (progress: number) => void;
}

interface CreateLocalGenerationInput {
  file: File;
  projectId: string;
  handle: PersistedLocalMediaHandle;
  mediaType: 'image' | 'video';
}

export async function uploadImageForVariant(
  imageFile: File,
  _projectId: string,
  options: { onProgress?: (progress: number) => void } = {},
): Promise<{ imageUrl: string; thumbnailUrl: string }> {
  void _projectId;
  const { onProgress } = options;

  try {
    const thumbnailResult = await generateClientThumbnail(imageFile, 300, 0.8);
    return await uploadImageWithThumbnail(imageFile, thumbnailResult.thumbnailBlob, {
      onProgress,
    });
  } catch (error) {
    normalizeAndPresentError(error, {
      context: `useShotCreation:thumbnail:${imageFile.name}`,
      showToast: false,
    });

    const imageUrl = await uploadImageToStorage(imageFile, 3, onProgress);
    return {
      imageUrl,
      thumbnailUrl: imageUrl,
    };
  }
}

async function insertUploadedGeneration(input: {
  projectId: string;
  type: 'image' | 'video';
  location: string;
  thumbnailUrl: string;
  generationParams: GenerationParams;
}): Promise<GenerationRow> {
  const generation = await createExternalUploadGeneration({
    imageUrl: input.location,
    thumbnailUrl: input.thumbnailUrl,
    fileType: input.type,
    projectId: input.projectId,
    generationParams: input.generationParams,
  });

  return generation as unknown as GenerationRow;
}

export async function createGenerationForLocalFile(
  input: CreateLocalGenerationInput,
): Promise<GenerationRow> {
  // This route is unavailable in the frozen bridge contract. Fail before
  // thumbnail generation, handle persistence, storage upload, or any other
  // externally visible work. Capability errors must be side-effect free.
  void input;
  throw bridgeCapabilityUnavailable(
    'create a generation from a browser-local file',
    'Import media through an Astrid task after the media-registration route is installed.',
  );
}

export async function createGenerationForUploadedImage(
  input: CreateGenerationForUploadedImageInput,
): Promise<GenerationRow> {
  const { imageFile, projectId, onProgress } = input;
  const { imageUrl, thumbnailUrl } = await uploadImageForVariant(imageFile, projectId, {
    onProgress,
  });

  const generationParams: GenerationParams = {
    prompt: '',
    extra: {
      source: 'external_upload',
      original_filename: imageFile.name,
      file_type: imageFile.type,
      file_size: imageFile.size,
    },
  };

  return insertUploadedGeneration({
    projectId,
    type: 'image',
    location: imageUrl,
    thumbnailUrl: thumbnailUrl || imageUrl,
    generationParams,
  });
}

async function uploadVideoPosterFrame(videoFile: File): Promise<string> {
  const posterBlob = await extractVideoPosterFrame(videoFile);
  return uploadBlobToStorage(posterBlob, `${videoFile.name}-poster.jpg`, 'image/jpeg');
}

export async function createGenerationForUploadedVideo(
  input: CreateGenerationForUploadedVideoInput,
): Promise<GenerationRow> {
  const { videoFile, projectId, onProgress } = input;
  const videoUrl = await uploadVideoToStorage(videoFile, { onProgress });

  let thumbnailUrl = videoUrl;
  try {
    thumbnailUrl = await uploadVideoPosterFrame(videoFile);
  } catch (error) {
    normalizeAndPresentError(error, {
      context: `createGenerationForUploadedVideo:thumbnail:${videoFile.name}`,
      showToast: false,
    });
  }

  const generationParams: GenerationParams = {
    prompt: '',
    extra: {
      source: 'external_upload',
      original_filename: videoFile.name,
      file_type: videoFile.type,
      file_size: videoFile.size,
    },
  };

  return insertUploadedGeneration({
    projectId,
    type: 'video',
    location: videoUrl,
    thumbnailUrl,
    generationParams,
  });
}
