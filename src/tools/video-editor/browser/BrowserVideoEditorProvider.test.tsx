import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserVideoEditorProvider } from '@/tools/video-editor/browser/BrowserVideoEditorProvider';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';
import { InMemoryExtensionStateRepository } from '@/tools/video-editor/runtime/extensionStateRepository';
import type { ExtensionPackage, ExtensionManifest } from '@/tools/video-editor/runtime/extensionManifest';
import { createVideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics';
import type { VideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics';

const runtimeProviderSpy = vi.fn();

vi.mock('@/tools/video-editor/contexts/EditorRuntimeProvider', () => ({
  EditorRuntimeProvider: ({ children, ...props }: any) => {
    runtimeProviderSpy(props);
    return <div data-testid="runtime-provider">{children}</div>;
  },
}));

const provider: DataProvider = {
  loadTimeline: vi.fn(),
  saveTimeline: vi.fn(),
  loadAssetRegistry: vi.fn(),
  resolveAssetUrl: vi.fn(async (file: string) => file),
};

function slotRenderer(label: string) {
  return () => label;
}

afterEach(() => {
  runtimeProviderSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Package test helpers
// ---------------------------------------------------------------------------

function validManifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'com.example.test',
    name: 'Test Extension',
    version: '1.0.0',
    apiVersion: '1.0.0',
    ...overrides,
  };
}

function extPackage(
  manifestOverrides: Partial<ExtensionManifest> = {},
  config: Record<string, unknown> = {},
): ExtensionPackage {
  return { manifest: validManifest(manifestOverrides), config };
}

describe('BrowserVideoEditorProvider', () => {
  it('mounts the standalone runtime without importing the stock shell', () => {
    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
        timelineName="Provider demo"
        userId={null}
        hostContext={{ projectId: 'project-1' }}
      >
        <div data-testid="custom-shell">Custom shell</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('Custom shell');
    expect(runtimeProviderSpy).toHaveBeenCalledWith(expect.objectContaining({
      dataProvider: provider,
      timelineId: 'timeline-1',
      timelineName: 'Provider demo',
      userId: null,
      runtime: expect.objectContaining({
        hostContext: { projectId: 'project-1' },
      }),
    }));
  });

  // ---- extension threading negative coverage (no-input / disabled-input) ----

  it('mounts normally when extensions is omitted (undefined)', () => {
    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
      >
        <div data-testid="custom-shell">No extensions</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('No extensions');
    // extensions omitted → runtime provider receives undefined
    expect(runtimeProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ extensions: undefined }),
    );
  });

  it('mounts normally when extensions is an empty array', () => {
    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
        extensions={[]}
      >
        <div data-testid="custom-shell">Empty extensions</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('Empty extensions');
  });

  it('mounts normally when all extensions are disabled', () => {
    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
        extensions={[
          { enabled: false, slots: { toolbar: slotRenderer('hidden') } },
          { enabled: false },
        ]}
      >
        <div data-testid="custom-shell">All disabled</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('All disabled');
  });

  it('threads extensions prop through to EditorRuntimeProvider', () => {
    const ext = { slots: { statusBar: slotRenderer('test-status') } };

    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
        extensions={ext}
      >
        <div data-testid="custom-shell">With extension</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(runtimeProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ extensions: ext }),
    );
  });

  // ---- package-loaded extension integration ----

  describe('package-loaded extensions', () => {
    it('mounts package-loaded configs carrying extensionId and settings', () => {
      const pkg = extPackage({ id: 'com.example.pkg' });

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          extensionPackages={[pkg]}
        >
          <div data-testid="custom-shell">Package only</div>
        </BrowserVideoEditorProvider>,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.pkg');
      expect(passedExtensions[0].settings).toEqual({});
    });

    it('mounts package-loaded extensions alongside raw extensions', () => {
      const rawExt = { slots: { statusBar: slotRenderer('raw-status') } };
      const pkg = extPackage({ id: 'com.example.pkg' });

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          extensions={rawExt}
          extensionPackages={[pkg]}
        >
          <div data-testid="custom-shell">Both</div>
        </BrowserVideoEditorProvider>,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(2);

      // Raw config comes first, no extensionId
      expect(passedExtensions[0].extensionId).toBeUndefined();
      expect(passedExtensions[0].slots).toBeDefined();

      // Package config has extensionId
      expect(passedExtensions[1].extensionId).toBe('com.example.pkg');
    });

    it('disabled packages remain installed but contribute no configs', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setEnabled('com.example.disabled', false);

      const pkg = extPackage({ id: 'com.example.disabled' });

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          extensionPackages={[pkg]}
          extensionStateRepository={repo}
        >
          <div data-testid="custom-shell">Disabled pkg</div>
        </BrowserVideoEditorProvider>,
      );

      // No raw extensions, disabled package excluded -> empty array
      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toEqual([]);
    });

    it('disabled packages contribute no slots, panels, dialogs, or settings', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setEnabled('com.example.disabled', false);

      const pkg = extPackage(
        { id: 'com.example.disabled' },
        {
          slots: { toolbar: slotRenderer('hidden-toolbar') },
          dialogHost: { dialogs: [{ id: 'hidden-dialog', render: () => 'x' }] },
          registry: {
            panels: [{ id: 'hidden-panel', placement: 'asset-panel', render: () => 'x' }],
          },
        },
      );

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          extensions={[{ slots: { statusBar: slotRenderer('raw') } }]}
          extensionPackages={[pkg]}
          extensionStateRepository={repo}
        >
          <div data-testid="custom-shell">Mixed</div>
        </BrowserVideoEditorProvider>,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      // Only raw config survives; disabled package excluded entirely
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBeUndefined();
      expect(passedExtensions[0].slots).toBeDefined();
      expect(passedExtensions[0].dialogHost).toBeUndefined();
      expect(passedExtensions[0].registry).toBeUndefined();
    });

    it('raw configs are not persisted or disabled by package state', () => {
      const repo = new InMemoryExtensionStateRepository();
      // Disable all known packages
      repo.setEnabled('com.example.a', false);
      repo.setEnabled('com.example.b', false);

      const rawExt = [
        { slots: { toolbar: slotRenderer('raw-toolbar') } },
        { slots: { statusBar: slotRenderer('raw-status') } },
      ];

      const pkgA = extPackage({ id: 'com.example.a' });
      const pkgB = extPackage(
        { id: 'com.example.b' },
        { slots: { header: slotRenderer('pkg-header') } },
      );

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          extensions={rawExt}
          extensionPackages={[pkgA, pkgB]}
          extensionStateRepository={repo}
        >
          <div data-testid="custom-shell">Raw survives</div>
        </BrowserVideoEditorProvider>,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      // All raw configs pass through unchanged; disabled packages contribute nothing
      expect(passedExtensions).toHaveLength(2);
      // Raw configs don't carry extensionId
      expect(passedExtensions[0].extensionId).toBeUndefined();
      expect(passedExtensions[1].extensionId).toBeUndefined();
      // Raw configs retain their slots
      expect(passedExtensions[0].slots).toBeDefined();
      expect(passedExtensions[1].slots).toBeDefined();
    });

    it('raw extensions mount unchanged when extensionPackages is empty', () => {
      const rawExt = [{ slots: { toolbar: slotRenderer('raw-toolbar') } }];

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          extensions={rawExt}
          extensionPackages={[]}
        >
          <div data-testid="custom-shell">Raw only</div>
        </BrowserVideoEditorProvider>,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBeUndefined();
      expect(passedExtensions[0].slots).toBeDefined();
    });

    it('handles multiple packages with mixed enabled and disabled state', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setEnabled('com.example.disabled', false);

      const pkgEnabled = extPackage({ id: 'com.example.enabled' });
      const pkgDisabled = extPackage(
        { id: 'com.example.disabled' },
        { slots: { toolbar: slotRenderer('hidden') } },
      );

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          extensionPackages={[pkgEnabled, pkgDisabled]}
          extensionStateRepository={repo}
        >
          <div data-testid="custom-shell">Mixed pkgs</div>
        </BrowserVideoEditorProvider>,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.enabled');
    });

    it('enabled packages contribute slots, dialogHost, and registry', () => {
      const pkg = extPackage(
        {
          id: 'com.example.rich',
          contributions: {
            slots: [
              { slot: 'toolbar', id: 'pkg-toolbar' },
              { slot: 'statusBar', id: 'pkg-status' },
            ],
            dialogs: [{ id: 'pkg-dialog' }],
            panels: [{ id: 'pkg-panel', placement: 'asset-panel' }],
            inspectorSections: [
              { id: 'pkg-inspector', placement: 'after-default' },
            ],
          },
        },
        {
          slots: {
            toolbar: slotRenderer('pkg-toolbar'),
            statusBar: slotRenderer('pkg-status'),
          },
          dialogHost: {
            dialogs: [{ id: 'pkg-dialog', render: () => 'dialog' }],
          },
          registry: {
            panels: [
              { id: 'pkg-panel', placement: 'asset-panel', render: () => 'panel' },
            ],
            inspectorSections: [
              {
                id: 'pkg-inspector',
                placement: 'after-default',
                render: () => 'inspector',
              },
            ],
          },
        },
      );

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          extensionPackages={[pkg]}
        >
          <div data-testid="custom-shell">Rich pkg</div>
        </BrowserVideoEditorProvider>,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      const cfg = passedExtensions[0];
      expect(cfg.extensionId).toBe('com.example.rich');
      expect(cfg.slots).toBeDefined();
      expect(cfg.slots!.toolbar).toBeDefined();
      expect(cfg.slots!.statusBar).toBeDefined();
      expect(cfg.dialogHost).toBeDefined();
      expect(cfg.dialogHost!.dialogs).toHaveLength(1);
      expect(cfg.registry).toBeDefined();
      expect(cfg.registry!.panels).toHaveLength(1);
      expect(cfg.registry!.inspectorSections).toHaveLength(1);
    });
  });

  // ---- diagnostics store threading ---- 

  describe('diagnostics store', () => {
    it('creates a default diagnostics store and passes it through to EditorRuntimeProvider', () => {
      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
        >
          <div data-testid="custom-shell">Diag</div>
        </BrowserVideoEditorProvider>,
      );

      expect(runtimeProviderSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          diagnosticsStore: expect.objectContaining({
            getSnapshot: expect.any(Function),
            subscribe: expect.any(Function),
            report: expect.any(Function),
            reportMany: expect.any(Function),
            replaceBySource: expect.any(Function),
            clear: expect.any(Function),
          }),
        }),
      );
    });

    it('accepts an external diagnostics store and threads it through to EditorRuntimeProvider unchanged', () => {
      const injected: VideoEditorDiagnosticsStore = createVideoEditorDiagnosticsStore();
      // Pre-populate with a diagnostic so we can identify it
      injected.report({
        severity: 'warning',
        source: 'provider',
        code: 'P_TEST',
        message: 'injected store test',
      });

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          diagnosticsStore={injected}
        >
          <div data-testid="custom-shell">Injected</div>
        </BrowserVideoEditorProvider>,
      );

      const passedStore = runtimeProviderSpy.mock.calls[0][0].diagnosticsStore as VideoEditorDiagnosticsStore;
      expect(passedStore).toBe(injected);
      const snapshot = passedStore.getSnapshot();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].code).toBe('P_TEST');
    });

    it('reports no loader diagnostics when extensionPackages is omitted', () => {
      const store = createVideoEditorDiagnosticsStore();

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          diagnosticsStore={store}
        >
          <div data-testid="custom-shell">No pkgs</div>
        </BrowserVideoEditorProvider>,
      );

      const loaderDiags = store.getSnapshot().filter((d) => d.source === 'extension-loader');
      expect(loaderDiags).toHaveLength(0);
    });

    it('reports no loader diagnostics when extensionPackages is empty', () => {
      const store = createVideoEditorDiagnosticsStore();

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          diagnosticsStore={store}
          extensionPackages={[]}
        >
          <div data-testid="custom-shell">Empty pkgs</div>
        </BrowserVideoEditorProvider>,
      );

      const loaderDiags = store.getSnapshot().filter((d) => d.source === 'extension-loader');
      expect(loaderDiags).toHaveLength(0);
    });

    it('routes valid package loader diagnostics into the store via replaceBySource', () => {
      const store = createVideoEditorDiagnosticsStore();
      const pkg = extPackage({ id: 'com.example.ok' });

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          diagnosticsStore={store}
          extensionPackages={[pkg]}
        >
          <div data-testid="custom-shell">Valid pkg</div>
        </BrowserVideoEditorProvider>,
      );

      // Valid package produces no diagnostics, so loader source should be empty
      const loaderDiags = store.getSnapshot().filter((d) => d.source === 'extension-loader');
      expect(loaderDiags).toHaveLength(0);

      // Extension config threading is unchanged
      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.ok');
    });

    it('routes invalid package diagnostics into the store via replaceBySource', () => {
      const store = createVideoEditorDiagnosticsStore();
      // Missing required 'id' field in manifest
      const invalidPkg = extPackage({ id: '' });

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          diagnosticsStore={store}
          extensionPackages={[invalidPkg]}
        >
          <div data-testid="custom-shell">Invalid pkg</div>
        </BrowserVideoEditorProvider>,
      );

      const loaderDiags = store.getSnapshot().filter((d) => d.source === 'extension-loader');
      expect(loaderDiags.length).toBeGreaterThanOrEqual(1);

      // Invalid package should be excluded from enabled configs
      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(0);
    });

    it('replaces loader diagnostics on rerender so entries do not duplicate', () => {
      const store = createVideoEditorDiagnosticsStore();
      const pkg = extPackage({ id: 'com.example.stable' });

      const { rerender } = render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          diagnosticsStore={store}
          extensionPackages={[pkg]}
        >
          <div data-testid="custom-shell">Stable</div>
        </BrowserVideoEditorProvider>,
      );

      const countAfterFirst = store.getSnapshot().filter((d) => d.source === 'extension-loader').length;

      rerender(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          diagnosticsStore={store}
          extensionPackages={[pkg]}
        >
          <div data-testid="custom-shell">Stable rerender</div>
        </BrowserVideoEditorProvider>,
      );

      const countAfterRerender = store.getSnapshot().filter((d) => d.source === 'extension-loader').length;
      // replaceBySource prevents duplication — same count
      expect(countAfterRerender).toBe(countAfterFirst);
    });

    it('does not change extension config threading when diagnostics collection is active', () => {
      const store = createVideoEditorDiagnosticsStore();
      const pkg = extPackage(
        {
          id: 'com.example.threaded',
          contributions: {
            slots: [{ slot: 'toolbar', id: 'threaded-toolbar' }],
            dialogs: [{ id: 'threaded-dialog' }],
            panels: [{ id: 'threaded-panel', placement: 'asset-panel' }],
          },
        },
        {
          slots: { toolbar: slotRenderer('threaded-toolbar') },
          dialogHost: { dialogs: [{ id: 'threaded-dialog', render: () => 'x' }] },
          registry: { panels: [{ id: 'threaded-panel', placement: 'asset-panel', render: () => 'x' }] },
        },
      );

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId="timeline-1"
          diagnosticsStore={store}
          extensionPackages={[pkg]}
        >
          <div data-testid="custom-shell">Threaded</div>
        </BrowserVideoEditorProvider>,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      const cfg = passedExtensions[0];
      expect(cfg.extensionId).toBe('com.example.threaded');
      expect(cfg.slots).toBeDefined();
      expect(cfg.dialogHost).toBeDefined();
      expect(cfg.registry).toBeDefined();
      expect(cfg.settings).toEqual({});
    });
  });
});
