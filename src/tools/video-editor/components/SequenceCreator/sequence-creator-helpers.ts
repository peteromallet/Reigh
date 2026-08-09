import type { SequenceDraftEditError } from '@/tools/video-editor/lib/sequence-drafts.ts';
import type { EditableSequenceDraft } from '@/tools/video-editor/sequences/generation.ts';
import { materializeResolvedSequenceConfig } from '@/tools/video-editor/sequences/materialize.ts';
import {
  AVAILABLE_SEQUENCE_CLIP_TYPES,
  AVAILABLE_SEQUENCE_METADATA,
} from '@/tools/video-editor/sequences/registry.ts';
import {
  validateSequenceDraft,
  type ValidatedSequenceDraft,
} from '@/tools/video-editor/sequences/validation.ts';
import type {
  ResolvedTimelineClip,
  ResolvedTimelineConfig,
} from '@/tools/video-editor/types/index.ts';

export const TEMP_SEQUENCE_PREVIEW_CLIP_ID = '__sequence_preview__';

export const formatEditError = (error: SequenceDraftEditError): string => {
  switch (error) {
    case 'no_visual_track':
      return 'Add or select a visual track before inserting a sequence.';
    case 'replace_target_missing':
      return 'Select a visual clip to replace.';
    case 'replace_target_not_visual':
      return 'Sequences can only replace visual clips. Audio clips are not valid replace targets.';
    default:
      return 'This sequence cannot be inserted here.';
  }
};

export const validateEditableSequenceDraft = (
  draft: EditableSequenceDraft,
  allowedAssetKeys: readonly string[],
  extensionClipTypeIds?: ReadonlySet<string>,
) => validateSequenceDraft(draft, {
  metadata: AVAILABLE_SEQUENCE_METADATA,
  allowedClipTypes: AVAILABLE_SEQUENCE_CLIP_TYPES,
  allowedAssetKeys,
  extensionClipTypeIds,
});

export const buildSequencePreviewConfig = (
  resolvedConfig: ResolvedTimelineConfig,
  draft: ValidatedSequenceDraft,
): ResolvedTimelineConfig | null => {
  const sourceTrack = resolvedConfig.tracks.find((track) => track.kind === 'visual');
  const trackId = sourceTrack?.id ?? 'sequence-preview-visual';

  const clip: ResolvedTimelineClip = {
    id: TEMP_SEQUENCE_PREVIEW_CLIP_ID,
    clipType: draft.clipType,
    track: trackId,
    at: 0,
    hold: draft.hold,
    params: { ...draft.params },
  };

  return materializeResolvedSequenceConfig({
    ...resolvedConfig,
    tracks: [
      sourceTrack
        ? { ...sourceTrack, id: trackId }
        : { id: trackId, kind: 'visual', label: 'Sequence preview' },
    ],
    clips: [clip],
  });
};

export const summarizeValidationErrors = (errors: readonly { message: string }[]): string => (
  errors.map((error) => error.message).join(' ')
);
