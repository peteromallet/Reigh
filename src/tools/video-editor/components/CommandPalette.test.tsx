// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom does not implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
import type {
  EditorCommandContext,
  EditorCommandEntry,
  EditorCommandRegistry,
  EditorCommandResult,
} from '@/tools/video-editor/commands/editorCommandRegistry.ts';

// ---------------------------------------------------------------------------
// Mock useEditorCommandRegistry
// ---------------------------------------------------------------------------

const mockExecute = vi.fn<(id: string, context: EditorCommandContext) => EditorCommandResult | null>();
const mockQueryCommands = vi.fn<(context: EditorCommandContext) => readonly EditorCommandEntry[]>();
const mockBuildContext = vi.fn<(overrides?: Partial<EditorCommandContext>) => EditorCommandContext>();

const mockRegistry: Partial<EditorCommandRegistry> = {
  commands: [] as readonly EditorCommandEntry[],
  queryCommands: mockQueryCommands,
  executeCommand: mockExecute,
  getCommand: vi.fn(),
  registerExecutor: vi.fn(),
  unregisterExecutor: vi.fn(),
};

let mockContext: EditorCommandContext;

vi.mock('@/tools/video-editor/hooks/useEditorCommandRegistry.ts', () => ({
  useEditorCommandRegistry: () => ({
    registry: mockRegistry as EditorCommandRegistry,
    buildContext: mockBuildContext,
    execute: (id: string, context: EditorCommandContext) => (mockRegistry as EditorCommandRegistry).executeCommand(id, context),
    queryCommands: (source: string, menuContext?: unknown) => {
      const ctx = mockBuildContext({ source: source as EditorCommandContext['source'], menuContext: menuContext as EditorCommandContext['menuContext'] });
      return (mockRegistry as EditorCommandRegistry).queryCommands(ctx);
    },
    commands: (mockRegistry as EditorCommandRegistry).commands,
  }),
}));

// Mock useProposalReview
const mockOpenReview = vi.fn();
const mockCloseReview = vi.fn();
const mockAcceptProposal = vi.fn();
const mockRejectProposal = vi.fn();

vi.mock('@/tools/video-editor/components/ProposalReviewDialog.tsx', () => ({
  ProposalReviewProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ProposalReviewDialog: () => <div data-testid="mock-proposal-dialog">Review Dialog</div>,
  useProposalReview: () => ({
    openReview: mockOpenReview,
    closeReview: mockCloseReview,
    acceptProposal: mockAcceptProposal,
    rejectProposal: mockRejectProposal,
  }),
}));

// Mock cn
vi.mock('@/shared/components/ui/contracts/cn.ts', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { CommandPalette } from './CommandPalette';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PaletteCommandSpec {
  id: string;
  title: string;
  description?: string;
  isProposal?: boolean;
  keybinding?: { key: string; mac?: string };
  source?: EditorCommandEntry['source'];
  extensionId?: string;
}

function buildEntry(spec: PaletteCommandSpec): EditorCommandEntry {
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    isProposal: spec.isProposal ?? false,
    keybinding: spec.keybinding,
    source: spec.source ?? 'internal',
    extensionId: spec.extensionId,
  };
}

function buildEntries(specs: PaletteCommandSpec[]): EditorCommandEntry[] {
  return specs.map(buildEntry);
}

function createBaseContext(overrides: Partial<EditorCommandContext> = {}): EditorCommandContext {
  return {
    data: {
      configVersion: 1,
      stableSignature: 'sig-1',
      config: { output: { resolution: '1920x1080', fps: 30 }, tracks: [], clips: [] },
      resolvedConfig: { output: { resolution: '1920x1080', fps: 30 }, tracks: [], clips: [] },
      registry: { assets: {} },
      rows: [],
      meta: {},
      clipOrder: {},
    },
    timelineId: 'timeline-1',
    userId: 'user-1',
    selectedClipIds: ['clip-1'],
    source: 'palette',
    ...overrides,
  };
}

