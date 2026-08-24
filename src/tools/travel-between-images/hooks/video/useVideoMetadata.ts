import { useState, useEffect } from 'react';
import { VideoMetadata, extractVideoMetadataFromUrl, type AuthoredVideoMetadata } from '@/shared/lib/media/videoUploader';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';

interface UseVideoMetadataOptions {
  /** Callback when metadata is extracted (e.g., to save to database) */
  onExtracted?: (metadata: VideoMetadata) => void;
}

/**
 * Hook that provides video metadata, extracting it from the URL if not provided.
 *
 * @param videoUrl - URL of the video
 * @param providedMetadata - Pre-existing metadata (if available)
 * @param options - Optional callbacks
 * @returns { metadata, isExtracting }
 *
 * @example
 * const { metadata, isExtracting } = useVideoMetadata(videoUrl, existingMetadata, {
 *   onExtracted: (m) => saveToDatabase(m),
 * });
 */
export function useVideoMetadata(
  videoUrl: string,
  providedMetadata: AuthoredVideoMetadata | null,
  options: UseVideoMetadataOptions = {}
) {
  const { onExtracted } = options;

  const [extractedMetadata, setExtractedMetadata] = useState<VideoMetadata | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  // Use provided metadata or extracted metadata
  const metadata = isCompleteVideoMetadata(providedMetadata) ? providedMetadata : extractedMetadata;

  // Extract metadata from URL if not provided
  useEffect(() => {
    if (!isCompleteVideoMetadata(providedMetadata) && !isExtracting && !extractedMetadata) {
      let cancelled = false;
      setIsExtracting(true);

      extractVideoMetadataFromUrl(videoUrl)
        .then((meta) => {
          if (cancelled) return;
          setExtractedMetadata(meta);

          if (onExtracted) {
            onExtracted(meta);
          }
        })
        .catch((error) => {
          if (cancelled) return;
          normalizeAndPresentError(error, { context: 'useVideoMetadata', showToast: false });
        })
        .finally(() => {
          if (!cancelled) setIsExtracting(false);
        });

      return () => { cancelled = true; };
    }
  }, [videoUrl, providedMetadata, isExtracting, extractedMetadata, onExtracted]);

  return { metadata, isExtracting };
}

export function isCompleteVideoMetadata(metadata: AuthoredVideoMetadata | null): metadata is VideoMetadata {
  return metadata !== null &&
    Number.isFinite(metadata.duration_seconds) &&
    Number.isFinite(metadata.frame_rate) &&
    Number.isFinite(metadata.total_frames) &&
    Number.isFinite(metadata.width) &&
    Number.isFinite(metadata.height) &&
    Number.isFinite(metadata.file_size);
}
