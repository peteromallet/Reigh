import type { QueryClient } from '@tanstack/react-query';
import type { GenerationRow } from '@/domains/generation/types';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { fileToDataURL, dataURLtoFile } from '@/shared/lib/media/fileConversion';
import { uploadImageToStorage } from '@/shared/lib/media/imageUploader';
import {
  ReferenceThumbnailUploadError,
  uploadReferenceThumbnail,
} from '@/shared/lib/media/uploadReferenceThumbnail';
import { resolveProjectResolution } from '@/shared/lib/taskCreation';
import { processStyleReferenceForAspectRatioString } from '@/shared/lib/media/styleReferenceProcessor';
import { extractSettingsFromCache } from '@/shared/hooks/settings/useToolSettings';
import { placeGeneration } from '@/shared/lib/placement/placementService';
import { settingsQueryKeys } from '@/shared/lib/queryKeys/settings';
import {
  getOperationFailureLogData,
  operationFailure,
  operationSuccess,
  type OperationResult,
} from '@/shared/lib/operationResult';
import { getGenerationId } from '@/shared/lib/media/mediaTypeHelpers';
import { SETTINGS_IDS } from '@/shared/lib/settingsIds';
import { toJson } from '@/shared/lib/supabaseTypeHelpers';
import type {
  HydratedReferenceImage,
  ProjectImageSettings,
  ReferenceImage,
  ReferenceMode,
} from '../../types';
import { getReferenceModeDefaults } from '../../types';
import type { StyleReferenceMetadata } from '@/features/resources/hooks/useResources';

interface UploadAndProcessReferenceInput {
  file: File;
  selectedProjectId: string | undefined;
}

interface UploadAndProcessReferenceResult {
  originalUploadedUrl: string;
  processedUploadedUrl: string;
}

interface ResolveReferenceThumbnailInput {
  file: File;
  fallbackUrl: string;
}

interface BuildStyleReferenceMetadataInput {
  hydratedReferences: HydratedReferenceImage[];
  processedUploadedUrl: string;
  originalUploadedUrl: string;
  thumbnailUrl: string;
  generationId?: string;
  resourcesPublic: boolean;
  userEmail: string | null;
}

interface CreateUploadedReferenceGenerationInput {
  currentProjectId: string | undefined;
  shotId: string;
  originalUploadedUrl: string;
  thumbnailUrl: string;
}

interface CreateUploadedReferenceGenerationResult {
  generationId: string;
  shotGenerationId?: string;
}

interface CreateReferencePointerInput {
  resourceId: string;
  referenceMode: ReferenceMode;
  isLocalGenerationEnabled: boolean;
  styleReferenceStrength: number;
  subjectStrength: number;
  inThisScene: boolean;
  inThisSceneStrength: number;
}

interface PersistReferenceSelectionInput {
  queryClient: QueryClient;
  selectedProjectId: string | undefined;
  updateProjectImageSettings: (
    scope: 'project' | 'shot',
    updates: Partial<ProjectImageSettings>
  ) => Promise<void>;
}

