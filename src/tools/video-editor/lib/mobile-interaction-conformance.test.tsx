// @vitest-environment jsdom
/**
 * Policy ↔ mechanism conformance for `lib/mobile-interaction-model.ts`.
 *
 * The policy module answers *may this gesture happen*. It cannot make it happen.
 * Four of the seven timeline bugs found in one week were a predicate shipped
 * without the mechanism that enforces it — a `touch-action` rule, a reachable
 * mode control, a tap path on a drag-only affordance. Predicate unit tests stay
 * green through all of them, because the predicate was never wrong.
 *
 * This suite binds each predicate to the *rendered* mechanism, over the full
 * (device class × interaction mode) matrix, and gates the binding: the last test
 * enumerates the module's runtime exports and fails if one is neither covered by
 * a check here nor listed in `EXCLUSIONS` with a reason. Adding a policy without
 * a mechanism is therefore a red test, not a device-only surprise.
 *
 * **What this suite cannot see.** jsdom has no gesture arbitration: it will
 * happily deliver a pointer stream the real browser would have claimed for
 * native panning, and it never runs the CSS. So the assertions here are
 * DOM/CSS *contract* assertions — the attribute is written, the stylesheet
 * carries a matching `touch-action: none` rule. Proof that the gesture survives
 * a real touch belongs to the committed Playwright device specs
 * (`npm run test:e2e:timeline`): `tests/e2e/timeline/tablet-gestures.spec.ts`
 * (tablet: move drag, marquee) and `tests/e2e/timeline/phone-gestures.spec.ts`
 * (phone: drag, trim, pinch).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as policy from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import {
  APP_PANE_RAIL_GUTTER_PX,
  resolveTimelineModeSwitcherVariant,
  resolveTouchGestureMode,
  shouldAllowTouchClipDrag,
  shouldAllowTouchMarquee,
  shouldEnableTimelinePinchZoom,
  shouldExpandTouchTrimHandles,
  shouldPinHoverAffordances,
  shouldReserveAppPaneRailGutter,
  shouldShowTimelineModeSwitcher,
  shouldTapTimelineToolButtons,
  type TimelineDeviceClass,
  type TimelineGestureOwner,
  type TimelineInteractionMode,
  type TimelineShellLayout,
} from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import {
  CLIP_ACTION_SELECTOR,
  EDIT_AREA_SELECTOR,
  RESIZE_EDGE_ATTR,
  RESIZE_EDGE_SELECTOR,
  TOUCH_GESTURE_MODE_ATTR,
} from '@/tools/video-editor/lib/timeline-dom.ts';
import {
  RESIZE_HANDLE_WIDTH,
  TOUCH_RESIZE_HANDLE_WIDTH,
} from '@/tools/video-editor/components/TimelineEditor/timeline-canvas-constants.ts';
import { createInteractionState } from '@/tools/video-editor/lib/interaction-state.ts';
import type { TrackDefinition } from '@/tools/video-editor/types';
import type { TimelineAction, TimelineRow } from '@/tools/video-editor/types/timeline-canvas';

// ---------------------------------------------------------------------------
// Harness mocks. The shell half mirrors TimelineEditorShellCore.test.tsx and the
// canvas half mirrors TimelineCanvas.test.tsx — same seams, same stubs. The one
// module deliberately *not* mocked is `mobile-interaction-model` itself: this
// suite exists to run the real predicates against real markup.
// ---------------------------------------------------------------------------

let __deviceClass: TimelineDeviceClass = 'desktop';
let __interactionMode: TimelineInteractionMode = 'browse';

const __editorOps = {
  applyEdit: vi.fn(),
  handleDeleteClips: vi.fn(),
  moveSelectedClipsToTrack: vi.fn(),
  handleToggleMuteClips: vi.fn(),
  handleSplitSelectedClip: vi.fn(),
  clearSelection: vi.fn(),
  setInspectorTarget: vi.fn(),
  setContextTarget: vi.fn(),
  setPrecisionEnabled: vi.fn(),
  setInteractionMode: vi.fn(),
};

vi.mock('@/tools/video-editor/hooks/timelineStore.ts', async () => {
  const actual = await vi.importActual<typeof import('@/tools/video-editor/hooks/timelineStore.ts')>(
    '@/tools/video-editor/hooks/timelineStore.ts',
  );

  return {
    ...actual,
    // Canvas seam
    useTimelineMutableAdapters: () => ({
      dataRef: { current: null },
      pendingOpsRef: { current: 0 },
      interactionStateRef: { current: createInteractionState() },
      selectedClipIdsRef: { current: new Set<string>() },
      additiveSelectionRef: { current: false },
    }),
    // Shell seams
    useTimelineEditorData: () => ({
      dataRef: { current: null },
      data: null,
      selectedClipIds: new Set<string>(),
      selectedTrackId: null,
      resolvedConfig: null,
      deviceClass: __deviceClass,
      precisionEnabled: false,
      interactionMode: __interactionMode,
      gestureOwner: null,
      inspectorTarget: { kind: 'timeline' as const },
    }),
    useTimelineEditorOps: () => __editorOps,
    useTimelineChromeContext: () => ({
      saveStatus: 'saved' as const,
      isConflictExhausted: false,
      retrySaveAfterConflict: vi.fn(),
      reloadFromServer: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
      checkpoints: [],
      jumpToCheckpoint: vi.fn(),
      createManualCheckpoint: vi.fn(),
      timelineName: 'Test Timeline',
      setScaleWidth: vi.fn(),
      startRender: vi.fn(),
      renderStatus: 'idle' as const,
      renderProgress: null,
      renderResultUrl: null,
      renderResultFilename: null,
      renderDirty: false,
    }),
    useTimelinePlaybackContext: () => ({
      currentTime: 0,
      previewRef: { current: { togglePlayPause: vi.fn(), seek: vi.fn() } },
      formatTime: (t: number) => `${t.toFixed(1)}s`,
    }),
    useProposalRuntimeFromStoreSafe: () => null,
    useProposalImportDiagnosticsFromStoreSafe: () => null,
  };
});

vi.mock('@/tools/video-editor/components/ProposalPanel/ProposalPanel.tsx', () => ({
  ProposalPanel: () => null,
}));
vi.mock('@/tools/video-editor/hooks/useKeyboardShortcuts.ts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));
vi.mock('@/tools/video-editor/hooks/useTimelineRealtime.ts', () => ({
  useTimelineRealtime: () => ({
    isOpen: false,
    setOpen: vi.fn(),
    keepLocalChanges: vi.fn(),
    discardAndReload: vi.fn(),
  }),
}));
vi.mock('@/tools/video-editor/hooks/useEditorSync.ts', () => ({
  useEditorSync: () => ({
    syncState: 'idle' as const,
    syncError: null,
    isSyncAvailable: false,
    performSync: vi.fn(),
    lastSyncResult: null,
  }),
}));
vi.mock('@/tools/video-editor/hooks/usePerfDiagnostics.ts', () => ({
  useRenderDiagnostic: vi.fn(),
}));
vi.mock('@/tools/video-editor/lib/perf-diagnostics.ts', () => ({
  bootDiagnostics: vi.fn(),
  MemoryPressureDetector: { start: vi.fn(), stop: vi.fn() },
}));
vi.mock('@/tools/video-editor/components/CommandPalette/CommandPalette.tsx', () => ({
  CommandPalette: () => null,
}));
vi.mock('@/tools/video-editor/runtime/useVideoEditorRenderContext.ts', () => ({
  useVideoEditorSlotRenderers: () => ({}),
  useVideoEditorRenderContext: () => ({
    provider: {},
    timelineId: 'test-timeline',
    timelineName: 'Test Timeline',
    userId: 'user-1',
    extensions: {
      slots: {},
      dialogHost: { dialogs: [] },
      registry: { panels: [], inspectorSections: [] },
      outputFormats: [],
    },
    data: {},
    ops: {},
    chrome: {},
    playback: {},
  }),
  useVideoEditorAssetPanels: () => [],
  useVideoEditorDialogDescriptors: () => [],
  useVideoEditorPanelRegistry: () => ({ panels: [], inspectorSections: [] }),
  useResolvedVideoEditorPanelRegistry: () => ({
    assetPanels: [],
    inspectorSections: { all: [], beforeDefault: [], afterDefault: [] },
  }),
  useVideoEditorInspectorSections: () => [],
}));
vi.mock('@/tools/video-editor/components/PreviewPanel/PreviewPanel.tsx', () => ({
  PreviewPanel: () => <div data-testid="preview-panel">Preview</div>,
  default: () => <div data-testid="preview-panel">Preview</div>,
}));
vi.mock('@/tools/video-editor/components/PreviewPanel/useVideoEditorPreviewSurface.tsx', () => ({
  useVideoEditorPreviewSurface: () => ({ slotRef: { current: null }, portal: null }),
}));
vi.mock('@/tools/video-editor/components/PropertiesPanel/PropertiesPanel.tsx', () => ({
  PropertiesPanel: () => null,
}));
vi.mock('@/tools/video-editor/components/PropertiesPanel/VideoEditorAssetPanelSurface.tsx', () => ({
  VideoEditorAssetPanelSurface: () => null,
}));
vi.mock('@/tools/video-editor/components/SequenceCreator/SequenceCreatorPanel.tsx', () => ({
  SequenceCreatorPanel: () => null,
}));
vi.mock('@/tools/video-editor/components/ThemeChip.tsx', () => ({ ThemeChip: () => null }));
vi.mock('@/tools/video-editor/components/TimelineEditor/TimelineEditor.tsx', () => ({
  TimelineEditor: () => <div data-testid="timeline-editor">Timeline Editor</div>,
}));
vi.mock('@/tools/video-editor/lib/config-utils.ts', () => ({
  getTimelineDurationInFrames: () => 300,
  parseResolution: () => ({ width: 1920, height: 1080 }),
}));
vi.mock('@/tools/video-editor/lib/keyboard-delete.ts', () => ({
  buildKeyboardDeleteMutation: () => null,
}));
vi.mock('@/shared/lib/typedEvents.ts', () => ({ dispatchAppEvent: vi.fn() }));
vi.mock('@/shared/state/selectionStore.ts', () => ({
  editorReplaceTimelineSelection: vi.fn(),
  userSelectTimelineClip: vi.fn(),
  userSelectTimelineClips: vi.fn(),
  userClearAllSelection: vi.fn(),
}));

// Imported after the mocks, as the sibling suites do.
import { TimelineCanvas } from '@/tools/video-editor/components/TimelineEditor/TimelineCanvas.tsx';
import { TimelineEditorShellCore } from '@/tools/video-editor/components/TimelineEditorShellCore.tsx';
import { TIMELINE_MODE_HINTS } from '@/tools/video-editor/components/TimelineModeSwitcher.tsx';

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

const DEVICE_CLASSES: readonly TimelineDeviceClass[] = ['desktop', 'tablet', 'phone'];
const INTERACTION_MODES: readonly TimelineInteractionMode[] = [
  'browse',
  'select',
  'move',
  'trim',
  'precision',
];
const TOUCH_DEVICE_CLASSES: readonly TimelineDeviceClass[] = ['tablet', 'phone'];
/** Modes the switcher must expose. `precision` is the switcher's toggle, not a mode button. */
const SWITCHABLE_MODES = ['browse', 'select', 'move', 'trim'] as const;

