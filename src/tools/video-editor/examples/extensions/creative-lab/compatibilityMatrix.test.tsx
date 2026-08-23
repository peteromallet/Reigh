// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import {
  defineExtension,
  type CommandHandler,
  type DataItemInspectorProps,
  type DataKindRegistrationService,
  type DataLaneRendererProps,
  type DisposeHandle,
  type ExtensionCommandService,
  type ExtensionContext,
  type ExtensionId,
  type ExtensionRenderer,
  type ExtensionUiService,
  type ReighExtension,
  type TimelineDiff,
  type TimelineOps,
  type TimelinePatch,
  type TimelineReader,
} from '@reigh/editor-sdk';
import { createExtensionContext } from '@/tools/video-editor/runtime/extensionContextFactory';
import {
  createExtensionLifecycle,
  createExtensionLifecycleHost,
} from '@/tools/video-editor/runtime/extensionLifecycle';
import { HostContributionErrorBoundary } from '@/tools/video-editor/runtime/ContributionErrorBoundary';
import { transcriptLaneExtension } from '@/tools/video-editor/dev/transcript-lane/extension';
import { runawayTimelineExtension } from '@/tools/video-editor/dev/runaway-timeline/extension';
import { creativeLabExtensions } from './index';
import { createCreativeLabSnapshot } from './testing/createCreativeLabHarness';

const compatibilityCatalog = Object.freeze([
  ...creativeLabExtensions,
  transcriptLaneExtension,
  runawayTimelineExtension,
]);

function allPairs<T>(items: readonly T[]): readonly (readonly [T, T])[] {
  return items.flatMap((left, leftIndex) => (
    items.slice(leftIndex + 1).map((right) => [left, right] as const)
  ));
}

function createPairContextFactory() {
  const commands = new Map<string, { owner: string; handler: CommandHandler }>();
  const renderers = new Map<string, { owner: string; renderer: ExtensionRenderer<unknown> }>();
  const dataKinds = new Map<string, {
    owner: string;
    renderer: (props: DataLaneRendererProps) => unknown;
    inspector?: (props: DataItemInspectorProps) => unknown;
  }>();
  const reader: TimelineReader = { snapshot: () => createCreativeLabSnapshot() };
  const timeline = {
    apply(_patch: TimelinePatch): TimelineDiff { return {} as TimelineDiff; },
  } as TimelineOps;

  const contextFactory = (extension: ReighExtension): ExtensionContext => {
    const owner = extension.manifest.id as string;
    const commandService: ExtensionCommandService = {
      registerCommand(id, handler): DisposeHandle {
        if (commands.has(id)) throw new Error(`duplicate command: ${id}`);
        const record = { owner, handler };
        commands.set(id, record);
        return { dispose: () => { if (commands.get(id) === record) commands.delete(id); } };
      },
    };
    const uiService: ExtensionUiService = {
      registerRenderer<Props>(id: string, renderer: ExtensionRenderer<Props>): DisposeHandle {
        if (renderers.has(id)) throw new Error(`duplicate renderer: ${id}`);
        const record = { owner, renderer: renderer as ExtensionRenderer<unknown> };
        renderers.set(id, record);
        return { dispose: () => { if (renderers.get(id) === record) renderers.delete(id); } };
      },
    };
    const dataKindService: DataKindRegistrationService = {
      register(kindId, renderer, inspector): DisposeHandle {
        if (dataKinds.has(kindId)) throw new Error(`duplicate data kind: ${kindId}`);
        const record = { owner, renderer, ...(inspector ? { inspector } : {}) };
        dataKinds.set(kindId, record);
        return { dispose: () => { if (dataKinds.get(kindId) === record) dataKinds.delete(kindId); } };
      },
    };
    return createExtensionContext(
      extension,
      { reader, timeline },
      commandService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      uiService,
      dataKindService,
    );
  };

  return { commands, renderers, dataKinds, contextFactory };
}

describe('Creative Lab + typed-lane all-pairs compatibility matrix', () => {
  it('generates the complete 12-extension / 66-pair matrix', () => {
    expect(compatibilityCatalog).toHaveLength(12);
    expect(new Set(compatibilityCatalog.map((extension) => extension.manifest.id)).size).toBe(12);
    expect(allPairs(compatibilityCatalog)).toHaveLength(66);
  });

  it.each(allPairs(compatibilityCatalog))(
    'activates and disposes %s with %s without identity collisions',
    (left, right) => {
      const harness = createPairContextFactory();
      const host = createExtensionLifecycleHost();
      host.synchronize([left, right], harness.contextFactory);

      expect([...host.lifecycles.values()].map((lifecycle) => lifecycle.state)).toEqual([
        'active',
        'active',
      ]);
      expect(host.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);

      host.disposeAll();
      expect(harness.commands.size).toBe(0);
      expect(harness.renderers.size).toBe(0);
      expect(harness.dataKinds.size).toBe(0);
    },
  );

  it('contains a partial activation failure without blocking the healthy peer', () => {
    const broken = defineExtension({
      manifest: {
        id: 'com.reigh.compat.activation-failure' as ExtensionId,
        version: '1.0.0',
        apiVersion: 1,
        license: 'MIT',
        label: 'Activation failure probe',
        contributions: [],
      },
      activate() {
        throw new Error('activation probe failed');
      },
    });
    const harness = createPairContextFactory();
    const host = createExtensionLifecycleHost();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.synchronize([compatibilityCatalog[0], broken], harness.contextFactory);

    expect(host.lifecycles.get(compatibilityCatalog[0].manifest.id as string)?.state).toBe('active');
    expect(host.lifecycles.get(broken.manifest.id as string)?.state).toBe('failed');
    expect(host.diagnostics.some((diagnostic) => diagnostic.code === 'lifecycle/activation-failed')).toBe(true);
    host.disposeAll();
    consoleError.mockRestore();
  });

  it('contains a renderer throw behind the host-owned contribution boundary', () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const suppressExpectedWindowError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', suppressExpectedWindowError);
    const throwingRenderer: ExtensionRenderer<Record<string, never>> = () => {
      throw new Error('renderer probe failed');
    };
    function RendererSurface(): ReactNode {
      return throwingRenderer({}) as ReactNode;
    }

    render(
      <HostContributionErrorBoundary
        contributionId="compat.renderer"
        extensionId="com.reigh.compat.renderer"
        kind="timelineOverlay"
        onError={onError}
      >
        <RendererSurface />
      </HostContributionErrorBoundary>,
    );

    expect(screen.getByRole('alert').textContent).toContain('renderer probe failed');
    expect(onError).toHaveBeenCalledTimes(1);
    window.removeEventListener('error', suppressExpectedWindowError);
    consoleError.mockRestore();
  });

  it('records a disposal failure and still reaches the terminal disposed state', () => {
    const brokenDispose = defineExtension({
      manifest: {
        id: 'com.reigh.compat.disposal-failure' as ExtensionId,
        version: '1.0.0',
        apiVersion: 1,
        license: 'MIT',
        label: 'Disposal failure probe',
        contributions: [],
      },
      activate() {
        return { dispose: () => { throw new Error('disposal probe failed'); } };
      },
    });
    const lifecycle = createExtensionLifecycle(brokenDispose);
    const harness = createPairContextFactory();
    lifecycle.activate(harness.contextFactory(brokenDispose));
    lifecycle.dispose();

    expect(lifecycle.state).toBe('disposed');
    expect(lifecycle.diagnostics.some((diagnostic) => (
      diagnostic.code === 'lifecycle/dispose-handle-error'
    ))).toBe(true);
  });
});
