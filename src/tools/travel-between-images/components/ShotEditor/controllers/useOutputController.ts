import { useOutputSelection } from '../hooks/video/useOutputSelection';
import { useSegmentOutputsForShot } from '@/shared/hooks/segments';
import { useDemoteOrphanedVariants } from '../../../hooks/workflow/useDemoteOrphanedVariants';
import { useEnsureSelectedOutput } from '../hooks/video/useEnsureSelectedOutput';
import type { GenerationRow, Shot } from '@/domains/generation/types';

interface UseOutputControllerParams {
  selectedProjectId: string | null;
  selectedShotId: string;
  selectedShot: Shot | null;
  projectId: string | null;
  timelineImages: GenerationRow[];
}

export function useOutputController({
  selectedProjectId,
  selectedShotId,
  selectedShot,
  projectId,
  timelineImages,
}: UseOutputControllerParams) {
  const {
    selectedOutputId,
    setSelectedOutputId,
    isReady: outputSelectionReady,
  } = useOutputSelection({
    projectId: selectedProjectId ?? undefined,
    shotId: selectedShot?.id,
  });

  const {
    segmentSlots: joinSegmentSlots,
    selectedParent: joinSelectedParent,
    parentGenerations,
    segmentProgress,
    isLoading: isSegmentOutputsLoading,
  } = useSegmentOutputsForShot(
    selectedShotId,
    projectId,
    undefined, // localShotGenPositions not needed here
    outputSelectionReady ? selectedOutputId : undefined,
    outputSelectionReady ? setSelectedOutputId : undefined,
    undefined, // preloadedGenerations
    timelineImages.at(-1)?.id, // trailingShotGenId: allow trailing segment videos to show
  );

  useEnsureSelectedOutput({
    outputSelectionReady,
    parentGenerations,
    selectedOutputId,
    setSelectedOutputId,
  });

  const { demoteOrphanedVariants } = useDemoteOrphanedVariants();

  return {
    selectedOutputId,
    setSelectedOutputId,
    outputSelectionReady,
    joinSegmentSlots,
    joinSelectedParent,
    parentGenerations,
    segmentProgress,
    isSegmentOutputsLoading,
    demoteOrphanedVariants,
  };
}
