import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserVideoEditor } from '@/tools/video-editor/browser/BrowserVideoEditor';
import { mountVideoEditor } from '@/tools/video-editor/browser/mountVideoEditor';
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

vi.mock('@/tools/video-editor/components/VideoEditorShell', () => ({
  VideoEditorShell: ({ mode, timelineId }: { mode: string; timelineId: string }) => (
    <div data-testid="video-editor-shell">{`${mode}:${timelineId}`}</div>
  ),
}));

const provider: DataProvider = {
  loadTimeline: vi.fn(),
  saveTimeline: vi.fn(),
  loadAssetRegistry: vi.fn(),
  resolveAssetUrl: vi.fn(async (file: string) => file),
};

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

describe('BrowserVideoEditor', () => {
  it('mounts the real shell through the generic runtime provider with injected services', () => {
    const assetResolver = { resolveAssetUrl: vi.fn((file: string) => `https://assets.example/${file}`) };
    const exporter = { render: vi.fn() };

    render(
      <BrowserVideoEditor
        dataProvider={provider}
        timelineId="timeline-1"
        timelineName="Demo timeline"
        userId={null}
        assetResolver={assetResolver}
        exporter={exporter}
        hostContext={{ projectId: 'project-1' }}
      />,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('video-editor-shell')).toHaveTextContent('full:timeline-1');
    expect(runtimeProviderSpy).toHaveBeenCalledWith(expect.objectContaining({
      dataProvider: provider,
      timelineId: 'timeline-1',
      timelineName: 'Demo timeline',
      userId: null,
      runtime: expect.objectContaining({
        assetResolver,
        exporter,
        hostContext: { projectId: 'project-1' },
      }),
    }));
  });

  it('wraps the stock shell with renderLayout without replacing the public runtime bootstrap', () => {
    render(
      <BrowserVideoEditor
        dataProvider={provider}
        timelineId="timeline-1"
        renderLayout={(shell) => <div data-testid="layout-shell">{shell}</div>}
      />,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('layout-shell')).toBeInTheDocument();
    expect(screen.getByTestId('video-editor-shell')).toHaveTextContent('full:timeline-1');
  });

  it('imperatively mounts, updates, and unmounts the browser editor', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let mounted!: ReturnType<typeof mountVideoEditor>;

    act(() => {
      mounted = mountVideoEditor(container, {
        dataProvider: provider,
        timelineId: 'timeline-1',
        mode: 'compact',
      });
    });

    expect(container.textContent).toContain('compact:timeline-1');

    act(() => {
      mounted.update({
        dataProvider: provider,
        timelineId: 'timeline-2',
        mode: 'full',
      });
    });

    expect(container.textContent).toContain('full:timeline-2');

    act(() => {
      mounted.unmount();
    });

    expect(container.textContent).toBe('');
    container.remove();
  });

  // ---- extension negative coverage (no-input / disabled-input) ----

  it('mounts the real shell when extensions is omitted (undefined)', () => {
    render(
      <BrowserVideoEditor
        dataProvider={provider}
        timelineId="timeline-1"
        timelineName="No extensions"
      />,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('video-editor-shell')).toHaveTextContent('full:timeline-1');
  });

  it('mounts the real shell when extensions is an empty array', () => {
    render(
      <BrowserVideoEditor
        dataProvider={provider}
        timelineId="timeline-1"
        extensions={[]}
      />,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('video-editor-shell')).toHaveTextContent('full:timeline-1');
  });

  it('mounts the real shell when all extensions are disabled', () => {
    render(
      <BrowserVideoEditor
        dataProvider={provider}
        timelineId="timeline-1"
        extensions={[
          { enabled: false, slots: { toolbar: () => 'hidden' } },
          { enabled: false },
        ]}
      />,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('video-editor-shell')).toHaveTextContent('full:timeline-1');
  });

  // ---- package-loaded extension integration ----

  describe('package-loaded extensions', () => {
    it('mounts package-loaded configs carrying extensionId and settings', () => {
      const pkg = extPackage({ id: 'com.example.pkg' });

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId="timeline-1"
          extensionPackages={[pkg]}
        />,
      );

      expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
      expect(screen.getByTestId('video-editor-shell')).toBeInTheDocument();

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.pkg');
      expect(passedExtensions[0].settings).toEqual({});
    });

    it('mounts package-loaded extensions alongside raw extensions', () => {
      const rawExt = { slots: { statusBar: () => 'raw-status' } };
      const pkg = extPackage({ id: 'com.example.pkg' });

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId="timeline-1"
          extensions={rawExt}
          extensionPackages={[pkg]}
        />,
      );

      expect(screen.getByTestId('video-editor-shell')).toBeInTheDocument();

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
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId="timeline-1"
          extensionPackages={[pkg]}
          extensionStateRepository={repo}
        />,
      );

      expect(screen.getByTestId('video-editor-shell')).toBeInTheDocument();

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
          slots: { toolbar: () => 'hidden-toolbar' },
          dialogHost: { dialogs: [{ id: 'hidden-dialog', render: () => 'x' }] },
          registry: {
            panels: [{ id: 'hidden-panel', placement: 'asset-panel', render: () => 'x' }],
          },
        },
      );

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId="timeline-1"
          extensions={[{ slots: { statusBar: () => 'raw' } }]}
          extensionPackages={[pkg]}
          extensionStateRepository={repo}
        />,
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
      repo.setEnabled('com.example.a', false);
      repo.setEnabled('com.example.b', false);

      const rawExt = [
        { slots: { toolbar: () => 'raw-toolbar' } },
        { slots: { statusBar: () => 'raw-status' } },
      ];

      const pkgA = extPackage({ id: 'com.example.a' });
      const pkgB = extPackage(
        { id: 'com.example.b' },
        { slots: { header: () => 'pkg-header' } },
      );

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId="timeline-1"
          extensions={rawExt}
          extensionPackages={[pkgA, pkgB]}
          extensionStateRepository={repo}
        />,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      // All raw configs pass through unchanged; disabled packages contribute nothing
      expect(passedExtensions).toHaveLength(2);
      expect(passedExtensions[0].extensionId).toBeUndefined();
      expect(passedExtensions[1].extensionId).toBeUndefined();
      expect(passedExtensions[0].slots).toBeDefined();
      expect(passedExtensions[1].slots).toBeDefined();
    });

    it('raw extensions mount unchanged when extensionPackages is empty', () => {
      const rawExt = [{ slots: { toolbar: () => 'raw-toolbar' } }];

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId="timeline-1"
          extensions={rawExt}
          extensionPackages={[]}
        />,
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
        { slots: { toolbar: () => 'hidden' } },
      );

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId="timeline-1"
          extensionPackages={[pkgEnabled, pkgDisabled]}
          extensionStateRepository={repo}
        />,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.enabled');
    });
  });
});
