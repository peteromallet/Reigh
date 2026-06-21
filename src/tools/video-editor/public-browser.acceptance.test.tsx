import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserVideoEditor,
  InMemoryDataProvider,
} from '@/tools/video-editor/browser';
import { BrowserVideoEditorProvider } from '@/tools/video-editor/browser-provider';
import { createEmbedDemoTimelineFixture } from '@/tools/video-editor/testing';
import { basicExtensionPackage } from '@/tools/video-editor/testing/extensions/basic-extension';
import { InMemoryExtensionStateRepository } from '@/tools/video-editor/extension';
import type { VideoEditorExtensionConfig } from '@/tools/video-editor/extension';

const runtimeProviderSpy = vi.fn();

vi.mock('@banodoco/timeline-composition/registry.generated', () => ({
  THEME_PACKAGE_REGISTRY: {},
}));

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

afterEach(() => {
  runtimeProviderSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Derive a raw extension config from the package fixture for backwards-
// compatible raw-extension tests.  The raw config carries no extensionId so it
// behaves like an M1 extension and is not affected by package state.
// ---------------------------------------------------------------------------
const basicVideoEditorExtension: VideoEditorExtensionConfig =
  basicExtensionPackage.config as unknown as VideoEditorExtensionConfig;

describe('public browser SDK acceptance', () => {
  it('mounts the standalone shell from the public browser entrypoint with a shared fixture timeline', () => {
    const fixture = createEmbedDemoTimelineFixture();
    const provider = new InMemoryDataProvider({
      timelines: {
        [fixture.timelineId]: fixture,
      },
    });

    render(
      <BrowserVideoEditor
        dataProvider={provider}
        timelineId={fixture.timelineId}
        timelineName={fixture.timelineName}
        renderLayout={(shell) => <div data-testid="layout-shell">{shell}</div>}
      />,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('layout-shell')).toBeInTheDocument();
    expect(screen.getByTestId('video-editor-shell')).toHaveTextContent(`full:${fixture.timelineId}`);
    expect(runtimeProviderSpy).toHaveBeenCalledWith(expect.objectContaining({
      timelineId: fixture.timelineId,
      timelineName: fixture.timelineName,
    }));
  });

  it('mounts a custom shell from the public browser-provider entrypoint with the shared fixture timeline', () => {
    const fixture = createEmbedDemoTimelineFixture();
    const provider = new InMemoryDataProvider({
      timelines: {
        [fixture.timelineId]: fixture,
      },
    });

    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId={fixture.timelineId}
        timelineName={fixture.timelineName}
      >
        <div data-testid="custom-shell">Custom fixture shell</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('Custom fixture shell');
    expect(runtimeProviderSpy).toHaveBeenCalledWith(expect.objectContaining({
      timelineId: fixture.timelineId,
      timelineName: fixture.timelineName,
    }));
  });

  // ---- extension fixture acceptance (T7) ----

  it('passes the basic extension fixture through BrowserVideoEditor to the runtime provider', () => {
    const fixture = createEmbedDemoTimelineFixture();
    const provider = new InMemoryDataProvider({
      timelines: {
        [fixture.timelineId]: fixture,
      },
    });

    render(
      <BrowserVideoEditor
        dataProvider={provider}
        timelineId={fixture.timelineId}
        timelineName={fixture.timelineName}
        extensions={[basicVideoEditorExtension]}
        renderLayout={(shell) => <div data-testid="layout-shell">{shell}</div>}
      />,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('layout-shell')).toBeInTheDocument();
    expect(screen.getByTestId('video-editor-shell')).toHaveTextContent(`full:${fixture.timelineId}`);
    expect(runtimeProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: [basicVideoEditorExtension],
      }),
    );
  });

  it('passes the basic extension fixture through BrowserVideoEditorProvider to the runtime provider', () => {
    const fixture = createEmbedDemoTimelineFixture();
    const provider = new InMemoryDataProvider({
      timelines: {
        [fixture.timelineId]: fixture,
      },
    });

    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId={fixture.timelineId}
        timelineName={fixture.timelineName}
        extensions={[basicVideoEditorExtension]}
      >
        <div data-testid="custom-shell">Extension fixture shell</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('Extension fixture shell');
    expect(runtimeProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: [basicVideoEditorExtension],
      }),
    );
  });

  it('mounts BrowserVideoEditor cleanly with no extensions (undefined) via public API', () => {
    const fixture = createEmbedDemoTimelineFixture();
    const provider = new InMemoryDataProvider({
      timelines: {
        [fixture.timelineId]: fixture,
      },
    });

    render(
      <BrowserVideoEditor
        dataProvider={provider}
        timelineId={fixture.timelineId}
        timelineName={fixture.timelineName}
      />,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('video-editor-shell')).toHaveTextContent(`full:${fixture.timelineId}`);
    // No extensions prop → editor still mounts cleanly
  });

  it('mounts BrowserVideoEditor cleanly when the extension fixture is disabled', () => {
    const fixture = createEmbedDemoTimelineFixture();
    const provider = new InMemoryDataProvider({
      timelines: {
        [fixture.timelineId]: fixture,
      },
    });

    render(
      <BrowserVideoEditor
        dataProvider={provider}
        timelineId={fixture.timelineId}
        timelineName={fixture.timelineName}
        extensions={[{ ...basicVideoEditorExtension, enabled: false }]}
        renderLayout={(shell) => <div data-testid="layout-shell">{shell}</div>}
      />,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('video-editor-shell')).toHaveTextContent(`full:${fixture.timelineId}`);
    // Disabled fixture → editor still mounts with no fixture chrome
  });

  // =========================================================================
  // M2 package-loading acceptance (T16)
  // =========================================================================

  describe('package-loaded extensions through public entrypoint', () => {
    it('loads a valid package fixture through BrowserVideoEditor and passes configs to the runtime', () => {
      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          timelineName={fixture.timelineName}
          extensionPackages={[basicExtensionPackage]}
          renderLayout={(shell) => <div data-testid="layout-shell">{shell}</div>}
        />,
      );

      expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
      expect(screen.getByTestId('video-editor-shell')).toHaveTextContent(`full:${fixture.timelineId}`);

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions as VideoEditorExtensionConfig[];
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.basic-extension');
      expect(passedExtensions[0].settings).toEqual({});
      expect(passedExtensions[0].slots).toBeDefined();
      expect(passedExtensions[0].registry).toBeDefined();
    });

    it('loads a valid package fixture through BrowserVideoEditorProvider and passes configs to the runtime', () => {
      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId={fixture.timelineId}
          timelineName={fixture.timelineName}
          extensionPackages={[basicExtensionPackage]}
        >
          <div data-testid="custom-shell">Package shell</div>
        </BrowserVideoEditorProvider>,
      );

      expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
      expect(screen.getByTestId('custom-shell')).toHaveTextContent('Package shell');

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions as VideoEditorExtensionConfig[];
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.basic-extension');
      expect(passedExtensions[0].settings).toEqual({});
      expect(passedExtensions[0].slots).toBeDefined();
    });

    it('persists extension state across remount with the same repository (BrowserVideoEditor)', () => {
      const repo = new InMemoryExtensionStateRepository();
      // Pre-configure extension state: disabled, with settings overrides
      repo.setEnabled('com.example.basic-extension', false);

      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      // First mount – disabled package produces no configs
      const { unmount } = render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        />,
      );

      let passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toEqual([]);

      // Verify the repository still knows about the extension (it is installed)
      expect(repo.getAllStates()).toHaveProperty('com.example.basic-extension');
      expect(repo.getState('com.example.basic-extension').enabled).toBe(false);

      unmount();
      runtimeProviderSpy.mockClear();

      // Re-enable and add settings overrides BEFORE remount
      repo.setEnabled('com.example.basic-extension', true);
      repo.setSettingsOverrides('com.example.basic-extension', { theme: 'dark' });

      // Second mount – re-enabled with settings, simulating a reload + state change
      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        />,
      );

      passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.basic-extension');
      expect(passedExtensions[0].settings).toEqual({ theme: 'dark' });
    });

    it('persists extension state across remount with the same repository (BrowserVideoEditorProvider)', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setEnabled('com.example.basic-extension', true);
      repo.setSettingsOverrides('com.example.basic-extension', { fontSize: 14 });

      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      // First mount
      const { unmount } = render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        >
          <div data-testid="custom-shell">First mount</div>
        </BrowserVideoEditorProvider>,
      );

      let passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions as VideoEditorExtensionConfig[];
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.basic-extension');
      expect(passedExtensions[0].settings).toEqual({ fontSize: 14 });

      unmount();
      runtimeProviderSpy.mockClear();

      // Second mount – same repository, settings must persist
      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        >
          <div data-testid="custom-shell">Second mount</div>
        </BrowserVideoEditorProvider>,
      );

      passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions as VideoEditorExtensionConfig[];
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.basic-extension');
      expect(passedExtensions[0].settings).toEqual({ fontSize: 14 });
    });

    it('hides disabled extension contributions while the extension remains installed in repository state (BrowserVideoEditor)', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setEnabled('com.example.basic-extension', false);

      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        />,
      );

      // Disabled package → no configs, no contributions mounted
      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toEqual([]);

      // But the extension is still installed – repository retains its state
      const allStates = repo.getAllStates();
      expect(allStates).toHaveProperty('com.example.basic-extension');
      expect(allStates['com.example.basic-extension'].enabled).toBe(false);

      // The editor shell still mounts cleanly
      expect(screen.getByTestId('video-editor-shell')).toHaveTextContent(`full:${fixture.timelineId}`);
    });

    it('hides disabled extension contributions while the extension remains installed in repository state (BrowserVideoEditorProvider)', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setEnabled('com.example.basic-extension', false);

      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      render(
        <BrowserVideoEditorProvider
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        >
          <div data-testid="custom-shell">Disabled package</div>
        </BrowserVideoEditorProvider>,
      );

      // Disabled package → no configs passed to runtime
      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toEqual([]);

      // Repository still holds the extension's state – it remains installed
      const allStates = repo.getAllStates();
      expect(allStates).toHaveProperty('com.example.basic-extension');
      expect(allStates['com.example.basic-extension'].enabled).toBe(false);

      // Provider still mounts cleanly
      expect(screen.getByTestId('custom-shell')).toHaveTextContent('Disabled package');
    });

    it('passes settings from repository overrides into loaded package configs (BrowserVideoEditor)', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setEnabled('com.example.basic-extension', true);
      repo.setSettingsOverrides('com.example.basic-extension', {
        appearance: 'compact',
        debug: true,
      });

      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        />,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions as VideoEditorExtensionConfig[];
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.basic-extension');
      expect(passedExtensions[0].settings).toEqual({
        appearance: 'compact',
        debug: true,
      });
    });

    it('loads valid extension packages additively with raw extensions (BrowserVideoEditor)', () => {
      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      const rawExt: VideoEditorExtensionConfig = {
        slots: { header: () => 'raw-header' },
      };

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensions={[rawExt]}
          extensionPackages={[basicExtensionPackage]}
        />,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions as VideoEditorExtensionConfig[];
      expect(passedExtensions).toHaveLength(2);

      // Raw config comes first, no extensionId
      expect(passedExtensions[0].extensionId).toBeUndefined();
      expect(passedExtensions[0].slots).toBeDefined();

      // Package config comes second, carries extensionId + settings
      expect(passedExtensions[1].extensionId).toBe('com.example.basic-extension');
      expect(passedExtensions[1].settings).toEqual({});
    });

    it('disables and re-enables an extension across remounts while preserving settings overrides', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setEnabled('com.example.basic-extension', true);
      repo.setSettingsOverrides('com.example.basic-extension', { volume: 0.5 });

      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      // Mount enabled
      const { unmount } = render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        />,
      );

      let passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.basic-extension');
      expect(passedExtensions[0].settings).toEqual({ volume: 0.5 });

      unmount();
      runtimeProviderSpy.mockClear();

      // Disable
      repo.setEnabled('com.example.basic-extension', false);

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        />,
      );

      // Disabled → no configs
      passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toEqual([]);

      // Extension still installed with settings preserved
      const state = repo.getState('com.example.basic-extension');
      expect(state.enabled).toBe(false);
      expect(state.settingsOverrides).toEqual({ volume: 0.5 });

      unmount();
      runtimeProviderSpy.mockClear();

      // Re-enable
      repo.setEnabled('com.example.basic-extension', true);

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        />,
      );

      // Re-enabled → config returns with original settings still intact
      passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extensionId).toBe('com.example.basic-extension');
      expect(passedExtensions[0].settings).toEqual({ volume: 0.5 });
    });

    it('coexists peacefully with raw extension disabled-prop (raw disabled does not affect package state)', () => {
      const repo = new InMemoryExtensionStateRepository();
      // Package is enabled in repository, but a raw extension with the same
      // config shape is passed as disabled.  Package state is independent.
      repo.setEnabled('com.example.basic-extension', true);

      const fixture = createEmbedDemoTimelineFixture();
      const provider = new InMemoryDataProvider({
        timelines: { [fixture.timelineId]: fixture },
      });

      render(
        <BrowserVideoEditor
          dataProvider={provider}
          timelineId={fixture.timelineId}
          extensions={[{ ...basicVideoEditorExtension, enabled: false }]}
          extensionPackages={[basicExtensionPackage]}
          extensionStateRepository={repo}
        />,
      );

      const passedExtensions = runtimeProviderSpy.mock.calls[0][0].extensions;
      // The raw disabled extension is still passed through (raw configs are not
      // filtered by the loader), and the enabled package config is appended.
      // The raw config comes first, package config second.
      expect(passedExtensions).toHaveLength(2);
      expect(passedExtensions[0].extensionId).toBeUndefined();
      expect(passedExtensions[0].enabled).toBe(false);
      expect(passedExtensions[1].extensionId).toBe('com.example.basic-extension');

      // Repository state unaffected by raw config
      expect(repo.getState('com.example.basic-extension').enabled).toBe(true);
    });
  });
});
