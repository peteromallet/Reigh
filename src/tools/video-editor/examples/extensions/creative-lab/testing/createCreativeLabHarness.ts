/**
 * Focused lifecycle harness for Creative Lab extension examples.
 *
 * It centralizes the host-internal positional context factory call so each
 * authored extension test can stay focused on public commands, renderers,
 * snapshots, patches, and disposal behavior.
 */

import { createExtensionContext } from '@/tools/video-editor/runtime/extensionContextFactory';
import type {
  CommandHandler,
  DisposeHandle,
  ExtensionCommandService,
  ExtensionContext,
  ExtensionRenderer,
  ExtensionUiService,
  ReighExtension,
  TimelineDiff,
  TimelineOps,
  TimelinePatch,
  TimelineReader,
  TimelineSnapshot,
} from '@reigh/editor-sdk';

export function createCreativeLabSnapshot(
  overrides: Partial<TimelineSnapshot> = {},
): TimelineSnapshot {
  return {
    projectId: 'creative-lab-fixture',
    baseVersion: 1,
    currentVersion: 1,
    extensionRequirements: [],
    clips: [],
    tracks: [],
    assetKeys: [],
    app: {},
    ...overrides,
  };
}
export interface CreativeLabExtensionHarness {
  readonly ctx: ExtensionContext;
  readonly patches: readonly TimelinePatch[];
  readonly commandDisposals: number;
  readonly rendererDisposals: number;
  setSnapshot(next: TimelineSnapshot): void;
  getCommand(id: string): CommandHandler | undefined;
  getRenderer<Props = unknown>(id: string): ExtensionRenderer<Props> | undefined;
}

export function createCreativeLabExtensionHarness(
  extension: ReighExtension,
  initialSnapshot: TimelineSnapshot = createCreativeLabSnapshot(),
): CreativeLabExtensionHarness {
  let currentSnapshot = initialSnapshot;
  let commandDisposals = 0;
  let rendererDisposals = 0;
  const patches: TimelinePatch[] = [];
  const commandsById = new Map<string, CommandHandler>();
  const renderersById = new Map<string, ExtensionRenderer<unknown>>();

  const commands: ExtensionCommandService = {
    registerCommand(id, handler): DisposeHandle {
      commandsById.set(id, handler);
      let disposed = false;
      return {
        dispose(): void {
          if (disposed) return;
          disposed = true;
          if (commandsById.get(id) === handler) commandsById.delete(id);
          commandDisposals += 1;
        },
      };
    },
  };
  const ui: ExtensionUiService = {
    registerRenderer<Props>(id: string, renderer: ExtensionRenderer<Props>): DisposeHandle {
      const storedRenderer = renderer as ExtensionRenderer<unknown>;
      renderersById.set(id, storedRenderer);
      let disposed = false;
      return {
        dispose(): void {
          if (disposed) return;
          disposed = true;
          if (renderersById.get(id) === storedRenderer) renderersById.delete(id);
          rendererDisposals += 1;
        },
      };
    },
  };
  const reader: TimelineReader = { snapshot: () => currentSnapshot };
  const timeline = {
    apply(patch: TimelinePatch): TimelineDiff {
      patches.push(patch);
      return {} as TimelineDiff;
    },
  } as TimelineOps;

  const ctx = createExtensionContext(
    extension,
    { reader, timeline },
    commands,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    ui,
  );

  return {
    ctx,
    patches,
    get commandDisposals() { return commandDisposals; },
    get rendererDisposals() { return rendererDisposals; },
    setSnapshot(next) { currentSnapshot = next; },
    getCommand(id) { return commandsById.get(id); },
    getRenderer<Props>(id: string) {
      return renderersById.get(id) as ExtensionRenderer<Props> | undefined;
    },
  };
}
