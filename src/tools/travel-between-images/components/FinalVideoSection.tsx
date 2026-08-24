/**
 * FinalVideoSection - Prominent final video display with output selector
 *
 * Shows the final joined video output at the top of the shot editor,
 * with a dropdown to switch between different generation outputs.
 */

import React from 'react';
import { Card, CardContent } from '@/shared/components/ui/card';
import { MediaLightbox } from '@/domains/media-lightbox/MediaLightbox';
import { FinalVideoSectionControls } from './FinalVideoSectionControls';
import { FinalVideoSectionDisplay } from './FinalVideoSectionDisplay';
import { useFinalVideoSectionController } from './hooks/useFinalVideoSectionController';
import type { FinalVideoSectionProps } from './FinalVideoSection.types';

export const FinalVideoSection: React.FC<FinalVideoSectionProps> = (props) => {
  const {
    isMobile,
    isLightboxOpen,
    handleLightboxOpen,
    handleLightboxClose,
    parentGenerations,
    selectedParentId,
    selectedIndex,
    hasFinalOutput,
    badgeData,
    handleMarkAllVariantsViewed,
    parentVideoRow,
    taskDetailsData,
    taskMapping,
    task,
    taskError,
    inputImages,
    handleShare,
    isCreatingShare,
    shareCopied,
    shareSlug,
    handleOutputSelect,
    segmentProgress,
    handleDelete,
    isCurrentlyLoading,
    shouldShowSkeleton,
    hasActiveJoinTask,
  } = useFinalVideoSectionController(props);

  return (
    <div className="w-full">
      <Card className="border rounded-xl shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <FinalVideoSectionControls
            readOnly={Boolean(props.readOnly)}
            hasFinalOutput={hasFinalOutput}
            badgeData={badgeData}
            onMarkAllVariantsViewed={handleMarkAllVariantsViewed}
            selectedParentId={selectedParentId}
            onShare={(event) => { void handleShare(event); }}
            isCreatingShare={isCreatingShare}
            shareCopied={shareCopied}
            shareSlug={shareSlug}
            progress={segmentProgress}
            onJoinSegmentsClick={props.onJoinSegmentsClick}
            parentGenerations={parentGenerations}
            selectedIndex={selectedIndex}
            onOutputSelect={handleOutputSelect}
          />

          <div className="my-3 h-px w-full bg-border" />

          <FinalVideoSectionDisplay
            projectAspectRatio={props.projectAspectRatio}
            shouldShowSkeleton={shouldShowSkeleton}
            hasFinalOutput={hasFinalOutput}
            parentVideoRow={parentVideoRow}
            isMobile={isMobile}
            projectId={props.projectId}
            onLightboxOpen={handleLightboxOpen}
            onMobileTap={handleLightboxOpen}
            onApplySettingsFromTask={props.onApplySettingsFromTask}
            readOnly={Boolean(props.readOnly)}
            onDelete={props.onDelete}
            onDeleteSelected={handleDelete}
            isDeleting={Boolean(props.isDeleting)}
            isCurrentlyLoading={isCurrentlyLoading}
            hasActiveJoinTask={hasActiveJoinTask}
          />
        </CardContent>
      </Card>

      {isLightboxOpen && parentVideoRow && (
        <MediaLightbox
          media={parentVideoRow}
          variantFetchGenerationIdOverride={parentVideoRow.variant_fetch_generation_id ?? undefined}
          onClose={handleLightboxClose}
          navigation={{
            showNavigation: false,
            hasNext: false,
            hasPrevious: false,
          }}
          features={{
            showImageEditTools: false,
            showDownload: true,
            showTaskDetails: true,
          }}
          actions={{
            starred: parentVideoRow.starred ?? false,
          }}
          shotId={props.shotId}
          readOnly={Boolean(props.readOnly)}
          taskDetailsData={{
            task: task ?? null,
            isLoading: taskDetailsData?.isLoading ?? false,
            status: taskDetailsData?.status ?? (taskError ? 'error' : task ? 'ok' : 'missing'),
            error: taskError,
            inputImages,
            taskId: taskMapping?.taskId || null,
            onApplySettingsFromTask: props.onApplySettingsFromTask,
            onClose: handleLightboxClose,
          }}
        />
      )}
    </div>
  );
};
