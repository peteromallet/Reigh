import { beforeEach, describe, expect, it, vi } from 'vitest';
import { operationFailure, operationSuccess } from '@/shared/lib/operationResult';
import {
  buildStyleReferenceMetadataFromGeneration,
  tryPersistReferenceSelection,
  resolveReferenceThumbnailUrl,
  tryUploadAndProcessReference,
} from './referenceDomainService';

const fileToDataURLMock = vi.fn();
const dataURLtoFileMock = vi.fn();
const uploadImageToStorageMock = vi.fn();
const uploadThumbnailBlobToStorageMock = vi.fn();
const resolveProjectResolutionMock = vi.fn();
const processStyleReferenceForAspectRatioStringMock = vi.fn();
const generateClientThumbnailMock = vi.fn();
const getSessionMock = vi.fn();
const uploadMock = vi.fn();
const extractSettingsFromCacheMock = vi.fn();

vi.mock('@/shared/lib/media/fileConversion', () => ({
  fileToDataURL: (...args: unknown[]) => fileToDataURLMock(...args),
  dataURLtoFile: (...args: unknown[]) => dataURLtoFileMock(...args),
}));

vi.mock('@/shared/lib/media/imageUploader', () => ({
  uploadImageToStorage: (...args: unknown[]) => uploadImageToStorageMock(...args),
  uploadThumbnailBlobToStorage: (...args: unknown[]) => uploadThumbnailBlobToStorageMock(...args),
}));

vi.mock('@/shared/lib/taskCreation', () => ({
  resolveProjectResolution: (...args: unknown[]) => resolveProjectResolutionMock(...args),
}));

vi.mock('@/shared/lib/media/styleReferenceProcessor', () => ({
  processStyleReferenceForAspectRatioString: (...args: unknown[]) =>
    processStyleReferenceForAspectRatioStringMock(...args),
}));

vi.mock('@/shared/media/clientThumbnailGenerator', () => ({
  generateClientThumbnail: (...args: unknown[]) => generateClientThumbnailMock(...args),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => uploadMock(...args),
      }),
    },
  }),
}));

vi.mock('@/shared/hooks/settings/useToolSettings', () => ({
  extractSettingsFromCache: (...args: unknown[]) => extractSettingsFromCacheMock(...args),
}));

describe('referenceDomainService', () => {
  beforeEach(() => {
    fileToDataURLMock.mockReset();
    dataURLtoFileMock.mockReset();
    uploadImageToStorageMock.mockReset();
    uploadThumbnailBlobToStorageMock.mockReset();
    resolveProjectResolutionMock.mockReset();
    processStyleReferenceForAspectRatioStringMock.mockReset();
    generateClientThumbnailMock.mockReset();
    getSessionMock.mockReset();
    uploadMock.mockReset();
    extractSettingsFromCacheMock.mockReset();
  });

  it('builds style-reference metadata from a generation-backed reference', () => {
    const generation = {
      id: 'shot-generation-1',
      generation_id: 'generation-1',
      location: 'https://example.com/generated.png',
      thumbUrl: 'https://example.com/generated-thumb.png',
      type: 'uploaded-reference',
    } as import('@/domains/generation/types').GenerationRow & {
      thumbUrl: string;
    };

    const result = buildStyleReferenceMetadataFromGeneration(generation, 2);

    expect(result).toEqual(expect.objectContaining({
      name: 'Reference 3',
      styleReferenceImage: 'https://example.com/generated.png',
      styleReferenceImageOriginal: 'https://example.com/generated.png',
      thumbnailUrl: 'https://example.com/generated-thumb.png',
      generationId: 'generation-1',
      referenceMode: 'style',
      styleReferenceStrength: 1.1,
    }));
  });

  it('returns failure when aspect-ratio processing fails', async () => {
    fileToDataURLMock.mockResolvedValue('data:image/png;base64,abc');
    uploadImageToStorageMock.mockResolvedValue('https://example.com/original.png');
    resolveProjectResolutionMock.mockResolvedValue({ aspectRatio: '16:9' });
    processStyleReferenceForAspectRatioStringMock.mockResolvedValue(null);

    const result = await tryUploadAndProcessReference({
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      selectedProjectId: 'project-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected failure');
    }
    expect(result.errorCode).toBe('reference_aspect_processing_failed');
    expect(uploadImageToStorageMock).toHaveBeenCalledTimes(1);
    expect(resolveProjectResolutionMock).toHaveBeenCalledWith('project-1');
    expect(processStyleReferenceForAspectRatioStringMock).toHaveBeenCalledTimes(1);
  });

  it('returns failure when processed file conversion yields no file', async () => {
    fileToDataURLMock.mockResolvedValue('data:image/png;base64,abc');
    uploadImageToStorageMock.mockResolvedValue('https://example.com/original.png');
    dataURLtoFileMock.mockReturnValue(operationFailure(new Error('Invalid Data URL format'), {
      message: 'Failed to convert data URL to file',
      errorCode: 'data_url_file_conversion_failed',
      policy: 'fail_closed',
      recoverable: false,
    }));

    const result = await tryUploadAndProcessReference({
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      selectedProjectId: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected failure');
    }
    expect(result.errorCode).toBe('reference_file_conversion_failed');
    expect(result.message).toBe('Failed to convert processed image to file');
    expect(uploadImageToStorageMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the original upload error on the failure result', async () => {
    const uploadError = new Error('Upload timed out after 60000ms');
    fileToDataURLMock.mockResolvedValue('data:image/png;base64,abc');
    uploadImageToStorageMock.mockRejectedValue(uploadError);
    dataURLtoFileMock.mockReturnValue(
      operationSuccess(new File(['processed'], 'processed.png', { type: 'image/png' }))
    );

    const result = await tryUploadAndProcessReference({
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      selectedProjectId: 'project-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected failure');
    }
    expect(result.errorCode).toBe('reference_upload_failed');
    expect(result.error).toBe(uploadError);
    expect(result.cause).toBe(uploadError);
  });

  it('returns failure when thumbnail auth/session is missing', async () => {
    generateClientThumbnailMock.mockResolvedValue({
      thumbnailBlob: new Blob(['x'], { type: 'image/jpeg' }),
    });
    uploadThumbnailBlobToStorageMock.mockRejectedValue(new Error('User not authenticated'));

    const result = await resolveReferenceThumbnailUrl({
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      fallbackUrl: 'https://fallback.example/img.png',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected failure');
    }
    expect(result.errorCode).toBe('reference_thumbnail_auth_required');
    expect(uploadThumbnailBlobToStorageMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('returns failure when selection persistence throws', async () => {
    extractSettingsFromCacheMock.mockReturnValue({
      references: [],
      selectedReferenceIdByShot: {},
    });
    const updateProjectImageSettings = vi.fn().mockRejectedValue(new Error('write failed'));

    const result = await tryPersistReferenceSelection({
      queryClient: {
        getQueryData: () => ({}),
      } as unknown as import('@tanstack/react-query').QueryClient,
      selectedProjectId: 'project-1',
      updateProjectImageSettings,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected failure');
    }
    expect(result.errorCode).toBe('reference_selection_persist_failed');
    expect(extractSettingsFromCacheMock).toHaveBeenCalledTimes(1);
    expect(updateProjectImageSettings).toHaveBeenCalledTimes(1);
  });
});
