import React, { RefObject } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { cn } from '@/shared/components/ui/contracts/cn';

interface MediaTypeFilterProps {
  value: 'all' | 'image' | 'video';
  onChange?: (value: 'all' | 'image' | 'video') => void;
  /** Use when component is on a permanently dark surface (e.g., GenerationsPane) */
  darkSurface?: boolean;
  className?: string;
  id?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contentRef?: RefObject<HTMLDivElement>;
}

const MediaTypeFilterComponent: React.FC<MediaTypeFilterProps> = ({
  value,
  onChange,
  darkSurface,
  className = '',
  id,
  open,
  onOpenChange,
  contentRef,
}) => {
  // Variant selection: zinc for dark surfaces, retro for normal (handles app dark mode automatically)
  const variant = darkSurface ? 'zinc' : 'retro';

  return (
    <Select
      value={value}
      onValueChange={(val) => {
        if (val === 'all' || val === 'image' || val === 'video') {
          onChange?.(val);
        }
      }}
      open={open}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger
        id={id}
        variant={darkSurface ? 'retro-dark' : 'retro'}
        colorScheme={darkSurface ? 'zinc' : 'default'}
        size="sm"
        className={cn("h-6 text-xs w-[80px]", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent variant={variant} className="w-max text-xs" ref={contentRef}>
        <SelectItem variant={variant} value="all" className="text-xs whitespace-nowrap">
          All
        </SelectItem>
        <SelectItem variant={variant} value="image" className="text-xs whitespace-nowrap">
          Images
        </SelectItem>
        <SelectItem variant={variant} value="video" className="text-xs whitespace-nowrap">
          Videos
        </SelectItem>
      </SelectContent>
    </Select>
  );
};

export const MediaTypeFilter = React.memo(MediaTypeFilterComponent);
