import React from 'react';
import { AddAudioButton } from './AddAudioButton';
import { GuidanceVideoControls, type GuidanceVideoControlsProps } from './GuidanceVideoControls';
import { TimelineBottomControls, type TimelineBottomControlsProps } from './TimelineBottomControls';
import { ZoomControls } from './ZoomControls';

interface TimelineControlsProps {
  timeline: {
    shotId: string;
    projectId: string | null;
    readOnly: boolean;
    hasNoImages: boolean;
    zoomLevel: number;
    fullMax: number;
    showDragHint: boolean;
  };
  audio: {
    audioUrl?: string | null;
    onAudioChange?: (audioUrl: string | null, metadata: { duration: number; name?: string } | null) => void;
  };
  guidance: {
    primaryStructureVideo: GuidanceVideoControlsProps['primaryStructureVideo'];
    structureVideos?: GuidanceVideoControlsProps['structureVideos'];
    onAddStructureVideo?: GuidanceVideoControlsProps['onAddStructureVideo'];
    onUpdateStructureVideo?: GuidanceVideoControlsProps['onUpdateStructureVideo'];
    onPrimaryStructureVideoInputChange?: GuidanceVideoControlsProps['onPrimaryStructureVideoInputChange'];
    onShowVideoBrowser: () => void;
    isUploadingStructureVideo: boolean;
    setIsUploadingStructureVideo: (uploading: boolean) => void;
  };
  zoom: {
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomReset: () => void;
    onZoomToStart: () => void;
  };
  bottom: {
    resetGap: TimelineBottomControlsProps['resetGap'];
    setResetGap: TimelineBottomControlsProps['setResetGap'];
    maxGap: TimelineBottomControlsProps['maxGap'];
    onReset: TimelineBottomControlsProps['onReset'];
    onFileDrop?: TimelineBottomControlsProps['onFileDrop'];
    isUploadingImage: TimelineBottomControlsProps['isUploadingImage'];
    uploadProgress: TimelineBottomControlsProps['uploadProgress'];
    pushMode: TimelineBottomControlsProps['pushMode'];
  };
}

export const TimelineControls: React.FC<TimelineControlsProps> = ({
  timeline,
  audio,
  guidance,
  zoom,
  bottom,
}) => (
  <>
    {timeline.shotId
      && (timeline.projectId || timeline.readOnly)
      && guidance.onPrimaryStructureVideoInputChange
      && (guidance.primaryStructureVideo.path || !timeline.readOnly) && (
      <div
        className="absolute left-0 z-30 flex items-end justify-between pointer-events-none px-8"
        style={{ width: '100%', maxWidth: '100vw', top: timeline.zoomLevel > 1 ? '0.98875rem' : '1rem' }}
      >
        <ZoomControls
          zoomLevel={timeline.zoomLevel}
          onZoomIn={zoom.onZoomIn}
          onZoomOut={zoom.onZoomOut}
          onZoomReset={zoom.onZoomReset}
          onZoomToStart={zoom.onZoomToStart}
          hasNoImages={timeline.hasNoImages}
        />

        {!audio.audioUrl && audio.onAudioChange && !timeline.readOnly && (
          <AddAudioButton projectId={timeline.projectId ?? undefined} shotId={timeline.shotId} onAudioChange={audio.onAudioChange} />
        )}

        {(guidance.structureVideos ? true : !guidance.primaryStructureVideo.path) && (
          <GuidanceVideoControls
            shotId={timeline.shotId}
            projectId={timeline.projectId ?? undefined}
            readOnly={timeline.readOnly}
            hasNoImages={timeline.hasNoImages}
            primaryStructureVideo={guidance.primaryStructureVideo}
            structureVideos={guidance.structureVideos}
            fullMax={timeline.fullMax}
            onAddStructureVideo={guidance.onAddStructureVideo}
            onUpdateStructureVideo={guidance.onUpdateStructureVideo}
            onPrimaryStructureVideoInputChange={guidance.onPrimaryStructureVideoInputChange}
            onShowVideoBrowser={guidance.onShowVideoBrowser}
            isUploadingStructureVideo={guidance.isUploadingStructureVideo}
            setIsUploadingStructureVideo={guidance.setIsUploadingStructureVideo}
          />
        )}
      </div>
    )}

    <TimelineBottomControls
      resetGap={bottom.resetGap}
      setResetGap={bottom.setResetGap}
      maxGap={bottom.maxGap}
      onReset={bottom.onReset}
      onFileDrop={bottom.onFileDrop}
      isUploadingImage={bottom.isUploadingImage}
      uploadProgress={bottom.uploadProgress}
      readOnly={timeline.readOnly}
      hasNoImages={timeline.hasNoImages}
      zoomLevel={timeline.zoomLevel}
      pushMode={bottom.pushMode}
      showDragHint={timeline.showDragHint}
    />
  </>
);
