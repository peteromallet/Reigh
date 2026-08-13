/**
 * The timeline's DOM contract, named.
 *
 * The gesture layer has no React props into the render layer: it resolves its
 * targets out of the document with `closest()` / `querySelector()` and reads
 * their `dataset`. Those class names and data attributes are the actual API
 * between the two layers, so both sides import them from here — a rename is a
 * compile-time change instead of a silently dead gesture.
 *
 * CSS cannot import TypeScript. `timeline-overrides.css` repeats these tokens
 * as literals, and `timeline-dom.test.ts` fails until the stylesheet matches
 * the constants below.
 */

// ── Class names ────────────────────────────────────────────────────────────

/** Root element of a rendered clip. The drag machine's hit target. */
export const CLIP_ACTION_CLASS = 'clip-action';
/** The canvas scroll container; also the coordinate origin for drops and marquee. */
export const EDIT_AREA_CLASS = 'timeline-canvas-edit-area';

// ── Data attributes ────────────────────────────────────────────────────────

export const CLIP_ID_ATTR = 'data-clip-id';
/**
 * `"true"` on a selected clip root, absent otherwise.
 *
 * Selection used to be readable only as a Tailwind accent border, so every
 * out-of-React reader (e2e specs, device probes, DevTools) matched
 * `border-sky-400`/`border-violet-400` — which a theming change silently turns
 * into "0 selected". The attribute is the contract; the border is presentation.
 */
export const CLIP_SELECTED_ATTR = 'data-selected';
export const ROW_ID_ATTR = 'data-row-id';
export const RESIZE_EDGE_ATTR = 'data-resize-edge';
export const ACTION_ID_ATTR = 'data-action-id';
export const TRACK_ID_ATTR = 'data-track-id';
export const TOUCH_GESTURE_MODE_ATTR = 'data-touch-gesture-mode';
export const SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR = 'data-shot-group-drag-anchor-clip-id';
export const SHOT_GROUP_DRAG_ANCHOR_ROW_ID_ATTR = 'data-shot-group-drag-anchor-row-id';
export const SHELL_REGION_ATTR = 'data-video-editor-shell-region';

/**
 * Host-owned marker on the one timeline-overlay wrapper that is interactive
 * while it holds the pointer claim. Marquee and the empty-canvas context menu
 * treat any element bearing it as interactive and ignore pointerdowns on it,
 * so an overlay drag can never start a marquee or open a menu on the same
 * event. Every other overlay wrapper stays click-through and must not carry it.
 *
 * Set by the overlay host (see `TimelineExtensionOverlayHost`), never by
 * extension code; the literal string is not part of the extension contract.
 */
export const OVERLAY_INTERACTIVE_ATTR = 'data-overlay-interactive';

/** `data-action-id` value marking a pinned shot-group label. */
export const SHOT_GROUP_LABEL_ACTION_ID = 'shot-group-label';

export const TIMELINE_DOM = {
  clipActionClass: CLIP_ACTION_CLASS,
  editAreaClass: EDIT_AREA_CLASS,
  clipId: CLIP_ID_ATTR,
  clipSelected: CLIP_SELECTED_ATTR,
  rowId: ROW_ID_ATTR,
  resizeEdge: RESIZE_EDGE_ATTR,
  actionId: ACTION_ID_ATTR,
  trackId: TRACK_ID_ATTR,
  touchGestureMode: TOUCH_GESTURE_MODE_ATTR,
  shotGroupDragAnchorClipId: SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR,
  shotGroupDragAnchorRowId: SHOT_GROUP_DRAG_ANCHOR_ROW_ID_ATTR,
  shellRegion: SHELL_REGION_ATTR,
  overlayInteractive: OVERLAY_INTERACTIVE_ATTR,
} as const;

// ── Selectors (mirroring the queries the gesture layer actually issues) ─────

export const CLIP_ACTION_SELECTOR = `.${CLIP_ACTION_CLASS}` as const;
export const EDIT_AREA_SELECTOR = `.${EDIT_AREA_CLASS}` as const;
export const CLIP_ACTION_WITH_ID_SELECTOR = `.${CLIP_ACTION_CLASS}[${CLIP_ID_ATTR}]` as const;
/** Every currently selected clip. The out-of-React read of selection state. */
export const SELECTED_CLIP_SELECTOR = `[${CLIP_ID_ATTR}][${CLIP_SELECTED_ATTR}="true"]` as const;
export const RESIZE_EDGE_SELECTOR = `[${RESIZE_EDGE_ATTR}]` as const;
export const SHOT_GROUP_DRAG_ANCHOR_SELECTOR = `[${SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR}]` as const;

