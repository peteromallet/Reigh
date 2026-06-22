/**
 * @publicContract
 * Shared editor command registry that combines internal TimelineCommands
 * with extension command contributions into a single query/execute surface.
 *
 * Consumed by palette, context menu, keybinding dispatch, and agent paths.
 * Internal direct UI paths (addClip, updateClip, etc.) remain untouched —
 * this registry only wraps TimelineCommand-based operations.
 */

import type { TimelineData } from '@/tools/video-editor/lib/timeline-data.ts';
import type {
  ExtensionCommandContribution,
  ExtensionCommandMenuContext,
} from '@/tools/video-editor/runtime/extensionManifest.ts';
import { createProposalFromInput } from './proposals.ts';
import { MEDIA_COMMAND_DESCRIPTORS } from './media.ts';
import type {
  JsonObject,
  TimelineCommand,
  TimelineCommandDescriptor,
  TimelineCommandInput,
  TimelineCommandRunner,
  TimelineProposal,
} from './types.ts';

// ---------------------------------------------------------------------------
// EditorCommandContext — serializable execution context
// ---------------------------------------------------------------------------

export interface EditorCommandContext {
  /** Timeline data snapshot at invocation time. */
  data: TimelineData;
  /** Timeline identifier. */
  timelineId: string;
  /** Current user identifier. */
  userId: string;
  /** Optional human-readable timeline name. */
  timelineName?: string | null;
  /** Selected clip IDs at invocation time. */
  selectedClipIds: readonly string[];
  /** Invocation source (palette, context-menu, keybinding, agent). */
  source: EditorCommandSource;
  /** For context-menu invocations, the menu context being invoked. */
  menuContext?: ExtensionCommandMenuContext;
  /** For clip-context invocations, the ID of the clicked clip. */
  clickedClipId?: string;
  /** For track-context invocations, the ID of the clicked track. */
  clickedTrackId?: string;
  /** Arbitrary JSON metadata attached by the caller. */
  metadata?: JsonObject;
}

export type EditorCommandSource =
  | 'palette'
  | 'context-menu'
  | 'keybinding'
  | 'agent';

// ---------------------------------------------------------------------------
// EditorCommandEntry — registered command visible to UI surfaces
// ---------------------------------------------------------------------------

export interface EditorCommandEntry {
  /** Fully qualified command ID. Internal commands use their type; extension commands are namespaced. */
  id: string;
  /** Human-readable label for the command palette and context menus. */
  title: string;
  /** Optional prose description shown in the command palette. */
  description?: string;
  /** Whether this command requires proposal review before committing. */
  isProposal: boolean;
  /** Optional default keybinding. */
  keybinding?: EditorCommandKeybinding;
  /** Optional context menu configuration. */
  menu?: EditorCommandMenu;
  /** Command origin. */
  source: EditorCommandEntrySource;
  /** Extension manifest ID for extension commands; undefined for internal. */
  extensionId?: string;
}

export interface EditorCommandKeybinding {
  key: string;
  mac?: string;
}

export interface EditorCommandMenu {
  context: ExtensionCommandMenuContext;
  group?: string;
  order?: number;
}

export type EditorCommandEntrySource = 'internal' | 'extension';

// ---------------------------------------------------------------------------
// EditorCommandResult — unified execution result
// ---------------------------------------------------------------------------

export type EditorCommandResult =
  | EditorCommandDirectResult
  | EditorCommandProposalResult;

export interface EditorCommandDirectResult {
  kind: 'direct';
  /** The new timeline data after applying the command. */
  nextData: TimelineData;
  /** Human-readable summary of what changed. */
  summary?: string;
}

export interface EditorCommandProposalResult {
  kind: 'proposal';
  /** The proposal that must be reviewed before committing. */
  proposal: TimelineProposal;
}

// ---------------------------------------------------------------------------
// EditorCommandExecutor — function that executes a command given context
// ---------------------------------------------------------------------------

export type EditorCommandExecutor = (
  context: EditorCommandContext,
) => EditorCommandResult | null;

// ---------------------------------------------------------------------------
// EditorCommandRegistry — shared command query and execute surface
// ---------------------------------------------------------------------------

export interface EditorCommandRegistry {
  /** All registered commands (ordered by registration). */
  readonly commands: readonly EditorCommandEntry[];

  /**
   * Query commands matching the given context.
   *
   * When `source` is `'context-menu'`, only commands whose `menu.context`
   * matches `context.menuContext` are returned.  Commands without a `menu`
   * definition are excluded from context-menu queries.
   *
   * For all other sources, all commands are returned (no context filtering).
   * Results are sorted by `menu.order` (default 0), then by insertion order.
   */
  queryCommands(context: EditorCommandContext): readonly EditorCommandEntry[];

