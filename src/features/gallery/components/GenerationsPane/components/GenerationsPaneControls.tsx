import React from 'react';
import { cn } from '@/shared/components/ui/contracts/cn';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Label } from '@/shared/components/ui/primitives/label';
import { ShotFilter } from '@/shared/components/selectors/ShotFilter';
import { MediaTypeFilter } from '@/shared/components/selectors/MediaTypeFilter';
import { SHOT_FILTER } from '@/shared/constants/filterConstants';
import { ChevronLeft, ChevronRight, Search, Star, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

type ShotFilterProps = React.ComponentProps<typeof ShotFilter>;
type MediaTypeFilterProps = React.ComponentProps<typeof MediaTypeFilter>;

interface GenerationsPaneFiltersModel {
  shots: ShotFilterProps['shots'];
  selectedShotFilter: ShotFilterProps['selectedShotId'];
  onSelectedShotFilterChange: NonNullable<ShotFilterProps['onShotChange']>;
  excludePositioned: ShotFilterProps['excludePositioned'];
  onExcludePositionedChange: NonNullable<ShotFilterProps['onExcludePositionedChange']>;
  isMobile: boolean;
  shotFilterContentRef: React.MutableRefObject<HTMLDivElement>;
  mediaTypeFilterContentRef: React.RefObject<HTMLDivElement>;
  shotFilterOpen: boolean;
  onShotFilterOpenChange: (open: boolean) => void;
  mediaTypeFilter: MediaTypeFilterProps['value'];
  onMediaTypeFilterChange: NonNullable<MediaTypeFilterProps['onChange']>;
  mediaTypeFilterOpen: boolean;
  onMediaTypeFilterOpenChange: (open: boolean) => void;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  isSearchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  searchInputRef: React.MutableRefObject<HTMLInputElement>;
  starredOnly: boolean;
  onStarredOnlyChange: (value: boolean) => void;
  currentShotId: string | null;
  isSpecialFilterSelected: boolean;
}

interface GenerationsPanePaginationModel {
  totalCount: number;
  perPage: number;
  page: number;
  onPageChange: (nextPage: number) => void;
}

interface GenerationsPaneInteractionModel {
  isInteractionDisabled: boolean;
}

interface GenerationsPaneControlsProps {
  filters: GenerationsPaneFiltersModel;
  pagination: GenerationsPanePaginationModel;
  interaction: GenerationsPaneInteractionModel;
}

export function GenerationsPaneControls({
  filters,
  pagination,
  interaction,
}: GenerationsPaneControlsProps): React.ReactElement {
  const totalPages = Math.ceil(pagination.totalCount / pagination.perPage);
  const currentShotId = filters.currentShotId;

  return (
    <div className="px-2 pt-3 pb-2 space-y-2">
      <div className="flex items-center justify-between min-w-0 mx-2">
        <div
          className={cn(
            'flex items-center gap-2 min-w-0 flex-shrink',
            'transition-all duration-200',
            interaction.isInteractionDisabled && 'pointer-events-none opacity-70',
          )}
        >
          <ShotFilter
            shots={filters.shots}
            selectedShotId={filters.selectedShotFilter}
            onShotChange={filters.onSelectedShotFilterChange}
            excludePositioned={filters.excludePositioned}
            onExcludePositionedChange={filters.onExcludePositionedChange}
            darkSurface
            checkboxId="exclude-positioned-generations-pane"
            triggerWidth="w-[100px] sm:w-[140px]"
            isMobile={filters.isMobile}
            contentRef={filters.shotFilterContentRef}
            showPositionFilter={false}
            open={filters.shotFilterOpen}
            onOpenChange={(open) => {
              if (interaction.isInteractionDisabled && open) {
                filters.onShotFilterOpenChange(false);
                return;
              }
              filters.onShotFilterOpenChange(open);
            }}
          />

          {currentShotId &&
            (filters.selectedShotFilter === currentShotId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => filters.onSelectedShotFilterChange(SHOT_FILTER.ALL)}
                className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 whitespace-nowrap hidden sm:flex"
              >
                <ChevronLeft className="h-3 w-3 -mr-0.5" />
                All
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => filters.onSelectedShotFilterChange(currentShotId)}
                className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 whitespace-nowrap hidden sm:flex"
              >
                <ChevronLeft className="h-3 w-3 -mr-0.5" />
                This shot
              </Button>
            ))}

          <div className="flex items-center">
            {!filters.isSearchOpen ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  filters.onSearchOpenChange(true);
                  setTimeout(() => filters.searchInputRef.current?.focus(), 0);
                }}
                className="h-7 w-7 p-0 text-zinc-400 hover:text-white hover:bg-zinc-700"
                aria-label="Search prompts"
              >
                <Search className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex items-center gap-x-1 border rounded-md px-2 py-1 h-7 bg-zinc-800 border-zinc-600">
                <Search className="h-3.5 w-3.5 text-zinc-400" />
                <input
                  ref={(node) => {
                    if (node) filters.searchInputRef.current = node;
                  }}
                  type="text"
                  placeholder="Search..."
                  value={filters.searchTerm}
                  onChange={(e) => filters.onSearchTermChange(e.target.value)}
                  className="bg-transparent border-none outline-none text-base lg:text-xs w-20 sm:w-28 text-white placeholder-zinc-400 preserve-case"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (filters.searchTerm) {
                      filters.onSearchTermChange('');
                      filters.searchInputRef.current?.focus();
                    } else {
                      filters.onSearchOpenChange(false);
                    }
                  }}
                  className="h-auto p-0.5 text-zinc-400 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </div>

        <div
          className={cn(
            'flex items-center transition-all duration-200',
            interaction.isInteractionDisabled && 'pointer-events-none opacity-70',
          )}
        >
          <div className="flex h-6 items-center overflow-hidden rounded-md border border-zinc-700 text-[10px] font-medium">
            <button
              type="button"
              className={cn(
                'h-full px-2.5 transition-colors',
                filters.mediaTypeFilter !== 'video'
                  ? 'bg-zinc-600 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
              onClick={() => filters.onMediaTypeFilterChange('image')}
            >
              Images
            </button>
            <button
              type="button"
              className={cn(
                'h-full px-2.5 transition-colors',
                filters.mediaTypeFilter === 'video'
                  ? 'bg-zinc-600 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
              onClick={() => filters.onMediaTypeFilterChange('video')}
            >
              Videos
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between min-w-0 gap-2 mx-2">
        <div className="flex items-center gap-2">
          {pagination.totalCount > pagination.perPage ? (
            <div className="flex items-center gap-x-1">
              <button
                onClick={() => pagination.onPageChange(Math.max(1, pagination.page - 1))}
                disabled={pagination.page === 1}
                className="p-1 rounded hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4 text-zinc-400" />
              </button>

              <div className="flex items-center gap-1">
                <Select
                  value={pagination.page.toString()}
                  onValueChange={(value) => {
                    if (value) {
                      pagination.onPageChange(parseInt(value, 10));
                    }
                  }}
                >
                  <SelectTrigger
                    variant="retro-dark"
                    colorScheme="zinc"
                    size="sm"
                    className="h-6 w-9 text-xs px-1 !justify-center [&>span]:!text-center"
                    hideIcon
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent variant="zinc" className="!min-w-0 w-11">
                    {Array.from({ length: totalPages }, (_, i) => (
                      <SelectItem
                        variant="zinc"
                        key={i + 1}
                        value={(i + 1).toString()}
                        className="text-xs !px-0 !justify-center [&>span]:!text-center [&>span]:!w-full"
                      >
                        {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-zinc-400">
                  <span className="hidden sm:inline">
                    of {totalPages} ({pagination.totalCount})
                  </span>
                  <span className="sm:hidden">/ {totalPages}</span>
                </span>
              </div>

              <button
                onClick={() => pagination.onPageChange(pagination.page + 1)}
                disabled={pagination.page * pagination.perPage >= pagination.totalCount}
                className="p-1 rounded hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4 text-zinc-400" />
              </button>
            </div>
          ) : (
            <span className="text-xs text-zinc-400">
              {pagination.totalCount > 0
                ? `${pagination.totalCount} item${pagination.totalCount !== 1 ? 's' : ''}`
                : 'No items'}
            </span>
          )}
        </div>

        <div
          className={cn(
            'flex items-center transition-all duration-200 flex-shrink-0',
            interaction.isInteractionDisabled && 'pointer-events-none opacity-70',
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            className="p-1 h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-700"
            onClick={() => filters.onStarredOnlyChange(!filters.starredOnly)}
            aria-label={filters.starredOnly ? 'Show all items' : 'Show only starred items'}
          >
            <Star className="h-5 w-5" fill={filters.starredOnly ? 'currentColor' : 'none'} />
          </Button>
        </div>
      </div>

      {!filters.isSpecialFilterSelected && (
        <div className="flex items-center gap-x-2 mx-2">
          <Checkbox
            id="exclude-positioned-generations-pane"
            checked={filters.excludePositioned}
            onCheckedChange={(checked) => filters.onExcludePositionedChange(!!checked)}
            className="border-zinc-600 data-[checked]:bg-zinc-600"
          />
          <Label
            htmlFor="exclude-positioned-generations-pane"
            className="text-xs cursor-pointer text-zinc-300"
          >
            Exclude items with a position
          </Label>
        </div>
      )}
    </div>
  );
}
