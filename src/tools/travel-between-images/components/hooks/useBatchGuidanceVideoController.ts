import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { uploadVideoToStorage, extractVideoMetadata, type AuthoredVideoMetadata, type VideoMetadata } from '@/shared/lib/media/videoUploader';
import { useCreateResource, type Resource, type StructureVideoMetadata } from '@/features/resources/hooks/useResources';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { useUserUIState } from '@/shared/hooks/useUserUIState';
import { isCompleteVideoMetadata } from '../../hooks/video/useVideoMetadata';

interface UseBatchGuidanceVideoControllerParams {
  shotId: string;
  videoUrl: string | null;
  videoMetadata: AuthoredVideoMetadata | null;
  treatment: 'adjust' | 'clip';
  timelineFramePositions: number[];
  onVideoUploaded: (videoUrl: string | null, metadata: VideoMetadata | null, resourceId?: string) => void;
  readOnly: boolean;
}

function formatAdjustModeDescription(totalVideoFrames: number, timelineFrames: number): string {
  if (totalVideoFrames === 0 || timelineFrames === 0) return '';

  if (totalVideoFrames > timelineFrames) {
    const framesToDrop = totalVideoFrames - timelineFrames;
    return `Your input video has ${totalVideoFrames} frame${totalVideoFrames === 1 ? '' : 's'} so we'll drop ${framesToDrop} frame${framesToDrop === 1 ? '' : 's'} to compress your guide video to the ${timelineFrames} frame${timelineFrames === 1 ? '' : 's'} your input images cover.`;
  }

  if (totalVideoFrames < timelineFrames) {
    const framesToDuplicate = timelineFrames - totalVideoFrames;
    return `Your input video has ${totalVideoFrames} frame${totalVideoFrames === 1 ? '' : 's'} so we'll duplicate ${framesToDuplicate} frame${framesToDuplicate === 1 ? '' : 's'} to stretch your guide video to the ${timelineFrames} frame${timelineFrames === 1 ? '' : 's'} your input images cover.`;
  }

  return `Perfect! Your input video has ${timelineFrames} frame${timelineFrames === 1 ? '' : 's'}, matching your timeline exactly.`;
}

function formatClipModeDescription(totalVideoFrames: number, timelineFrames: number): string {
  if (totalVideoFrames === 0 || timelineFrames === 0) return '';

  if (totalVideoFrames > timelineFrames) {
    const unusedFrames = totalVideoFrames - timelineFrames;
    return `Your video will guide all ${timelineFrames} frame${timelineFrames === 1 ? '' : 's'} of your timeline. The last ${unusedFrames} frame${unusedFrames === 1 ? '' : 's'} of your video (frame${unusedFrames === 1 ? '' : 's'} ${timelineFrames + 1}-${totalVideoFrames}) will be ignored.`;
  }

  if (totalVideoFrames < timelineFrames) {
    const uncoveredFrames = timelineFrames - totalVideoFrames;
    return `Your video will guide the first ${totalVideoFrames} frame${totalVideoFrames === 1 ? '' : 's'} of your timeline. The last ${uncoveredFrames} frame${uncoveredFrames === 1 ? '' : 's'} (frame${uncoveredFrames === 1 ? '' : 's'} ${totalVideoFrames + 1}-${timelineFrames}) won't have video guidance.`;
  }

  return `Perfect! Your video length matches your timeline exactly (${timelineFrames} frame${timelineFrames === 1 ? '' : 's'}).`;
}

