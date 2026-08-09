export type TimelineDeviceClass = 'desktop' | 'tablet' | 'phone';

export type TimelineInputModality = 'mouse' | 'touch' | 'pen' | 'keyboard' | 'unknown';

export type TimelineInteractionMode = 'browse' | 'select' | 'move' | 'trim' | 'precision';

/**
 * The gesture-ownership modes the stylesheet keys on. Not a subset of
 * `TimelineInteractionMode`: `marquee` is the *gesture* select mode hands to the
 * edit area, not an interaction mode of its own.
 */
export type TimelineTouchGestureMode = 'move' | 'trim' | 'marquee';

export type TimelineGestureOwner =
  | 'none'
  | 'timeline'
  | 'ruler'
  | 'clip'
  | 'trim'
  | 'preview'
  | 'inspector'
  | 'shell';

export type TimelineInteractionTargetKind =
  | 'clip'
  | 'shader'
  | 'track'
  | 'timeline'
  | 'selection'
  | 'preview'
  | 'overlay'
  | 'shell';

export interface TimelineInteractionTarget {
  kind: TimelineInteractionTargetKind;
  clipId?: string | null;
  trackId?: string | null;
  clipIds?: string[];
  shaderScope?: 'clip' | 'postprocess';
  shaderId?: string | null;
  extensionId?: string | null;
  contributionId?: string | null;
}

export type TimelineContextTarget = TimelineInteractionTarget | null;
export type TimelineInspectorTarget = TimelineInteractionTarget | null;

export interface MobileInteractionPolicy {
  deviceClass: TimelineDeviceClass;
  inputModality: TimelineInputModality;
  interactionMode: TimelineInteractionMode;
  gestureOwner: TimelineGestureOwner;
  precisionEnabled: boolean;
  contextTarget: TimelineContextTarget;
  inspectorTarget: TimelineInspectorTarget;
}

export function resolveTimelineDeviceClass({
  isMobile,
  isTablet,
}: {
  isMobile: boolean;
  isTablet: boolean;
}): TimelineDeviceClass {
  if (isTablet) {
    return 'tablet';
  }

  return isMobile ? 'phone' : 'desktop';
}

export function resolveInputModalityFromPointerType(
  pointerType: string | null | undefined,
): TimelineInputModality {
  switch (pointerType) {
    case 'mouse':
      return 'mouse';
    case 'touch':
      return 'touch';
    case 'pen':
      return 'pen';
    default:
      return 'unknown';
  }
}

export function getDefaultInteractionMode(
  deviceClass: TimelineDeviceClass,
): TimelineInteractionMode {
  return deviceClass === 'phone' ? 'browse' : 'select';
}

export function createMobileInteractionPolicy(
  deviceClass: TimelineDeviceClass,
): MobileInteractionPolicy {
  return {
    deviceClass,
    inputModality: 'unknown',
    interactionMode: getDefaultInteractionMode(deviceClass),
    gestureOwner: 'none',
    precisionEnabled: false,
    contextTarget: null,
    inspectorTarget: null,
  };
}

export function isTouchTimelineInput(
  deviceClass: TimelineDeviceClass,
  inputModality: TimelineInputModality,
): boolean {
  return inputModality === 'touch' && (deviceClass === 'phone' || deviceClass === 'tablet');
}

export function shouldAllowTouchClipDrag(
  deviceClass: TimelineDeviceClass,
  inputModality: TimelineInputModality,
  interactionMode: TimelineInteractionMode,
): boolean {
  if (!isTouchTimelineInput(deviceClass, inputModality)) {
    return true;
  }

  return interactionMode === 'move';
}

export function shouldAllowTouchMarquee(
  deviceClass: TimelineDeviceClass,
  inputModality: TimelineInputModality,
  interactionMode: TimelineInteractionMode,
): boolean {
  if (!isTouchTimelineInput(deviceClass, inputModality)) {
    return true;
  }

  return deviceClass === 'tablet' && interactionMode === 'select';
}

export function shouldExpandTouchTrimHandles(
  deviceClass: TimelineDeviceClass,
  inputModality: TimelineInputModality,
  interactionMode: TimelineInteractionMode,
): boolean {
  return isTouchTimelineInput(deviceClass, inputModality) && interactionMode === 'trim';
}

/**
 * Which element owns the touch gesture, keyed into the stylesheet as
 * `data-touch-gesture-mode`. `move` hands it to the clips, `trim` to the trim
 * handles, `marquee` to the scrolling edit area itself (the marquee starts on
 * empty canvas, so the scroll container *is* the owner).
 *
 * Whatever the returned mode selects must set `touch-action: none`, or the
 * browser claims the touch for native panning and cancels the pointer stream
 * mid-drag — `preventDefault()` on pointermove cannot undo that. On a real
 * tablet the marquee case did worse than die: with the edit area left at
 * `touch-action: auto` a left-to-right drag at `scrollLeft: 0` overscrolled into
 * the browser's back-navigation gesture and took the tab off the editor
 * entirely, which reads as "the shell unmounted" (see `tests/e2e/timeline/tablet-gestures.spec.ts`).
 *
 * `marquee` costs select mode its native panning, deliberately: gesture
 * ownership is per-mode, and `browse` is the mode that pans.
 *
 * Deliberately keyed on device class rather than `inputModality`: the CSS has to
 * be in place before the first pointer event, which is what resolves the modality.
 */
