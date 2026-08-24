import { useState, useEffect, useMemo } from 'react';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { isProgressiveLoadingEnabled } from '@/shared/settings/progressiveLoading';
import { useProgressiveImage } from '@/shared/hooks/ui-image/useProgressiveImage';
import type { GeneratedImageWithMetadata } from '../types';

interface UseStableMediaUrlsParams {
  image: GeneratedImageWithMetadata;
  isPriority: boolean;
}

/**
 * Manages stable display URLs and video URLs for a gallery item.
 *
 * "Stable" means the browser-visible URL only changes when the underlying file
 * changes (detected via `urlIdentity`), NOT when a signed-URL token refreshes.
 * This prevents unnecessary image/video reloads on token rotation.
 *
 * Also handles progressive image loading (thumbnail → full crossfade).
 */
export function useStableMediaUrls({ image, isPriority }: UseStableMediaUrlsParams) {
  // === Progressive loading (images only) ===
  const isVideoContent = useMemo(() => {
    if (typeof image.isVideo === 'boolean') return image.isVideo;
    const url = image.url || '';
    const lower = url.toLowerCase();
    return lower.endsWith('.webm') || lower.endsWith('.mp4') || lower.endsWith('.mov');
  }, [image.isVideo, image.url]);

  const progressiveEnabled = isProgressiveLoadingEnabled() && !isVideoContent;
  const { src: progressiveSrc, isThumbShowing, isFullLoaded, ref: progressiveRef } = useProgressiveImage(
    progressiveEnabled ? image.thumbUrl : null,
    image.url,
    {
      priority: isPriority,
      lazy: !isPriority,
      enabled: progressiveEnabled,
      crossfadeMs: 180,
    }
  );

  const projectSlug = getProjectSelectionFallbackId();

  // === Display URL (image thumbnail or progressive src) ===
  // Stored refs become same-origin R9 content-route addresses here.
  const displayUrl = useMemo(() => {
    if (isVideoContent) {
      return bridgeMediaUrl(projectSlug, image.thumbUrl || image.url);
    }
    if (progressiveEnabled && progressiveSrc) {
      return progressiveSrc;
    }
    return bridgeMediaUrl(projectSlug, image.thumbUrl || image.url);
  }, [progressiveEnabled, progressiveSrc, image.thumbUrl, image.url, isVideoContent, projectSlug]);

  // Stable display URL (only changes when underlying file changes)
  const displayUrlIdentity = image.urlIdentity || image.url || '';
  const [stableDisplayUrl, setStableDisplayUrl] = useState<string>(displayUrl);
  const [lastDisplayUrlIdentity, setLastDisplayUrlIdentity] = useState<string>(displayUrlIdentity);

  useEffect(() => {
    if (displayUrlIdentity !== lastDisplayUrlIdentity) {
      setStableDisplayUrl(displayUrl);
      setLastDisplayUrlIdentity(displayUrlIdentity);
    }
  }, [displayUrl, displayUrlIdentity, lastDisplayUrlIdentity]);

  // === Video URL (only for video content) ===
  const videoUrl = useMemo(() => (isVideoContent ? (image.url || null) : null), [isVideoContent, image.url]);

  const videoUrlIdentity = image.urlIdentity || '';
  const [stableVideoUrl, setStableVideoUrl] = useState<string | null>(videoUrl);
  const [lastVideoUrlIdentity, setLastVideoUrlIdentity] = useState<string>(videoUrlIdentity);

  useEffect(() => {
    if (!videoUrl) {
      setStableVideoUrl(null);
      setLastVideoUrlIdentity('');
      return;
    }
    if (videoUrlIdentity !== lastVideoUrlIdentity) {
      setStableVideoUrl(videoUrl);
      setLastVideoUrlIdentity(videoUrlIdentity);
    }
  }, [videoUrl, videoUrlIdentity, lastVideoUrlIdentity]);

  return {
    isVideoContent,
    displayUrl,
    stableDisplayUrl,
    stableVideoUrl,
    progressiveEnabled,
    isThumbShowing,
    isFullLoaded,
    progressiveRef,
  };
}
