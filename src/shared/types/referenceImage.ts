import type { ReferenceMode } from '@/shared/types/imageGeneration';

export interface ReferenceImage {
  id: string;
  resourceId: string;
  /** Legacy inline-resource fields retained for migration and old projects. */
  name?: string;
  styleReferenceImage?: string;
  styleReferenceImageOriginal?: string;
  thumbnailUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  referenceMode?: ReferenceMode;
  styleReferenceStrength?: number;
  subjectStrength?: number;
  subjectDescription?: string;
  inThisScene?: boolean;
  inThisSceneStrength?: number;
  styleBoostTerms?: string;
}
