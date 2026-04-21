// @vitest-environment jsdom
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../testing.js';
import type { DataProvider } from '../data/DataProvider.js';
import { useTimelineQueries } from './useTimelineQueries.js';
import { createDefaultTimelineConfig } from '@tbd/schema';

function makeProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    loadTimeline: vi.fn(async () => ({
      config: createDefaultTimelineConfig(),
      configVersion: 7,
    })),
    saveTimeline: vi.fn(async () => 8),
    loadAssetRegistry: vi.fn(async () => ({
      assets: {
        assetA: { file: 'media/a.mp4', type: 'video/mp4' },
      },
    })),
    resolveAssetUrl: vi.fn((file: string) => `https://cdn.test/${file}`),
    ...overrides,
  };
}

describe('useTimelineQueries', () => {
  it('loads timeline data and asset registry via react-query', async () => {
    const provider = makeProvider();
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () => useTimelineQueries(provider, 'timeline-1'),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.timelineQuery.isSuccess).toBe(true);
      expect(result.current.assetRegistryQuery.isSuccess).toBe(true);
    });

    expect(provider.loadTimeline).toHaveBeenCalledWith('timeline-1');
    expect(provider.loadAssetRegistry).toHaveBeenCalledWith('timeline-1');
    expect(result.current.timelineQuery.data?.configVersion).toBe(7);
    expect(result.current.assetRegistryQuery.data?.assets.assetA?.file).toBe('media/a.mp4');
  });
});
