import type { RefObject } from 'react';
import type { TrimState } from '@/shared/types/videoTrim';

export interface TrimControlsPanelProps {
  trimState: TrimState;
  onStartTrimChange: (seconds: number) => void;
  onEndTrimChange: (seconds: number) => void;
  onResetTrim: () => void;
  trimmedDuration: number;
  hasTrimChanges: boolean;
  onSave: () => void;
  isSaving: boolean;
  saveProgress: number;
  saveError: string | null;
  saveSuccess: boolean;
  onClose: () => void;
  variant: 'desktop' | 'mobile';
  videoUrl?: string;
  currentTime?: number;
  videoRef?: RefObject<HTMLVideoElement | null>;
  hideHeader?: boolean;
}

export interface TrimTimelineBarProps {
  duration: number;
  startTrim: number;
  endTrim: number;
  onStartTrimChange: (seconds: number) => void;
  onEndTrimChange: (seconds: number) => void;
  currentTime?: number;
  disabled?: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onSeek?: (time: number) => void;
}