export function resolveTouchGestureMode(
  deviceClass: TimelineDeviceClass,
  interactionMode: TimelineInteractionMode,
): TimelineTouchGestureMode | null {
  if (deviceClass === 'desktop') {
    return null;
  }

  if (interactionMode === 'move' || interactionMode === 'trim') {
    return interactionMode;
  }

  // Derived from the marquee predicate rather than restating its device/mode
  // matrix, so permission and mechanism cannot drift apart again.
  return shouldAllowTouchMarquee(deviceClass, 'touch', interactionMode) ? 'marquee' : null;
}

/**
 * Whether affordances that desktop reveals on hover must be pinned open instead.
 * Touch devices never fire hover, so anything behind `group-hover` is invisible
 * and unreachable there.
 *
 * Keyed on device class rather than `inputModality` for the same reason as
 * `resolveTouchGestureMode`: the markup has to be correct before the first
 * pointer event, which is what resolves the modality.
 */
export function shouldPinHoverAffordances(deviceClass: TimelineDeviceClass): boolean {
  return deviceClass !== 'desktop';
}

/**
 * Whether the timeline's floating tool buttons act on tap instead of exposing an
 * HTML5 drag source. HTML5 drag-and-drop never fires on touch, so the drag-only
 * affordance is inert there and the tap itself has to place the item.
 */
export function shouldTapTimelineToolButtons(deviceClass: TimelineDeviceClass): boolean {
  return deviceClass !== 'desktop';
}

/**
 * Horizontal band at each viewport edge occupied by the host app's floating
 * pane-control tabs (`shared/components/PaneControlTab.tsx`: ToolsPane left,
 * TasksPane right, both `position: fixed` and vertically centred). 46px of tab
 * plus breathing room.
 */
export const APP_PANE_RAIL_GUTTER_PX = 52;

/**
 * Whether the editor insets itself from the left/right viewport edges to clear
 * those tabs.
 *
 * The editor is the app's only full-bleed page, so it is the only one that puts
 * interactive chrome under them. On tablet the tabs are touch-sized (46px),
 * `pointer-events: auto` and `touch-none`, so anything beneath is not merely
 * hidden but unreachable — in landscape they sat on the toolbar's save-status
 * badge, in portrait on the track labels.
 *
 * Phone is excluded: 104px is a quarter of the viewport, and there the tabs land
 * on the preview rather than on chrome. Desktop is excluded: its 42px tabs clear
 * the toolbar row by all but a few pixels, and the layout is otherwise unchanged.
 */
export function shouldReserveAppPaneRailGutter(deviceClass: TimelineDeviceClass): boolean {
  return deviceClass === 'tablet';
}

/** How the timeline mode switcher is presented, if at all. */
export type TimelineModeSwitcherVariant = 'bar' | 'compact';

/** Which shell layout is asking. Single-pane is the phone's stacked layout. */
export type TimelineShellLayout = 'single-pane' | 'split';

/**
 * Which mode-switcher presentation a device class and layout get, or `null` for
 * none.
 *
 * Every non-desktop mode must be reachable by some rendered control — a policy
 * that permits a touch gesture only in `move`/`trim` is inert if nothing can
 * *reach* `move`/`trim` (Key Invariant 2 in `docs/structure_detail/tool_video_editor.md`).
 * Tablet used to fall in that hole: it defaults to `select`, the full-width bar
 * was gated on the phone's single-pane layout, and the inspector's move/trim
 * buttons require a clip to already be selected.
 *
 * Desktop deliberately returns `null`: its input model is modeless — hover
 * affordances, drag handles and marquee all coexist without a mode, so a
 * switcher there would be dead chrome.
 */
export function resolveTimelineModeSwitcherVariant(
  deviceClass: TimelineDeviceClass,
  layout: TimelineShellLayout,
): TimelineModeSwitcherVariant | null {
  if (deviceClass === 'desktop') {
    return null;
  }

  return layout === 'single-pane' ? 'bar' : 'compact';
}

/** Whether any mode switcher is rendered for this device class and layout. */
export function shouldShowTimelineModeSwitcher(
  deviceClass: TimelineDeviceClass,
  layout: TimelineShellLayout,
): boolean {
  return resolveTimelineModeSwitcherVariant(deviceClass, layout) !== null;
}

/**
 * Whether a two-finger pinch on the timeline drives zoom. Touch only: a desktop
 * trackpad pinch arrives as a ctrl+wheel event rather than a two-touch stream,
 * and the toolbar +/- buttons already serve pointer users.
 */
export function shouldEnableTimelinePinchZoom(deviceClass: TimelineDeviceClass): boolean {
  return deviceClass !== 'desktop';
}

export function shouldToggleTouchSelection(
  deviceClass: TimelineDeviceClass,
  inputModality: TimelineInputModality,
  interactionMode: TimelineInteractionMode,
): boolean {
  return isTouchTimelineInput(deviceClass, inputModality) && interactionMode === 'select';
}

export function shouldPreserveTouchSelectionForMove(
  deviceClass: TimelineDeviceClass,
  inputModality: TimelineInputModality,
  interactionMode: TimelineInteractionMode,
): boolean {
  return isTouchTimelineInput(deviceClass, inputModality) && interactionMode === 'move';
}

export function areTimelineInteractionTargetsEqual(
  left: TimelineInteractionTarget | null | undefined,
  right: TimelineInteractionTarget | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  if (left.kind !== right.kind || left.clipId !== right.clipId || left.trackId !== right.trackId) {
    return false;
  }

  const leftClipIds = left.clipIds ?? [];
  const rightClipIds = right.clipIds ?? [];
  if (leftClipIds.length !== rightClipIds.length) {
    return false;
  }

  return leftClipIds.every((clipId, index) => clipId === rightClipIds[index]);
}
