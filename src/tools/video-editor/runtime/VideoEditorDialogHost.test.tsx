// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataProviderWrapper } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import { createVideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { VideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { VideoEditorRuntimeContextValue } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import type { VideoEditorDialogDescriptor } from '@/tools/video-editor/runtime/extensionSurface.ts';
import { VideoEditorDialogHost } from '@/tools/video-editor/runtime/VideoEditorDialogHost.tsx';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const useVideoEditorDialogDescriptorsMock = vi.fn();
const useVideoEditorRenderContextMock = vi.fn();

vi.mock('@/tools/video-editor/runtime/useVideoEditorRenderContext', () => ({
  useVideoEditorDialogDescriptors: () => useVideoEditorDialogDescriptorsMock(),
  useVideoEditorRenderContext: () => useVideoEditorRenderContextMock(),
}));

// ExtensionRenderBoundary is NOT mocked — we want to exercise the real boundary.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRuntimeContext(
  store: VideoEditorDiagnosticsStore,
  dialogs: readonly VideoEditorDialogDescriptor[] = [],
): VideoEditorRuntimeContextValue {
  return {
    provider: {} as any,
    assetResolver: {} as any,
    auth: {} as any,
    project: {} as any,
    shots: {} as any,
    mediaLightbox: {} as any,
    agentChat: {} as any,
    toast: {} as any,
    telemetry: {} as any,
    timelineId: 'test-timeline',
    userId: 'test-user',
    timelineName: 'Test Timeline',
    extensions: {
      slots: {},
      dialogHost: { dialogs },
      registry: { panels: [], inspectorSections: [] },
    },
    diagnosticsStore: store,
  };
}

function throwingDialog(id = 'fixture.throw.dialog'): VideoEditorDialogDescriptor {
  return {
    id,
    render: () => {
      throw new Error('Dialog render intentional exception');
    },
  };
}

function healthyDialog(
  id = 'fixture.ok.dialog',
  label = 'Healthy Dialog Content',
): VideoEditorDialogDescriptor {
  return {
    id,
    render: () => <div data-testid={`dialog-${id}`}>{label}</div>,
  };
}

function dialogWithThrowingWhen(
  id = 'fixture.when.dialog',
): VideoEditorDialogDescriptor {
  return {
    id,
    when: () => {
      throw new Error('When predicate intentional exception');
    },
    render: () => <div data-testid={`dialog-${id}`}>Should not render</div>,
  };
}

