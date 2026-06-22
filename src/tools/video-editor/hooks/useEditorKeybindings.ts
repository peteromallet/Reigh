import { useCallback, useEffect, useMemo } from 'react';
import { isEditableTarget } from '@/tools/video-editor/lib/coordinate-utils.ts';
import type { EditorCommandEntry, EditorCommandKeybinding } from '@/tools/video-editor/commands/editorCommandRegistry.ts';
import type { EditorCommandContext } from '@/tools/video-editor/commands/editorCommandRegistry.ts';

// ---------------------------------------------------------------------------
// Keybinding normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a keyboard event into a canonical keybinding string.
 * Format: modifier+modifier+key (e.g. "ctrl+shift+a", "meta+z")
 *
 * - Modifiers are sorted alphabetically: alt, ctrl, meta, shift
 * - On Mac, meta is the Cmd key; on other platforms, ctrl is the main modifier
 * - The key portion is always lowercased
 */
export function normalizeKeybinding(event: KeyboardEvent): string {
  const modifiers: string[] = [];

  if (event.altKey) modifiers.push('alt');
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.metaKey) modifiers.push('meta');
  if (event.shiftKey) modifiers.push('shift');

  modifiers.sort();

  // Use event.key for the main key, lowercased
  const key = event.key.toLowerCase();

  // Skip standalone modifier key presses
  if (['control', 'alt', 'shift', 'meta'].includes(key)) {
    return '';
  }

  if (modifiers.length === 0) {
    return key;
  }

  return `${modifiers.join('+')}+${key}`;
}

/**
 * Normalize an EditorCommandKeybinding (from manifest) into a canonical string
 * matching what normalizeKeybinding produces from actual keyboard events.
 *
 * Platform-aware: if a `mac` variant is provided and the current platform is Mac,
 * that variant is used; otherwise the `key` string is used.
 */
export function normalizeCommandKeybinding(kb: EditorCommandKeybinding): string | null {
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
  const raw = isMac && kb.mac ? kb.mac : kb.key;

  // Parse the raw keybinding string like "Ctrl+Shift+P" or "Cmd+I"
  const parts = raw.split('+').map((p) => p.trim().toLowerCase());
  if (parts.length === 0) return null;

  const knownModifiers = new Set(['alt', 'ctrl', 'meta', 'cmd', 'shift']);
  const modifiers: string[] = [];
  let key: string | null = null;

  for (const part of parts) {
    const normalized = part === 'cmd' ? 'meta' : part;
    if (knownModifiers.has(normalized)) {
      modifiers.push(normalized);
    } else {
      // Last non-modifier part is the key
      key = normalized;
    }
  }

  if (!key) return null;

  modifiers.sort();
  if (modifiers.length === 0) return key;
  return `${modifiers.join('+')}+${key}`;
}

// ---------------------------------------------------------------------------
// Duplicate resolution
// ---------------------------------------------------------------------------

/**
 * Detect duplicate keybindings among registered entries and return the winner.
 *
 * Rules:
 * 1. Internal (built-in) commands win over extension commands.
 * 2. For conflicts among commands of the same source, the one registered first
 *    in the sorted entry list wins (stable insertion order).
 *
 * Returns a Map<normalizedShortcut, winningCommandId>.
 */
export function resolveKeybindingWinners(
  entries: readonly EditorCommandEntry[],
): Map<string, string> {
  const winners = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.keybinding) continue;

    const normalized = normalizeCommandKeybinding(entry.keybinding);
    if (!normalized) continue;

    const existing = winners.get(normalized);
    if (!existing) {
      winners.set(normalized, entry.id);
      continue;
    }

    // Conflict: internal wins over extension
    const existingEntry = entries.find((e) => e.id === existing);
    if (!existingEntry) {
      winners.set(normalized, entry.id);
      continue;
    }

    if (entry.source === 'internal' && existingEntry.source === 'extension') {
      // Internal beats extension
      winners.set(normalized, entry.id);
    }
    // else: keep existing winner (first-wins for same source, or extension can't beat internal)
  }

  return winners;
}

// ---------------------------------------------------------------------------
// Internal command keybinding entries
// ---------------------------------------------------------------------------

export interface InternalKeybindingEntry {
  /** Normalized shortcut string (e.g. "ctrl+z") */
  shortcut: string;
  /** Command ID for dispatch */
  commandId: string;
  /** Human-readable title for diagnostics */
  title: string;
  /** Source discriminator */
  source: 'internal';
}

/**
 * The built-in timeline shortcut definitions.
 * These are prioritized above extension keybindings during duplicate resolution.
 */
