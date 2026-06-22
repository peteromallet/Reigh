// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClipMeta } from '@/tools/video-editor/lib/timeline-data';
import type { TimelineAction } from '@/tools/video-editor/types/timeline-canvas';

const mocks = vi.hoisted(() => ({
  useWaveformData: vi.fn(),
}));

vi.mock('@/tools/video-editor/hooks/useWaveformData', () => ({
  useWaveformData: mocks.useWaveformData,
}));

import { ClipAction } from './ClipAction';

function buildProps(overrides: Partial<ComponentProps<typeof ClipAction>> = {}) {
  const action: TimelineAction = {
    id: 'clip-1',
    start: 1,
    end: 3,
    effectId: 'effect-1',
  };
  const clipMeta: ClipMeta = {
    asset: 'asset-1',
    track: 'V1',
    clipType: 'media',
  };

  return {
    action,
    clipMeta,
    isSelected: true,
    isPrimary: true,
    selectedClipIds: ['clip-1', 'clip-2'],
    audioSrc: undefined,
    clipWidth: 90,
    onSelect: vi.fn(),
    onSplitHere: vi.fn(),
    onSplitClipsAtPlayhead: vi.fn(),
    onDeleteClip: vi.fn(),
    onDeleteClips: vi.fn(),
    onToggleMuteClips: vi.fn(),
    canCreateShotFromSelection: true,
    existingShots: [],
    onCreateShotFromSelection: vi.fn(),
    onGenerateVideoFromSelection: vi.fn(),
    onNavigateToShot: vi.fn(),
    onOpenGenerateVideo: vi.fn(),
    isCreatingShot: false,
    ...overrides,
  };
}

function getContextMenu() {
  return document.body.querySelector('div.fixed.z-50');
}