/**
 * Which policy exports each check binds to a rendered mechanism. Coverage is
 * declared here and gated at the bottom of the file — a new predicate with no
 * entry fails the suite.
 */
const COVERAGE = {
  'gesture ownership': ['resolveTouchGestureMode', 'shouldAllowTouchClipDrag'],
  marquee: ['shouldAllowTouchMarquee'],
  'trim handles': ['shouldExpandTouchTrimHandles'],
  'affordance pinning': ['shouldPinHoverAffordances', 'shouldTapTimelineToolButtons'],
  'pinch zoom': ['shouldEnableTimelinePinchZoom'],
  'mode reachability': ['resolveTimelineModeSwitcherVariant', 'shouldShowTimelineModeSwitcher'],
  'pane rail gutter': ['shouldReserveAppPaneRailGutter', 'APP_PANE_RAIL_GUTTER_PX'],
} as const satisfies Record<string, readonly string[]>;

/**
 * Exports with no rendered mechanism to bind. Every entry needs a reason
 * specific to *that* export — "it's a helper" is not one.
 */
const EXCLUSIONS: Record<string, string> = {
  resolveTimelineDeviceClass:
    'Resolves the matrix input (which device class we are on) from useIsMobile/useIsTablet plus '
    + 'viewport width and the tablet-hardware hint. It decides nothing about a gesture, so there '
    + 'is no mechanism to bind; every row below takes its output as a parameter. The '
    + 'classification itself is pinned by mobile-interaction-model.test.ts ("device class").',
  resolveInputModalityFromPointerType:
    'The other matrix input: maps a PointerEvent.pointerType to a modality. Pure lookup, no DOM.',
  getDefaultInteractionMode:
    'Picks the mode the editor opens in. The mechanism that matters is that every *other* mode '
    + 'stays reachable from there, which is the "mode reachability" check.',
  createMobileInteractionPolicy:
    'Seeds the store slice from a device class. Each field it seeds is read by a predicate that '
    + 'this suite already binds, so asserting the seed again would test the store, not a mechanism.',
  isTouchTimelineInput:
    'Shared "is this a touch stream on a touch device" guard composed by the touch predicates; '
    + 'it grants nothing on its own and is exercised transitively by every touch row here.',
  shouldToggleTouchSelection:
    'Selection semantics inside useClipDrag\'s document-level pointer machine — it changes which '
    + 'clips end up selected, not what the DOM must carry. Pinned by useClipDrag.test.tsx '
    + '("toggles touch selection in select mode without desktop modifier keys").',
  shouldPreserveTouchSelectionForMove:
    'Same pointer machine, same reason. Pinned by useClipDrag.test.tsx ("preserves additive touch '
    + 'selection on move-mode taps that do not start a drag").',
  areTimelineInteractionTargetsEqual:
    'Structural equality for context/inspector targets, used to skip redundant state writes. '
    + 'Not a gesture policy and has no device-class dimension.',
};