function dialogWithFalseWhen(
  id = 'fixture.hidden.dialog',
): VideoEditorDialogDescriptor {
  return {
    id,
    when: () => false,
    render: () => <div data-testid={`dialog-${id}`}>Should not render</div>,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VideoEditorDialogHost extension fallback', () => {
  it('renders fallback when a dialog render throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createVideoEditorDiagnosticsStore();
    const dialogs = [throwingDialog('fixture.throw.dialog')];

    useVideoEditorDialogDescriptorsMock.mockReturnValue(dialogs);
    useVideoEditorRenderContextMock.mockReturnValue({ timelineId: 'test-timeline' });

    const runtime = createRuntimeContext(store, dialogs);

    render(
      <DataProviderWrapper value={runtime}>
        <VideoEditorDialogHost>
          <div data-testid="children-content">Children</div>
        </VideoEditorDialogHost>
      </DataProviderWrapper>,
    );

    // Children should still render (dialog host doesn't blank)
    expect(screen.getByTestId('children-content')).toBeInTheDocument();

    // Fallback should render for the throwing dialog
    const fallbacks = screen.getAllByTestId('extension-render-fallback');
    expect(fallbacks.length).toBeGreaterThanOrEqual(1);
    expect(fallbacks[0]).toHaveTextContent('Extension content unavailable');

    // Diagnostic should be emitted
    const snapshot = store.getSnapshot();
    const renderDiags = snapshot.filter(
      (d) => d.code === 'extension_render_exception',
    );
    expect(renderDiags.length).toBeGreaterThanOrEqual(1);
    const diag = renderDiags.find(
      (d) => d.detail?.descriptorId === 'fixture.throw.dialog',
    );
    expect(diag).toBeDefined();
    expect(diag!.source).toBe('extension-render');
    expect(diag!.severity).toBe('error');
    expect(diag!.detail).toMatchObject({
      descriptorId: 'fixture.throw.dialog',
      descriptorType: 'dialog',
      errorMessage: 'Dialog render intentional exception',
    });

    spy.mockRestore();
  });

  it('hides dialog and reports diagnostic when when-predicate throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createVideoEditorDiagnosticsStore();
    const dialogs = [dialogWithThrowingWhen('fixture.when.dialog')];

    useVideoEditorDialogDescriptorsMock.mockReturnValue(dialogs);
    useVideoEditorRenderContextMock.mockReturnValue({ timelineId: 'test-timeline' });

    const runtime = createRuntimeContext(store, dialogs);

    render(
      <DataProviderWrapper value={runtime}>
        <VideoEditorDialogHost>
          <div data-testid="children-content">Children</div>
        </VideoEditorDialogHost>
      </DataProviderWrapper>,
    );

    // Children render
    expect(screen.getByTestId('children-content')).toBeInTheDocument();

    // Dialog should NOT render (fail-closed)
    expect(
      screen.queryByTestId('dialog-fixture.when.dialog'),
    ).not.toBeInTheDocument();

    // No fallback either (the dialog was hidden, not errored during render)
    expect(
      screen.queryByTestId('extension-render-fallback'),
    ).not.toBeInTheDocument();

    // Visibility diagnostic should be emitted
    const snapshot = store.getSnapshot();
    const visibilityDiags = snapshot.filter(
      (d) => d.code === 'extension_visibility_exception',
    );
    expect(visibilityDiags.length).toBe(1);
    expect(visibilityDiags[0].source).toBe('extension-render');
    expect(visibilityDiags[0].severity).toBe('error');
    expect(visibilityDiags[0].detail).toMatchObject({
      descriptorId: 'fixture.when.dialog',
      descriptorType: 'dialog',
      errorMessage: 'When predicate intentional exception',
    });

    spy.mockRestore();
  });

  it('renders healthy dialog normally without diagnostics', () => {
    const store = createVideoEditorDiagnosticsStore();
    const dialogs = [healthyDialog('fixture.ok.dialog', 'Healthy Content')];

    useVideoEditorDialogDescriptorsMock.mockReturnValue(dialogs);
    useVideoEditorRenderContextMock.mockReturnValue({ timelineId: 'test-timeline' });

    const runtime = createRuntimeContext(store, dialogs);

    render(
      <DataProviderWrapper value={runtime}>
        <VideoEditorDialogHost>
          <div data-testid="children-content">Children</div>
        </VideoEditorDialogHost>
      </DataProviderWrapper>,
    );

    expect(screen.getByTestId('children-content')).toBeInTheDocument();
    expect(screen.getByTestId('dialog-fixture.ok.dialog')).toHaveTextContent(
      'Healthy Content',
    );
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('hides dialog when when-predicate returns false without diagnostics', () => {
    const store = createVideoEditorDiagnosticsStore();
    const dialogs = [dialogWithFalseWhen('fixture.hidden.dialog')];

    useVideoEditorDialogDescriptorsMock.mockReturnValue(dialogs);
    useVideoEditorRenderContextMock.mockReturnValue({ timelineId: 'test-timeline' });

    const runtime = createRuntimeContext(store, dialogs);

    render(
      <DataProviderWrapper value={runtime}>
        <VideoEditorDialogHost>
          <div data-testid="children-content">Children</div>
        </VideoEditorDialogHost>
      </DataProviderWrapper>,
    );

    expect(screen.getByTestId('children-content')).toBeInTheDocument();
    expect(
      screen.queryByTestId('dialog-fixture.hidden.dialog'),
    ).not.toBeInTheDocument();
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('renders nothing extra when no dialogs are registered', () => {
    const store = createVideoEditorDiagnosticsStore();

    useVideoEditorDialogDescriptorsMock.mockReturnValue([]);
    useVideoEditorRenderContextMock.mockReturnValue({ timelineId: 'test-timeline' });

    const runtime = createRuntimeContext(store, []);

    const { container } = render(
      <DataProviderWrapper value={runtime}>
        <VideoEditorDialogHost>
          <div data-testid="children-content">Children</div>
        </VideoEditorDialogHost>
      </DataProviderWrapper>,
    );

    expect(screen.getByTestId('children-content')).toBeInTheDocument();
    // No fallback or dialog elements should appear
    expect(
      container.querySelector('[data-video-editor-dialog-id]'),
    ).toBeNull();
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('handles non-Error throws from when-predicates', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createVideoEditorDiagnosticsStore();

    const stringThrowDialog: VideoEditorDialogDescriptor = {
      id: 'fixture.string-throw',
      when: () => {
        throw 'raw string error';
      },
      render: () => <div>Should not render</div>,
    };

    useVideoEditorDialogDescriptorsMock.mockReturnValue([stringThrowDialog]);
    useVideoEditorRenderContextMock.mockReturnValue({ timelineId: 'test-timeline' });

    const runtime = createRuntimeContext(store, [stringThrowDialog]);

    render(
      <DataProviderWrapper value={runtime}>
        <VideoEditorDialogHost>
          <div data-testid="children-content">Children</div>
        </VideoEditorDialogHost>
      </DataProviderWrapper>,
    );

    expect(screen.getByTestId('children-content')).toBeInTheDocument();

    const snapshot = store.getSnapshot();
    expect(snapshot.length).toBeGreaterThanOrEqual(1);
    expect(snapshot[0].code).toBe('extension_visibility_exception');
    expect(snapshot[0].detail.errorMessage).toBe('raw string error');

    spy.mockRestore();
  });
});