describe('ClipAction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.useWaveformData.mockReset();
  });

  const mockUseWaveformData = (
    implementation: (src: string | undefined) => { waveform: number[] | null; loading: boolean } = (src) => ({
      waveform: src ? [0.25, 0.75, 0.5] : null,
      loading: false,
    }),
  ) => {
    mocks.useWaveformData.mockImplementation(implementation);
  };

  it('adds create-shot actions without disturbing existing batch actions', () => {
    mockUseWaveformData();
    const props = buildProps();
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    expect(screen.getByText('Mute/Unmute 2 clips')).toBeInTheDocument();
    expect(screen.getByText('Split 2 clips at playhead')).toBeInTheDocument();
    expect(screen.getByText('Create Shot')).toBeInTheDocument();
    expect(screen.getByText('Generate Video')).toBeInTheDocument();
    expect(screen.getByText('Delete 2 clips')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Create Shot'));

    expect(props.onCreateShotFromSelection).toHaveBeenCalledTimes(1);
  });

  it('shows create animation sequence for single and multi-clip context menus', () => {
    mockUseWaveformData();
    const onOpenSequenceCreator = vi.fn();
    const props = buildProps({ onOpenSequenceCreator });
    const { container, rerender } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);
    fireEvent.click(screen.getByText('Create animation sequence'));

    expect(onOpenSequenceCreator).toHaveBeenCalledTimes(1);

    rerender(<ClipAction {...props} selectedClipIds={['clip-1']} />);
    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    expect(screen.getByText('Create animation sequence')).toBeInTheDocument();
  });

  it('hides create-shot actions when the selection is not eligible', () => {
    mockUseWaveformData();
    const props = buildProps({
      canCreateShotFromSelection: false,
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    expect(screen.queryByText('Create Shot')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate Video')).not.toBeInTheDocument();
    expect(screen.getByText('Mute/Unmute 2 clips')).toBeInTheDocument();
    expect(screen.getByText('Delete 2 clips')).toBeInTheDocument();
  });

  it('selects an unselected clip before opening its context menu', () => {
    mockUseWaveformData();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    const props = buildProps({
      isSelected: false,
      selectedClipIds: [],
      onDeleteClip: vi.fn(),
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    expect(props.onSelect).toHaveBeenCalledWith('clip-1', 'V1');
    expect(screen.getByText('Delete Clip')).toBeInTheDocument();

    window.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('shows a visible overflow trigger for touch layouts and opens the menu from it', () => {
    mockUseWaveformData();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    const props = buildProps({
      isSelected: false,
      selectedClipIds: [],
      showOverflowMenu: true,
      onDeleteClip: vi.fn(),
    });
    render(<ClipAction {...props} />);

    fireEvent.click(screen.getByLabelText('Open clip actions'));

    expect(props.onSelect).toHaveBeenCalledWith('clip-1', 'V1');
    expect(screen.getByText('Delete Clip')).toBeInTheDocument();

    window.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('selects the clip when the outer button receives Enter or Space', () => {
    mockUseWaveformData();
    const props = buildProps({
      isSelected: false,
      selectedClipIds: [],
    });
    const { container } = render(<ClipAction {...props} />);
    const clipButton = container.querySelector('[data-clip-id="clip-1"]') as HTMLElement;

    fireEvent.keyDown(clipButton, { key: 'Enter' });
    fireEvent.keyDown(clipButton, { key: ' ' });

    expect(props.onSelect).toHaveBeenNthCalledWith(1, 'clip-1', 'V1');
    expect(props.onSelect).toHaveBeenNthCalledWith(2, 'clip-1', 'V1');
  });

  it('labels the visible overflow trigger for multi-clip touch selections', () => {
    mockUseWaveformData();
    const props = buildProps({
      showOverflowMenu: true,
    });
    render(<ClipAction {...props} />);

    const trigger = screen.getByLabelText('Open actions for 2 selected clips');

    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('role', 'button');
  });

  it('shows existing shots and updates the menu from live props while it is open', () => {
    mockUseWaveformData();
    const existingShot = { id: 'shot-9', name: 'Shot 9' };
    const props = buildProps({
      existingShots: [existingShot],
    });
    const { container, rerender } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    expect(screen.getByText('Shot 9')).toBeInTheDocument();
    expect(screen.getByTitle('Jump to shot')).toBeInTheDocument();
    expect(screen.getByTitle('Generate Video')).toBeInTheDocument();
    expect(screen.getByText('Create Shot')).toBeInTheDocument();

    rerender(<ClipAction {...props} existingShots={[]} />);

    expect(screen.queryByText('Shot 9')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Jump to shot')).not.toBeInTheDocument();
  });

  it('shows a duplicate action for generation-backed clips and calls it with the clip id', () => {
    mockUseWaveformData();
    const props = buildProps({
      selectedClipIds: ['clip-1'],
      isGenerationAsset: true,
      onDuplicateGeneration: vi.fn(),
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);
    fireEvent.click(screen.getByText('Duplicate generation'));

    expect(props.onDuplicateGeneration).toHaveBeenCalledWith('clip-1');
  });

  it('does not open a context menu for pinned-shot-group clips when no asset-state actions are available', () => {
    mockUseWaveformData();
    const props = buildProps({
      isInPinnedShotGroup: true,
      selectedClipIds: ['clip-1'],
      onSplitHere: vi.fn(),
      onDeleteClip: vi.fn(),
      onDeleteClips: vi.fn(),
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    expect(getContextMenu()).toBeNull();
    expect(screen.queryByText('Split Here')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Clip')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Shot')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate Video')).not.toBeInTheDocument();
  });

  it('shows overhang actions for pinned-shot-group clips when a frozen tail is present', () => {
    mockUseWaveformData();
    const props = buildProps({
      isInPinnedShotGroup: true,
      selectedClipIds: ['clip-1'],
      overhangDurationSeconds: 2,
      overhangEndFraction: 0.6,
      onTrimToMediaEnd: vi.fn(),
      onConvertOverhangToHold: vi.fn(),
      onDeleteClip: vi.fn(),
      onDeleteClips: vi.fn(),
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    expect(getContextMenu()).not.toBeNull();
    expect(screen.getByText('Trim to media end')).toBeInTheDocument();
    expect(screen.getByText('Hold last frame')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Trim to media end'));

    expect(props.onTrimToMediaEnd).toHaveBeenCalledWith('clip-1');
  });

  it('shows only asset-state actions for pinned-shot-group clips when a stale reminder is available', () => {
    mockUseWaveformData();
    const props = buildProps({
      isInPinnedShotGroup: true,
      selectedClipIds: ['clip-1'],
      existingShots: [{ id: 'shot-9', name: 'Shot 9' }],
      isVariantStale: true,
      isGenerationAsset: true,
      onUpdateVariant: vi.fn(),
      onDismissStale: vi.fn(),
      onDeleteClip: vi.fn(),
      onDeleteClips: vi.fn(),
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    expect(getContextMenu()).not.toBeNull();
    expect(screen.getByText('Update to current variant')).toBeInTheDocument();
    expect(screen.getByText('Dismiss reminder')).toBeInTheDocument();
    expect(screen.queryByText('Split Here')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Clip')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Shot')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate Video')).not.toBeInTheDocument();
    expect(screen.queryByText('Shot 9')).not.toBeInTheDocument();
  });

  it('does not render resize handles for pinned-shot-group clips', () => {
    mockUseWaveformData();
    const props = buildProps({
      isInPinnedShotGroup: true,
      selectedClipIds: ['clip-1'],
    });
    const { container } = render(<ClipAction {...props} />);

    expect(container.querySelector('.cursor-ew-resize')).toBeNull();
  });

  it('does not open the stale badge menu for pinned-shot-group clips when no asset-state actions are available', () => {
    mockUseWaveformData();
    const props = buildProps({
      isInPinnedShotGroup: true,
      selectedClipIds: ['clip-1'],
      isVariantStale: true,
      onDismissStale: undefined,
      onUpdateVariant: undefined,
      onDeleteClip: vi.fn(),
      onDeleteClips: vi.fn(),
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.click(container.querySelector('[title="Variant outdated"]') as HTMLElement);

    expect(getContextMenu()).toBeNull();
    expect(screen.queryByText('Dismiss reminder')).not.toBeInTheDocument();
    expect(screen.queryByText('Update to current variant')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Clip')).not.toBeInTheDocument();
  });

  it('only renders the waveform overlay when audioSrc is truthy', () => {
    mockUseWaveformData();

    const { container, rerender } = render(<ClipAction {...buildProps()} />);
    const getWaveformSvg = () => container.querySelector('div[aria-hidden="true"] svg');

    expect(getWaveformSvg()).toBeNull();
    expect(mocks.useWaveformData).toHaveBeenCalledWith(undefined, expect.objectContaining({
      from: undefined,
      to: undefined,
      speed: undefined,
      numBuckets: 30,
    }));

    rerender(<ClipAction {...buildProps({ audioSrc: 'https://example.com/audio.wav' })} />);

    expect(getWaveformSvg()).not.toBeNull();
    expect(mocks.useWaveformData).toHaveBeenLastCalledWith('https://example.com/audio.wav', expect.objectContaining({
      numBuckets: 30,
    }));
  });

  it('renders a striped overlay for frozen tail overhang', () => {
    mockUseWaveformData();
    const { container } = render(<ClipAction {...buildProps({
      overhangDurationSeconds: 2,
      overhangEndFraction: 0.6,
    })} />);

    const overlay = container.querySelector('[data-overhang-overlay="true"]');

    expect(overlay).not.toBeNull();
    expect(overlay).toHaveAttribute('title', 'Media ends 2.00s before the clip ends');
  });

  it('re-renders when audioSrc or clipWidth changes so the memo comparator keeps waveform props fresh', () => {
    mockUseWaveformData();

    const props = buildProps({ audioSrc: 'https://example.com/a.wav', clipWidth: 90 });
    const { rerender } = render(<ClipAction {...props} />);

    expect(mocks.useWaveformData).toHaveBeenCalledTimes(1);

    rerender(<ClipAction {...props} />);
    expect(mocks.useWaveformData).toHaveBeenCalledTimes(1);

    rerender(<ClipAction {...props} audioSrc="https://example.com/b.wav" />);
    expect(mocks.useWaveformData).toHaveBeenCalledTimes(2);

    rerender(<ClipAction {...props} audioSrc="https://example.com/b.wav" clipWidth={120} />);
    expect(mocks.useWaveformData).toHaveBeenCalledTimes(3);
    expect(mocks.useWaveformData).toHaveBeenLastCalledWith('https://example.com/b.wav', expect.objectContaining({
      numBuckets: 40,
    }));
  });
});

// ---------------------------------------------------------------------------
// Extension commands in context menu
// ---------------------------------------------------------------------------

import type { EditorCommandEntry } from '@/tools/video-editor/commands/editorCommandRegistry.ts';

function buildExtensionEntry(overrides: Partial<EditorCommandEntry> = {}): EditorCommandEntry {
  return {
    id: 'com.example.clip.normalize-speed',
    title: 'Normalize Speed',
    description: 'Adjust clip speed to match timeline frame rate.',
    isProposal: true,
    source: 'extension',
    extensionId: 'com.example.clip',
    menu: { context: 'clip-context', group: 'clip-ops', order: 100 },
    ...overrides,
  };
}

describe('ClipAction extension commands', () => {
  const mockWaveform = () => {
    mocks.useWaveformData.mockImplementation((src: string | undefined) => ({
      waveform: src ? [0.25, 0.75, 0.5] : null,
      loading: false,
    }));
  };

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.useWaveformData.mockReset();
  });

  it('shows matching extension commands in the clip context menu', () => {
    mockWaveform();
    const onExecuteExtensionCommand = vi.fn();
    const extensionCommands: EditorCommandEntry[] = [
      buildExtensionEntry({ id: 'com.example.clip.normalize-speed', title: 'Normalize Speed' }),
      buildExtensionEntry({ id: 'com.example.clip.fade-marker', title: 'Add Fade Marker', description: 'Queue a command proposal for a fade marker at the clip boundary.' }),
    ];

    const props = buildProps({
      selectedClipIds: ['clip-1'],
      extensionCommands,
      onExecuteExtensionCommand,
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    // Both extension commands should appear
    expect(screen.getByText('Normalize Speed')).toBeInTheDocument();
    expect(screen.getByText('Add Fade Marker')).toBeInTheDocument();
    const commandRows = screen.getAllByTestId('clip-context-command-entry');
    expect(commandRows.map((row) => row.getAttribute('data-command-id'))).toEqual([
      'com.example.clip.normalize-speed',
      'com.example.clip.fade-marker',
    ]);
    // Descriptions should be visible
    expect(screen.getByText('Queue a command proposal for a fade marker at the clip boundary.')).toBeInTheDocument();
  });

  it('calls onExecuteExtensionCommand with correct command ID when extension command is clicked', () => {
    mockWaveform();
    const onExecuteExtensionCommand = vi.fn();
    const extensionCommands: EditorCommandEntry[] = [
      buildExtensionEntry({ id: 'com.example.clip.normalize-speed', title: 'Normalize Speed' }),
    ];

    const props = buildProps({
      selectedClipIds: ['clip-1'],
      extensionCommands,
      onExecuteExtensionCommand,
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    fireEvent.click(screen.getByText('Normalize Speed'));

    expect(onExecuteExtensionCommand).toHaveBeenCalledTimes(1);
    expect(onExecuteExtensionCommand).toHaveBeenCalledWith('com.example.clip.normalize-speed');
  });

  it('does not show extension commands when none are provided', () => {
    mockWaveform();

    const props = buildProps({
      selectedClipIds: ['clip-1'],
      extensionCommands: [],
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    // The Puzzle icon (used for extension commands) should not be present
    // when no extension commands are provided
    expect(screen.queryByText('Normalize Speed')).not.toBeInTheDocument();
  });

  it('does not show extension commands when extensionCommands is undefined', () => {
    mockWaveform();

    const props = buildProps({
      selectedClipIds: ['clip-1'],
      extensionCommands: undefined,
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    // Extension commands should not appear
    expect(screen.queryByText('Normalize Speed')).not.toBeInTheDocument();
  });

  it('closes context menu after executing an extension command', () => {
    mockWaveform();
    const onExecuteExtensionCommand = vi.fn();
    const extensionCommands: EditorCommandEntry[] = [
      buildExtensionEntry({ id: 'com.example.clip.reverse', title: 'Reverse Clip' }),
    ];

    const props = buildProps({
      selectedClipIds: ['clip-1'],
      extensionCommands,
      onExecuteExtensionCommand,
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    expect(screen.getByText('Reverse Clip')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Reverse Clip'));

    // The menu should be closed after executing
    expect(onExecuteExtensionCommand).toHaveBeenCalledTimes(1);
    // After closeMenu, the portal should be removed
    expect(getContextMenu()).toBeNull();
  });

  it('preserves existing menu items alongside extension commands', () => {
    mockWaveform();
    const onExecuteExtensionCommand = vi.fn();
    const extensionCommands: EditorCommandEntry[] = [
      buildExtensionEntry({ id: 'com.example.clip.normalize-speed', title: 'Normalize Speed' }),
    ];

    const props = buildProps({
      selectedClipIds: ['clip-1'],
      onSplitHere: vi.fn(),
      onDeleteClip: vi.fn(),
      extensionCommands,
      onExecuteExtensionCommand,
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    // Existing menu items still appear
    expect(screen.getByText('Split Here')).toBeInTheDocument();
    expect(screen.getByText('Delete Clip')).toBeInTheDocument();
    // Extension command also appears
    expect(screen.getByText('Normalize Speed')).toBeInTheDocument();
  });

  it('shows extension commands in batch selection context menu', () => {
    mockWaveform();
    const onExecuteExtensionCommand = vi.fn();
    const extensionCommands: EditorCommandEntry[] = [
      buildExtensionEntry({ id: 'com.example.clip.normalize-speed', title: 'Normalize Speed' }),
    ];

    const props = buildProps({
      isSelected: true,
      selectedClipIds: ['clip-1', 'clip-2', 'clip-3'],
      onToggleMuteClips: vi.fn(),
      onSplitClipsAtPlayhead: vi.fn(),
      onDeleteClips: vi.fn(),
      extensionCommands,
      onExecuteExtensionCommand,
    });
    const { container } = render(<ClipAction {...props} />);

    fireEvent.contextMenu(container.querySelector('[data-clip-id="clip-1"]') as HTMLElement);

    // Batch-specific items
    expect(screen.getByText('Mute/Unmute 3 clips')).toBeInTheDocument();
    expect(screen.getByText('Split 3 clips at playhead')).toBeInTheDocument();
    expect(screen.getByText('Delete 3 clips')).toBeInTheDocument();
    // Extension command also appears
    expect(screen.getByText('Normalize Speed')).toBeInTheDocument();
  });
});