// ---------------------------------------------------------------------------
// The stylesheet, read as text — jsdom does not apply it
// ---------------------------------------------------------------------------

const OVERRIDES_CSS = join(
  resolve(import.meta.dirname, '..'),
  'components/TimelineEditor/timeline-overrides.css',
);

/** Selectors of every rule in `timeline-overrides.css` that sets `touch-action: none`. */
const touchActionNoneSelectors: string[] = [
  ...readFileSync(OVERRIDES_CSS, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([^{}]+)\{([^{}]*)\}/g),
]
  .filter((match) => /touch-action\s*:\s*none/.test(match[2]))
  .map((match) => match[1].trim().replace(/\s+/g, ' '));

const gestureModeSelector = (mode: string) =>
  `${EDIT_AREA_SELECTOR}[${TOUCH_GESTURE_MODE_ATTR}='${mode}']`;

// ---------------------------------------------------------------------------
// Render paths
// ---------------------------------------------------------------------------

const track: TrackDefinition = { id: 'V1', kind: 'visual', label: 'V1' };
const action: TimelineAction = { id: 'clip-1', start: 0, end: 2, effectId: 'effect-clip-1' };
const row: TimelineRow = { id: 'V1', actions: [action] };

function renderCanvasFor(
  deviceClass: TimelineDeviceClass,
  interactionMode: TimelineInteractionMode,
  onScaleWidthChange?: (next: number) => void,
  gestureOwner: TimelineGestureOwner = 'none',
) {
  const result = render(
    <TimelineCanvas
      rows={[row]}
      tracks={[track]}
      deviceClass={deviceClass}
      // Touch throughout: the point of the matrix is the touch mechanism. The
      // predicates that key on modality are asked with the same value.
      inputModality="touch"
      interactionMode={interactionMode}
      gestureOwner={gestureOwner}
      scale={1}
      scaleWidth={100}
      scaleSplitCount={1}
      startLeft={0}
      rowHeight={48}
      minScaleCount={1}
      maxScaleCount={10}
      selectedTrackId={null}
      getActionRender={() => <div>clip</div>}
      onSelectTrack={vi.fn()}
      onTrackChange={vi.fn()}
      onRemoveTrack={vi.fn()}
      onTrackDragEnd={vi.fn()}
      trackSensors={[] as never}
      onCursorDrag={vi.fn()}
      onClickTimeArea={vi.fn()}
      setInputModalityFromPointerType={vi.fn(() => 'touch' as const)}
      setGestureOwner={vi.fn()}
      onActionResizeStart={vi.fn()}
      onClipEdgeResizeEnd={vi.fn()}
      onAddTextAt={vi.fn()}
      onAddEffectLayerAt={vi.fn()}
      onOpenSequenceCreator={vi.fn()}
      onScaleWidthChange={onScaleWidthChange}
      dragSessionRef={{ current: null }}
    />,
  );

  const editArea = result.container.querySelector(EDIT_AREA_SELECTOR);
  if (!(editArea instanceof HTMLElement)) {
    throw new Error(`expected a rendered ${EDIT_AREA_SELECTOR}`);
  }

  return { ...result, editArea };
}