  /**
   * Execute a command by its fully qualified ID.
   *
   * - Internal commands: creates a TimelineCommand with the command's type
   *   and runs it through `runner.apply`, returning a direct result.
   * - Extension commands with `isProposal: true`: creates a TimelineCommand
   *   and runs it through `runner.dryRun`, returning a proposal result.
   * - Extension commands with `isProposal: false`: delegates to the
   *   registered executor (if any), otherwise returns null.
   *
   * Returns null if the command ID is not found, or if an extension command
   * lacks a registered executor.
   */
  executeCommand(
    id: string,
    context: EditorCommandContext,
  ): EditorCommandResult | null;

  /**
   * Look up a command entry by ID.
   * Returns undefined if not found.
   */
  getCommand(id: string): EditorCommandEntry | undefined;

  /**
   * Register an executor for an extension command.
   *
   * Replaces any previously registered executor for the same command ID.
   * Callers (extension loader, agent harness) should register their
   * executors before the command is invoked from UI surfaces.
   */
  registerExecutor(id: string, executor: EditorCommandExecutor): void;

  /**
   * Remove a registered executor.
   * No-op if the command ID has no registered executor.
   */
  unregisterExecutor(id: string): void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const INTERNAL_COMMAND_ENTRIES: readonly EditorCommandEntry[] = [
  {
    id: 'add-media',
    title: 'Add Media',
    description: 'Add a provisioned media asset to a timeline track.',
    isProposal: false,
    source: 'internal',
  },
  {
    id: 'swap',
    title: 'Swap Media',
    description: 'Swap a clip\'s media asset.',
    isProposal: false,
    source: 'internal',
  },
] as const;

/** Map of internal command type → TimelineCommandDescriptor. */
const INTERNAL_DESCRIPTOR_MAP = new Map<string, TimelineCommandDescriptor>(
  MEDIA_COMMAND_DESCRIPTORS.map((d) => [d.type, d]),
);

/**
 * Build a TimelineCommandInput from an extension command contribution
 * and the execution context.
 *
 * Extension commands that carry a `proposal` flag produce a command whose
 * type is the namespaced command ID.  The payload includes the context
 * metadata so the extension executor can reconstruct the operation.
 *
 * Commands without `proposal` are expected to have a registered executor
 * that handles the full execution (including payload construction).
 */
function buildExtensionTimelineCommandInput(
  entry: EditorCommandEntry,
  context: EditorCommandContext,
): TimelineCommandInput {
  return {
    type: entry.id,
    payload: {
      commandId: entry.id,
      extensionId: entry.extensionId,
      timelineId: context.timelineId,
      selectedClipIds: [...context.selectedClipIds],
      clickedClipId: context.clickedClipId ?? null,
      clickedTrackId: context.clickedTrackId ?? null,
      source: context.source,
      menuContext: context.menuContext ?? null,
    },
    metadata: context.metadata,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const EMPTY_COMMANDS: readonly EditorCommandEntry[] = Object.freeze([]);

export interface CreateEditorCommandRegistryOptions {
  /** Extension command contributions from the resolved runtime config. */
  extensionCommands?: readonly ExtensionCommandContribution[];
  /** Timeline command runner built from internal descriptors. */
  runner: TimelineCommandRunner;
  /** Optional initial executor map for extension commands. */
  executors?: Record<string, EditorCommandExecutor>;
}

export function createEditorCommandRegistry(
  options: CreateEditorCommandRegistryOptions,
): EditorCommandRegistry {
  const { extensionCommands = [], runner, executors: initialExecutors = {} } = options;

  // Build the unified command list: internal entries first, then extension entries.
  const extensionEntries: EditorCommandEntry[] = extensionCommands.map((cmd) => ({
    id: cmd.id,
    title: cmd.title,
    description: cmd.description,
    isProposal: cmd.proposal === true,
    keybinding: cmd.keybinding
      ? { key: cmd.keybinding.key, mac: cmd.keybinding.mac }
      : undefined,
    menu: cmd.menu
      ? {
          context: cmd.menu.context,
          group: cmd.menu.group,
          order: cmd.menu.order,
        }
      : undefined,
    source: 'extension' as const,
    extensionId: cmd.id.includes('.') ? cmd.id.split('.')[0] : undefined,
  }));

  const allCommands: EditorCommandEntry[] = [
    ...INTERNAL_COMMAND_ENTRIES,
    ...extensionEntries,
  ];

  // Build lookup maps.
  const commandMap = new Map<string, EditorCommandEntry>();
  for (const entry of allCommands) {
    // First-wins: skip duplicates (should already be handled by mergeCommands in extensionSurface).
    if (!commandMap.has(entry.id)) {
      commandMap.set(entry.id, entry);
    }
  }

  // Executor map: extension commands only.
  const executorMap = new Map<string, EditorCommandExecutor>(Object.entries(initialExecutors));

  // -----------------------------------------------------------------------
  // queryCommands
  // -----------------------------------------------------------------------

  function queryCommands(context: EditorCommandContext): readonly EditorCommandEntry[] {
    if (allCommands.length === 0) {
      return EMPTY_COMMANDS;
    }

    let candidates: EditorCommandEntry[];

    if (context.source === 'context-menu') {
      // Only commands that have a menu definition matching the invocation context.
      const targetContext = context.menuContext;
      candidates = allCommands.filter((entry) => {
        if (!entry.menu) {
          return false;
        }
        if (targetContext && entry.menu.context !== targetContext) {
          return false;
        }
        return true;
      });
    } else {
      // Palette, keybinding, agent: all commands are eligible.
      candidates = [...allCommands];
    }

    // Sort by menu.order (default 0), then preserve insertion order for equal orders.
    // Array.prototype.sort is stable in all supported engines (V8 TimSort).
    return candidates.sort((a, b) => {
      const orderA = a.menu?.order ?? 0;
      const orderB = b.menu?.order ?? 0;
      return orderA - orderB;
    });
  }

  // -----------------------------------------------------------------------
  // executeCommand
  // -----------------------------------------------------------------------

  function executeCommand(
    id: string,
    context: EditorCommandContext,
  ): EditorCommandResult | null {
    const entry = commandMap.get(id);
    if (!entry) {
      return null;
    }

    if (entry.source === 'internal') {
      return executeInternalCommand(entry, context);
    }

    return executeExtensionCommand(entry, context);
  }

  function executeInternalCommand(
    entry: EditorCommandEntry,
    context: EditorCommandContext,
  ): EditorCommandResult | null {
    // Internal commands always run through the existing runner's apply path.
    // The caller is responsible for constructing the correct payload before
    // invoking — this is the "preserved direct internal UI path" contract.
    // Here we create a minimal proxy command; actual payload is set by the
    // UI surface (palette/context menu) before calling executeCommand.
    const input: TimelineCommandInput = {
      type: entry.id,
      payload: {
        commandId: entry.id,
        timelineId: context.timelineId,
        selectedClipIds: [...context.selectedClipIds],
        clickedClipId: context.clickedClipId ?? null,
        clickedTrackId: context.clickedTrackId ?? null,
      },
      metadata: context.metadata,
    };

    const result = runner.apply(context.data, input);

    if (result.status === 'rejected') {
      return null;
    }

    return {
      kind: 'direct',
      nextData: result.nextData,
      summary: result.commandResults[0]?.summary,
    };
  }

  function executeExtensionCommand(
    entry: EditorCommandEntry,
    context: EditorCommandContext,
  ): EditorCommandResult | null {
    if (entry.isProposal) {
      // Proposal commands: dry-run through the runner for preview.
      // The extension must have registered the command type as a descriptor,
      // or the runner will reject it as unknown_command.
      const input = buildExtensionTimelineCommandInput(entry, context);
      const proposal = createProposalFromInput(
        context.data,
        input,
        runner,
        {
          extensionId: entry.extensionId,
          commandId: entry.id,
          source: context.source,
        },
      );

      if (!proposal) {
        return null;
      }

      return {
        kind: 'proposal',
        proposal,
      };
    }

    // Non-proposal extension commands: delegate to registered executor.
    const executor = executorMap.get(entry.id);
    if (!executor) {
      return null;
    }

    return executor(context);
  }

  // -----------------------------------------------------------------------
  // getCommand / registerExecutor / unregisterExecutor
  // -----------------------------------------------------------------------

  function getCommand(id: string): EditorCommandEntry | undefined {
    return commandMap.get(id);
  }

  function registerExecutor(id: string, executor: EditorCommandExecutor): void {
    executorMap.set(id, executor);
  }

  function unregisterExecutor(id: string): void {
    executorMap.delete(id);
  }

  return {
    commands: allCommands,
    queryCommands,
    executeCommand,
    getCommand,
    registerExecutor,
    unregisterExecutor,
  };
}
