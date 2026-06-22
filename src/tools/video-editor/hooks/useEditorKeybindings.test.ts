// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeKeybinding,
  normalizeCommandKeybinding,
  resolveKeybindingWinners,
  useEditorKeybindings,
  INTERNAL_KEYBINDINGS,
} from './useEditorKeybindings';
import type {
  EditorCommandEntry,
  EditorCommandKeybinding,
  EditorCommandContext,
} from '@/tools/video-editor/commands/editorCommandRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal KeyboardEvent-like object for normalizeKeybinding tests. */
function createKeyboardEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: '',
    code: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    location: 0,
    getModifierState: () => false,
    ...overrides,
  } as KeyboardEvent;
}

/** Create a minimal EditorCommandEntry for testing. */
function createEntry(
  overrides: Partial<EditorCommandEntry> & Pick<EditorCommandEntry, 'id' | 'source'>,
): EditorCommandEntry {
  return {
    title: overrides.id,
    isProposal: false,
    ...overrides,
  };
}

/** Create an extension command entry with keybinding. */
function extensionEntryWithKeybinding(
  id: string,
  keybinding: EditorCommandKeybinding,
  isProposal = false,
): EditorCommandEntry {
  return {
    id,
    title: id,
    isProposal,
    keybinding,
    source: 'extension',
    extensionId: id.split('.')[0],
  };
}

// ---------------------------------------------------------------------------
// normalizeKeybinding
// ---------------------------------------------------------------------------

describe('normalizeKeybinding', () => {
  it('produces canonical format with sorted modifiers', () => {
    // Sims Ctrl+Shift+A -> "alt+ctrl+shift+a" (sorted alphabetically)
    const event = createKeyboardEvent({
      key: 'a',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(normalizeKeybinding(event)).toBe('ctrl+shift+a');
  });

  it('lowercases the key portion', () => {
    const event = createKeyboardEvent({
      key: 'Z',
      ctrlKey: true,
    });
    expect(normalizeKeybinding(event)).toBe('ctrl+z');
  });

  it('includes all four modifiers sorted alphabetically', () => {
    const event = createKeyboardEvent({
      key: 'x',
      altKey: true,
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
    });
    expect(normalizeKeybinding(event)).toBe('alt+ctrl+meta+shift+x');
  });

  it('returns empty string for standalone modifier key presses', () => {
    // Ctrl alone (no non-modifier key)
    const event = createKeyboardEvent({
      key: 'Control',
      ctrlKey: true,
    });
    expect(normalizeKeybinding(event)).toBe('');
  });

  it('returns empty string for Alt key alone', () => {
    const event = createKeyboardEvent({ key: 'Alt', altKey: true });
    expect(normalizeKeybinding(event)).toBe('');
  });

  it('returns empty string for Shift key alone', () => {
    const event = createKeyboardEvent({ key: 'Shift', shiftKey: true });
    expect(normalizeKeybinding(event)).toBe('');
  });

  it('returns empty string for Meta key alone', () => {
    const event = createKeyboardEvent({ key: 'Meta', metaKey: true });
    expect(normalizeKeybinding(event)).toBe('');
  });

  it('returns just the key when no modifiers are pressed', () => {
    const event = createKeyboardEvent({ key: 'a' });
    expect(normalizeKeybinding(event)).toBe('a');
  });

  it('handles space key', () => {
    const event = createKeyboardEvent({ key: ' ' });
    expect(normalizeKeybinding(event)).toBe(' ');
  });

  it('handles arrow keys', () => {
    const event = createKeyboardEvent({ key: 'ArrowLeft' });
    expect(normalizeKeybinding(event)).toBe('arrowleft');
  });

  it('handles Meta+Cmd as meta modifier on Mac-like events', () => {
    const event = createKeyboardEvent({
      key: 's',
      metaKey: true,
    });
    expect(normalizeKeybinding(event)).toBe('meta+s');
  });
});

// ---------------------------------------------------------------------------
// normalizeCommandKeybinding (platform-aware Mod)
// ---------------------------------------------------------------------------

describe('normalizeCommandKeybinding', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');

  beforeEach(() => {
    // Reset platform property before each test
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform);
    }
  });

  it('resolves "Cmd" to "meta" on Mac', () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const kb: EditorCommandKeybinding = { key: 'Cmd+I' };
    expect(normalizeCommandKeybinding(kb)).toBe('meta+i');
  });

  it('resolves "Cmd" to "meta" on non-Mac (no mac variant provided)', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const kb: EditorCommandKeybinding = { key: 'Cmd+I' };
    // Even on non-Mac, "Cmd" is treated as "meta" since it's just a string parse
    expect(normalizeCommandKeybinding(kb)).toBe('meta+i');
  });

  it('uses mac variant on Mac when provided', () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const kb: EditorCommandKeybinding = { key: 'Ctrl+I', mac: 'Cmd+I' };
    expect(normalizeCommandKeybinding(kb)).toBe('meta+i');
  });

  it('uses key (not mac) variant on non-Mac', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const kb: EditorCommandKeybinding = { key: 'Ctrl+I', mac: 'Cmd+I' };
    expect(normalizeCommandKeybinding(kb)).toBe('ctrl+i');
  });

  it('parses modifiers with spaces around plus signs', () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const kb: EditorCommandKeybinding = { key: 'Ctrl + Shift + K' };
    expect(normalizeCommandKeybinding(kb)).toBe('ctrl+shift+k');
  });

  it('returns null for empty keybinding string', () => {
    const kb: EditorCommandKeybinding = { key: '' };
    expect(normalizeCommandKeybinding(kb)).toBeNull();
  });

  it('returns null for keybinding with only modifiers', () => {
    const kb: EditorCommandKeybinding = { key: 'Ctrl+Shift' };
    expect(normalizeCommandKeybinding(kb)).toBeNull();
  });

  it('handles single key without modifiers', () => {
    const kb: EditorCommandKeybinding = { key: 'M' };
    expect(normalizeCommandKeybinding(kb)).toBe('m');
  });
});

