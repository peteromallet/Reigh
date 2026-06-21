import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserVideoEditorProvider } from '@/tools/video-editor/browser/BrowserVideoEditorProvider';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';
import { InMemoryExtensionStateRepository } from '@/tools/video-editor/runtime/extensionStateRepository';
import type { ExtensionPackage, ExtensionManifest } from '@/tools/video-editor/runtime/extensionManifest';

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
});