export async function tryUploadAndProcessReference(
  input: UploadAndProcessReferenceInput,
): Promise<OperationResult<UploadAndProcessReferenceResult>> {
  try {
    const dataURL = await fileToDataURL(input.file);
    const originalUploadedUrl = await uploadImageToStorage(input.file);

    let processedDataURL = dataURL;
    if (input.selectedProjectId) {
      const { aspectRatio } = await resolveProjectResolution(input.selectedProjectId);
      const processed = await processStyleReferenceForAspectRatioString(dataURL, aspectRatio);
      if (!processed) {
        return operationFailure(new Error('Failed to process image for aspect ratio'), {
          policy: 'fail_closed',
          errorCode: 'reference_aspect_processing_failed',
          message: 'Failed to process image for aspect ratio',
          recoverable: false,
          cause: { selectedProjectId: input.selectedProjectId },
        });
      }
      processedDataURL = processed;
    }

    const processedFileResult = dataURLtoFile(
      processedDataURL,
      `style-reference-processed-${Date.now()}.png`,
    );
    if (!processedFileResult.ok) {
      return operationFailure(processedFileResult.error, {
        policy: 'fail_closed',
        errorCode: 'reference_file_conversion_failed',
        message: 'Failed to convert processed image to file',
        recoverable: false,
        cause: getOperationFailureLogData(processedFileResult),
      });
    }

    const processedUploadedUrl = await uploadImageToStorage(processedFileResult.value);
    return operationSuccess({ originalUploadedUrl, processedUploadedUrl }, { policy: 'best_effort' });
  } catch (error) {
    return operationFailure(error, {
      policy: 'degrade',
      errorCode: 'reference_upload_failed',
      message: 'Failed to upload and process reference image',
      recoverable: true,
      cause: error,
    });
  }
}

export async function resolveReferenceThumbnailUrl(
  input: ResolveReferenceThumbnailInput,
): Promise<OperationResult<string>> {
  try {
    const thumbnailUrl = await uploadReferenceThumbnail({ file: input.file });
    return operationSuccess(thumbnailUrl, { policy: 'best_effort' });
  } catch (error) {
    if (error instanceof ReferenceThumbnailUploadError) {
      if (error.kind === 'auth') {
        return operationFailure(error, {
          policy: 'fail_closed',
          errorCode: 'reference_thumbnail_auth_required',
          message: 'User not authenticated',
          recoverable: false,
          cause: {
            fallbackUrl: input.fallbackUrl,
            error,
          },
        });
      }

      if (error.kind === 'upload') {
        return operationFailure(error, {
          policy: 'degrade',
          errorCode: 'reference_thumbnail_upload_failed',
          message: 'Failed to upload thumbnail image',
          recoverable: true,
          cause: {
            fallbackUrl: input.fallbackUrl,
            error: error.cause ?? error,
          },
        });
      }
    }

    return operationFailure(error, {
      policy: 'degrade',
      errorCode: 'reference_thumbnail_resolution_failed',
      message: 'Failed to resolve reference thumbnail URL',
      recoverable: true,
      cause: {
        fallbackUrl: input.fallbackUrl,
        error,
      },
    });
  }
}

export function buildStyleReferenceMetadata(
  input: BuildStyleReferenceMetadataInput,
): StyleReferenceMetadata {
  const now = new Date().toISOString();
  return {
    name: `Reference ${(input.hydratedReferences.length + 1)}`,
    styleReferenceImage: input.processedUploadedUrl,
    styleReferenceImageOriginal: input.originalUploadedUrl,
    thumbnailUrl: input.thumbnailUrl,
    generationId: input.generationId,
    styleReferenceStrength: 1.1,
    subjectStrength: 0.0,
    subjectDescription: '',
    inThisScene: false,
    inThisSceneStrength: 1.0,
    referenceMode: 'style',
    styleBoostTerms: '',
    is_public: input.resourcesPublic,
    created_by: {
      is_you: true,
      username: input.userEmail || 'user',
    },
    createdAt: now,
    updatedAt: now,
  };
}

