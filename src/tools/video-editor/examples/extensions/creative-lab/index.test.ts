import { describe, expect, it } from 'vitest';
import { createExtensionContext } from '@/tools/video-editor/runtime/extensionContextFactory';
import { createExtensionLifecycleHost } from '@/tools/video-editor/runtime/extensionLifecycle';
import type {
  CommandHandler,
  DisposeHandle,
  ExtensionCommandService,
  ExtensionRenderer,
  ExtensionUiService,
  ReighExtension,
  TimelineDiff,
  TimelineOps,
  TimelinePatch,
  TimelineReader,
} from '@reigh/editor-sdk';
import { creativeLabExtensions } from './index';
import { createCreativeLabSnapshot } from './testing/createCreativeLabHarness';
import { clusterTimelineMarkers, getTimelineMarkerClusterEntries } from './timelineMarkerClusters';

describe('Creative Lab extension catalog', () => {
  it('contains exactly ten uniquely identified editor extensions', () => {
    expect(creativeLabExtensions).toHaveLength(10);
    const extensionIds = creativeLabExtensions.map((extension) => extension.manifest.id as string);
    expect(new Set(extensionIds).size).toBe(10);
    expect(extensionIds.every((id) => id.startsWith('com.reigh.creative-lab.'))).toBe(true);
  });

  it('keeps command and renderer identities collision-free across the swarm', () => {
    const commandIds: string[] = [];
    const renderIds: string[] = [];

    for (const extension of creativeLabExtensions) {
      const contributions = extension.manifest.contributions ?? [];
      expect(contributions.filter((item) => item.kind === 'command')).toHaveLength(1);
      expect(contributions.filter((item) => item.kind === 'timelineOverlay')).toHaveLength(1);
      for (const contribution of contributions) {
        if (contribution.kind === 'command' && contribution.command) {
          commandIds.push(contribution.command);
        }
        if (contribution.kind === 'timelineOverlay' && contribution.render) {
          renderIds.push(contribution.render);
        }
      }
    }

    expect(commandIds).toHaveLength(10);
    expect(renderIds).toHaveLength(10);
    expect(new Set(commandIds).size).toBe(10);
    expect(new Set(renderIds).size).toBe(10);
  });

  it('composes ten layers with one visible marker per layer at a coincident timestamp', () => {
    const layers = creativeLabExtensions.map((extension) => clusterTimelineMarkers([
      { id: `${extension.manifest.id}-a`, time: 4, label: 'primary cue' },
      { id: `${extension.manifest.id}-b`, time: 4, label: 'secondary cue' },
    ], {
      getId: (entry) => entry.id,
      getTime: (entry) => entry.time,
      getLabel: (entry) => entry.label,
    }));

    expect(layers).toHaveLength(10);
    expect(layers.every((layer) => layer)).toBe(true);
    expect(layers.flat()).toHaveLength(10);
    expect(layers.flat().every((marker) => marker.time === 4)).toBe(true);
    expect(layers.flat().every((marker) => getTimelineMarkerClusterEntries(marker.data).length === 2)).toBe(true);
  });

  it('activates, removes, re-adds, and disposes all ten through one lifecycle host', () => {
    const commands = new Map<string, CommandHandler>();
    const renderers = new Map<string, ExtensionRenderer<unknown>>();
    const patches: TimelinePatch[] = [];
    const reader: TimelineReader = { snapshot: () => createCreativeLabSnapshot() };
    const timeline = {
      apply(patch: TimelinePatch): TimelineDiff {
        patches.push(patch);
        return {} as TimelineDiff;
      },
    } as TimelineOps;
    const commandService: ExtensionCommandService = {
      registerCommand(id, handler): DisposeHandle {
        if (commands.has(id)) throw new Error(`duplicate command registration: ${id}`);
        commands.set(id, handler);
        return { dispose: () => { if (commands.get(id) === handler) commands.delete(id); } };
      },
    };
    const uiService: ExtensionUiService = {
      registerRenderer<Props>(id: string, renderer: ExtensionRenderer<Props>): DisposeHandle {
        if (renderers.has(id)) throw new Error(`duplicate renderer registration: ${id}`);
        const stored = renderer as ExtensionRenderer<unknown>;
        renderers.set(id, stored);
        return { dispose: () => { if (renderers.get(id) === stored) renderers.delete(id); } };
      },
    };
    const contextFactory = (extension: ReighExtension) => createExtensionContext(
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
    );
    const host = createExtensionLifecycleHost();

    host.synchronize(creativeLabExtensions, contextFactory);
    expect([...host.lifecycles.values()].every((lifecycle) => lifecycle.state === 'active')).toBe(true);
    expect(commands.size).toBe(10);
    expect(renderers.size).toBe(10);
    expect(host.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);

    host.synchronize(creativeLabExtensions.slice(0, 5), contextFactory);
    expect(host.lifecycles.size).toBe(5);
    expect(commands.size).toBe(5);
    expect(renderers.size).toBe(5);

    host.synchronize(creativeLabExtensions, contextFactory);
    expect(host.lifecycles.size).toBe(10);
    expect(commands.size).toBe(10);
    expect(renderers.size).toBe(10);
    expect(host.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);

    host.disposeAll();
    expect(commands.size).toBe(0);
    expect(renderers.size).toBe(0);
  });
});
