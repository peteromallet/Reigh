import React from 'react';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/primitives/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Slider } from '@/shared/components/ui/slider';
import { Video, X, Images } from 'lucide-react';
import { ResourceBrowserModalBase } from '@/features/resources/components/ResourceBrowserModalBase';
import { useBatchGuidanceVideoController } from './hooks/useBatchGuidanceVideoController';
import type { AuthoredVideoMetadata, VideoMetadata } from '@/shared/lib/media/videoUploader';
import type { TravelGuidanceMode } from '@/shared/lib/tasks/travelGuidance';

interface BatchGuidanceVideoProps {
  shotId: string;
  projectId: string;
  videoUrl: string | null;
  videoMetadata: AuthoredVideoMetadata | null;
  treatment: 'adjust' | 'clip';
  motionStrength: number;
  structureType?: TravelGuidanceMode;
  onVideoUploaded: (videoUrl: string | null, metadata: VideoMetadata | null, resourceId?: string) => void;
  onTreatmentChange: (treatment: 'adjust' | 'clip') => void;
  onMotionStrengthChange: (strength: number) => void;
  onStructureTypeChange?: (type: TravelGuidanceMode) => void;
  uni3cEndPercent?: number;
  onUni3cEndPercentChange?: (value: number) => void;
  imageCount?: number;
  timelineFramePositions?: number[];
  readOnly?: boolean;
  hideStructureSettings?: boolean;
}

export const BatchGuidanceVideo: React.FC<BatchGuidanceVideoProps> = ({
  shotId,
  projectId: _projectId,
  videoUrl,
  videoMetadata,
  treatment,
  onVideoUploaded,
  onTreatmentChange,
  timelineFramePositions = [],
  readOnly = false,
}) => {
  const controller = useBatchGuidanceVideoController({
    shotId,
    videoUrl,
    videoMetadata,
    treatment,
    timelineFramePositions,
    onVideoUploaded,
    readOnly,
  });

  if (!videoUrl) {
    if (readOnly) {
      return null;
    }

    return (
      <>
        <div className="mb-4">
          <div
            ref={controller.dropZoneRef}
            className={`w-full sm:w-2/3 md:w-1/2 lg:w-1/3 p-4 border-2 border-dashed rounded-lg transition-colors ${
              controller.isDragging
                ? 'border-primary bg-primary/10'
                : 'border-border bg-muted/20 hover:border-muted-foreground/50'
            }`}
            onDragEnter={controller.handleDragEnter}
            onDragLeave={controller.handleDragLeave}
            onDragOver={controller.handleDragOver}
            onDrop={controller.handleDrop}
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <Video className={`h-8 w-8 ${controller.isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
              <p className="text-xs text-muted-foreground">
                {controller.isDragging
                  ? 'Drop video here'
                  : 'Add a motion guidance video to control the animation'}
              </p>

              <input
                ref={controller.fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={controller.handleFileSelect}
                disabled={controller.isUploading}
                className="hidden"
                id={`batch-video-upload-${shotId}`}
              />

              <div className="flex gap-2 w-full">
                <Label htmlFor={`batch-video-upload-${shotId}`} className="m-0 cursor-pointer flex-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={controller.isUploading}
                    className="w-full"
                    asChild
                  >
                    <span>
                      {controller.isUploading
                        ? `Uploading... ${Math.round(controller.uploadProgress)}%`
                        : 'Upload'}
                    </span>
                  </Button>
                </Label>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={controller.isUploading}
                  onClick={() => controller.setShowBrowser(true)}
                  className="flex-1"
                >
                  <Images className="h-4 w-4 mr-1" />
                  Browse
                </Button>
              </div>

              {controller.isUploading && (
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${Math.round(controller.uploadProgress)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <ResourceBrowserModalBase
          isOpen={controller.showBrowser}
          onOpenChange={controller.setShowBrowser}
          resourceType="structure-video"
          title="Browse Guidance Videos"
          onResourceSelect={controller.handleResourceSelect}
        />
      </>
    );
  }

  return (
    <div className="mb-4">
      <div className="border rounded-lg overflow-hidden bg-background">
        <div className="flex flex-col md:flex-row">
          <div className="w-full md:w-1/3 relative bg-black aspect-video flex-shrink-0 flex flex-col">
            <video
              ref={controller.videoRef}
              src={videoUrl}
              preload="metadata"
              className="hidden"
              muted
            />

            <canvas
              ref={controller.canvasRef}
              className="w-full h-full object-contain"
            />

            {controller.isFrameBeyondVideoCoverage && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/80 text-white px-4 py-3 rounded-lg text-center max-w-[80%]">
                  <p className="text-sm font-medium">
                    The guidance video only covers {controller.videoCoversFrames} frame{controller.videoCoversFrames === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-white/70 mt-1">
                    (frames {controller.minFrame}-{controller.lastCoveredFrame})
                  </p>
                </div>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-2 space-y-1">
              <div className="flex items-center justify-between text-xs text-white/80">
                <span>Timeline Frame: {controller.currentTimelineFrame}</span>
                <span>{controller.minFrame} - {controller.maxFrame}</span>
              </div>
              <Slider
                value={controller.currentTimelineFrame}
                onValueChange={controller.handleFrameChange}
                min={controller.minFrame}
                max={controller.maxFrame}
                step={1}
                className="w-full"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="md:hidden p-3 border-t">
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={controller.handleRemoveVideo}
              >
                <X className="h-4 w-4 mr-2" />
                Remove Video
              </Button>
            )}
          </div>

          <div className="flex-1 p-4 bg-muted/20 flex flex-col gap-4">
            <div className="space-y-2">
              <Label className="text-sm">How would you like to cut the guidance video to match the timeline?</Label>
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-shrink-0 w-full md:w-[200px]">
                  <Select
                    value={treatment}
                    onValueChange={(value) => {
                      if (value === 'adjust' || value === 'clip') onTreatmentChange(value);
                    }}
                    disabled={readOnly}
                  >
                    <SelectTrigger variant="retro" size="sm" className="h-9 w-full">
                      <SelectValue>
                        {treatment === 'adjust'
                          ? (controller.totalVideoFrames > controller.timelineFrames
                            ? 'Compress'
                            : controller.totalVideoFrames < controller.timelineFrames
                              ? 'Stretch'
                              : 'Match') + ' to timeline'
                          : 'Use video as is'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent variant="retro">
                      <SelectItem variant="retro" value="adjust">
                        {controller.totalVideoFrames > controller.timelineFrames
                          ? 'Compress'
                          : controller.totalVideoFrames < controller.timelineFrames
                            ? 'Stretch'
                            : 'Match'} to timeline
                      </SelectItem>
                      <SelectItem variant="retro" value="clip">
                        Use video as is
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 text-xs text-muted-foreground leading-relaxed">
                  {treatment === 'adjust' ? controller.adjustModeDescription : controller.clipModeDescription}
                </div>
              </div>
            </div>

            <div className="mt-auto pt-2 hidden md:block">
              {!readOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={controller.handleRemoveVideo}
                >
                  <X className="h-4 w-4 mr-2" />
                  Remove Video
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
