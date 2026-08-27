// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOutputController } from './useOutputController';

const mocks = vi.hoisted(() => ({
  useOutputSelection: vi.fn(),
  useSegmentOutputsForShot: vi.fn(),
  useDemoteOrphanedVariants: vi.fn(),
  useEnsureSelectedOutput: vi.fn(),
}));

vi.mock('../hooks/video/useOutputSelection', () => ({
  useOutputSelection: mocks.useOutputSelection,
}));

vi.mock('@/shared/hooks/segments', () => ({
  useSegmentOutputsForShot: mocks.useSegmentOutputsForShot,
}));

vi.mock('../../../hooks/workflow/useDemoteOrphanedVariants', () => ({
  useDemoteOrphanedVariants: mocks.useDemoteOrphanedVariants,
}));

vi.mock('../hooks/video/useEnsureSelectedOutput', () => ({
  useEnsureSelectedOutput: mocks.useEnsureSelectedOutput,
}));

describe('useOutputController', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useOutputSelection.mockReturnValue({
      selectedOutputId: 'output-1',
      setSelectedOutputId: vi.fn(),
      isReady: true,
    });

    mocks.useSegmentOutputsForShot.mockReturnValue({
      segmentSlots: [{ id: 'slot-1' }],
      selectedParent: { id: 'parent-1' },
      parentGenerations: [{ id: 'parent-1' }],
      segmentProgress: { completed: 2, total: 3 },
      isLoading: false,
    });

    mocks.useDemoteOrphanedVariants.mockReturnValue({
      demoteOrphanedVariants: vi.fn(),
    });
  });

  function buildArgs() {
    return {
      selectedProjectId: 'project-1',
      selectedShotId: 'shot-1',
      selectedShot: { id: 'shot-1' } as never,
      projectId: 'project-1',
      timelineImages: [{ id: 'img-1' }, { id: 'img-2' }] as never[],
    };
  }

  it('connects output selection, segment outputs, and orphan demotion helpers', () => {
    const args = buildArgs();

    const { result, rerender } = renderHook(
      (currentArgs) => useOutputController(currentArgs),
      { initialProps: args },
    );

    expect(mocks.useOutputSelection).toHaveBeenCalledWith({
      projectId: 'project-1',
      shotId: 'shot-1',
    });
    expect(mocks.useSegmentOutputsForShot).toHaveBeenCalledWith(
      'shot-1',
      'project-1',
      undefined,
      'output-1',
      mocks.useOutputSelection.mock.results[0].value.setSelectedOutputId,
      [
        { id: 'img-1' },
        { id: 'img-2' },
      ],
      'img-2',
    );
    expect(mocks.useEnsureSelectedOutput).toHaveBeenCalledWith({
      outputSelectionReady: true,
      parentGenerations: [{ id: 'parent-1' }],
      selectedOutputId: 'output-1',
      setSelectedOutputId: mocks.useOutputSelection.mock.results[0].value.setSelectedOutputId,
    });
    expect(result.current).toMatchObject({
      selectedOutputId: 'output-1',
      outputSelectionReady: true,
      joinSegmentSlots: [{ id: 'slot-1' }],
      joinSelectedParent: { id: 'parent-1' },
      parentGenerations: [{ id: 'parent-1' }],
      segmentProgress: { completed: 2, total: 3 },
      isSegmentOutputsLoading: false,
      demoteOrphanedVariants: expect.any(Function),
    });

    mocks.useOutputSelection.mockReturnValueOnce({
      selectedOutputId: 'output-2',
      setSelectedOutputId: vi.fn(),
      isReady: false,
    });

    rerender(args);

    expect(mocks.useSegmentOutputsForShot).toHaveBeenLastCalledWith(
      'shot-1',
      'project-1',
      undefined,
      undefined,
      undefined,
      [
        { id: 'img-1' },
        { id: 'img-2' },
      ],
      'img-2',
    );
  });
});