// ---------------------------------------------------------------------------
// resolveKeybindingWinners (duplicate winner dispatch)
// ---------------------------------------------------------------------------

describe('resolveKeybindingWinners', () => {
  it('returns empty map for empty entries', () => {
    expect(resolveKeybindingWinners([]).size).toBe(0);
  });

  it('returns empty map when no entries have keybindings', () => {
    const entries: EditorCommandEntry[] = [
      createEntry({ id: 'cmd-1', source: 'internal' }),
      createEntry({ id: 'ext.cmd-2', source: 'extension' }),
    ];
    expect(resolveKeybindingWinners(entries).size).toBe(0);
  });

  it('maps normalized shortcut to winner command ID', () => {
    const entries: EditorCommandEntry[] = [
      extensionEntryWithKeybinding('ext.cmd-a', { key: 'Ctrl+B' }),
    ];
    const winners = resolveKeybindingWinners(entries);
    expect(winners.get('ctrl+b')).toBe('ext.cmd-a');
  });

  it('internal wins over extension for duplicate shortcut', () => {
    const entries: EditorCommandEntry[] = [
      createEntry({
        id: 'internal-cmd',
        source: 'internal',
        keybinding: { key: 'Ctrl+S' },
      }),
      extensionEntryWithKeybinding('ext.cmd-s', { key: 'Ctrl+S' }),
    ];
    const winners = resolveKeybindingWinners(entries);
    expect(winners.get('ctrl+s')).toBe('internal-cmd');
  });

  it('internal beats extension regardless of registration order', () => {
    // Extension registered first
    const entries: EditorCommandEntry[] = [
      extensionEntryWithKeybinding('ext.cmd-x', { key: 'Ctrl+X' }),
      createEntry({
        id: 'internal-cmd',
        source: 'internal',
        keybinding: { key: 'Ctrl+X' },
      }),
    ];
    const winners = resolveKeybindingWinners(entries);
    expect(winners.get('ctrl+x')).toBe('internal-cmd');
  });

  it('first-registered wins among same-source conflicts (extension vs extension)', () => {
    const entries: EditorCommandEntry[] = [
      extensionEntryWithKeybinding('ext.first', { key: 'Ctrl+K' }),
      extensionEntryWithKeybinding('ext.second', { key: 'Ctrl+K' }),
    ];
    const winners = resolveKeybindingWinners(entries);
    expect(winners.get('ctrl+k')).toBe('ext.first');
  });

  it('first-registered wins among same-source conflicts (internal vs internal)', () => {
    const entries: EditorCommandEntry[] = [
      createEntry({
        id: 'internal-first',
        source: 'internal',
        keybinding: { key: 'Ctrl+J' },
      }),
      createEntry({
        id: 'internal-second',
        source: 'internal',
        keybinding: { key: 'Ctrl+J' },
      }),
    ];
    const winners = resolveKeybindingWinners(entries);
    expect(winners.get('ctrl+j')).toBe('internal-first');
  });

  it('different shortcuts coexist independently', () => {
    const entries: EditorCommandEntry[] = [
      extensionEntryWithKeybinding('ext.a', { key: 'Ctrl+A' }),
      extensionEntryWithKeybinding('ext.b', { key: 'Ctrl+B' }),
      createEntry({
        id: 'internal-c',
        source: 'internal',
        keybinding: { key: 'Ctrl+C' },
      }),
    ];
    const winners = resolveKeybindingWinners(entries);
    expect(winners.get('ctrl+a')).toBe('ext.a');
    expect(winners.get('ctrl+b')).toBe('ext.b');
    expect(winners.get('ctrl+c')).toBe('internal-c');
  });
});

