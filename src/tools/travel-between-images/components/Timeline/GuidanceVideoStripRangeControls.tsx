import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';

interface GuidanceVideoStripRangeControlsProps {
  displayOutputStart: number;
  displayOutputEnd: number;
  isDragging: unknown;
  treatment: 'adjust' | 'clip';
  onTreatmentChange: (treatment: 'adjust' | 'clip') => void;
  onRangeChange?: (startFrame: number, endFrame: number) => void;
  effectiveMetadataTotalFrames: number;
  useAbsolutePosition: boolean;
}

export const GuidanceVideoStripRangeControls: React.FC<GuidanceVideoStripRangeControlsProps> = ({
  displayOutputStart,
  displayOutputEnd,
  isDragging,
  treatment,
  onTreatmentChange,
  onRangeChange,
  effectiveMetadataTotalFrames,
  useAbsolutePosition,
}) => {
  return (
    <div
      className="absolute bottom-0 z-50 flex justify-between items-center text-[9px] text-muted-foreground font-mono"
      style={{
        left: useAbsolutePosition ? '2px' : '16px',
        right: useAbsolutePosition ? '2px' : '16px',
      }}
    >
      <div className="flex items-center gap-1">
        <span className={`px-1 rounded bg-background/80 pointer-events-none ${isDragging ? 'ring-1 ring-primary' : ''}`}>
          f{displayOutputStart}
        </span>

        <Select
          value={treatment}
          onValueChange={(newTreatment) => {
            if (newTreatment !== 'adjust' && newTreatment !== 'clip') return;
            if (newTreatment === 'clip' && onRangeChange) {
              const currentDuration = displayOutputEnd - displayOutputStart;
              if (effectiveMetadataTotalFrames > 0 && currentDuration > effectiveMetadataTotalFrames) {
                onRangeChange(displayOutputStart, displayOutputStart + effectiveMetadataTotalFrames);
              }
            }
            onTreatmentChange(newTreatment);
          }}
        >
          <SelectTrigger
            variant="retro"
            size="sm"
            className="h-4 w-[72px] text-[8px] px-1 py-0 !bg-background hover:!bg-background font-sans [&>span]:line-clamp-none [&>span]:whitespace-nowrap"
          >
            <SelectValue>
              {treatment === 'adjust' ? 'Fit to range' : '1:1 mapping'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent variant="retro">
            <SelectItem variant="retro" value="adjust">
              <div className="flex flex-col gap-0.5 py-1">
                <span className="text-xs font-medium">Fit to range</span>
                <span className="text-[10px] text-muted-foreground leading-tight">
                  Stretch or compress video to fill the entire range
                </span>
              </div>
            </SelectItem>
            <SelectItem variant="retro" value="clip">
              <div className="flex flex-col gap-0.5 py-1">
                <span className="text-xs font-medium">1:1 mapping</span>
                <span className="text-[10px] text-muted-foreground leading-tight">
                  Each video frame maps to one output frame
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <span className={`px-1 rounded bg-background/80 pointer-events-none ${isDragging ? 'ring-1 ring-primary' : ''}`}>
        f{displayOutputEnd}
      </span>
    </div>
  );
};
