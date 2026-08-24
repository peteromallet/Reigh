import React from 'react';
import { Check, Copy, Film, Loader2, Share2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { VariantBadge } from '@/shared/components/VariantBadge';
import type { GenerationRow } from '@/domains/generation/types';
import type {
  FinalVideoSectionProgress,
  FinalVideoVariantBadgeData,
} from './FinalVideoSection.types';

interface FinalVideoSectionControlsProps {
  readOnly: boolean;
  hasFinalOutput: boolean;
  badgeData: FinalVideoVariantBadgeData | null;
  onMarkAllVariantsViewed: () => void;
  selectedParentId: string | null;
  onShare: () => void;
  isCreatingShare: boolean;
  shareCopied: boolean;
  shareSlug?: string | null;
  progress: FinalVideoSectionProgress;
  onJoinSegmentsClick?: () => void;
  parentGenerations: GenerationRow[];
  selectedIndex: number;
  onOutputSelect: (id: string) => void;
}

function renderShareIcon(isCreatingShare: boolean, shareCopied: boolean, shareSlug?: string | null) {
  if (isCreatingShare) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  if (shareCopied) {
    return <Check className="h-4 w-4 text-green-500" />;
  }
  if (shareSlug) {
    return <Copy className="h-4 w-4" />;
  }
  return <Share2 className="h-4 w-4" />;
}

function getShareTooltipLabel(shareCopied: boolean, shareSlug?: string | null): string {
  if (shareCopied) {
    return 'Link copied!';
  }
  return shareSlug ? 'Copy share link' : 'Share this video';
}

export const FinalVideoSectionControls: React.FC<FinalVideoSectionControlsProps> = ({
  readOnly,
  hasFinalOutput,
  badgeData,
  onMarkAllVariantsViewed,
  selectedParentId,
  onShare,
  isCreatingShare,
  shareCopied,
  shareSlug,
  progress,
  onJoinSegmentsClick,
  parentGenerations,
  selectedIndex,
  onOutputSelect,
}) => {
  const showVariantBadge = Boolean(
    hasFinalOutput &&
    badgeData &&
    (badgeData.derivedCount > 0 || badgeData.hasUnviewedVariants),
  );

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-base sm:text-lg font-light flex items-center gap-2">
          <Film className="w-5 h-5 text-muted-foreground" />
          Final Video
          {showVariantBadge && badgeData && (
            <VariantBadge
              derivedCount={badgeData.derivedCount}
              unviewedVariantCount={badgeData.unviewedVariantCount}
              hasUnviewedVariants={badgeData.hasUnviewedVariants}
              variant="inline"
              size="md"
              onMarkAllViewed={onMarkAllVariantsViewed}
            />
          )}
        </h2>

        {!readOnly && (
          <div className="flex items-center gap-2">
            {hasFinalOutput && selectedParentId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onShare}
                    disabled={isCreatingShare}
                    className={shareCopied ? 'bg-green-500/10 border-green-500/50' : ''}
                  >
                    {renderShareIcon(isCreatingShare, shareCopied, shareSlug)}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {getShareTooltipLabel(shareCopied, shareSlug)}
                </TooltipContent>
              </Tooltip>
            )}

            {progress.total > 0 && progress.completed === progress.total && onJoinSegmentsClick && (
              <Button type="button" variant="outline" size="sm" onClick={onJoinSegmentsClick}>
                Join clips
              </Button>
            )}
          </div>
        )}
      </div>

      {!readOnly && parentGenerations.length > 1 && (
        <div className="mb-4">
          <Select value={selectedParentId || ''} onValueChange={onOutputSelect}>
            <SelectTrigger className="w-full sm:w-auto sm:min-w-[160px] h-8 text-sm">
              <SelectValue placeholder="Select output">
                {selectedParentId && (
                  <span className="flex items-center gap-1.5">
                    Output {Math.max(selectedIndex + 1, 1)} of {parentGenerations.length}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {parentGenerations.map((parent, index) => {
                const createdAt = parent.createdAt;
                const timeAgo = createdAt
                  ? formatDistanceToNow(new Date(createdAt), { addSuffix: true })
                  : '';
                const hasOutput = Boolean(parent.location);

                return (
                  <SelectItem key={parent.id} value={parent.id}>
                    <div className="flex items-center gap-2">
                      <span>Output {index + 1}</span>
                      {hasOutput && <Check className="w-3 h-3 text-green-500" />}
                      <span className="text-xs text-muted-foreground">{timeAgo}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
};
