import {
  THEME_PACKAGE_REGISTRY,
} from '@banodoco/timeline-composition/registry.generated';
import {
  AVAILABLE_TIMELINE_THEME_IDS,
  INSTALLED_TIMELINE_THEMES,
} from '@/tools/video-editor/compositions/installed-themes';
import {
  TRUSTED_SEQUENCE_METADATA,
  type TrustedSequenceMetadata,
} from '@/tools/video-editor/sequences/metadata';
import { ImageJumpSequence } from '@/tools/video-editor/sequences/components/ImageJumpSequence';

export const LOCAL_SEQUENCE_REGISTRY = {
  'image-jump': {
    component: ImageJumpSequence,
    themeId: '2rp',
    source: 'local:reigh',
  },
} as const;

export const SEQUENCE_COMPONENT_REGISTRY = {
  ...THEME_PACKAGE_REGISTRY,
  ...LOCAL_SEQUENCE_REGISTRY,
};

export type AvailableSequenceMetadata = TrustedSequenceMetadata & {
  clipType: keyof typeof SEQUENCE_COMPONENT_REGISTRY;
};

export const filterTrustedSequenceMetadataForRegistry = (
  registry: Partial<Record<string, unknown>>,
  themeRegistry: Partial<Record<string, unknown>> = INSTALLED_TIMELINE_THEMES,
): AvailableSequenceMetadata[] => {
  return TRUSTED_SEQUENCE_METADATA.filter((metadata): metadata is AvailableSequenceMetadata => {
    return Object.prototype.hasOwnProperty.call(registry, metadata.clipType)
      && Object.prototype.hasOwnProperty.call(themeRegistry, metadata.themeId);
  });
};

export const AVAILABLE_SEQUENCE_METADATA = filterTrustedSequenceMetadataForRegistry(
  SEQUENCE_COMPONENT_REGISTRY,
);

export const AVAILABLE_SEQUENCE_CLIP_TYPES = AVAILABLE_SEQUENCE_METADATA.map(
  (metadata) => metadata.clipType,
) as readonly string[];

export const AVAILABLE_SEQUENCE_THEME_IDS = AVAILABLE_TIMELINE_THEME_IDS.filter((themeId) => (
  AVAILABLE_SEQUENCE_METADATA.some((metadata) => metadata.themeId === themeId)
)) as readonly string[];

export const isAvailableSequenceClipType = (value: unknown): value is AvailableSequenceMetadata['clipType'] => {
  return typeof value === 'string' && (AVAILABLE_SEQUENCE_CLIP_TYPES as readonly string[]).includes(value);
};

export const getAvailableSequenceMetadata = (
  clipType: string,
): AvailableSequenceMetadata | undefined => {
  return AVAILABLE_SEQUENCE_METADATA.find((metadata) => metadata.clipType === clipType);
};
