import { act, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderHookWithProviders } from '@/test/test-utils';
import { queryKeys } from '@/shared/lib/queryKeys';
import { TOOL_IDS } from '@/shared/lib/tooling/toolIds';

const {
  fromMock,
  normalizeAndPresentErrorMock,
  selectEqMock,
  selectMock,
  singleMock,
  updateEqMock,
  updateMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  normalizeAndPresentErrorMock: vi.fn(),
  selectEqMock: vi.fn(),
  selectMock: vi.fn(),
  singleMock: vi.fn(),
  updateEqMock: vi.fn(),
  updateMock: vi.fn(),
}));
const mockIsDeferredCloudDataAuthority = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: normalizeAndPresentErrorMock,
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: fromMock,
  }),
}));

vi.mock('@/app/runtime/dataAuthority.ts', () => ({
  isDeferredCloudDataAuthority: mockIsDeferredCloudDataAuthority,
}));

import { useUpdateShotAspectRatio } from '../useUpdateShotAspectRatio';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

describe('useUpdateShotAspectRatio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);

    selectEqMock.mockReturnValue({ single: singleMock });
    selectMock.mockReturnValue({ eq: selectEqMock });
    updateEqMock.mockResolvedValue({ error: null });
    updateMock.mockReturnValue({ eq: updateEqMock });
    fromMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    });
    singleMock.mockResolvedValue({
      data: {
        settings: {
          [TOOL_IDS.TRAVEL_BETWEEN_IMAGES]: {
            dimensionSource: 'custom',
            customWidth: 1024,
            customHeight: 768,
            keepExistingSetting: 'keep-me',
          },
          unrelatedTool: {
            enabled: true,
          },
        },
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('optimistically updates both shot caches and persists the debounced change', async () => {
    vi.useFakeTimers();

    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const shotsPage0 = [
      { id: 'shot-1', aspect_ratio: '1:1' },
      { id: 'shot-2', aspect_ratio: '4:3' },
    ];
    const shotsPage2 = [
      { id: 'shot-1', aspect_ratio: '1:1' },
    ];

    queryClient.setQueryData(queryKeys.shots.list('project-1', 0), shotsPage0);
    queryClient.setQueryData(queryKeys.shots.list('project-1', 2), shotsPage2);

    const { result } = renderHookWithProviders(() => useUpdateShotAspectRatio(), { queryClient });

    let updateResult = false;
    await act(async () => {
      updateResult = await result.current.updateShotAspectRatio('shot-1', 'project-1', '16:9');
    });

    expect(updateResult).toBe(true);
    expect(queryClient.getQueryData(queryKeys.shots.list('project-1', 0))).toEqual([
      expect.objectContaining({ id: 'shot-1', aspect_ratio: '16:9' }),
      expect.objectContaining({ id: 'shot-2', aspect_ratio: '4:3' }),
    ]);
    expect(queryClient.getQueryData(queryKeys.shots.list('project-1', 2))).toEqual([
      expect.objectContaining({ id: 'shot-1', aspect_ratio: '16:9' }),
    ]);
    expect(updateMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(updateMock).toHaveBeenCalledTimes(1);

    const payload = updateMock.mock.calls[0][0] as {
      aspect_ratio: string;
      settings: Record<string, unknown>;
    };
    const travelSettings = payload.settings[TOOL_IDS.TRAVEL_BETWEEN_IMAGES] as Record<string, unknown>;

    expect(payload.aspect_ratio).toBe('16:9');
    expect(travelSettings).toMatchObject({
      dimensionSource: 'firstImage',
      keepExistingSetting: 'keep-me',
    });
    expect(travelSettings).not.toHaveProperty('customWidth');
    expect(travelSettings).not.toHaveProperty('customHeight');
    expect(payload.settings).toMatchObject({
      unrelatedTool: { enabled: true },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.settings.tool(TOOL_IDS.TRAVEL_BETWEEN_IMAGES, 'project-1', 'shot-1'),
    });
  });

  it('awaits the database write and returns true for immediate updates', async () => {
    const queryClient = createQueryClient();
    const { result } = renderHookWithProviders(() => useUpdateShotAspectRatio(), { queryClient });

    let updateResult = false;
    await act(async () => {
      updateResult = await result.current.updateShotAspectRatio(
        'shot-1',
        'project-1',
        '4:3',
        { immediate: true }
      );
    });

    expect(updateResult).toBe(true);
    expect(selectMock).toHaveBeenCalledWith('settings');
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        aspect_ratio: '4:3',
      })
    );
    expect(updateEqMock).toHaveBeenCalledWith('id', 'shot-1');
  });

  it('returns false without throwing and invalidates shots on immediate update failure', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const dbError = new Error('database rejected');

    updateEqMock.mockRejectedValueOnce(dbError);

    const { result } = renderHookWithProviders(() => useUpdateShotAspectRatio(), { queryClient });

    let thrownError: unknown = null;
    let updateResult: boolean | undefined;

    try {
      await act(async () => {
        updateResult = await result.current.updateShotAspectRatio(
          'shot-1',
          'project-1',
          '9:16',
          { immediate: true }
        );
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeNull();
    expect(updateResult).toBe(false);
    expect(normalizeAndPresentErrorMock).toHaveBeenCalledWith(
      dbError,
      expect.objectContaining({
        context: 'ShotEditorHeader',
      })
    );

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.shots.list('project-1'),
      });
    });
  });
});
