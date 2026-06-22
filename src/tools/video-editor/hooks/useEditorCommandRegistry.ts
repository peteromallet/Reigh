import { useCallback, useMemo } from 'react';
import { useVideoEditorRuntimeSafe } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import {
  useTimelineDataSliceSafe,
  useTimelineOpsSliceSafe,
} from '@/tools/video-editor/hooks/timelineStore.ts';
import {
  createEditorCommandRegistry,
  type EditorCommandContext,
  type EditorCommandEntry,
  type EditorCommandRegistry,
  type EditorCommandResult,
  type EditorCommandSource,
} from '@/tools/video-editor/commands/editorCommandRegistry.ts';
import { createTimelineCommandRunner } from '@/tools/video-editor/commands/runner.ts';
import { MEDIA_COMMAND_DESCRIPTORS } from '@/tools/video-editor/commands/media.ts';
import type {
  TimelineCommand,
  TimelineCommandInput,
  TimelineCommandRunner,
} from '@/tools/video-editor/commands/types.ts';
import type { ExtensionCommandMenuContext } from '@/tools/video-editor/runtime/extensionManifest.ts';

// ---------------------------------------------------------------------------
// Lazy runner singleton — built once from internal descriptors
// ---------------------------------------------------------------------------

let _sharedRunner: TimelineCommandRunner | null = null;

function getSharedRunner(): TimelineCommandRunner {
  if (!_sharedRunner) {
    _sharedRunner = createTimelineCommandRunner([...MEDIA_COMMAND_DESCRIPTORS]);
  }
  return _sharedRunner;
}

// ---------------------------------------------------------------------------
// Empty registry stub
// ---------------------------------------------------------------------------

const EMPTY_COMMANDS: readonly EditorCommandEntry[] = Object.freeze([]);

function createEmptyRegistryResult(): UseEditorCommandRegistryResult {
  const emptyRegistry: EditorCommandRegistry = {
    commands: EMPTY_COMMANDS,
    queryCommands: () => EMPTY_COMMANDS,
    executeCommand: () => null,
    getCommand: () => undefined,
    registerExecutor: () => {},
    unregisterExecutor: () => {},
  };

  const emptyContext: EditorCommandContext = {
    data: {} as any,
    timelineId: '',
    userId: 'anonymous',
    selectedClipIds: [],
    source: 'palette',
  };

  return {
    registry: emptyRegistry,
    buildContext: () => emptyContext,
    execute: () => null,
    queryCommands: () => EMPTY_COMMANDS,
    commands: EMPTY_COMMANDS,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseEditorCommandRegistryResult {
  /** The built registry, ready for query and execute. */
  registry: EditorCommandRegistry;

  /** Convenience: build an EditorCommandContext from the current timeline state. */
  buildContext: (
    overrides?: Partial<EditorCommandContext>,
  ) => EditorCommandContext;

  /** Execute a command by ID and return its result. Proposal commands return EditorCommandProposalResult. */
  execute: (id: string, context: EditorCommandContext) => EditorCommandResult | null;

  /** Query commands matching the given source and optional menu context. */
  queryCommands: (
    source: EditorCommandSource,
    menuContext?: ExtensionCommandMenuContext,
  ) => readonly EditorCommandEntry[];

  /** All registered commands (ordered). */
  commands: readonly EditorCommandEntry[];
}

/**
 * Build the shared EditorCommandRegistry from extension commands in the
 * resolved runtime config and the internal media command descriptors.
 *
 * The returned registry is stable across renders as long as the resolved
 * extension commands array identity is stable.
 *
 * Safe: returns an empty stub when called outside a DataProviderWrapper.
 */
export function useEditorCommandRegistry(): UseEditorCommandRegistryResult {
  const runtime = useVideoEditorRuntimeSafe();

  // When runtime is unavailable (outside provider), return empty stub.
  // Must call ALL hooks unconditionally, even when runtime is null.
  const dataSlice = useTimelineDataSliceSafe();
  const opsSlice = useTimelineOpsSliceSafe();
  const runner = useMemo(() => getSharedRunner(), []);

  if (!runtime || !dataSlice) {
    return useMemo(() => createEmptyRegistryResult(), []);
  }

  const extensionCommands = runtime.extensions.commands;

  const registry = useMemo(
    () =>
      createEditorCommandRegistry({
        extensionCommands,
        runner,
      }),
    [extensionCommands, runner],
  );

  const buildContext = useCallback(
    (overrides?: Partial<EditorCommandContext>): EditorCommandContext => {
      const currentData = dataSlice.dataRef.current ?? dataSlice.data;
      return {
        data: currentData!,
        timelineId: runtime.timelineId,
        userId: runtime.userId ?? 'anonymous',
        timelineName: runtime.timelineName ?? null,
        selectedClipIds: [...dataSlice.selectedClipIds],
        source: 'palette',
        ...overrides,
      };
    },
    [
      dataSlice.dataRef,
      dataSlice.data,
      dataSlice.selectedClipIds,
      runtime.timelineId,
      runtime.userId,
      runtime.timelineName,
    ],
  );

  const execute = useCallback(
    (id: string, context: EditorCommandContext): EditorCommandResult | null => {
      return registry.executeCommand(id, context);
    },
    [registry],
  );

  const queryCommands = useCallback(
    (
      source: EditorCommandSource,
      menuContext?: ExtensionCommandMenuContext,
    ): readonly EditorCommandEntry[] => {
      const context = buildContext({ source, menuContext });
      return registry.queryCommands(context);
    },
    [registry, buildContext],
  );

  return {
    registry,
    buildContext,
    execute,
    queryCommands,
    commands: registry.commands,
  };
}