export const INTERNAL_KEYBINDINGS: readonly InternalKeybindingEntry[] = [
  { shortcut: 'ctrl+z', commandId: 'editor.undo', title: 'Undo', source: 'internal' },
  { shortcut: 'meta+z', commandId: 'editor.undo', title: 'Undo', source: 'internal' },
  { shortcut: 'ctrl+shift+z', commandId: 'editor.redo', title: 'Redo', source: 'internal' },
  { shortcut: 'meta+shift+z', commandId: 'editor.redo', title: 'Redo', source: 'internal' },
  { shortcut: 'ctrl+y', commandId: 'editor.redo', title: 'Redo', source: 'internal' },
  { shortcut: 'arrowleft', commandId: 'editor.seekBackward', title: 'Seek Backward', source: 'internal' },
  { shortcut: 'arrowright', commandId: 'editor.seekForward', title: 'Seek Forward', source: 'internal' },
  { shortcut: 'alt+arrowleft', commandId: 'editor.seekBackwardFrame', title: 'Seek Backward (Frame)', source: 'internal' },
  { shortcut: 'alt+arrowright', commandId: 'editor.seekForwardFrame', title: 'Seek Forward (Frame)', source: 'internal' },
  { shortcut: 'arrowup', commandId: 'editor.moveClipUp', title: 'Move Clip Up', source: 'internal' },
  { shortcut: 'arrowdown', commandId: 'editor.moveClipDown', title: 'Move Clip Down', source: 'internal' },
  { shortcut: 'ctrl+a', commandId: 'editor.selectAll', title: 'Select All Clips', source: 'internal' },
  { shortcut: 'meta+a', commandId: 'editor.selectAll', title: 'Select All Clips', source: 'internal' },
  { shortcut: ' ', commandId: 'editor.togglePlayPause', title: 'Toggle Play/Pause', source: 'internal' },
  { shortcut: 'm', commandId: 'editor.toggleMute', title: 'Toggle Mute', source: 'internal' },
  { shortcut: 's', commandId: 'editor.splitClip', title: 'Split Selected Clip', source: 'internal' },
  { shortcut: 'backspace', commandId: 'editor.deleteSelected', title: 'Delete Selected', source: 'internal' },
  { shortcut: 'delete', commandId: 'editor.deleteSelected', title: 'Delete Selected', source: 'internal' },
  { shortcut: 'escape', commandId: 'editor.clearSelection', title: 'Clear Selection', source: 'internal' },
];

// ---------------------------------------------------------------------------
// Keybinding dispatch handler
// ---------------------------------------------------------------------------

export type KeybindingDispatchHandler = (commandId: string, event: KeyboardEvent) => void;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseEditorKeybindingsOptions {
  /** Whether at least one clip is selected. */
  hasSelectedClip: boolean;
  /** Whether the selected clip can be moved to another track. */
  canMoveSelectedClipToTrack: boolean;
  /** Whether precision mode is enabled (alt+arrow seeks by frame). */
  precisionEnabled: boolean;
  /** Current timeline FPS for frame-step calculations. */
  timelineFps: number;
  /** Set of selected clip IDs at invocation time. */
  selectedClipIds: ReadonlySet<string>;

  // -- Callbacks for internal commands --

  /** Undo the last action. */
  undo: () => void;
  /** Redo the last undone action. */
  redo: () => void;
  /** Select all clips on the timeline. */
  selectAllClips: () => void;
  /** Toggle playback. */
  togglePlayPause: () => void;
  /** Seek relative in seconds. */
  seekRelative: (deltaSeconds: number) => void;
  /** Toggle mute on selected clips. */
  toggleMute: () => void;
  /** Split the selected clip at playhead. */
  splitSelectedClip: () => void;
  /** Delete selected clips. */
  deleteSelectedClip: () => void;
  /** Clear the current selection. */
  clearSelection: () => void;
  /** Move selected clips to another track. */
  moveSelectedClipsToTrack: (direction: 'up' | 'down', selectedClipIds: ReadonlySet<string>) => void;

  // -- Extension keybinding support --

  /** Command entries from the editor command registry (includes extension commands with keybindings). */
  commandEntries?: readonly EditorCommandEntry[];
  /** Build an EditorCommandContext from the current state for extension dispatch. */
  buildCommandContext?: () => EditorCommandContext;
  /** Dispatch an extension command by ID through the registry. */
  dispatchExtensionCommand?: (commandId: string, context: EditorCommandContext) => void;
}

/**
 * Centralized keyboard shortcut dispatch for the timeline editor.
 *
 * Responsibilities:
 * 1. Normalize keyboard shortcuts to a canonical format.
 * 2. Ignore events when focus is in an editable target (input/textarea/select/contenteditable).
 * 3. Build a dispatch map from internal shortcuts + extension command keybindings.
 * 4. Resolve duplicate keybindings deterministically: internal wins over extension,
 *    first-registered wins among same-source conflicts.
 * 5. Dispatch to the appropriate handler based on the normalized shortcut.
 */
