// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type HTMLAttributes, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticsPanel } from '@/tools/video-editor/components/DiagnosticsPanel.tsx';
import { EditorRuntimeProvider } from '@/tools/video-editor/contexts/EditorRuntimeProvider.tsx';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import { createVideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { VideoEditorDiagnostic } from '@/tools/video-editor/runtime/diagnostics.ts';

vi.mock('@/shared/components/ui/badge.tsx', () => ({
  Badge: ({
    children,
    variant,
    ...props
  }: HTMLAttributes<HTMLSpanElement> & { variant?: string; children?: ReactNode }) => (
    <span data-variant={variant} {...props}>{children}</span>
  ),
}));

vi.mock('@/shared/components/ui/dialog.tsx', () => ({
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
  DialogContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/shared/components/ui/contracts/cn.ts', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/tools/video-editor/hooks/useEffects.ts', () => ({
  useEffects: () => ({ data: [] }),
}));

vi.mock('@/tools/video-editor/hooks/useEffectRegistry.ts', () => ({
  useEffectRegistry: vi.fn(),
}));

vi.mock('@/tools/video-editor/hooks/useEffectResources.ts', () => ({
  EffectCatalogProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useResolvedEffectCatalog: () => ({ effects: [] }),
}));

vi.mock('@/tools/video-editor/hooks/useSequenceResources.ts', () => ({
  SequenceComponentCatalogProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useResolvedSequenceComponentCatalog: () => ({ components: {} }),
}));

vi.mock('@/tools/video-editor/hooks/useTimelineState.ts', () => ({
  useTimelineState: () => ({
    store: {
      getState: () => ({ syncSlices: vi.fn() }),
    },
  }),
}));

vi.mock('@/tools/video-editor/hooks/timelineStore.ts', () => ({
  TimelineStoreProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/tools/video-editor/sequences/SequenceComponentRegistryContext.tsx', () => ({
  SequenceComponentRegistryProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

function createProvider(
  collectDiagnostics: () => Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>,
): DataProvider {
  return {
    loadTimeline: vi.fn(),
    saveTimeline: vi.fn(),
    loadAssetRegistry: vi.fn(),
    resolveAsset: vi.fn(),
    uploadAsset: vi.fn(),
    collectDiagnostics,
  } as unknown as DataProvider;
}

describe('EditorRuntimeProvider provider diagnostics', () => {
  it('publishes collectDiagnostics output into DiagnosticsPanel and clears stale source diagnostics', async () => {
    const diagnosticsStore = createVideoEditorDiagnosticsStore();
    let diagnostics: Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> = [{
      source: 'asset-materialization',
      severity: 'warning',
      code: 'asset_registry_unavailable',
      message: 'Asset registry materialization is unavailable.',
      detail: {
        providerId: 'test-provider',
        capability: 'assetRegistry',
      },
    }];
    const provider = createProvider(() => diagnostics);

    const { rerender } = render(
      <EditorRuntimeProvider
        dataProvider={provider}
        timelineId="timeline-with-diagnostics"
        diagnosticsStore={diagnosticsStore}
      >
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </EditorRuntimeProvider>,
    );

    const row = (await screen.findByText('Asset registry materialization is unavailable.'))
      .closest('[data-diagnostic-code]');
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute('data-diagnostic-source', 'asset-materialization');
    expect(row).toHaveAttribute('data-diagnostic-severity', 'warning');
    expect(row).toHaveAttribute('data-diagnostic-code', 'asset_registry_unavailable');

    await userEvent.click(screen.getByText('Show details'));
    expect(screen.getByText(/"providerId": "test-provider"/)).toBeInTheDocument();
    expect(screen.getByText(/"capability": "assetRegistry"/)).toBeInTheDocument();

    diagnostics = [];
    rerender(
      <EditorRuntimeProvider
        dataProvider={provider}
        timelineId="timeline-cleared-diagnostics"
        diagnosticsStore={diagnosticsStore}
      >
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </EditorRuntimeProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText('Asset registry materialization is unavailable.')).not.toBeInTheDocument();
    });
    expect(screen.getByText('No diagnostics to display.')).toBeInTheDocument();
  });
});
