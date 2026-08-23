// @vitest-environment jsdom

import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AstridBridgeDataProvider } from '@/tools/video-editor/data/AstridBridgeDataProvider.ts';
import { SupabaseDataProvider } from '@/tools/video-editor/data/SupabaseDataProvider.ts';
import { InMemoryDataProvider } from '@/tools/video-editor/testing/InMemoryDataProvider.ts';

// useEditorSync pulls the editor data/chrome contexts; only the capability
// gate under test matters here, so those hooks are stubbed minimal.
vi.mock('@/tools/video-editor/hooks/timelineStore', () => ({
  useTimelineEditorData: () => ({ data: { config: { clips: [] }, registry: { assets: {} } } }),
  useTimelineChromeContext: () => ({ saveStatus: 'saved', reloadFromServer: vi.fn() }),
  useTimelineConfigVersion: () => 1,
}));
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import { useEditorSync } from '@/tools/video-editor/hooks/useEditorSync.ts';
import { VideoEditorRuntimeContext } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';

vi.mock('@/integrations/supabase/client.ts', () => ({
  getSupabaseClient: vi.fn(),
}));

/**
 * T2.4: the two former `instanceof` gates are now boolean capability flags
 * declared on `DataProvider`. Both gates must behave IDENTICALLY for every
 * provider class — the class declares, callers read. These tests pin the
 * declaration per class and prove one consumption path end-to-end.
 */
describe('provider capability flags', () => {
  it('declares sync=true/upload=false for SupabaseDataProvider', () => {
    const provider = new SupabaseDataProvider({ projectId: 'p', userId: 'u' });
    expect(provider.supportsEditorSync).toBe(true);
    expect(provider.supportsDirectAssetUpload).toBe(false);
  });

  it('declares sync=false/upload=true for AstridBridgeDataProvider', () => {
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'demo-project',
      timelineRef: 'demo-timeline',
    });
    expect(provider.supportsEditorSync).toBe(false);
    expect(provider.supportsDirectAssetUpload).toBe(true);
  });

  it('declares neither capability for InMemoryDataProvider', () => {
    const provider = new InMemoryDataProvider();
    expect(provider.supportsEditorSync).toBe(false);
    expect(provider.supportsDirectAssetUpload).toBe(false);
  });

  it('both flag paths drive useEditorSync identically across provider classes', () => {
    const cases: Array<[DataProvider, boolean]> = [
      [new SupabaseDataProvider({ projectId: 'p', userId: 'u' }), true],
      [
        new AstridBridgeDataProvider({
          projectSlug: 'demo-project',
          timelineRef: 'demo-timeline',
        }),
        false,
      ],
      [new InMemoryDataProvider(), false],
    ];

    for (const [provider, expectedAvailable] of cases) {
      const runtime = {
        provider,
        timelineId: 'timeline-1',
      } as unknown as React.ContextType<typeof VideoEditorRuntimeContext>;
      const { result, unmount } = renderHook(() => useEditorSync(), {
        wrapper: ({ children }: { children?: React.ReactNode }) =>
          React.createElement(
            // The hook reads the context value directly; only `provider`
            // matters for this gate.
            VideoEditorRuntimeContext.Provider,
            { value: runtime },
            children,
          ),
      });
      expect(result.current.isSyncAvailable).toBe(expectedAvailable);
      unmount();
    }
  });
});