/**
 * Marquee ignores pointerdowns that land on a clip, any positioned action
 * slot, or the host-owned overlay-interactive wrapper holding a pointer claim.
 */
export const MARQUEE_IGNORE_SELECTOR =
  `${CLIP_ACTION_SELECTOR}, [${ACTION_ID_ATTR}], [${OVERLAY_INTERACTIVE_ATTR}]` as const;

/**
 * The empty-canvas context menu only opens away from clips, tracks, controls
 * and host-owned overlay-interactive elements.
 */
export const TIMELINE_AREA_CONTEXT_MENU_IGNORE_SELECTOR =
  `[${ACTION_ID_ATTR}], [${TRACK_ID_ATTR}], [${SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR}], [${OVERLAY_INTERACTIVE_ATTR}], button, input, textarea, select, [role="menuitem"]` as const;

// ── dataset keys ───────────────────────────────────────────────────────────
// `element.dataset.<key>` is the read side of the attributes above; the test
// asserts each pair still agrees so a renamed attribute cannot leave a stale
// reader behind.

export const CLIP_ID_DATASET_KEY = 'clipId';
export const ROW_ID_DATASET_KEY = 'rowId';
export const RESIZE_EDGE_DATASET_KEY = 'resizeEdge';
export const SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_DATASET_KEY = 'shotGroupDragAnchorClipId';
export const SHOT_GROUP_DRAG_ANCHOR_ROW_ID_DATASET_KEY = 'shotGroupDragAnchorRowId';
export const OVERLAY_INTERACTIVE_DATASET_KEY = 'overlayInteractive';

/** `data-shot-group-drag-anchor-row-id` → `shotGroupDragAnchorRowId`. */
export const datasetKeyForAttribute = (attribute: string): string =>
  attribute
    .replace(/^data-/, '')
    .replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase());

// ── Attribute builders (the write side, one per markup site) ───────────────

/**
 * `ClipAction` root — the drag machine's hit target, and the selection readout.
 *
 * `data-selected` is emitted only when selected (React drops `undefined`), so
 * `[data-selected="true"]` is an exact match for the selected set.
 */
export const clipActionAttrs = (clipId: string, rowId: string, selected = false) => ({
  [CLIP_ID_ATTR]: clipId,
  [ROW_ID_ATTR]: rowId,
  [CLIP_SELECTED_ATTR]: selected ? 'true' : undefined,
});

/** `TrackListRenderer` row container. */
export const rowAttrs = (rowId: string) => ({
  [ROW_ID_ATTR]: rowId,
});

/** `TrackListRenderer` positioned wrapper around one clip. */
export const actionSlotAttrs = (actionId: string, rowId: string) => ({
  [ACTION_ID_ATTR]: actionId,
  [ROW_ID_ATTR]: rowId,
});

/** `TrackListRenderer` trim handle. */
export const resizeHandleAttrs = (edge: 'left' | 'right', clipId: string, rowId: string) => ({
  [RESIZE_EDGE_ATTR]: edge,
  [CLIP_ID_ATTR]: clipId,
  [ROW_ID_ATTR]: rowId,
});

/** `TrackLabel` row header. */
export const trackLabelAttrs = (trackId: string) => ({
  [TRACK_ID_ATTR]: trackId,
});

/** `ShotGroupOverlay` label — drags the group via its anchor clip. */
export const shotGroupLabelAttrs = (anchorClipId: string, anchorRowId: string) => ({
  [ACTION_ID_ATTR]: SHOT_GROUP_LABEL_ACTION_ID,
  [SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR]: anchorClipId,
  [SHOT_GROUP_DRAG_ANCHOR_ROW_ID_ATTR]: anchorRowId,
});

/** `TimelineCanvas` edit area — this attribute *is* the touch mechanism (see CSS). */
export const touchGestureModeAttrs = (mode: string | null | undefined) => ({
  [TOUCH_GESTURE_MODE_ATTR]: mode ?? undefined,
});

/** `TimelineEditorShellCore` stacked grid regions. */
export const shellRegionAttrs = (region: string) => ({
  [SHELL_REGION_ATTR]: region,
});