function renderShellFor(deviceClass: TimelineDeviceClass, layout: TimelineShellLayout) {
  __deviceClass = deviceClass;
  // The shell derives its layout the same way for every device class: only the
  // phone's stacked (non-condensed) branch is single-pane.
  const forceCondensed = deviceClass === 'phone' && layout === 'split';
  if (deviceClass !== 'phone' && layout === 'single-pane') {
    throw new Error(`${deviceClass} has no single-pane layout`);
  }

  return render(
    <TimelineEditorShellCore timelineId="test-timeline" forceCondensed={forceCondensed} />,
  );
}

/** A two-finger touch sequence the pinch listener will accept. jsdom has no TouchEvent. */
function dispatchPinch(target: HTMLElement, from: number, to: number) {
  const send = (type: string, spread: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', {
      value: [
        { clientX: 100, clientY: 40 },
        { clientX: 100 + spread, clientY: 40 },
      ],
    });
    target.dispatchEvent(event);
    return event;
  };

  const start = send('touchstart', from);
  const move = send('touchmove', to);
  send('touchend', 0);
  return { start, move };
}

afterEach(() => {
  vi.clearAllMocks();
  __deviceClass = 'desktop';
  __interactionMode = 'browse';
});

// ---------------------------------------------------------------------------
// 1. Gesture ownership: policy mode ⇒ attribute ⇒ stylesheet rule
// ---------------------------------------------------------------------------

