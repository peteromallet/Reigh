import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createExternalUploadGeneration: vi.fn(),
  uploadImageToStorage: vi.fn(),
  uploadBlobToStorage: vi.fn(),
  uploadVideoToStorage: vi.fn(),
  extractVideoPosterFrame: vi.fn(),
  generateClientThumbnail: vi.fn(),
  uploadImageWithThumbnail: vi.fn(),
}));

vi.mock('@/integrations/supabase/repositories/generationMutationsRepository', () => ({
  createExternalUploadGeneration: mocks.createExternalUploadGeneration,
}));
vi.mock('@/shared/lib/media/imageUploader', () => ({
  uploadImageToStorage: mocks.uploadImageToStorage,
  uploadBlobToStorage: mocks.uploadBlobToStorage,
}));
vi.mock('@/shared/lib/media/videoUploader', () => ({
  uploadVideoToStorage: mocks.uploadVideoToStorage,
}));
vi.mock('@/shared/lib/media/videoPosterExtractor', () => ({
  extractVideoPosterFrame: mocks.extractVideoPosterFrame,
}));
vi.mock('@/shared/media/clientThumbnailGenerator', () => ({
  generateClientThumbnail: mocks.generateClientThumbnail,
  uploadImageWithThumbnail: mocks.uploadImageWithThumbnail,
}));

import { createGenerationForLocalFile } from './createGenerationFromFile.ts';

describe('createGenerationForLocalFile after Astrid cutover', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns capability_unavailable before thumbnailing, upload, or persistence', async () => {
    const handle = { id: 'handle-1' } as never;
    await expect(createGenerationForLocalFile({
      file: new File(['pixels'], 'local.png', { type: 'image/png' }),
      projectId: 'demo',
      handle,
      mediaType: 'image',
    })).rejects.toMatchObject({ code: 'capability_unavailable' });

    Object.values(mocks).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
});
