import type { AuthoredVideoMetadata } from '@/shared/lib/media/videoUploader';
import type { StructureVideoConfigWithMetadata } from '@/shared/lib/tasks/travelBetweenImages';
import type { TravelGuidanceMode } from '@/shared/lib/tasks/travelGuidance';

export type StructureVideoType = TravelGuidanceMode;

export interface PrimaryStructureVideoInput {
  videoPath: string | null;
  metadata: AuthoredVideoMetadata | null;
  treatment: 'adjust' | 'clip';
  motionStrength: number;
  structureType: StructureVideoType;
  resourceId?: string;
}

export type OnPrimaryStructureVideoInputChange = (
  input: PrimaryStructureVideoInput,
) => void;

export interface StructureVideoCollectionHandlers {
  structureVideos?: StructureVideoConfigWithMetadata[];
  isStructureVideoLoading?: boolean;
  cachedHasStructureVideo?: boolean;
  onAddStructureVideo?: (video: StructureVideoConfigWithMetadata) => void;
  onUpdateStructureVideo?: (index: number, updates: Partial<StructureVideoConfigWithMetadata>) => void;
  onRemoveStructureVideo?: (index: number) => void;
  onSetStructureVideos?: (videos: StructureVideoConfigWithMetadata[]) => void;
}

export type OnAudioChange = (
  audioUrl: string | null,
  metadata: { duration: number; name?: string } | null,
) => void;