describe.each(DEVICE_CLASSES)('gesture ownership — %s', (deviceClass) => {
  it.each(INTERACTION_MODES)('%s carries the mechanism its policy implies', (interactionMode) => {
    const expectedMode = resolveTouchGestureMode(deviceClass, interactionMode);
    const { editArea } = renderCanvasFor(deviceClass, interactionMode);

    expect(
      editArea.getAttribute(TOUCH_GESTURE_MODE_ATTR),
      `edit area's ${TOUCH_GESTURE_MODE_ATTR} disagrees with resolveTouchGestureMode(${deviceClass}, ${interactionMode}) — TimelineCanvas.tsx writes this attribute from that policy; fix whichever side is wrong`,
    ).toBe(expectedMode);

    if (deviceClass === 'desktop') {
      // Modeless by design: a mouse gesture is never claimed by the browser, so
      // desktop must not opt any element out of native scrolling.
      expect(expectedMode).toBeNull();
      return;
    }

    if (expectedMode === null) {
      return;
    }

    // The attribute only matters because the stylesheet keys on it.
    const selector = touchActionNoneSelectors.find((candidate) =>
      candidate.startsWith(gestureModeSelector(expectedMode)));
    expect(
      selector,
      `timeline-overrides.css has no touch-action:none rule for ${gestureModeSelector(expectedMode)}`,
    ).toBeDefined();
  });

  it.each(INTERACTION_MODES)('%s hands the touch to the element that owns it', (interactionMode) => {
    const { editArea } = renderCanvasFor(deviceClass, interactionMode);
    const expectedMode = resolveTouchGestureMode(deviceClass, interactionMode);
    if (expectedMode === null) {
      return;
    }

    const selector = touchActionNoneSelectors.find((candidate) =>
      candidate.startsWith(gestureModeSelector(expectedMode)));
    const owner = selector?.slice(gestureModeSelector(expectedMode).length).trim();

    if (expectedMode === 'move') {
      // Clip drag is allowed exactly here, and the clips are what must stop
      // panning. The clip element itself comes from `getActionRender` (ClipAction
      // in the app), which spells the class through TIMELINE_DOM — so the binding
      // to assert here is the rule's scope, not this harness's stand-in markup.
      expect(shouldAllowTouchClipDrag(deviceClass, 'touch', interactionMode)).toBe(true);
      expect(owner).toBe(CLIP_ACTION_SELECTOR);
    } else if (expectedMode === 'trim') {
      expect(owner).toBe(RESIZE_EDGE_SELECTOR);
      expect(editArea.querySelector(RESIZE_EDGE_SELECTOR)).toBeTruthy();
    } else {
      // Marquee starts on empty canvas, so the scroll container itself is the owner.
      expect(owner).toBe('');
    }
  });

  it.each(INTERACTION_MODES)(
    '%s only allows a touch clip drag where the clip owns the gesture',
    (interactionMode) => {
      if (deviceClass === 'desktop') {
        // Non-touch input is unrestricted by construction; nothing to enforce.
        expect(shouldAllowTouchClipDrag(deviceClass, 'touch', interactionMode)).toBe(true);
        return;
      }

      const { editArea } = renderCanvasFor(deviceClass, interactionMode);
      const dragAllowed = shouldAllowTouchClipDrag(deviceClass, 'touch', interactionMode);
      expect(editArea.getAttribute(TOUCH_GESTURE_MODE_ATTR) === 'move').toBe(dragAllowed);
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Marquee (the gap this suite was written after)
// ---------------------------------------------------------------------------

describe.each(TOUCH_DEVICE_CLASSES)('marquee — %s', (deviceClass) => {
  it.each(INTERACTION_MODES)('%s: permission and mechanism agree', (interactionMode) => {
    const { editArea } = renderCanvasFor(deviceClass, interactionMode);
    const allowed = shouldAllowTouchMarquee(deviceClass, 'touch', interactionMode);
    const marqueeOwned = editArea.getAttribute(TOUCH_GESTURE_MODE_ATTR) === 'marquee';

    expect(
      marqueeOwned,
      `shouldAllowTouchMarquee(${deviceClass}, touch, ${interactionMode}) is ${allowed} but the edit area ${marqueeOwned ? 'claims' : 'does not claim'} the marquee gesture — resolveTouchGestureMode must derive marquee ownership from that permission (mobile-interaction-model.ts) and TimelineCanvas.tsx must write the attribute`,
    ).toBe(allowed);
    if (!allowed) {
      return;
    }

    // Scoped to the edit area itself and nothing inside it: a descendant rule
    // would leave the empty canvas — where the marquee actually starts — pannable,
    // which is how a tablet marquee drag used to overscroll into the browser's
    // back-navigation gesture and take the page off the editor.
    expect(touchActionNoneSelectors).toContain(gestureModeSelector('marquee'));
  });
});

it('leaves marquee ownership off desktop, whose mouse marquee needs no touch-action', () => {
  INTERACTION_MODES.forEach((interactionMode) => {
    const { editArea, unmount } = renderCanvasFor('desktop', interactionMode);
    expect(editArea.hasAttribute(TOUCH_GESTURE_MODE_ATTR)).toBe(false);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// 3. Trim handles
// ---------------------------------------------------------------------------

describe.each(DEVICE_CLASSES)('trim handles — %s', (deviceClass) => {
  it.each(INTERACTION_MODES)('%s applies the handle width its policy implies', (interactionMode) => {
    const { editArea } = renderCanvasFor(deviceClass, interactionMode);
    const handle = editArea.querySelector(`[${RESIZE_EDGE_ATTR}='left']`);
    if (!(handle instanceof HTMLElement)) {
      throw new Error('expected a rendered left trim handle');
    }

    const expectedWidth = shouldExpandTouchTrimHandles(deviceClass, 'touch', interactionMode)
      ? TOUCH_RESIZE_HANDLE_WIDTH
      : RESIZE_HANDLE_WIDTH;
    expect(handle.style.width).toBe(`${expectedWidth}px`);
  });
});

// ---------------------------------------------------------------------------
// 4. Affordance pinning and tap-capable tools
// ---------------------------------------------------------------------------

describe.each(DEVICE_CLASSES)('affordance pinning — %s', (deviceClass) => {
  it('renders track actions without hover gating exactly when the policy pins them', () => {
    const { container } = renderCanvasFor(deviceClass, 'select');
    const pinned = container.querySelector('[data-track-actions="touch"]');

    if (!shouldPinHoverAffordances(deviceClass)) {
      expect(pinned).toBeNull();
      // Desktop keeps the hover overlay; that is the affordance being pinned elsewhere.
      expect(container.querySelector('.group-hover\\:opacity-100')).toBeTruthy();
      return;
    }

    if (!(pinned instanceof HTMLElement)) {
      throw new Error('expected pinned track actions');
    }
    // Nothing on the reachable path may be hidden until a hover that never comes.
    expect(pinned.className).not.toMatch(/opacity-0|group-hover/);
    const reorder = within(pinned).getByRole('button', { name: 'Reorder track' });
    expect(reorder.className).not.toMatch(/opacity-0|group-hover/);
    expect(reorder.closest('[class*="opacity-0"]')).toBeNull();
  });

  it('makes the timeline tool buttons tap-capable exactly when the policy says so', () => {
    renderCanvasFor(deviceClass, 'select');

    if (!shouldTapTimelineToolButtons(deviceClass)) {
      // HTML5 drag sources: fine on a pointer device, inert on touch.
      expect(screen.getByTitle('Drag onto timeline to add text')).toBeTruthy();
      return;
    }

    expect(screen.queryByTitle('Drag onto timeline to add text')).toBeNull();
    ['New text at playhead', 'New effect layer at playhead', 'Create animation sequence'].forEach(
      (label) => {
        const button = screen.getByRole('button', { name: label });
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('draggable')).not.toBe('true');
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Pinch zoom
// ---------------------------------------------------------------------------

describe.each(DEVICE_CLASSES)('pinch zoom — %s', (deviceClass) => {
  it('binds the two-finger listeners exactly when the policy enables them', () => {
    const onScaleWidthChange = vi.fn();
    const { editArea } = renderCanvasFor(deviceClass, 'browse', onScaleWidthChange);

    dispatchPinch(editArea, 100, 220);

    expect(onScaleWidthChange.mock.calls.length > 0).toBe(shouldEnableTimelinePinchZoom(deviceClass));
  });
});

describe.each(TOUCH_DEVICE_CLASSES)('overlay-owned pinch — %s', (deviceClass) => {
  it('declines acquisition without preventing the native event', () => {
    const onScaleWidthChange = vi.fn();
    const { editArea } = renderCanvasFor(deviceClass, 'browse', onScaleWidthChange, 'overlay');

    const { start, move } = dispatchPinch(editArea, 100, 220);

    expect(onScaleWidthChange).not.toHaveBeenCalled();
    expect(start.defaultPrevented).toBe(false);
    expect(move.defaultPrevented).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Mode reachability
// ---------------------------------------------------------------------------

const SHELL_CASES: ReadonlyArray<[TimelineDeviceClass, TimelineShellLayout]> = [
  ['desktop', 'split'],
  ['tablet', 'split'],
  ['phone', 'single-pane'],
  ['phone', 'split'],
];

describe.each(SHELL_CASES)('mode reachability — %s / %s', (deviceClass, layout) => {
  it('renders the switcher variant the policy resolves, or none', () => {
    const variant = resolveTimelineModeSwitcherVariant(deviceClass, layout);
    expect(shouldShowTimelineModeSwitcher(deviceClass, layout)).toBe(variant !== null);

    renderShellFor(deviceClass, layout);
    const switchers = document.querySelectorAll('[data-timeline-mode-switcher]');

    if (variant === null) {
      expect(switchers).toHaveLength(0);
      return;
    }

    expect(switchers).toHaveLength(1);
    expect(switchers[0].getAttribute('data-timeline-mode-switcher')).toBe(variant);
  });

  it('reaches every switchable mode through a pressable control', () => {
    if (resolveTimelineModeSwitcherVariant(deviceClass, layout) === null) {
      return;
    }

    __interactionMode = 'trim';
    renderShellFor(deviceClass, layout);
    const switcher = document.querySelector('[data-timeline-mode-switcher]') as HTMLElement;

    SWITCHABLE_MODES.forEach((mode) => {
      const label = mode[0].toUpperCase() + mode.slice(1);
      const button = within(switcher).getByRole('button', { name: label });
      // aria-pressed is the contract: a mode control with no pressed state is a
      // button that cannot tell you which mode you are in.
      expect(button.getAttribute('aria-pressed')).toBe(String(mode === 'trim'));
      expect(button.tagName).toBe('BUTTON');
    });

    // Precision is a toggle beside the modes, not a mode button.
    expect(within(switcher).getByRole('button', { name: 'Precision' })).toBeTruthy();
    expect(TIMELINE_MODE_HINTS.trim).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. App pane-rail gutter
// ---------------------------------------------------------------------------

describe.each(SHELL_CASES)('pane rail gutter — %s / %s', (deviceClass, layout) => {
  it('insets the shell main exactly when the policy reserves the gutter', () => {
    renderShellFor(deviceClass, layout);
    const main = document.querySelector('main') as HTMLElement | null;
    expect(main).toBeTruthy();

    expect(main?.style.paddingInline).toBe(
      shouldReserveAppPaneRailGutter(deviceClass) ? `${APP_PANE_RAIL_GUTTER_PX}px` : '',
    );
  });
});

// ---------------------------------------------------------------------------
// 8. The gate
// ---------------------------------------------------------------------------

describe('conformance coverage gate', () => {
  it('binds or explicitly excuses every export of mobile-interaction-model', () => {
    const covered = new Set(Object.values(COVERAGE).flat());
    const excluded = new Set(Object.keys(EXCLUSIONS));
    const uncovered = Object.keys(policy).filter(
      (name) => !covered.has(name) && !excluded.has(name),
    );

    expect(
      uncovered,
      'Every policy export needs either a conformance check that binds it to a rendered '
      + 'mechanism (add it to COVERAGE and write the check) or an entry in EXCLUSIONS with a '
      + 'reason specific to that export. Policy without mechanism is the bug class this suite exists for.',
    ).toEqual([]);
  });

  it('keeps the coverage and exclusion lists pointing at exports that still exist', () => {
    const exported = new Set(Object.keys(policy));
    const stale = [...Object.values(COVERAGE).flat(), ...Object.keys(EXCLUSIONS)].filter(
      (name) => !exported.has(name),
    );

    expect(stale, 'listed in COVERAGE/EXCLUSIONS but no longer exported').toEqual([]);
  });

  it('gives every exclusion a reason of its own', () => {
    Object.entries(EXCLUSIONS).forEach(([name, reason]) => {
      expect(reason.length, `${name} needs a real reason`).toBeGreaterThan(40);
    });
    expect(new Set(Object.values(EXCLUSIONS)).size).toBe(Object.keys(EXCLUSIONS).length);
  });
});
