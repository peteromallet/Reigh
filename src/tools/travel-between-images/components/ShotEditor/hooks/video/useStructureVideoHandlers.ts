/**
 * useStructureVideoHandlers - Structure video setting handlers
 *
 * Array-first handlers for the travel structure video state.
 * Keeps the mode-switch behavior centralized while avoiding legacy config shims.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { AuthoredVideoMetadata } from '@/shared/lib/media/videoUploader';
import type { StructureVideoConfigWithMetadata } from '@/shared/lib/tasks/travelBetweenImages';
import type { TravelGuidanceMode } from '@/shared/lib/tasks/travelGuidance';
import type { UseStructureVideoReturn } from './useStructureVideo';

interface UseStructureVideoHandlersOptions {
  structureVideos: StructureVideoConfigWithMetadata[];
  setStructureVideos: UseStructureVideoReturn['setStructureVideos'];
  updateStructureGuidanceControls: UseStructureVideoReturn['updateStructureGuidanceControls'];
  structureVideoPath: UseStructureVideoReturn['structureVideoPath'];
  structureVideoType: UseStructureVideoReturn['structureVideoType'];
  structureVideoUni3cEndPercent: UseStructureVideoReturn['structureVideoUni3cEndPercent'];
  generationTypeMode: 'i2v' | 'vace';
  setGenerationTypeMode: (mode: 'i2v' | 'vace') => void;
}

interface UseStructureVideoHandlersReturn {
  handleUni3cEndPercentChange: (value: number) => void;
  handleStructureVideoMotionStrengthChange: (strength: number) => void;
  handleStructureTypeChangeFromMotionControl: (type: TravelGuidanceMode) => void;
  handleStructureVideoInputChange: (
    videoPath: string | null,
    metadata: AuthoredVideoMetadata | null,
    treatment: 'adjust' | 'clip',
    motionStrength: number,
    structureType: TravelGuidanceMode,
    resourceId?: string
  ) => void;
}

export function useStructureVideoHandlers({
  structureVideos,
  setStructureVideos,
  updateStructureGuidanceControls,
  structureVideoPath,
  structureVideoType,
  structureVideoUni3cEndPercent,
  generationTypeMode,
  setGenerationTypeMode,
}: UseStructureVideoHandlersOptions): UseStructureVideoHandlersReturn {
  const switchModeForStructureType = useCallback((type: TravelGuidanceMode) => {
    const targetMode = type === 'flow' || type === 'canny' || type === 'depth' || type === 'raw'
      ? 'vace'
      : 'i2v';
    if (generationTypeMode !== targetMode) {
      setGenerationTypeMode(targetMode);
    }
  }, [generationTypeMode, setGenerationTypeMode]);

  const handleUni3cEndPercentChange = useCallback((value: number) => {
    if (structureVideos.length === 0) return;
    updateStructureGuidanceControls({ uni3cEndPercent: value });
  }, [structureVideos.length, updateStructureGuidanceControls]);

  const handleStructureVideoMotionStrengthChange = useCallback((strength: number) => {
    if (structureVideos.length === 0) return;
    updateStructureGuidanceControls({ strength });
  }, [structureVideos.length, updateStructureGuidanceControls]);

  const handleStructureTypeChangeFromMotionControl = useCallback((type: TravelGuidanceMode) => {
    if (structureVideos.length > 0) {
      updateStructureGuidanceControls({ mode: type });
    }
    switchModeForStructureType(type);
  }, [structureVideos.length, switchModeForStructureType, updateStructureGuidanceControls]);

  const handleStructureVideoInputChange = useCallback((
    videoPath: string | null,
    metadata: AuthoredVideoMetadata | null,
    treatment: 'adjust' | 'clip',
    motionStrength: number,
    structureType: TravelGuidanceMode,
    resourceId?: string
  ) => {
    if (!videoPath) {
      setStructureVideos([]);
      if (generationTypeMode !== 'i2v') {
        setGenerationTypeMode('i2v');
      }
      return;
    }

    const existing = structureVideos[0];
    const nextPrimary: StructureVideoConfigWithMetadata = {
      path: videoPath,
      start_frame: existing?.start_frame ?? 0,
      end_frame: existing?.end_frame ?? 81,
      treatment,
      metadata: metadata ?? null,
      resource_id: resourceId ?? null,
    };

    if (structureVideos.length > 0) {
      setStructureVideos([nextPrimary, ...structureVideos.slice(1)]);
    } else {
      setStructureVideos([nextPrimary]);
    }

    updateStructureGuidanceControls({
      strength: motionStrength,
      mode: structureType,
      ...(structureType === 'uni3c' ? { uni3cEndPercent: structureVideoUni3cEndPercent } : {}),
    });
    switchModeForStructureType(structureType);
  }, [
    generationTypeMode,
    setGenerationTypeMode,
    setStructureVideos,
    structureVideos,
    structureVideoUni3cEndPercent,
    switchModeForStructureType,
    updateStructureGuidanceControls,
  ]);

  const prevStructureVideoPath = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevStructureVideoPath.current === undefined) {
      prevStructureVideoPath.current = structureVideoPath;
      return;
    }

    const wasAdded = !prevStructureVideoPath.current && structureVideoPath;
    const wasRemoved = prevStructureVideoPath.current && !structureVideoPath;

    if (wasAdded) {
      switchModeForStructureType(structureVideoType);
    } else if (wasRemoved && generationTypeMode !== 'i2v') {
      setGenerationTypeMode('i2v');
    }

    prevStructureVideoPath.current = structureVideoPath;
  }, [
    generationTypeMode,
    setGenerationTypeMode,
    structureVideoPath,
    structureVideoType,
    switchModeForStructureType,
  ]);

  return {
    handleUni3cEndPercentChange,
    handleStructureVideoMotionStrengthChange,
    handleStructureTypeChangeFromMotionControl,
    handleStructureVideoInputChange,
  };
}
