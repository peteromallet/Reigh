import {
  THEME_PACKAGE_REGISTRY,
} from '@banodoco/timeline-composition/registry.generated';
import {
  createAvailableClipTypeRegistry,
  type AvailableClipTypeMetadata,
  type AvailableClipTypeRegistration,
} from '@/tools/video-editor/clip-types/registry';
import {
  createEditorClipTypeRegistry,
  type RegisteredClipTypeLookupResult,
} from '@/tools/video-editor/clip-types/runtime';
import { TRUSTED_SEQUENCE_THEME_ID } from './metadata';
import { ImageJumpSequence } from '@/tools/video-editor/sequences/components/ImageJumpSequence';

export const LOCAL_SEQUENCE_REGISTRY = {
  'image-jump': {
    component: ImageJumpSequence,
    themeId: TRUSTED_SEQUENCE_THEME_ID,
    source: 'local:reigh',
  },
} as const;

export const SEQUENCE_COMPONENT_REGISTRY = {
  ...THEME_PACKAGE_REGISTRY,
  ...LOCAL_SEQUENCE_REGISTRY,
};

const availableSequenceView = createAvailableClipTypeRegistry(
  SEQUENCE_COMPONENT_REGISTRY,
);
export const AVAILABLE_EDITOR_CLIP_TYPE_VIEW = createEditorClipTypeRegistry(
  SEQUENCE_COMPONENT_REGISTRY,
);

export type AvailableSequenceMetadata = AvailableClipTypeMetadata;
export type AvailableSequenceRegistration = AvailableClipTypeRegistration;

export const AVAILABLE_SEQUENCE_REGISTRATIONS = availableSequenceView.registrations;
export const AVAILABLE_SEQUENCE_METADATA = availableSequenceView.metadata;
export const AVAILABLE_SEQUENCE_CLIP_TYPES = availableSequenceView.clipTypes;
export const AVAILABLE_SEQUENCE_VALIDATION_OPTIONS = {
  metadata: AVAILABLE_SEQUENCE_METADATA,
  allowedClipTypes: AVAILABLE_SEQUENCE_CLIP_TYPES,
} as const;

export const filterTrustedSequenceMetadataForRegistry = (
  registry: Partial<Record<string, unknown>>,
): AvailableSequenceMetadata[] => {
  return createAvailableClipTypeRegistry(registry).metadata;
};

export const getAvailableSequenceMetadata = (
  clipType: string,
): AvailableSequenceMetadata | undefined => {
  return availableSequenceView.getAvailableClipTypeMetadata(clipType);
};

export const isAvailableSequenceClipType = (
  value: unknown,
): value is AvailableSequenceMetadata['clipType'] => {
  return availableSequenceView.isAvailableClipType(value);
};

export const getAvailableSequenceRegistration = (
  clipType: string,
): AvailableSequenceRegistration | undefined => {
  return availableSequenceView.getAvailableClipTypeRegistration(clipType);
};

export const resolveAvailableSequenceClipType = (
  clipType: string | undefined,
) => availableSequenceView.resolveAvailableClipTypeRegistration(clipType);

export const getAvailableClipTypeDescriptor = (
  clipType: string | undefined,
) => AVAILABLE_EDITOR_CLIP_TYPE_VIEW.getDescriptor(clipType);

export const resolveAvailableClipType = (
  clipType: string | undefined,
): RegisteredClipTypeLookupResult => AVAILABLE_EDITOR_CLIP_TYPE_VIEW.resolveRegistration(clipType);