export async function tryCreateUploadedReferenceGeneration(
  input: CreateUploadedReferenceGenerationInput,
): Promise<OperationResult<CreateUploadedReferenceGenerationResult>> {
  if (!input.currentProjectId) {
    return operationFailure(new Error('Project scope is required to create uploaded references'), {
      policy: 'fail_closed',
      errorCode: 'reference_generation_project_required',
      message: 'Project scope is required to create uploaded references',
      recoverable: false,
      cause: { shotId: input.shotId },
    });
  }

  const generationId = crypto.randomUUID();

  try {
    const { error: generationError } = await supabase()
      .from('generations')
      .insert({
        id: generationId,
        location: input.originalUploadedUrl,
        thumbnail_url: input.thumbnailUrl,
        type: 'uploaded-reference',
        project_id: input.currentProjectId,
        params: toJson({ source: 'reference-upload' }),
      });

    if (generationError) {
      throw generationError;
    }

    // Skip shot_generations link when there's no real shot (effectiveShotId defaults to 'none')
    const isRealShotId = input.shotId && input.shotId !== 'none';
    if (!isRealShotId) {
      return operationSuccess({ generationId }, { policy: 'best_effort' });
    }

    try {
      const shotGeneration = await placeGeneration({
        projectSlug: input.currentProjectId,
        shotId: input.shotId,
        generationId,
      });
      const shotGenerationId = typeof shotGeneration.entryId === 'string' ? shotGeneration.entryId : undefined;
      return operationSuccess({ generationId, shotGenerationId }, { policy: 'best_effort' });
    } catch (error) {
      await supabase()
        .from('generations')
        .delete()
        .eq('id', generationId)
        .eq('project_id', input.currentProjectId);
      throw error;
    }
  } catch (error) {
    return operationFailure(error, {
      policy: 'fail_closed',
      errorCode: 'reference_generation_create_failed',
      message: 'Failed to create uploaded reference generation',
      recoverable: false,
      cause: {
        currentProjectId: input.currentProjectId,
        shotId: input.shotId,
      },
    });
  }
}

export function buildStyleReferenceMetadataFromGeneration(
  generation: GenerationRow,
  referenceCount: number,
): StyleReferenceMetadata {
  const generationId = getGenerationId(generation) ?? undefined;
  const location = generation.location?.trim();
  const thumbnailUrl = generation.thumbUrl || location || null;

  if (!location) {
    throw new Error('Generation is missing a source image location');
  }

  const now = new Date().toISOString();

  return {
    name: `Reference ${referenceCount + 1}`,
    styleReferenceImage: location,
    styleReferenceImageOriginal: location,
    thumbnailUrl,
    generationId,
    styleReferenceStrength: 1.1,
    subjectStrength: 0.0,
    subjectDescription: '',
    inThisScene: false,
    inThisSceneStrength: 0,
    referenceMode: 'style',
    styleBoostTerms: '',
    created_by: { is_you: true },
    is_public: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function createReferencePointer(input: CreateReferencePointerInput): ReferenceImage {
  const modeDefaults = input.referenceMode === 'custom'
    ? {
        styleReferenceStrength: input.styleReferenceStrength,
        subjectStrength: input.subjectStrength,
        inThisScene: input.inThisScene,
        inThisSceneStrength: input.inThisSceneStrength,
      }
    : getReferenceModeDefaults(input.referenceMode, input.isLocalGenerationEnabled);

  return {
    id: crypto.randomUUID(),
    resourceId: input.resourceId,
    subjectDescription: '',
    styleBoostTerms: '',
    referenceMode: input.referenceMode,
    createdAt: new Date().toISOString(),
    ...modeDefaults,
  };
}

export async function tryPersistReferenceSelection(
  input: PersistReferenceSelectionInput,
): Promise<OperationResult<void>> {
  try {
    const currentData = extractSettingsFromCache<ProjectImageSettings>(
      input.queryClient.getQueryData(
        settingsQueryKeys.tool(SETTINGS_IDS.PROJECT_IMAGE_SETTINGS, input.selectedProjectId, undefined),
      ),
    ) || {};

    await input.updateProjectImageSettings('project', {
      references: currentData.references || [],
      selectedReferenceIdByShot: currentData.selectedReferenceIdByShot || {},
    });

    return operationSuccess(undefined, { policy: 'best_effort' });
  } catch (error) {
    return operationFailure(error, {
      policy: 'degrade',
      errorCode: 'reference_selection_persist_failed',
      message: 'Failed to persist selected reference settings',
      recoverable: true,
      cause: error,
    });
  }
}
