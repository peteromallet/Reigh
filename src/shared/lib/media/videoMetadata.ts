import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';

export interface VideoMetadata {
  duration_seconds: number;
  frame_rate: number;
  total_frames: number;
  width: number;
  height: number;
  file_size: number;
}

/**
 * Metadata authored in a project sidecar may be incomplete. Keep that shape
 * distinct from metadata extracted from a playable video, which is complete.
 */
export type AuthoredVideoMetadata = Partial<VideoMetadata>;

const AUTHORED_METADATA_FIELDS = [
  'duration_seconds',
  'frame_rate',
  'total_frames',
  'width',
  'height',
  'file_size',
] as const satisfies readonly (keyof VideoMetadata)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parses a project-authored metadata sidecar without requiring every field.
 * Unknown or non-finite fields are ignored; a non-object or empty sidecar is
 * treated as absent. This intentionally does not weaken VideoMetadata's
 * complete extraction contract above.
 */
export function parseAuthoredVideoMetadata(value: unknown): AuthoredVideoMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const metadata: AuthoredVideoMetadata = {};
  for (const field of AUTHORED_METADATA_FIELDS) {
    const fieldValue = value[field];
    if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) {
      metadata[field] = fieldValue;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

/**
 * Extracts video metadata using HTML5 Video API
 */
export const extractVideoMetadata = (file: File): Promise<VideoMetadata> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;

      // Estimate frame rate (assume 30fps as standard, could be improved)
      const frameRate = 30;
      const totalFrames = Math.floor(duration * frameRate);

      URL.revokeObjectURL(video.src);

      resolve({
        duration_seconds: duration,
        frame_rate: frameRate,
        total_frames: totalFrames,
        width,
        height,
        file_size: file.size
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video metadata'));
    };

    video.src = URL.createObjectURL(file);
  });
};

/**
 * Extracts video metadata from a URL (for videos already uploaded)
 */
export const extractVideoMetadataFromUrl = (videoUrl: string): Promise<VideoMetadata> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous'; // Handle CORS for external URLs

    video.onloadedmetadata = () => {
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;

      // Estimate frame rate (assume 30fps as standard, could be improved)
      const frameRate = 30;
      const totalFrames = Math.floor(duration * frameRate);

      resolve({
        duration_seconds: duration,
        frame_rate: frameRate,
        total_frames: totalFrames,
        width,
        height,
        file_size: 0 // Unknown from URL
      });
    };

    video.onerror = () => {
      normalizeAndPresentError(new Error('Failed to load video metadata from URL'), { context: 'videoUploader:extractMetadata', showToast: false });
      reject(new Error('Failed to load video metadata from URL'));
    };

    video.src = videoUrl;
  });
};
