// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DataProvider } from '../data/DataProvider.js';
import { useAssetOperations } from './useAssetOperations.js';
import { assetRegistryQueryKey, timelineQueryKey } from './queryKeys.js';

function makeProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    loadTimeline: vi.fn(async () => ({
      config: {
        output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
        clips: [],
        tracks: [],
      },
      configVersion: 1,
    })),
    saveTimeline: vi.fn(async () => 1),
    loadAssetRegistry: vi.fn(async () => ({ assets: {} })),
    resolveAssetUrl: vi.fn((file: string) => file),
    ...overrides,
  };
}

describe('useAssetOperations', () => {
  it('decrements pendingOpsRef when uploadAsset throws', async () => {
    const pendingOpsRef = { current: 0 };
    const provider = makeProvider({
      uploadAsset: vi.fn(async () => {
        throw new Error('upload failed');
      }),
    });
    const queryClient = new QueryClient();
    const { result } = renderHook(() => (
      useAssetOperations(provider, 'timeline-1', 'user-1', queryClient, pendingOpsRef)
    ));

    await expect(act(async () => {
      await result.current.uploadAsset(new File(['video'], 'clip.mp4', { type: 'video/mp4' }));
    })).rejects.toThrow('upload failed');

    expect(pendingOpsRef.current).toBe(0);
  });

  it('invalidates timeline and asset registry queries after uploads', async () => {
    const pendingOpsRef = { current: 0 };
    const provider = makeProvider({
      uploadAsset: vi.fn(async () => ({
        assetId: 'asset-1',
        entry: { file: 'media/clip.mp4', type: 'video/mp4' },
      })),
    });
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => (
      useAssetOperations(provider, 'timeline-1', 'user-1', queryClient, pendingOpsRef)
    ));

    await act(async () => {
      await result.current.uploadFiles([
        new File(['a'], 'a.mp4', { type: 'video/mp4' }),
        new File(['b'], 'b.mp4', { type: 'video/mp4' }),
      ]);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timelineQueryKey('timeline-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: assetRegistryQueryKey('timeline-1') });
    expect(pendingOpsRef.current).toBe(0);
  });
});
