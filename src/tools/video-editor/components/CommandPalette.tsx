import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { useEditorCommandRegistry } from '@/tools/video-editor/hooks/useEditorCommandRegistry.ts';
import { useProposalReview } from '@/tools/video-editor/components/ProposalReviewDialog.tsx';
import type {
  EditorCommandEntry,
  EditorCommandResult,
} from '@/tools/video-editor/commands/editorCommandRegistry.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PALETTE_SHORTCUT_DISPLAY = navigator.platform.includes('Mac')
  ? '⌘⇧P'
  : 'Ctrl+Shift+P';

const ITEM_HEIGHT = 36;
const MAX_VISIBLE_ITEMS = 10;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CommandPaletteProps {
  /** Whether the palette is currently open. */
  open: boolean;
  /** Called to close the palette. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function commandMatchScore(entry: EditorCommandEntry, query: string): number {
  const lowerQuery = query.toLowerCase().trim();
  if (lowerQuery.length === 0) return 1;

  const lowerId = entry.id.toLowerCase();
  const lowerTitle = entry.title.toLowerCase();
  const lowerDesc = (entry.description ?? '').toLowerCase();

  // Exact ID match — highest priority
  if (lowerId === lowerQuery) return 100;
  // ID starts with query
  if (lowerId.startsWith(lowerQuery)) return 90;
  // ID contains query
  if (lowerId.includes(lowerQuery)) return 80;
  // Title starts with query
  if (lowerTitle.startsWith(lowerQuery)) return 70;
  // Title contains query
  if (lowerTitle.includes(lowerQuery)) return 60;
  // Description contains query
  if (lowerDesc.includes(lowerQuery)) return 30;
  // No match
  return 0;
}

function formatKeybinding(keybinding: { key: string; mac?: string }): string {
  if (navigator.platform.includes('Mac') && keybinding.mac) {
    return keybinding.mac
      .replace(/Cmd/g, '⌘')
      .replace(/Shift/g, '⇧')
      .replace(/Alt/g, '⌥')
      .replace(/Ctrl/g, '⌃');
  }
  return keybinding.key
    .replace(/Cmd/g, '⌘')
    .replace(/Shift/g, '⇧')
    .replace(/Alt/g, '⌥')
    .replace(/Ctrl/g, '⌃');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { registry, buildContext, execute } = useEditorCommandRegistry();
  const proposalReview = useProposalReview();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Build context once for the palette source
  const paletteContext = useMemo(
    () => buildContext({ source: 'palette' }),
    [buildContext],
  );

  // Get all commands visible in the palette
  const allCommands = useMemo(
    () => registry.queryCommands(paletteContext),
    [registry, paletteContext],
  );

  // Filter and rank by query
  const filteredCommands = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return allCommands;

    const scored = allCommands
      .map((entry) => ({
        entry,
        score: commandMatchScore(entry, trimmed),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((item) => item.entry);
  }, [allCommands, query]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setExecutionError(null);
      // Focus input after a tick to allow the portal/mount to settle
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp selected index when results change
  useEffect(() => {
    if (selectedIndex >= filteredCommands.length) {
      setSelectedIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, filteredCommands.length - 1),
        );
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const entry = filteredCommands[selectedIndex];
        if (entry) {
          handleExecute(entry);
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredCommands, selectedIndex, onClose],
  );

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  const handleExecute = useCallback(
    (entry: EditorCommandEntry) => {
      setExecutionError(null);

      const result: EditorCommandResult | null = execute(entry.id, paletteContext);

      if (!result) {
        setExecutionError(`Command "${entry.id}" could not be executed.`);
        return;
      }

      if (result.kind === 'proposal') {
        // Route to proposal review
        if (proposalReview) {
          // Build a minimal command input for the proposal
          const input = {
            type: entry.id,
            payload: {
              commandId: entry.id,
              extensionId: entry.extensionId,
              timelineId: paletteContext.timelineId,
              selectedClipIds: [...paletteContext.selectedClipIds],
            },
          };
          proposalReview.openReview(
            result.proposal,
            input,
            // We need a runner — the registry's internal runner is used for dryRun
            // The proposal already contains the dryRun result, accept path will
            // re-apply via the commands facade.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            null as any,
          );
        }
        onClose();
        return;
      }

      // Direct result — close the palette (caller applies the mutation)
      onClose();
    },
    [execute, paletteContext, proposalReview, onClose],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[90000] flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        {/* Search input */}
        <div className="flex items-center border-b border-border px-4 py-3">
          <span className="mr-3 text-sm text-muted-foreground">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search commands by name or ID…"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            esc
          </kbd>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          className="max-h-[360px] overflow-y-auto p-1"
          role="listbox"
          aria-label="Command results"
        >
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {query.trim().length > 0
                ? 'No matching commands found.'
                : 'No commands available.'}
            </div>
          ) : (
            filteredCommands.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  index === selectedIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-muted',
                )}
                style={{ minHeight: ITEM_HEIGHT }}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => handleExecute(entry)}
              >
                {/* Left: title + description */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{entry.title}</span>
                    {entry.source === 'extension' && (
                      <span className="shrink-0 rounded bg-blue-500/10 px-1 py-0 text-[9px] font-medium text-blue-400">
                        EXT
                      </span>
                    )}
                    {entry.isProposal && (
                      <span className="shrink-0 rounded bg-amber-500/10 px-1 py-0 text-[9px] font-medium text-amber-400">
                        REVIEW
                      </span>
                    )}
                  </div>
                  {entry.description && (
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.description}
                    </p>
                  )}
                </div>

                {/* Right: keybinding + ID */}
                <div className="flex shrink-0 items-center gap-2">
                  {entry.keybinding && (
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      {formatKeybinding(entry.keybinding)}
                    </kbd>
                  )}
                  <span className="text-[10px] font-mono text-muted-foreground/60">
                    {entry.id}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>↑↓ Navigate</span>
            <span>↵ Execute</span>
            <span>Esc Close</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span>{allCommands.length} commands</span>
          </div>
        </div>

        {/* Error banner */}
        {executionError && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
            {executionError}
          </div>
        )}
      </div>
    </div>
  );
}

export { PALETTE_SHORTCUT_DISPLAY };