export function useBatchGuidanceVideoController({
  shotId,
  videoUrl,
  videoMetadata,
  treatment,
  timelineFramePositions,
  onVideoUploaded,
  readOnly,
}: UseBatchGuidanceVideoControllerParams) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showBrowser, setShowBrowser] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [currentTimelineFrame, setCurrentTimelineFrame] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const createResource = useCreateResource();
  const { value: privacyDefaults } = useUserUIState('privacyDefaults', { resourcesPublic: true, generationsPublic: false });

  const minFrame = timelineFramePositions.length > 0 ? Math.min(...timelineFramePositions) : 0;
  const maxFrame = timelineFramePositions.length > 0 ? Math.max(...timelineFramePositions) : 0;
  const timelineFrames = maxFrame - minFrame + 1;
  const effectiveMetadata = videoMetadata &&
    typeof videoMetadata.total_frames === 'number' &&
    typeof videoMetadata.frame_rate === 'number'
    ? videoMetadata
    : null;
  const totalVideoFrames = effectiveMetadata?.total_frames ?? 0;

  const videoCoversFrames = treatment === 'clip' ? Math.min(totalVideoFrames, timelineFrames) : timelineFrames;
  const lastCoveredFrame = treatment === 'clip' ? minFrame + videoCoversFrames - 1 : maxFrame;
  const isFrameBeyondVideoCoverage = treatment === 'clip' && currentTimelineFrame > lastCoveredFrame;

  const adjustModeDescription = formatAdjustModeDescription(totalVideoFrames, timelineFrames);
  const clipModeDescription = formatClipModeDescription(totalVideoFrames, timelineFrames);

  const drawTimelineFrame = useCallback((timelineFrame: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !effectiveMetadata) return;

    let videoFrame: number;
    if (treatment === 'adjust') {
      const timelineRange = maxFrame - minFrame;
      const normalizedPosition = timelineRange > 0 ? (timelineFrame - minFrame) / timelineRange : 0;
      videoFrame = Math.floor(normalizedPosition * ((effectiveMetadata.total_frames ?? 0) - 1));
    } else {
      const offsetFromStart = timelineFrame - minFrame;
      videoFrame = Math.min(offsetFromStart, (effectiveMetadata.total_frames ?? 0) - 1);
    }

    const fps = effectiveMetadata.frame_rate;
    if (!fps || fps <= 0 || !isFinite(fps)) {
      console.error('[BatchGuidanceVideo] Invalid frame_rate:', fps);
      return;
    }

    const timeInSeconds = videoFrame / fps;
    if (!isFinite(timeInSeconds) || timeInSeconds < 0) {
      console.error('[BatchGuidanceVideo] Invalid time value:', { videoFrame, fps, timeInSeconds });
      return;
    }

    video.currentTime = timeInSeconds;

    const handleSeeked = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      video.removeEventListener('seeked', handleSeeked);
    };

    video.addEventListener('seeked', handleSeeked);
  }, [effectiveMetadata, treatment, minFrame, maxFrame]);

  const handleFrameChange = useCallback((value: number) => {
    setCurrentTimelineFrame(value);
    drawTimelineFrame(value);
  }, [drawTimelineFrame]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    const handleLoadedMetadata = () => {
      drawTimelineFrame(minFrame);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, [videoUrl, minFrame, drawTimelineFrame]);

  const processFile = useCallback(async (file: File) => {
    const validTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!validTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload an MP4, WebM, or MOV file.');
      return;
    }

    const maxSizeMB = 200;
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxSizeMB) {
      toast.error(`File too large. Maximum size is ${maxSizeMB}MB (file is ${fileSizeMB.toFixed(1)}MB)`);
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);

      const metadata = await extractVideoMetadata(file);
      setUploadProgress(25);

      const uploadedVideoUrl = await uploadVideoToStorage(
        file,
        { onProgress: (progress) => setUploadProgress(25 + (progress * 0.65)) },
      );
      setUploadProgress(90);

      const { data: { user } } = await supabase().auth.getUser();
      const now = new Date().toISOString();
      const resourceMetadata: StructureVideoMetadata = {
        name: `Guidance Video ${new Date().toLocaleString()}`,
        videoUrl: uploadedVideoUrl,
        thumbnailUrl: null,
        videoMetadata: metadata,
        created_by: {
          is_you: true,
          username: user?.email || 'user',
        },
        is_public: privacyDefaults.resourcesPublic,
        createdAt: now,
      };

      const resource = await createResource.mutateAsync({
        type: 'structure-video',
        metadata: resourceMetadata,
      });
      setUploadProgress(100);

      onVideoUploaded(uploadedVideoUrl, metadata, resource.id);
    } catch (error) {
      normalizeAndPresentError(error, { context: 'BatchGuidanceVideo', toastTitle: 'Failed to upload video' });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [privacyDefaults.resourcesPublic, createResource, onVideoUploaded]);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await processFile(file);
  }, [processFile]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading && !readOnly) {
      setIsDragging(true);
    }
  }, [isUploading, readOnly]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isUploading || readOnly) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processFile(files[0]);
    }
  }, [isUploading, processFile, readOnly]);

  const handleRemoveVideo = useCallback(() => {
    onVideoUploaded(null, null, undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onVideoUploaded]);

  const handleResourceSelect = useCallback((resource: Resource) => {
    const metadata = resource.metadata as StructureVideoMetadata;
    onVideoUploaded(metadata.videoUrl, metadata.videoMetadata, resource.id);
    setShowBrowser(false);
  }, [onVideoUploaded]);

  return {
    fileInputRef,
    dropZoneRef,
    videoRef,
    canvasRef,
    isUploading,
    uploadProgress,
    showBrowser,
    setShowBrowser,
    isDragging,
    minFrame,
    maxFrame,
    timelineFrames,
    totalVideoFrames,
    videoCoversFrames,
    lastCoveredFrame,
    isFrameBeyondVideoCoverage,
    currentTimelineFrame,
    adjustModeDescription,
    clipModeDescription,
    handleFrameChange,
    handleFileSelect,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleRemoveVideo,
    handleResourceSelect,
  };
}