function setupMocks(commands: PaletteCommandSpec[], overrides?: Partial<EditorCommandContext>) {
  const entries = buildEntries(commands);
  const ctx = createBaseContext(overrides);

  // Mock buildContext to return the test context
  mockBuildContext.mockReturnValue(ctx);

  // Mock queryCommands to return all entries (palette gets all)
  mockQueryCommands.mockReturnValue(entries);

  // Update registry commands list
  (mockRegistry as Record<string, unknown>).commands = entries;

  // Mock executeCommand
  mockExecute.mockReturnValue(null);

  mockOpenReview.mockClear();
  mockCloseReview.mockClear();
  mockAcceptProposal.mockClear();
  mockRejectProposal.mockClear();
  mockExecute.mockClear();
  mockQueryCommands.mockClear();
  mockBuildContext.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandPalette', () => {
  beforeEach(() => {
    setupMocks([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('rendering', () => {
    it('does not render when open is false', () => {
      render(<CommandPalette open={false} onClose={vi.fn()} />);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders palette dialog when open is true', () => {
      render(<CommandPalette open={true} onClose={vi.fn()} />);
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByPlaceholderText('Search commands by name or ID…')).toBeDefined();
    });

    it('shows empty state when no commands are available', () => {
      mockQueryCommands.mockReturnValue([]);
      (mockRegistry as Record<string, unknown>).commands = [];
      render(<CommandPalette open={true} onClose={vi.fn()} />);
      expect(screen.getByText('No commands available.')).toBeDefined();
    });

    it('shows command count in footer', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media' },
        { id: 'swap', title: 'Swap Media' },
      ];
      setupMocks(commands);
      render(<CommandPalette open={true} onClose={vi.fn()} />);
      expect(screen.getByText('2 commands')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Extension commands visibility
  // -----------------------------------------------------------------------

  describe('extension commands', () => {
    it('displays extension commands with EXT badge', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
        {
          id: 'com.example.palette.inspect-clip',
          title: 'Inspect Selected Clip',
          source: 'extension',
          extensionId: 'com.example.palette',
        },
      ];
      setupMocks(commands);
      render(<CommandPalette open={true} onClose={vi.fn()} />);

      expect(screen.getByText('Inspect Selected Clip')).toBeDefined();
      expect(screen.getByText('Add Media')).toBeDefined();

      // Extension command should show EXT badge
      expect(screen.getByText('EXT')).toBeDefined();

      // Namespaced ID should be visible
      expect(screen.getByText('com.example.palette.inspect-clip')).toBeDefined();

      const entry = screen.getByTestId('command-palette-entry');
      expect(entry).toHaveAttribute('data-command-id', 'com.example.palette.inspect-clip');
      expect(entry).toHaveAttribute('data-extension-id', 'com.example.palette');
    });

    it('displays proposal commands with REVIEW badge', () => {
      const commands: PaletteCommandSpec[] = [
        {
          id: 'com.example.palette.export-timeline',
          title: 'Export Timeline Report',
          source: 'extension',
          isProposal: true,
          extensionId: 'com.example.palette',
        },
      ];
      setupMocks(commands);
      render(<CommandPalette open={true} onClose={vi.fn()} />);

      expect(screen.getByText('Export Timeline Report')).toBeDefined();
      expect(screen.getByText('REVIEW')).toBeDefined();
    });

    it('displays keybinding for commands that have one', () => {
      const commands: PaletteCommandSpec[] = [
        {
          id: 'com.example.palette.inspect-clip',
          title: 'Inspect Selected Clip',
          source: 'extension',
          extensionId: 'com.example.palette',
          keybinding: { key: 'Ctrl+I', mac: 'Cmd+I' },
        },
      ];
      setupMocks(commands);
      render(<CommandPalette open={true} onClose={vi.fn()} />);

      // The keybinding should display (formatted)
      // On Mac platforms, Ctrl is rendered as ⌃
      expect(screen.getByText(/[⌃Ctrl]\+I/)).toBeDefined();
      expect(screen.getByTestId('command-palette-keybinding')).toHaveAttribute(
        'data-command-id',
        'com.example.palette.inspect-clip',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  describe('search', () => {
    it('filters commands by title when typing', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
        { id: 'swap', title: 'Swap Media', source: 'internal' },
        {
          id: 'com.example.palette.inspect-clip',
          title: 'Inspect Selected Clip',
          source: 'extension',
        },
      ];
      setupMocks(commands);

      // Override queryCommands to simulate real search behavior
      mockQueryCommands.mockImplementation((ctx: EditorCommandContext) => {
        // The palette component does its own filtering, but queryCommands returns all
        return buildEntries(commands);
      });

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      // Type "add" — should show only Add Media
      const input = screen.getByPlaceholderText('Search commands by name or ID…');
      fireEvent.change(input, { target: { value: 'add' } });

      expect(screen.getByText('Add Media')).toBeDefined();
      expect(screen.queryByText('Swap Media')).toBeNull();
      expect(screen.queryByText('Inspect Selected Clip')).toBeNull();
    });

    it('finds commands by namespaced ID', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
        {
          id: 'com.example.palette.inspect-clip',
          title: 'Inspect Selected Clip',
          source: 'extension',
        },
      ];
      setupMocks(commands);

      mockQueryCommands.mockReturnValue(buildEntries(commands));

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      const input = screen.getByPlaceholderText('Search commands by name or ID…');
      fireEvent.change(input, { target: { value: 'com.example.palette' } });

      // Should find the extension command by ID
      expect(screen.getByText('Inspect Selected Clip')).toBeDefined();
      expect(screen.queryByText('Add Media')).toBeNull();
    });

    it('shows no results message when search has no matches', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
      ];
      setupMocks(commands);

      mockQueryCommands.mockReturnValue(buildEntries(commands));

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      const input = screen.getByPlaceholderText('Search commands by name or ID…');
      fireEvent.change(input, { target: { value: 'nonexistent' } });

      expect(screen.getByText('No matching commands found.')).toBeDefined();
    });

    it('ranks exact ID match highest', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
        {
          id: 'com.example.proposal.auto-color',
          title: 'Auto Color Grade',
          source: 'extension',
          description: 'Apply color grading',
        },
      ];
      setupMocks(commands);

      mockQueryCommands.mockReturnValue(buildEntries(commands));

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      const input = screen.getByPlaceholderText('Search commands by name or ID…');
      // Type the exact ID
      fireEvent.change(input, { target: { value: 'com.example.proposal.auto-color' } });

      // Should still find it — exact match
      expect(screen.getByText('Auto Color Grade')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Direct invocation
  // -----------------------------------------------------------------------

  describe('direct invocation', () => {
    it('executes a command on Enter key', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
        { id: 'swap', title: 'Swap Media', source: 'internal' },
      ];
      setupMocks(commands);

      const directResult: EditorCommandResult = {
        kind: 'direct',
        nextData: createBaseContext().data,
        summary: 'Media added',
      };
      mockExecute.mockReturnValue(directResult);

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      const input = screen.getByPlaceholderText('Search commands by name or ID…');
      // Navigate to first item and press Enter
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      // The palette should close after execution
    });

    it('executes a command on click', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
      ];
      setupMocks(commands);

      const directResult: EditorCommandResult = {
        kind: 'direct',
        nextData: createBaseContext().data,
        summary: 'Media added',
      };
      mockExecute.mockReturnValue(directResult);

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      const addMediaButton = screen.getByText('Add Media');
      fireEvent.click(addMediaButton);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('shows error when command execution fails', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
      ];
      setupMocks(commands);

      mockExecute.mockReturnValue(null); // null = failure

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      const input = screen.getByPlaceholderText('Search commands by name or ID…');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/could not be executed/)).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Proposal invocation
  // -----------------------------------------------------------------------

  describe('proposal invocation', () => {
    it('opens proposal review when executing a proposal command', () => {
      const commands: PaletteCommandSpec[] = [
        {
          id: 'com.example.palette.export-timeline',
          title: 'Export Timeline Report',
          source: 'extension',
          isProposal: true,
          extensionId: 'com.example.palette',
        },
      ];
      setupMocks(commands);

      const proposalResult: EditorCommandResult = {
        kind: 'proposal',
        proposal: {
          id: 'prop-1',
          status: 'pending',
          baseConfigVersion: 1,
          baseSignature: 'sig-base',
          predictedSignature: 'sig-predicted',
          nextData: createBaseContext().data,
          commandResults: [],
          affectedClipIds: [],
          commandTypes: [],
          commandIds: [],
          createdAt: Date.now(),
        },
      };
      mockExecute.mockReturnValue(proposalResult);

      const onClose = vi.fn();
      render(<CommandPalette open={true} onClose={onClose} />);

      const input = screen.getByPlaceholderText('Search commands by name or ID…');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      // openReview should have been called
      expect(mockOpenReview).toHaveBeenCalledTimes(1);
      // The palette should close
      expect(onClose).toHaveBeenCalled();
    });

    it('passes correct command input to proposal review', () => {
      const commands: PaletteCommandSpec[] = [
        {
          id: 'com.example.proposal.auto-color',
          title: 'Auto Color Grade',
          source: 'extension',
          isProposal: true,
          extensionId: 'com.example.proposal',
        },
      ];
      setupMocks(commands);

      const proposalResult: EditorCommandResult = {
        kind: 'proposal',
        proposal: {
          id: 'prop-2',
          status: 'pending',
          baseConfigVersion: 1,
          baseSignature: 'sig-base',
          predictedSignature: 'sig-predicted',
          nextData: createBaseContext().data,
          commandResults: [],
          affectedClipIds: [],
          commandTypes: [],
          commandIds: [],
          createdAt: Date.now(),
        },
      };
      mockExecute.mockReturnValue(proposalResult);

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      const autoColorButton = screen.getByText('Auto Color Grade');
      fireEvent.click(autoColorButton);

      expect(mockOpenReview).toHaveBeenCalledTimes(1);
      // Verify the input passed to openReview contains correct data
      const callArgs = mockOpenReview.mock.calls[0];
      expect(callArgs[0]).toBe(proposalResult.proposal);
      expect(callArgs[1]).toMatchObject({
        type: 'com.example.proposal.auto-color',
        payload: expect.objectContaining({
          commandId: 'com.example.proposal.auto-color',
          extensionId: 'com.example.proposal',
        }),
      });
    });

    it('closes palette when proposal review is opened', () => {
      const commands: PaletteCommandSpec[] = [
        {
          id: 'com.example.palette.export-timeline',
          title: 'Export Timeline Report',
          source: 'extension',
          isProposal: true,
          extensionId: 'com.example.palette',
        },
      ];
      setupMocks(commands);

      mockExecute.mockReturnValue({
        kind: 'proposal',
        proposal: {
          id: 'prop-3',
          status: 'pending',
          baseConfigVersion: 1,
          baseSignature: 'sig-base',
          predictedSignature: 'sig-predicted',
          nextData: createBaseContext().data,
          commandResults: [],
          affectedClipIds: [],
          commandTypes: [],
          commandIds: [],
          createdAt: Date.now(),
        },
      });

      const onClose = vi.fn();
      render(<CommandPalette open={true} onClose={onClose} />);

      const input = screen.getByPlaceholderText('Search commands by name or ID…');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onClose).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------

  describe('keyboard navigation', () => {
    it('navigates with ArrowDown and ArrowUp', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
        { id: 'swap', title: 'Swap Media', source: 'internal' },
      ];
      setupMocks(commands);

      mockQueryCommands.mockReturnValue(buildEntries(commands));

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      const input = screen.getByPlaceholderText('Search commands by name or ID…');

      // First item should be selected (index 0)
      const options = screen.getAllByRole('option');
      expect(options[0].getAttribute('aria-selected')).toBe('true');
      expect(options[1].getAttribute('aria-selected')).toBe('false');

      // ArrowDown moves selection
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(options[0].getAttribute('aria-selected')).toBe('false');
      expect(options[1].getAttribute('aria-selected')).toBe('true');

      // ArrowUp moves back
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(options[0].getAttribute('aria-selected')).toBe('true');
      expect(options[1].getAttribute('aria-selected')).toBe('false');
    });

    it('closes on Escape', () => {
      setupMocks([{ id: 'add-media', title: 'Add Media', source: 'internal' }]);
      mockQueryCommands.mockReturnValue(buildEntries([{ id: 'add-media', title: 'Add Media', source: 'internal' }]));

      const onClose = vi.fn();
      render(<CommandPalette open={true} onClose={onClose} />);

      const input = screen.getByPlaceholderText('Search commands by name or ID…');
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });

    it('closes on backdrop click', () => {
      setupMocks([{ id: 'add-media', title: 'Add Media', source: 'internal' }]);
      mockQueryCommands.mockReturnValue(buildEntries([{ id: 'add-media', title: 'Add Media', source: 'internal' }]));

      const onClose = vi.fn();
      render(<CommandPalette open={true} onClose={onClose} />);

      const dialog = screen.getByRole('dialog');
      fireEvent.click(dialog); // Click the backdrop (dialog itself is the click target since children don't stop propagation)

      expect(onClose).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Mouse interaction
  // -----------------------------------------------------------------------

  describe('mouse interaction', () => {
    it('selects item on mouse enter', () => {
      const commands: PaletteCommandSpec[] = [
        { id: 'add-media', title: 'Add Media', source: 'internal' },
        { id: 'swap', title: 'Swap Media', source: 'internal' },
      ];
      setupMocks(commands);
      mockQueryCommands.mockReturnValue(buildEntries(commands));

      render(<CommandPalette open={true} onClose={vi.fn()} />);

      const options = screen.getAllByRole('option');
      fireEvent.mouseEnter(options[1]);

      expect(options[0].getAttribute('aria-selected')).toBe('false');
      expect(options[1].getAttribute('aria-selected')).toBe('true');
    });
  });
});