// ---------------------------------------------------------------------------
// useEditorKeybindings hook — editable target ignore
// ---------------------------------------------------------------------------

describe('useEditorKeybindings - input/modal focus ignore', () => {
  let callbacks: ReturnType<typeof createMockCallbacks>;

  function createMockCallbacks() {
    return {
      undo: vi.fn(),
      redo: vi.fn(),
      selectAllClips: vi.fn(),
      togglePlayPause: vi.fn(),
      seekRelative: vi.fn(),
      toggleMute: vi.fn(),
      splitSelectedClip: vi.fn(),
      deleteSelectedClip: vi.fn(),
      clearSelection: vi.fn(),
      moveSelectedClipsToTrack: vi.fn(),
    };
  }

  function createOptions(overrides: Record<string, unknown> = {}) {
    return {
      hasSelectedClip: false,
      canMoveSelectedClipToTrack: false,
      precisionEnabled: false,
      timelineFps: 30,
      selectedClipIds: new Set<string>(),
      ...callbacks,
      ...overrides,
    } as Parameters<typeof useEditorKeybindings>[0];
  }

  beforeEach(() => {
    callbacks = createMockCallbacks();
  });

  it('ignores keydown events from INPUT elements', () => {
    renderHook(() => useEditorKeybindings(createOptions()));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
    });
    input.dispatchEvent(event);

    // Undo should NOT be called when focus is in an input
    expect(callbacks.undo).not.toHaveBeenCalled();
  });

  it('ignores keydown events from TEXTAREA elements', () => {
    renderHook(() => useEditorKeybindings(createOptions()));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
    });
    textarea.dispatchEvent(event);

    expect(callbacks.undo).not.toHaveBeenCalled();
  });

  it('ignores keydown events from SELECT elements', () => {
    renderHook(() => useEditorKeybindings(createOptions()));

    const select = document.createElement('select');
    document.body.appendChild(select);
    select.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
    });
    select.dispatchEvent(event);

    expect(callbacks.undo).not.toHaveBeenCalled();
  });

  it('ignores keydown events from contenteditable elements', () => {
    renderHook(() => useEditorKeybindings(createOptions()));

    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
    });
    div.dispatchEvent(event);

    expect(callbacks.undo).not.toHaveBeenCalled();
  });

  it('processes keydown events from non-editable targets', () => {
    renderHook(() => useEditorKeybindings(createOptions()));

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
    });
    div.dispatchEvent(event);

    expect(callbacks.undo).toHaveBeenCalledTimes(1);
  });

  it('ignores keydown events from elements nested inside editable', () => {
    renderHook(() => useEditorKeybindings(createOptions()));

    const input = document.createElement('input');
    const span = document.createElement('span');
    input.appendChild(span);
    document.body.appendChild(input);
    span.focus(); // focus is on the span inside the input

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
    });
    span.dispatchEvent(event);

    expect(callbacks.undo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useEditorKeybindings hook — internal command dispatch
// ---------------------------------------------------------------------------

describe('useEditorKeybindings - internal command dispatch', () => {
  let callbacks: ReturnType<typeof createMockCallbacks>;

  function createMockCallbacks() {
    return {
      undo: vi.fn(),
      redo: vi.fn(),
      selectAllClips: vi.fn(),
      togglePlayPause: vi.fn(),
      seekRelative: vi.fn(),
      toggleMute: vi.fn(),
      splitSelectedClip: vi.fn(),
      deleteSelectedClip: vi.fn(),
      clearSelection: vi.fn(),
      moveSelectedClipsToTrack: vi.fn(),
    };
  }

  function createOptions(overrides: Record<string, unknown> = {}) {
    return {
      hasSelectedClip: false,
      canMoveSelectedClipToTrack: false,
      precisionEnabled: false,
      timelineFps: 30,
      selectedClipIds: new Set<string>(),
      ...callbacks,
      ...overrides,
    } as Parameters<typeof useEditorKeybindings>[0];
  }

  beforeEach(() => {
    callbacks = createMockCallbacks();
  });

  function fireKeydown(key: string, modifiers: Partial<KeyboardEvent> = {}) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      ...modifiers,
    });
    div.dispatchEvent(event);
  }

  it('dispatches undo on Ctrl+Z', () => {
    renderHook(() => useEditorKeybindings(createOptions()));
    fireKeydown('z', { ctrlKey: true });
    expect(callbacks.undo).toHaveBeenCalledTimes(1);
  });

  it('dispatches undo on Meta+Z', () => {
    renderHook(() => useEditorKeybindings(createOptions()));
    fireKeydown('z', { metaKey: true });
    expect(callbacks.undo).toHaveBeenCalledTimes(1);
  });

  it('dispatches redo on Ctrl+Shift+Z', () => {
    renderHook(() => useEditorKeybindings(createOptions()));
    fireKeydown('z', { ctrlKey: true, shiftKey: true });
    expect(callbacks.redo).toHaveBeenCalledTimes(1);
  });

  it('dispatches redo on Ctrl+Y', () => {
    renderHook(() => useEditorKeybindings(createOptions()));
    fireKeydown('y', { ctrlKey: true });
    expect(callbacks.redo).toHaveBeenCalledTimes(1);
  });

  it('dispatches seekBackward on ArrowLeft', () => {
    renderHook(() => useEditorKeybindings(createOptions()));
    fireKeydown('ArrowLeft');
    expect(callbacks.seekRelative).toHaveBeenCalledWith(-1);
  });

  it('dispatches seekForward on ArrowRight', () => {
    renderHook(() => useEditorKeybindings(createOptions()));
    fireKeydown('ArrowRight');
    expect(callbacks.seekRelative).toHaveBeenCalledWith(1);
  });

  it('dispatches selectAll on Ctrl+A', () => {
    renderHook(() => useEditorKeybindings(createOptions()));
    fireKeydown('a', { ctrlKey: true });
    expect(callbacks.selectAllClips).toHaveBeenCalledTimes(1);
  });

  it('dispatches togglePlayPause on Space', () => {
    renderHook(() => useEditorKeybindings(createOptions()));
    fireKeydown(' ');
    expect(callbacks.togglePlayPause).toHaveBeenCalledTimes(1);
  });

  it('dispatches clearSelection on Escape', () => {
    renderHook(() => useEditorKeybindings(createOptions()));
    fireKeydown('Escape');
    expect(callbacks.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('dispatches deleteSelectedClip on Backspace when clip selected', () => {
    renderHook(() =>
      useEditorKeybindings(
        createOptions({ hasSelectedClip: true, selectedClipIds: new Set(['c1']) }),
      ),
    );
    fireKeydown('Backspace');
    expect(callbacks.deleteSelectedClip).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch deleteSelectedClip on Backspace when no clip selected', () => {
    renderHook(() => useEditorKeybindings(createOptions({ hasSelectedClip: false })));
    fireKeydown('Backspace');
    expect(callbacks.deleteSelectedClip).not.toHaveBeenCalled();
  });

  it('dispatches deleteSelectedClip on Delete when clip selected', () => {
    renderHook(() =>
      useEditorKeybindings(
        createOptions({ hasSelectedClip: true, selectedClipIds: new Set(['c1']) }),
      ),
    );
    fireKeydown('Delete');
    expect(callbacks.deleteSelectedClip).toHaveBeenCalledTimes(1);
  });

  it('dispatches toggleMute on M when clip selected', () => {
    renderHook(() =>
      useEditorKeybindings(
        createOptions({ hasSelectedClip: true, selectedClipIds: new Set(['c1']) }),
      ),
    );
    fireKeydown('m');
    expect(callbacks.toggleMute).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch toggleMute on M when no clip selected', () => {
    renderHook(() => useEditorKeybindings(createOptions({ hasSelectedClip: false })));
    fireKeydown('m');
    expect(callbacks.toggleMute).not.toHaveBeenCalled();
  });

  it('dispatches splitSelectedClip on S when clip selected', () => {
    renderHook(() =>
      useEditorKeybindings(
        createOptions({ hasSelectedClip: true, selectedClipIds: new Set(['c1']) }),
      ),
    );
    fireKeydown('s');
    expect(callbacks.splitSelectedClip).toHaveBeenCalledTimes(1);
  });

  it('dispatches moveSelectedClipsToTrack up on ArrowUp with selection', () => {
    const clipIds = new Set(['c1']);
    renderHook(() =>
      useEditorKeybindings(
        createOptions({
          hasSelectedClip: true,
          canMoveSelectedClipToTrack: true,
          selectedClipIds: clipIds,
        }),
      ),
    );
    fireKeydown('ArrowUp');
    expect(callbacks.moveSelectedClipsToTrack).toHaveBeenCalledWith('up', clipIds);
  });

  it('does not dispatch moveSelectedClipsToTrack on ArrowUp without selection', () => {
    renderHook(() =>
      useEditorKeybindings(createOptions({ hasSelectedClip: false })),
    );
    fireKeydown('ArrowUp');
    expect(callbacks.moveSelectedClipsToTrack).not.toHaveBeenCalled();
  });

  it('suppresses default browser behavior for matched shortcuts', () => {
    renderHook(() => useEditorKeybindings(createOptions()));

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const prevented = !div.dispatchEvent(event);

    // preventDefault was called
    expect(event.defaultPrevented).toBe(true);
    expect(callbacks.undo).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useEditorKeybindings hook — extension command dispatch
// ---------------------------------------------------------------------------

describe('useEditorKeybindings - extension command dispatch', () => {
  it('dispatches extension direct command via dispatchExtensionCommand', () => {
    const dispatchExtensionCommand = vi.fn();
    const buildCommandContext = vi.fn().mockReturnValue({
      data: {} as any,
      timelineId: 'tl-1',
      userId: 'user-1',
      selectedClipIds: [],
      source: 'keybinding',
    } as EditorCommandContext);

    const extEntry: EditorCommandEntry = extensionEntryWithKeybinding(
      'myext.doSomething',
      { key: 'Ctrl+D' },
      false, // not a proposal
    );

    renderHook(() =>
      useEditorKeybindings({
        hasSelectedClip: false,
        canMoveSelectedClipToTrack: false,
        precisionEnabled: false,
        timelineFps: 30,
        selectedClipIds: new Set<string>(),
        undo: vi.fn(),
        redo: vi.fn(),
        selectAllClips: vi.fn(),
        togglePlayPause: vi.fn(),
        seekRelative: vi.fn(),
        toggleMute: vi.fn(),
        splitSelectedClip: vi.fn(),
        deleteSelectedClip: vi.fn(),
        clearSelection: vi.fn(),
        moveSelectedClipsToTrack: vi.fn(),
        commandEntries: [extEntry],
        buildCommandContext,
        dispatchExtensionCommand,
      }),
    );

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'd',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    div.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(dispatchExtensionCommand).toHaveBeenCalledTimes(1);
    expect(dispatchExtensionCommand).toHaveBeenCalledWith(
      'myext.doSomething',
      expect.objectContaining({ source: 'keybinding' }),
    );
  });

  it('dispatches extension proposal command via dispatchExtensionCommand', () => {
    const dispatchExtensionCommand = vi.fn();
    const buildCommandContext = vi.fn().mockReturnValue({
      data: {} as any,
      timelineId: 'tl-1',
      userId: 'user-1',
      selectedClipIds: [],
      source: 'keybinding',
    } as EditorCommandContext);

    const propEntry: EditorCommandEntry = extensionEntryWithKeybinding(
      'myext.ProposeChange',
      { key: 'Ctrl+P' },
      true, // isProposal
    );

    renderHook(() =>
      useEditorKeybindings({
        hasSelectedClip: false,
        canMoveSelectedClipToTrack: false,
        precisionEnabled: false,
        timelineFps: 30,
        selectedClipIds: new Set<string>(),
        undo: vi.fn(),
        redo: vi.fn(),
        selectAllClips: vi.fn(),
        togglePlayPause: vi.fn(),
        seekRelative: vi.fn(),
        toggleMute: vi.fn(),
        splitSelectedClip: vi.fn(),
        deleteSelectedClip: vi.fn(),
        clearSelection: vi.fn(),
        moveSelectedClipsToTrack: vi.fn(),
        commandEntries: [propEntry],
        buildCommandContext,
        dispatchExtensionCommand,
      }),
    );

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    div.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(dispatchExtensionCommand).toHaveBeenCalledTimes(1);
    expect(dispatchExtensionCommand).toHaveBeenCalledWith(
      'myext.ProposeChange',
      expect.objectContaining({ source: 'keybinding' }),
    );
  });

  it('does not dispatch extension command when dispatchExtensionCommand is missing', () => {
    const buildCommandContext = vi.fn().mockReturnValue({
      data: {} as any,
      timelineId: 'tl-1',
      userId: 'user-1',
      selectedClipIds: [],
      source: 'keybinding',
    } as EditorCommandContext);

    const extEntry: EditorCommandEntry = extensionEntryWithKeybinding(
      'myext.foo',
      { key: 'Ctrl+F' },
    );

    renderHook(() =>
      useEditorKeybindings({
        hasSelectedClip: false,
        canMoveSelectedClipToTrack: false,
        precisionEnabled: false,
        timelineFps: 30,
        selectedClipIds: new Set<string>(),
        undo: vi.fn(),
        redo: vi.fn(),
        selectAllClips: vi.fn(),
        togglePlayPause: vi.fn(),
        seekRelative: vi.fn(),
        toggleMute: vi.fn(),
        splitSelectedClip: vi.fn(),
        deleteSelectedClip: vi.fn(),
        clearSelection: vi.fn(),
        moveSelectedClipsToTrack: vi.fn(),
        commandEntries: [extEntry],
        buildCommandContext,
        // dispatchExtensionCommand intentionally omitted
      }),
    );

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    div.dispatchEvent(event);

    // preventDefault is still called for extension commands even without handler
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not dispatch extension command when buildCommandContext is missing', () => {
    const dispatchExtensionCommand = vi.fn();

    const extEntry: EditorCommandEntry = extensionEntryWithKeybinding(
      'myext.foo',
      { key: 'Ctrl+F' },
    );

    renderHook(() =>
      useEditorKeybindings({
        hasSelectedClip: false,
        canMoveSelectedClipToTrack: false,
        precisionEnabled: false,
        timelineFps: 30,
        selectedClipIds: new Set<string>(),
        undo: vi.fn(),
        redo: vi.fn(),
        selectAllClips: vi.fn(),
        togglePlayPause: vi.fn(),
        seekRelative: vi.fn(),
        toggleMute: vi.fn(),
        splitSelectedClip: vi.fn(),
        deleteSelectedClip: vi.fn(),
        clearSelection: vi.fn(),
        moveSelectedClipsToTrack: vi.fn(),
        commandEntries: [extEntry],
        // buildCommandContext intentionally omitted
        dispatchExtensionCommand,
      }),
    );

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
    });
    div.dispatchEvent(event);

    expect(dispatchExtensionCommand).not.toHaveBeenCalled();
  });

  it('internal keybinding wins over extension keybinding for same shortcut', () => {
    const dispatchExtensionCommand = vi.fn();
    const undo = vi.fn();
    const buildCommandContext = vi.fn().mockReturnValue({
      data: {} as any,
      timelineId: 'tl-1',
      userId: 'user-1',
      selectedClipIds: [],
      source: 'keybinding',
    } as EditorCommandContext);

    // Extension tries to override Ctrl+Z (which is editor.undo internally)
    const extEntry: EditorCommandEntry = extensionEntryWithKeybinding(
      'myext.overrideUndo',
      { key: 'Ctrl+Z' },
    );

    renderHook(() =>
      useEditorKeybindings({
        hasSelectedClip: false,
        canMoveSelectedClipToTrack: false,
        precisionEnabled: false,
        timelineFps: 30,
        selectedClipIds: new Set<string>(),
        undo,
        redo: vi.fn(),
        selectAllClips: vi.fn(),
        togglePlayPause: vi.fn(),
        seekRelative: vi.fn(),
        toggleMute: vi.fn(),
        splitSelectedClip: vi.fn(),
        deleteSelectedClip: vi.fn(),
        clearSelection: vi.fn(),
        moveSelectedClipsToTrack: vi.fn(),
        commandEntries: [extEntry],
        buildCommandContext,
        dispatchExtensionCommand,
      }),
    );

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
    });
    div.dispatchEvent(event);

    // Internal undo wins, extension is NOT called
    expect(undo).toHaveBeenCalledTimes(1);
    expect(dispatchExtensionCommand).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cleanup helper for DOM-based tests
// ---------------------------------------------------------------------------

afterEach(() => {
  // Clean up any DOM nodes added during tests
  document.body.innerHTML = '';
});
