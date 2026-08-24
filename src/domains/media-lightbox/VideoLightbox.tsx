/**
 * VideoLightbox
 *
 * Specialized lightbox for video media. Handles all video-specific functionality:
 * - Video trimming
 * - Video replace mode
 * - Video regenerate mode
 * - Video enhance mode
 * - Segment slot mode (timeline navigation)
 *
 * Uses useSharedLightboxState for shared functionality (variants, navigation, etc.)
 *
 * This is part of the split architecture where MediaLightbox dispatches to
 * ImageLightbox or VideoLightbox based on media type.
 */

import React from 'react';
import type { VideoLightboxProps, VideoLightboxPropsWithMedia } from './types';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import type { OverlayViewportConstraints } from '@/shared/lib/layout/overlayViewportConstraints';

import { LightboxProviders } from './components/LightboxProviders';
import { LightboxLayout } from './components/layouts/LightboxLayout';
import { SegmentSlotFormView } from './components/SegmentSlotFormView';

import {
  useVideoLightboxMode,
  useVideoLightboxEnvironment,
} from './hooks/videoLightbox/useVideoLightboxEnvironment';
import { useVideoLightboxRenderModel } from './hooks/videoLightbox/useVideoLightboxRenderModel';
import {
  useVideoLightboxSharedState,
  useVideoLightboxEditing,
} from './hooks/videoLightbox/useVideoLightboxController';

import { LightboxShell } from './components/LightboxShell';
import { VideoEditProvider } from './contexts/VideoEditContext';

export type {
  VideoLightboxSharedStateModel,
  VideoLightboxEditModel,
} from './hooks/videoLightbox/useVideoLightboxController';

const VideoLightboxMediaContent: React.FC<VideoLightboxPropsWithMedia> = (props) => {
  const modeModel = useVideoLightboxMode(props);
  const env = useVideoLightboxEnvironment(props, modeModel);
  const sharedState = useVideoLightboxSharedState(props, modeModel, env);
  const editModel = useVideoLightboxEditing(props, modeModel, env, sharedState);
  const renderModel = useVideoLightboxRenderModel(props, modeModel, env, sharedState, editModel);
  const overlayViewport: OverlayViewportConstraints = {
    tasksPaneOpen: env.effectiveTasksPaneOpen,
    tasksPaneWidth: env.effectiveTasksPaneWidth,
    tasksPaneLocked: env.isTasksPaneLocked,
    isTabletOrLarger: sharedState.layout.isTabletOrLarger,
    needsFullscreenLayout: renderModel.needsFullscreenLayout,
    needsTasksPaneOffset: renderModel.needsTasksPaneOffset,
  };

  return (
    <LightboxProviders stateValue={renderModel.lightboxStateValue}>
      <VideoEditProvider value={editModel.videoEditValue}>
        <LightboxShell
          onClose={props.onClose}
          hasCanvasOverlay={false}
          isRepositionMode={false}
          isMobile={env.isMobile}
          isTabletOrLarger={sharedState.layout.isTabletOrLarger}
          overlayViewport={overlayViewport}
          contentRef={env.contentRef}
          accessibilityTitle={renderModel.accessibilityTitle}
          accessibilityDescription={renderModel.accessibilityDescription}
        >
          {modeModel.isFormOnlyMode && props.segmentSlotMode ? (
            <SegmentSlotFormView
              segmentSlotMode={props.segmentSlotMode}
              onClose={props.onClose}
              onNavPrev={modeModel.handleSlotNavPrev}
              onNavNext={modeModel.handleSlotNavNext}
              hasPrevious={modeModel.hasPrevious}
              hasNext={modeModel.hasNext}
              readOnly={props.readOnly}
            />
          ) : (
            <LightboxLayout {...renderModel.layoutProps} controlsPanelContent={renderModel.controlsPanelContent} />
          )}
        </LightboxShell>
      </VideoEditProvider>
    </LightboxProviders>
  );
};

const VideoLightboxFormOnlyContent: React.FC<VideoLightboxProps> = (props) => {
  const modeModel = useVideoLightboxMode(props);
  const env = useVideoLightboxEnvironment(props, modeModel);

  if (!props.segmentSlotMode) {
    return null;
  }

  const overlayViewport: OverlayViewportConstraints = {
    tasksPaneOpen: env.effectiveTasksPaneOpen,
    tasksPaneWidth: env.effectiveTasksPaneWidth,
    tasksPaneLocked: env.isTasksPaneLocked,
    isTabletOrLarger: false,
    needsFullscreenLayout: true,
    needsTasksPaneOffset: false,
  };

  return (
    <LightboxShell
      onClose={props.onClose}
      hasCanvasOverlay={false}
      isRepositionMode={false}
      isMobile={env.isMobile}
      isTabletOrLarger={false}
      overlayViewport={overlayViewport}
      contentRef={env.contentRef}
      accessibilityTitle={`Segment ${(props.segmentSlotMode.currentIndex ?? 0) + 1} Settings`}
      accessibilityDescription="Configure and generate this video segment. Use Tab or arrow keys to navigate between segments."
    >
      <SegmentSlotFormView
        segmentSlotMode={props.segmentSlotMode}
        onClose={props.onClose}
        onNavPrev={modeModel.handleSlotNavPrev}
        onNavNext={modeModel.handleSlotNavNext}
        hasPrevious={modeModel.hasPrevious}
        hasNext={modeModel.hasNext}
        readOnly={props.readOnly}
      />
    </LightboxShell>
  );
};

export const VideoLightbox: React.FC<VideoLightboxProps> = (props) => {
  const isSegmentSlotMode = !!props.segmentSlotMode;
  const hasSegmentVideo = isSegmentSlotMode && !!props.segmentSlotMode?.segmentVideo;
  const isFormOnlyMode = isSegmentSlotMode && !hasSegmentVideo;

  if (isFormOnlyMode) {
    return <VideoLightboxFormOnlyContent {...props} />;
  }

  if (!props.media) {
    normalizeAndPresentError(new Error('No media prop provided and not in form-only mode'), {
      context: 'VideoLightbox',
      showToast: false,
    });
    return null;
  }

  const media = props.parentGenerationIdOverride
    ? {
        ...props.media,
        parent_generation_id: props.parentGenerationIdOverride,
      }
    : props.media;

  return <VideoLightboxMediaContent {...props} media={media} />;
};