export function useEditorKeybindings(options: UseEditorKeybindingsOptions) {
  const {
    hasSelectedClip,
    canMoveSelectedClipToTrack,
    precisionEnabled,
    timelineFps,
    selectedClipIds,
    undo,
    redo,
    selectAllClips,
    togglePlayPause,
    seekRelative,
    toggleMute,
    splitSelectedClip,
    deleteSelectedClip,
    clearSelection,
    moveSelectedClipsToTrack,
    commandEntries,
    buildCommandContext,
    dispatchExtensionCommand,
  } = options;

  // Build the dispatch map from internal keybindings + extension command keybindings.
  const dispatchMap = useMemo(() => {
    const map = new Map<string, { commandId: string; source: 'internal' | 'extension' }>();

    // 1. Add internal keybindings
    for (const binding of INTERNAL_KEYBINDINGS) {
      if (!map.has(binding.shortcut)) {
        map.set(binding.shortcut, { commandId: binding.commandId, source: 'internal' });
      }
    }

    // 2. Add extension command keybindings
    if (commandEntries) {
      for (const entry of commandEntries) {
        if (!entry.keybinding) continue;

        const normalized = normalizeCommandKeybinding(entry.keybinding);
        if (!normalized) continue;

        const existing = map.get(normalized);
        if (existing && existing.source === 'internal') {
          // Internal already wins — skip this extension keybinding
          continue;
        }

        if (!existing) {
          // First registration wins
          map.set(normalized, { commandId: entry.id, source: 'extension' });
        }
        // If existing is also extension, first-wins (keep existing)
      }
    }

    return map;
  }, [commandEntries]);

  // Main keydown handler
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Ignore events from editable targets
      if (isEditableTarget(event.target)) {
        return;
      }

      const normalized = normalizeKeybinding(event);
      if (!normalized) return;

      const dispatch = dispatchMap.get(normalized);
      if (!dispatch) return;

      // Dispatch internal commands
      if (dispatch.source === 'internal') {
        event.preventDefault();

        switch (dispatch.commandId) {
          case 'editor.undo':
            undo();
            return;
          case 'editor.redo':
            redo();
            return;
          case 'editor.seekBackward':
            seekRelative(-1);
            return;
          case 'editor.seekForward':
            seekRelative(1);
            return;
          case 'editor.seekBackwardFrame':
            if (precisionEnabled) {
              seekRelative(-(1 / timelineFps));
            } else {
              seekRelative(-1);
            }
            return;
          case 'editor.seekForwardFrame':
            if (precisionEnabled) {
              seekRelative(1 / timelineFps);
            } else {
              seekRelative(1);
            }
            return;
          case 'editor.moveClipUp':
            if (hasSelectedClip && canMoveSelectedClipToTrack) {
              moveSelectedClipsToTrack('up', selectedClipIds);
            }
            return;
          case 'editor.moveClipDown':
            if (hasSelectedClip && canMoveSelectedClipToTrack) {
              moveSelectedClipsToTrack('down', selectedClipIds);
            }
            return;
          case 'editor.selectAll':
            selectAllClips();
            return;
          case 'editor.togglePlayPause':
            togglePlayPause();
            return;
          case 'editor.toggleMute':
            if (hasSelectedClip) {
              toggleMute();
            }
            return;
          case 'editor.splitClip':
            if (hasSelectedClip) {
              splitSelectedClip();
            }
            return;
          case 'editor.deleteSelected':
            if (hasSelectedClip) {
              deleteSelectedClip();
            }
            return;
          case 'editor.clearSelection':
            clearSelection();
            return;
          default:
            // Unknown internal command — no-op
            return;
        }
      }

      // Dispatch extension commands
      if (dispatch.source === 'extension') {
        event.preventDefault();

        if (buildCommandContext && dispatchExtensionCommand) {
          const context = buildCommandContext();
          dispatchExtensionCommand(dispatch.commandId, context);
        }
      }
    },
    [
      hasSelectedClip,
      canMoveSelectedClipToTrack,
      precisionEnabled,
      timelineFps,
      selectedClipIds,
      undo,
      redo,
      selectAllClips,
      togglePlayPause,
      seekRelative,
      toggleMute,
      splitSelectedClip,
      deleteSelectedClip,
      clearSelection,
      moveSelectedClipsToTrack,
      dispatchMap,
      buildCommandContext,
      dispatchExtensionCommand,
    ],
  );

  // Attach/detach the global keydown listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
