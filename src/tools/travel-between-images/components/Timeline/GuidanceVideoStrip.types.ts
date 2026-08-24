import type { AuthoredVideoMetadata, VideoMetadata } from '@/shared/lib/media/videoUploader';

export interface GuidanceVideoStripProps {
  videoUrl: string;
  videoMetadata: AuthoredVideoMetadata | null;
  treatment: 'adjust' | 'clip';
  onTreatmentChange: (treatment: 'adjust' | 'clip') => void;
  onRemove: () => void;
  onMetadataExtracted?: (metadata: VideoMetadata) => void;
  fullMin: number;
  fullMax: number;
  fullRange: number;
  containerWidth: number;
  zoomLevel: number;
  timelineFrameCount: number;
  readOnly?: boolean;
  outputStartFrame?: number;
  outputEndFrame?: number;
  sourceStartFrame?: number;
  sourceEndFrame?: number | null;
  onRangeChange?: (startFrame: number, endFrame: number) => void;
  onSourceRangeChange?: (sourceStartFrame: number, sourceEndFrame: number | null) => void;
  useAbsolutePosition?: boolean;
  siblingRanges?: Array<{ start: number; end: number }>;
}

export function calculateVideoFrameFromPosition(
  normalizedPosition: number,
  treatment: 'adjust' | 'clip',
  totalVideoFrames: number,
  displayOutputFrameCount: number,
  effectiveSourceStart: number,
  effectiveSourceEnd: number,
): number {
  if (treatment === 'adjust') {
    const frame = Math.floor(normalizedPosition * (totalVideoFrames - 1));
    return Math.max(0, Math.min(frame, totalVideoFrames - 1));
  }

  const outputOffset = Math.floor(normalizedPosition * displayOutputFrameCount);
  const frame = effectiveSourceStart + outputOffset;
  return Math.max(effectiveSourceStart, Math.min(frame, effectiveSourceEnd - 1));
}
