import type { StyleReferenceMetadata } from '@/features/resources/hooks/useResources';
import type { HydratedReferenceImage } from '@/shared/types/referenceHydration';
import type { ReferenceImage } from '@/shared/types/referenceImage';

interface BuildLegacyMetadataInput {
  pointer: ReferenceImage;
  resourcesPublic: boolean;
  username: string;
  now: string;
}

export function buildLegacyReferenceMetadata(
  input: BuildLegacyMetadataInput,
): StyleReferenceMetadata {
  const { pointer, resourcesPublic, username, now } = input;
  return {
    name: pointer.name || 'Reference',
    styleReferenceImage: pointer.styleReferenceImage || '',
    styleReferenceImageOriginal:
      pointer.styleReferenceImageOriginal || pointer.styleReferenceImage || '',
    thumbnailUrl: pointer.thumbnailUrl || null,
    styleReferenceStrength: pointer.styleReferenceStrength ?? 1.1,
    subjectStrength: pointer.subjectStrength ?? 0.0,
    subjectDescription: pointer.subjectDescription || '',
    inThisScene: pointer.inThisScene ?? false,
    inThisSceneStrength: pointer.inThisSceneStrength ?? 1.0,
    referenceMode: pointer.referenceMode || 'style',
    styleBoostTerms: pointer.styleBoostTerms || '',
    is_public: resourcesPublic,
    created_by: {
      is_you: true,
      username,
    },
    createdAt: pointer.createdAt || now,
    updatedAt: pointer.updatedAt || now,
  };
}

export function hydrateLegacyReference(pointer: ReferenceImage): HydratedReferenceImage {
  return {
    id: pointer.id,
    resourceId: '',
    name: pointer.name || 'Reference',
    styleReferenceImage: pointer.styleReferenceImage || '',
    styleReferenceImageOriginal: pointer.styleReferenceImageOriginal || '',
    thumbnailUrl: pointer.thumbnailUrl || null,
    styleReferenceStrength: pointer.styleReferenceStrength ?? 1.1,
    subjectStrength: pointer.subjectStrength ?? 0.0,
    subjectDescription: pointer.subjectDescription || '',
    inThisScene: pointer.inThisScene ?? false,
    inThisSceneStrength: pointer.inThisSceneStrength ?? 1.0,
    referenceMode: pointer.referenceMode || 'style',
    styleBoostTerms: pointer.styleBoostTerms || '',
    createdAt: pointer.createdAt || new Date().toISOString(),
    updatedAt: pointer.updatedAt || new Date().toISOString(),
    isPublic: false,
    isOwner: true,
  };
}
