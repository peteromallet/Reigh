import React from 'react';
import { Check, Copy, Loader2, Share2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { VariantBadge } from '@/shared/components/VariantBadge';
import { cn } from '@/shared/components/ui/contracts/cn';
import { InfoTooltip } from './InfoTooltip';
import type { GeneratedImageWithMetadata } from '../types';
import type { Task } from '@/types/tasks';

interface ItemMetadataBarProps {
  image: GeneratedImageWithMetadata;
  isVideoContent: boolean;
  isMobile: boolean;
  taskData: Task | null | undefined;
  inputImages: string[];
  shouldShowMetadata: boolean;
  shouldShowTaskDetails: boolean;
  setIsInfoOpen: (isOpen: boolean) => void;
  showShare: boolean;
  taskId: string | null;
  handleShare: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  isCreatingShare: boolean;
  shareCopied: boolean;
  shareSlug: string | null;
  onMarkAllVariantsViewed: () => void;
}

export const ItemMetadataBar: React.FC<ItemMetadataBarProps> = ({
  image,
  isVideoContent,
  isMobile,
  taskData,
  inputImages,
  shouldShowMetadata,
  shouldShowTaskDetails,
  setIsInfoOpen,
  showShare,
  taskId,
  handleShare,
  isCreatingShare,
  shareCopied,
  shareSlug,
  onMarkAllVariantsViewed,
}) => {
  return (
    <div
      className={cn(
        'absolute right-1.5 flex flex-col items-end gap-1.5 z-20',
        isMobile ? 'top-12' : 'top-1.5 mt-8',
      )}
    >
      <div className="flex flex-row items-center gap-1.5">
        <InfoTooltip
          image={image}
          taskData={taskData}
          inputImages={inputImages}
          shouldShowMetadata={shouldShowMetadata}
          shouldShowTaskDetails={shouldShowTaskDetails}
          setIsInfoOpen={setIsInfoOpen}
          isMobile={isMobile}
        />

        {!isVideoContent && (
          <VariantBadge
            derivedCount={image.derivedCount}
            unviewedVariantCount={image.unviewedVariantCount}
            hasUnviewedVariants={image.hasUnviewedVariants}
            variant="inline"
            size="md"
            tooltipSide="right"
            onMarkAllViewed={onMarkAllVariantsViewed}
          />
        )}
      </div>

      {showShare && taskId && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                onClick={handleShare}
                disabled={isCreatingShare}
                className={`h-7 w-7 p-0 rounded-full text-white transition-all opacity-0 group-hover:opacity-100 ${
                  shareCopied
                    ? 'bg-green-500 hover:bg-green-600'
                    : 'bg-black/50 hover:bg-black/70'
                }`}
              >
                {isCreatingShare ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : shareCopied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : shareSlug ? (
                  <Copy className="h-3.5 w-3.5" />
                ) : (
                  <Share2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{shareCopied ? 'Link copied!' : shareSlug ? 'Copy share link' : 'Share this generation'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};
