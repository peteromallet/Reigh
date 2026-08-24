import { useState, useEffect, useCallback, useMemo } from 'react';
import type { PortionSelection } from '@/shared/components/VideoPortionTimeline';
import { generateUUID } from '@/shared/lib/taskCreation';
import {
  calculateGapFramesFromRange,
  getDefaultSelectionRange,
  getNewSelectionRange,
  validatePortionSelections,
} from '@/shared/lib/video/replaceSelectionMath';
import {
  calculateMaxContextFrames,
  selectionsToFrameRanges as toReplaceFrameRanges,
} from '@/shared/lib/video/replaceFrameRanges';

export interface PortionFrameRange {
  start_frame: number;
  end_frame: number;
  start_time_seconds: number;
  end_time_seconds: number;
  frame_count: number;
  gap_frame_count: number;
  prompt: string;
}

interface UseVideoEditingSelectionsInput {
  mediaId?: string;
  videoDuration: number;
  defaultGapFrameCount: number;
  contextFrameCount: number;
}

interface SelectionValidation {
  isValid: boolean;
  errors: string[];
}

interface UseVideoEditingSelectionsReturn {
  selections: PortionSelection[];
  activeSelectionId: string | null;
  setActiveSelectionId: (id: string | null) => void;
  handleUpdateSelection: (id: string, start: number, end: number) => void;
  handleAddSelection: () => void;
  handleRemoveSelection: (id: string) => void;
  handleUpdateSelectionSettings: (
    id: string,
    updates: Partial<Pick<PortionSelection, 'gapFrameCount' | 'prompt'>>,
  ) => void;
  validation: SelectionValidation;
  maxContextFrames: number;
  selectionsToFrameRanges: (fps: number, globalGapFrameCount: number, globalPrompt: string) => PortionFrameRange[];
}

const DEFAULT_INITIAL_SELECTION: Omit<PortionSelection, 'id'> = {
  start: 0,
  end: 0,
  gapFrameCount: 12,
  prompt: '',
};

export function useVideoEditingSelections({
  mediaId,
  videoDuration,
  defaultGapFrameCount,
  contextFrameCount,
}: UseVideoEditingSelectionsInput): UseVideoEditingSelectionsReturn {
  const [selections, setSelections] = useState<PortionSelection[]>([
    { id: generateUUID(), ...DEFAULT_INITIAL_SELECTION },
  ]);
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(null);

  const resolveGapFrameCount = useCallback((start: number, end: number, fallbackGapFrameCount = defaultGapFrameCount): number => {
    return calculateGapFramesFromRange({
      start,
      end,
      fps: 16,
      fallbackGapFrameCount,
      contextFrameCount,
    });
  }, [defaultGapFrameCount, contextFrameCount]);

  // Initialize selection to 10%-20% when video duration is available.
  useEffect(() => {
    if (videoDuration > 0 && selections.length > 0 && selections[0].end === 0) {
      const { start, end } = getDefaultSelectionRange(videoDuration);
      const calculatedGapFrames = resolveGapFrameCount(start, end);
      setSelections(prev => [{
        ...prev[0],
        start,
        end,
        gapFrameCount: calculatedGapFrames,
        prompt: prev[0].prompt ?? '',
      }, ...prev.slice(1)]);
    }
  }, [videoDuration, selections, resolveGapFrameCount]);

  // Reset selections when media changes.
  useEffect(() => {
    if (mediaId) {
      setSelections([{ id: generateUUID(), ...DEFAULT_INITIAL_SELECTION }]);
      setActiveSelectionId(null);
    }
  }, [mediaId]);

  const handleUpdateSelection = useCallback((id: string, start: number, end: number) => {
    setSelections(prev => prev.map(s => {
      if (s.id === id) {
        const calculatedGapFrames = resolveGapFrameCount(start, end);
        return { ...s, start, end, gapFrameCount: calculatedGapFrames };
      }
      return s;
    }));
  }, [resolveGapFrameCount]);

  // Add new selection - 10% after last, or 10% before first if no space.
  const handleAddSelection = useCallback(() => {
    const { start: newStart, end: newEnd } = getNewSelectionRange(selections, videoDuration);
    const calculatedGapFrames = resolveGapFrameCount(newStart, newEnd);
    const newSelection: PortionSelection = {
      id: generateUUID(),
      start: newStart,
      end: newEnd,
      gapFrameCount: calculatedGapFrames,
      prompt: '',
    };
    setSelections(prev => [...prev, newSelection]);
    setActiveSelectionId(newSelection.id);
  }, [videoDuration, selections, resolveGapFrameCount]);

  const handleRemoveSelection = useCallback((id: string) => {
    setSelections(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        const { start, end } = getDefaultSelectionRange(videoDuration);
        const calculatedGapFrames = resolveGapFrameCount(start, end);
        return [{ id: generateUUID(), start, end, gapFrameCount: calculatedGapFrames, prompt: '' }];
      }
      return filtered;
    });
    if (activeSelectionId === id) {
      setActiveSelectionId(null);
    }
  }, [activeSelectionId, videoDuration, resolveGapFrameCount]);

  const handleUpdateSelectionSettings = useCallback((
    id: string,
    updates: Partial<Pick<PortionSelection, 'gapFrameCount' | 'prompt'>>,
  ) => {
    setSelections(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const validation = useMemo<SelectionValidation>(() => {
    return validatePortionSelections({
      selections,
      videoFps: 16,
      videoDuration,
    });
  }, [selections, videoDuration]);

  const selectionsToFrameRanges = useCallback((fps: number, globalGapFrameCount: number, globalPrompt: string) => {
    return toReplaceFrameRanges(selections, fps, videoDuration, globalGapFrameCount, globalPrompt)
      .map((range) => ({
        start_frame: range.start_frame,
        end_frame: range.end_frame,
        start_time_seconds: range.start_time,
        end_time_seconds: range.end_time,
        frame_count: range.frame_count,
        gap_frame_count: range.gap_frame_count,
        prompt: range.prompt,
      }));
  }, [selections, videoDuration]);

  const maxContextFrames = useMemo(() => {
    return calculateMaxContextFrames({
      videoFps: 16,
      videoDuration,
      frameRanges: selections.map((selection) => ({
        start_frame: Math.round(selection.start * 16),
        end_frame: Math.round(selection.end * 16),
      })),
    });
  }, [videoDuration, selections]);

  return {
    selections,
    activeSelectionId,
    setActiveSelectionId,
    handleUpdateSelection,
    handleAddSelection,
    handleRemoveSelection,
    handleUpdateSelectionSettings,
    validation,
    maxContextFrames,
    selectionsToFrameRanges,
  };
}
