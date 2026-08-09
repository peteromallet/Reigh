// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTimelineQueries } from '@/tools/video-editor/hooks/useTimelineQueries.ts';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';

/**
 * The source half of the load-error surfacing chain: a provider that rejects
 * must leave `timelineQuery.error` populated (nothing else in the shell can
 * observe the failure — `isLoading` goes false and no render throws). The sink
 * half — the shell rendering that error as a card instead of an empty editor —
 * is pinned in `TimelineEditorShellCore.test.tsx`.
 */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const makeProvider = (loadTimeline: DataProvider['loadTimeline']): DataProvider => ({
  persistenceEnabled: true,
  loadTimeline,
  loadAssetRegistry: async () => ({ assets: {} }),
  saveTimeline: async () => 1,
  resolveAssetUrl: async (file: string) => file,
} as unknown as DataProvider);

describe('useTimelineQueries', () => {
  it('surfaces a rejected loadTimeline as timelineQuery.error', async () => {
    const failure = new Error('Astrid bridge returned a malformed timeline payload: config: expected object, received string');
    const provider = makeProvider(async () => { throw failure; });

    const { result } = renderHook(
      () => useTimelineQueries(provider, 'timeline-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.timelineQuery.error).toBe(failure);
    });
    expect(result.current.timelineQuery.isLoading).toBe(false);
    expect(result.current.timelineQuery.data).toBeUndefined();
  });
});
