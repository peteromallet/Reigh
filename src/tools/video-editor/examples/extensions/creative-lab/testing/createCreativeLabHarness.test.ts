import { describe, expect, it } from 'vitest';
import { defineExtension } from '@reigh/editor-sdk';
import type {
  ContributionId,
  ExtensionId,
  TimelineOverlayRenderProps,
} from '@reigh/editor-sdk';
import {
  createCreativeLabExtensionHarness,
  createCreativeLabSnapshot,
} from './createCreativeLabHarness';

const extensionId = 'com.reigh.creative-lab.harness-fixture' as ExtensionId;
const commandId = `${extensionId}.run`;
const renderId = 'creative-lab-harness/overlay';
const extension = defineExtension({
  manifest: {
    id: extensionId,
    version: '1.0.0',
    label: 'Creative Lab Harness Fixture',
    apiVersion: 1,
    contributions: [
      {
        id: 'run' as ContributionId,
        kind: 'command',
        command: commandId,
        label: 'Run',
      },
      {
        id: 'overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: renderId,
        label: 'Overlay',
      },
    ],
  },
  activate(ctx) {
    const command = ctx.commands.registerCommand(commandId, () => {
      const snapshot = ctx.creative.reader.snapshot();
      ctx.creative.timeline.apply({
        version: snapshot.baseVersion,
        source: extensionId,
        operations: [],
      });
    });
    const renderer = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
      renderId,
      (props) => props,
    );
    return { dispose: () => { command.dispose(); renderer.dispose(); } };
  },
});
describe('createCreativeLabExtensionHarness', () => {
  it('captures commands, renderers, current snapshots, patches, and disposal', () => {
    const harness = createCreativeLabExtensionHarness(extension);
    const activation = extension.activate?.(harness.ctx);

    expect(harness.getCommand(commandId)).toEqual(expect.any(Function));
    expect(harness.getRenderer(renderId)).toEqual(expect.any(Function));
    harness.setSnapshot(createCreativeLabSnapshot({ baseVersion: 9, currentVersion: 9 }));
    harness.getCommand(commandId)?.({ commandId, extensionId });
    expect(harness.patches).toEqual([expect.objectContaining({ version: 9 })]);

    activation?.dispose();
    activation?.dispose();
    expect(harness.getCommand(commandId)).toBeUndefined();
    expect(harness.getRenderer(renderId)).toBeUndefined();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });
});
