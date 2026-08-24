/**
 * useStructureVideoUpload Hook
 *
 * Encapsulates structure video upload logic for the SegmentSettingsForm:
 * - File validation and upload
 * - Resource creation
 * - Loading state management
 * - Video browser modal state
 */

import { useState, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { extractVideoMetadata, uploadVideoToStorage } from '@/shared/lib/media/videoUploader';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { useCreateResource, type Resource, type StructureVideoMetadata } from '@/features/resources/hooks/useResources';
import { useUserUIState } from '@/shared/hooks/useUserUIState';
import type { StructureVideoConfigWithMetadata } from '@/shared/lib/tasks/travelBetweenImages';
import type { SegmentSettings } from '../segmentSettingsUtils';

const MAX_UPLOAD_SIZE_MB = 200;
const BYTES_PER_KB = 1024;
const VALID_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

interface UseStructureVideoUploadOptions {
  structureVideoFrameRange?: {
    segmentStart: number;
    segmentEnd: number;
    videoTotalFrames: number;
    videoFps: number;
  };
  settings: SegmentSettings;
  structureVideoDefaults?: {
    mode?: SegmentSettings['guidanceMode'];
    motionStrength: number;
    treatment: 'adjust' | 'clip';
    uni3cEndPercent: number;
    cannyIntensity?: number;
    depthContrast?: number;
  };
  onAddSegmentStructureVideo?: (video: StructureVideoConfigWithMetadata) => void;
}

interface UseStructureVideoUploadReturn {
  isUploadingVideo: boolean;
  uploadProgress: number;
  pendingVideoUrl: string | null;
  showVideoBrowser: boolean;
  setShowVideoBrowser: (show: boolean) => void;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleVideoResourceSelect: (resource: Resource) => void;
  handleVideoPreviewLoaded: () => void;
  clearPendingVideo: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  addFileInputRef: React.RefObject<HTMLInputElement>;
  isVideoLoading: boolean;
}

interface SharedStructureVideoConfigInput {
  frameRange: NonNullable<UseStructureVideoUploadOptions['structureVideoFrameRange']>;
  settings: SegmentSettings;
  structureVideoDefaults?: UseStructureVideoUploadOptions['structureVideoDefaults'];
}

function buildStructureVideoConfig(input: {
  path: string;
  metadata: StructureVideoConfigWithMetadata['metadata'];
  resourceId: string;
  shared: SharedStructureVideoConfigInput;
}): StructureVideoConfigWithMetadata {
  const { frameRange, settings, structureVideoDefaults } = input.shared;

  return {
    path: input.path,
    start_frame: frameRange.segmentStart,
    end_frame: frameRange.segmentEnd,
    treatment: settings.guidanceTreatment ?? structureVideoDefaults?.treatment ?? 'adjust',
    metadata: input.metadata,
    resource_id: input.resourceId,
  };
}

function clearFileInputs(
  fileInputRef: React.RefObject<HTMLInputElement>,
  addFileInputRef: React.RefObject<HTMLInputElement>
): void {
  if (fileInputRef.current) {
    fileInputRef.current.value = '';
  }
  if (addFileInputRef.current) {
    addFileInputRef.current.value = '';
  }
}

function isInvalidVideoFile(file: File): boolean {
  if (!VALID_VIDEO_TYPES.includes(file.type)) {
    toast.error('Invalid file type. Please upload an MP4, WebM, or MOV file.');
    return true;
  }

  const fileSizeMB = file.size / (BYTES_PER_KB * BYTES_PER_KB);
  if (fileSizeMB > MAX_UPLOAD_SIZE_MB) {
    toast.error(`File too large. Maximum size is ${MAX_UPLOAD_SIZE_MB}MB`);
    return true;
  }

  return false;
}

function useVideoResourceSelectionHandler(input: {
  onAddSegmentStructureVideo?: (video: StructureVideoConfigWithMetadata) => void;
  structureVideoFrameRange?: UseStructureVideoUploadOptions['structureVideoFrameRange'];
  settings: SegmentSettings;
  structureVideoDefaults?: UseStructureVideoUploadOptions['structureVideoDefaults'];
  setPendingVideoUrl: Dispatch<SetStateAction<string | null>>;
  setShowVideoBrowser: Dispatch<SetStateAction<boolean>>;
}): (resource: Resource) => void {
  const {
    onAddSegmentStructureVideo,
    structureVideoFrameRange,
    settings,
    structureVideoDefaults,
    setPendingVideoUrl,
    setShowVideoBrowser,
  } = input;

  return useCallback((resource: Resource) => {
    if (!onAddSegmentStructureVideo || !structureVideoFrameRange) {
      return;
    }

    const metadata = resource.metadata as StructureVideoMetadata;
    const newVideo = buildStructureVideoConfig({
      path: metadata.videoUrl,
      metadata: metadata.videoMetadata ?? null,
      resourceId: resource.id,
      shared: {
        frameRange: structureVideoFrameRange,
        settings,
        structureVideoDefaults,
      },
    });

    setPendingVideoUrl(metadata.videoUrl);
    onAddSegmentStructureVideo(newVideo);
    setShowVideoBrowser(false);
  }, [
    onAddSegmentStructureVideo,
    setPendingVideoUrl,
    setShowVideoBrowser,
    settings,
    structureVideoDefaults,
    structureVideoFrameRange,
  ]);
}

function useVideoFileUploadProcessor(input: {
  onAddSegmentStructureVideo?: (video: StructureVideoConfigWithMetadata) => void;
  structureVideoFrameRange?: UseStructureVideoUploadOptions['structureVideoFrameRange'];
  settings: SegmentSettings;
  structureVideoDefaults?: UseStructureVideoUploadOptions['structureVideoDefaults'];
  resourcesPublic: boolean;
  createResource: ReturnType<typeof useCreateResource>;
  setIsUploadingVideo: Dispatch<SetStateAction<boolean>>;
  setUploadProgress: Dispatch<SetStateAction<number>>;
  setPendingVideoUrl: Dispatch<SetStateAction<string | null>>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  addFileInputRef: React.RefObject<HTMLInputElement>;
}) {
  const {
    onAddSegmentStructureVideo,
    structureVideoFrameRange,
    settings,
    structureVideoDefaults,
    resourcesPublic,
    createResource,
    setIsUploadingVideo,
    setUploadProgress,
    setPendingVideoUrl,
    fileInputRef,
    addFileInputRef,
  } = input;

  const processVideoFile = useCallback(async (file: File) => {
    if (!onAddSegmentStructureVideo || !structureVideoFrameRange || isInvalidVideoFile(file)) {
      return;
    }

    try {
      setIsUploadingVideo(true);
      setUploadProgress(0);

      const metadata = await extractVideoMetadata(file);
      setUploadProgress(25);

      const { data: { user } } = await supabase().auth.getUser();
      const videoUrl = await uploadVideoToStorage(
        file,
        {
          onProgress: (progress) => setUploadProgress(25 + progress * 0.65),
        }
      );
      setUploadProgress(90);

      const now = new Date().toISOString();
      const resourceMetadata: StructureVideoMetadata = {
        name: `Guidance Video ${new Date().toLocaleString()}`,
        videoUrl,
        thumbnailUrl: null,
        videoMetadata: metadata,
        created_by: {
          is_you: true,
          username: user?.email || 'user',
        },
        is_public: resourcesPublic,
        createdAt: now,
      };

      const resource = await createResource.mutateAsync({
        type: 'structure-video',
        metadata: resourceMetadata,
      });
      setUploadProgress(100);

      const newVideo = buildStructureVideoConfig({
        path: videoUrl,
        metadata,
        resourceId: resource.id,
        shared: {
          frameRange: structureVideoFrameRange,
          settings,
          structureVideoDefaults,
        },
      });

      setPendingVideoUrl(videoUrl);
      onAddSegmentStructureVideo(newVideo);
    } catch (error) {
      normalizeAndPresentError(error, {
        context: 'SegmentSettingsForm',
        toastTitle: 'Failed to upload video',
      });
    } finally {
      setIsUploadingVideo(false);
      setUploadProgress(0);
      clearFileInputs(fileInputRef, addFileInputRef);
    }
  }, [
    addFileInputRef,
    createResource,
    fileInputRef,
    onAddSegmentStructureVideo,
    resourcesPublic,
    setIsUploadingVideo,
    setPendingVideoUrl,
    setUploadProgress,
    settings,
    structureVideoDefaults,
    structureVideoFrameRange,
  ]);

  return processVideoFile;
}

export function useStructureVideoUpload(
  options: UseStructureVideoUploadOptions
): UseStructureVideoUploadReturn {
  const { structureVideoFrameRange, settings, structureVideoDefaults, onAddSegmentStructureVideo } = options;

  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingVideoUrl, setPendingVideoUrl] = useState<string | null>(null);
  const [showVideoBrowser, setShowVideoBrowser] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);
  const createResource = useCreateResource();

  const { value: privacyDefaults } = useUserUIState('privacyDefaults', {
    resourcesPublic: true,
    generationsPublic: false,
  });

  const handleVideoResourceSelect = useVideoResourceSelectionHandler({
    onAddSegmentStructureVideo,
    structureVideoFrameRange,
    settings,
    structureVideoDefaults,
    setPendingVideoUrl,
    setShowVideoBrowser,
  });

  const processVideoFile = useVideoFileUploadProcessor({
    onAddSegmentStructureVideo,
    structureVideoFrameRange,
    settings,
    structureVideoDefaults,
    resourcesPublic: privacyDefaults.resourcesPublic,
    createResource,
    setIsUploadingVideo,
    setUploadProgress,
    setPendingVideoUrl,
    fileInputRef,
    addFileInputRef,
  });

  const handleVideoPreviewLoaded = useCallback(() => {
    setPendingVideoUrl(null);
  }, []);

  const clearPendingVideo = useCallback(() => {
    setPendingVideoUrl(null);
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processVideoFile(file);
    }
  }, [processVideoFile]);

  const isVideoLoading = isUploadingVideo || !!pendingVideoUrl;

  return {
    isUploadingVideo,
    uploadProgress,
    pendingVideoUrl,
    showVideoBrowser,
    setShowVideoBrowser,
    handleFileSelect,
    handleVideoResourceSelect,
    handleVideoPreviewLoaded,
    clearPendingVideo,
    fileInputRef: fileInputRef as React.RefObject<HTMLInputElement>,
    addFileInputRef: addFileInputRef as React.RefObject<HTMLInputElement>,
    isVideoLoading,
  };
}
