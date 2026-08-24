import React from 'react';

interface GuidanceVideoUploaderProps {
  shotId: string;
  projectId: string;
  onVideoUploaded: (videoUrl: string | null, metadata: import('@/shared/lib/media/videoUploader').VideoMetadata | null) => void;
  currentVideoUrl: string | null;
  compact?: boolean;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomToStart: () => void;
  hasNoImages?: boolean;
}

export const GuidanceVideoUploader: React.FC<GuidanceVideoUploaderProps> = ({
  zoomLevel,
}) => {
  // Note: Upload controls are now in TimelineContainer's top bar
  // Just a small spacer for visual separation

  return (
    <div
      className="relative h-2 -mt-1 mb-3"
      style={{
        width: zoomLevel > 1 ? `${zoomLevel * 100}%` : '100%',
        minWidth: '100%',
      }}
    />
  );
};
