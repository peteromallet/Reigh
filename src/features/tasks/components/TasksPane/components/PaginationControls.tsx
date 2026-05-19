import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { FilterGroup, ITEMS_PER_PAGE } from '../constants';

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  isLoading?: boolean;
  filterType: FilterGroup;
  recentCount?: number;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({ 
  currentPage, 
  totalPages, 
  onPageChange, 
  totalItems,
  isLoading = false,
  filterType,
  recentCount
}) => {
  // Only show pagination when there are multiple pages
  if (totalPages <= 1) return null;

  const getFilterLabel = () => {
    switch (filterType) {
      case 'Processing':
        return 'processing';
      case 'Succeeded':
        return 'succeeded';
      case 'Failed':
        return 'failed';
      default:
        return 'tasks';
    }
  };

  // Show recent count info if available and it's a filter that has recent data
  const showRecentInfo = recentCount && recentCount > 0 && (filterType === 'Succeeded' || filterType === 'Failed');

  const summaryText = showRecentInfo
    ? `${recentCount.toLocaleString()} recent, ${totalItems.toLocaleString()} total`
    : `${totalItems.toLocaleString()} ${getFilterLabel()} • ${ITEMS_PER_PAGE}/page`;

  return (
    <div className="flex flex-nowrap items-center gap-2 px-3 py-1.5 text-[11px] text-zinc-400">
      <span className="min-w-0 flex-1 truncate whitespace-nowrap" title={summaryText}>
        {summaryText}
      </span>
      <div className="flex flex-shrink-0 items-center gap-0.5 whitespace-nowrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1 || isLoading}
          className="h-7 w-7 p-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        {/* Page selector dropdown */}
        <Select
          value={currentPage.toString()}
          onValueChange={(value) => {
            if (!value) return;
            onPageChange(parseInt(value, 10));
          }}
          disabled={isLoading}
        >
          <SelectTrigger variant="retro-dark" colorScheme="zinc" size="sm" className="h-6 w-8 text-xs px-1 !justify-center [&>span]:!text-center" hideIcon>
            <SelectValue />
          </SelectTrigger>
          <SelectContent variant="zinc" className="!min-w-0 w-11 text-xs">
            {Array.from({ length: totalPages }, (_, i) => (
              <SelectItem variant="zinc" key={i + 1} value={(i + 1).toString()} className="text-xs !px-0 !justify-center [&>span]:!text-center [&>span]:!w-full">
                {i + 1}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-zinc-300 text-[11px]">
          / {totalPages}
        </span>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || isLoading}
          className="h-7 w-7 p-0"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
