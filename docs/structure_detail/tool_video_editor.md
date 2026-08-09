# Video Editor Tool (Timeline)

> **Path**: `src/tools/video-editor/` | Multi-track timeline editor, extension host, and render pipeline. Largest tool in the repo (~680 TS/TSX files).

**Purpose**: orient a developer in the *timeline surface* — layers, state ownership, gesture systems, and the unwritten contracts that hold them together. The extension platform has its own doc suite (`docs/video-editor/`, start at `extensions-quickstart.md`); this doc covers the host.

**Source of Truth**: `hooks/useTimelineState.ts` (state composition) · `hooks/timelineStore.ts` (slice store) · `lib/mobile-interaction-model.ts` (interaction policy) · `lib/timeline-scale.ts` + `lib/coordinate-utils.ts` (geometry).

---

## 0. Daily commands

| Task | Command |
|---|---|
| Boot the timeline with demo clips, no Supabase/Docker/sign-in | `npm run dev:editor` (prints the local-mode URL; bridge stub + Vite) |
| Bridge stub alone (when Vite is already running) | `npm run dev:editor:bridge` |
| Run one test file | `npx vitest run <path>` — the root `vitest.config.ts` delegates to `config/testing/`, so the `--config` flag in the package scripts is **not** needed interactively |
| Watch one test file | `npx vitest <path>` |
| Everything in the tool | `npx vitest run src/tools/video-editor` (or a subdir, e.g. `.../lib`) |
| Real-browser device gestures | `npm run test:e2e:timeline` — one command; it boots the dev server *and* the bridge. One-time setup: `npx playwright install chromium` |
| Is the extension host wired? | open the editor with `?extensionSmoke=1`; the smoke extension's status contribution should appear |

The conformance suite is the slow one (~45s for the 3-file run) — for the edit
loop, watch the single file you are changing.

---

## 1. Layer map

Paths below are relative to `src/tools/video-editor/`.

| Layer | File | Owns |
|---|---|---|
| Page | `pages/VideoEditorPage.tsx` | Reads `?timeline` / `?localProject` + `?localTimeline`; picks the data provider; `remountKey` forces a clean remount per timeline |
| Runtime assembly (app) | `contexts/VideoEditorProvider.tsx` | Calls `useTimelineState()`, creates the store, assembles command/agent-tool/live-data registries, extension lifecycle, `ProcessManager` |
| Shared assembly | `contexts/editorRuntimeAssembly.tsx` | `useEditorRuntimeAssembly` / `useEditorRuntimeSync` / `EditorRuntimeScaffold` — the wiring itself (registries, extension lifecycle, proposal runtime, process manager, diagnostics) lives here once, for both hosts |
| Runtime assembly (embed) | `contexts/EditorRuntimeProvider.tsx` via `browser/BrowserVideoEditorProvider.tsx` | The browser/embed host. Owns host-specific ports (console vs toasts, lightbox, stubs, settings persistence) and its own **option set** into the shared assembly (`enableLiveData`, `enableShaderRegistry`, `eagerProposalRetry`, …) |
| Runtime context | `contexts/VideoEditorRuntimeContext.tsx` | `VideoEditorRuntimeContextValue` — the whole runtime (ports, registries, provider, ids). Wrapper is `VideoEditorRuntimeProvider`, accessor is `useVideoEditorRuntime()` |
| Shell | `components/ReighVideoEditorShell.tsx` → `components/TimelineEditorShellCore.tsx` | CSS-grid layout, toolbar, mode switcher placement, extension slots, activity region, contribution + timeline error boundaries |
| Editor core | `components/TimelineEditor/TimelineEditor.tsx` (re-export) → `components/ReighTimelineEditor.tsx` (shots / shot groups / variants glue) → `components/TimelineEditor/TimelineEditorCore.tsx` | Registers gestures, computes extent, per-clip render, `DropIndicator`. Mounted inside `TimelineErrorBoundary` (§9) |
| Canvas | `components/TimelineEditor/TimelineCanvas.tsx` | Ruler, grid, scroll container, pinch zoom, context menus, tool buttons |
| Rows / clips | `components/TimelineEditor/TrackListRenderer.tsx`, `ClipAction.tsx`, `TrackLabel.tsx`, `ShotGroupOverlay.tsx` | Markup that carries the DOM contract (§4) |

---

## 2. State ownership

`useTimelineState()` composes ~15 sub-hooks (queries, save, history, selection, clip editing, resize, external drop, drag coordinator, playback, render state, track management, ops) into **four slice objects**, then *pushes* them into a vanilla zustand store via `syncSlices()` each render. The store is a distribution mechanism, not the source of truth — the hook composition is.

| Slice | Contains | Read via |
|---|---|---|
| `data` | Resolved config, clips, refs, zoom, device class, interaction mode | `useTimelineEditorData` / `useTimelineDataSelector` |
| `ops` | Mutations (`applyEdit`, `moveClipToRow`, …), selection setters, `commands` | `useTimelineEditorOps` / `useTimelineOpsSelector`, `useTimelineCommands` |
| `chrome` | Panels, zoom setters, shell UI state | `useTimelineChromeContext` / `useTimelineChromeSelector` |
| `playback` | Preview refs, transport | `useTimelinePlaybackContext` / `useTimelinePlaybackSelector` |
| (adapters) | Mutable refs handed to gesture code (`dataRef`, `selectedClipIdsRef`, …) | `useTimelineMutableAdapters` |

**Safe vs non-Safe.** Non-`Safe` hooks throw when no `TimelineStoreProvider` is above them — use them **inside the mounted editor subtree**. `Safe` variants return `null` when there is no provider *or* the editor is not mounted — use them only for consumers that legitimately run with no editor open (e.g. "add to editor" affordances elsewhere in the app), and handle the `null`.

**Pre-sync ops throw.** Every function in the store's *initial* ops slice (`createInitialOpsSlice` in `timelineStore.ts`) throws, not just `commands.validate/dryRun/apply`. `useTimelineState` seeds the store during render, before descendants mount, so the mounted path never reaches them — a call that does means the consumer is rendering outside the editor and should be on a `Safe` hook. Per CLAUDE.md's "Context hooks" rule, that is a crash, not a silent no-op.

---

## 3. Three drag-and-drop systems

They coexist and do not share a mechanism. Match the gesture to its owner before touching anything.

| Gesture | System | Entry point |
|---|---|---|
| Clip move (incl. cross-track), shot-group drag | Custom **document-level pointer machine** | `hooks/useClipDrag.ts` (`document.addEventListener('pointerdown')`), commit logic in `useClipDrag.helpers.ts` |
| Clip trim | Same pointer-machine style, separate hook | `hooks/useClipResizeGesture.ts`, mounted from `TimelineCanvas.tsx` |
| Marquee select | Window-level pointer listeners | `hooks/useMarqueeSelect.ts` |
| Track reorder | **dnd-kit** (`useSortable`/`DragEndEvent`) | `TimelineEditorCore.tsx` sensors → `TrackListRenderer.tsx` / `TrackLabel.tsx` |
| External asset & tool drops | **HTML5 drag-and-drop** | `onTimelineDragOver`/`onTimelineDrop` in `TimelineEditorCore.tsx`; `draggable` sources in `TimelineCanvas.tsx`; `hooks/useExternalDrop.ts` |

`hooks/useDragCoordinator.ts` drives `components/TimelineEditor/DropIndicator.tsx` — a `createPortal`-to-`document.body` imperative indicator **shared by the pointer machine and the HTML5 leg**, styled by the `.drop-indicator-*` classes in `timeline-overrides.css`. Because it is portaled and imperative, it does not appear in the editor's React tree; grep the class names, not the JSX.

HTML5 DnD never fires on touch — any drag-only affordance needs a tap path (`shouldTapTimelineToolButtons`).

**Keyboard is the pointerless fourth path, and it must not fork the commit.** `hooks/useKeyboardShortcuts.ts` owns the window-level `keydown` map (all built-ins decline before extension keybindings dispatch; `isEditableTarget` gates the whole handler). Arrow keys move the selection on both axes: `ArrowUp`/`ArrowDown` across tracks via `moveSelectedClipsToTrack`, `Alt+ArrowLeft`/`Alt+ArrowRight` along time via `buildKeyboardTimeNudgeMutation` (`lib/keyboard-nudge.ts`) → `applyEdit`, the same builder-plus-`applyEdit` shape as `lib/keyboard-delete.ts` and therefore history-tracked like any other edit. The nudge builder routes through `planMultiDragMoves`/`applyMultiDragMoves` so a keypress lands where the equivalent drag would; it steps one frame with `precision` on and `COARSE_TIME_NUDGE_SECONDS` (0.5s) without, expands a pinned-group member to its group, and clamps a leftward nudge **once for the whole selection** so relative offsets survive at `t=0`. `Alt+Arrow` with no selection is still the precision playhead seek — the only other Alt combo in the file. There is no shortcut help surface in the editor today; adding one means listing these, not inventing a second source of truth.

---

## 4. Stringly DOM contract

The gesture layer's real API is class names and data attributes resolved with `closest()` / `querySelector()`. `lib/timeline-dom.ts` (`TIMELINE_DOM`) names every token below and is the **only** place they may be spelled: it exports the class/attribute constants, the selectors the gesture layer issues, the `dataset` keys it reads back, and one attribute builder per markup site. Import from there on both sides — a rename then breaks the build instead of the gesture.

| Token | Written by | Read by |
|---|---|---|
| `.clip-action` | `ClipAction.tsx` | `useClipDrag.ts`, `useClipDrag.helpers.ts`, `useMarqueeSelect.ts`, `timeline-overrides.css` |
| `.timeline-canvas-edit-area` | `TimelineCanvas.tsx` | `TimelineEditorCore.tsx` (`editAreaRef` + ad-hoc re-queries), `useClipDrag.ts`, `lib/drop-position.ts`, CSS |
| `data-clip-id` | `ClipAction.tsx`, `TrackListRenderer.tsx` | `useClipDrag.ts`, `useMarqueeSelect.ts` |
| `data-row-id` | `ClipAction.tsx`, `TrackListRenderer.tsx` | drag/drop row resolution |
| `data-selected` | `ClipAction.tsx` (`"true"` only when selected) | `tests/e2e/timeline/support.ts`, device probes, DevTools — selection state outside React |
| `data-resize-edge` | `TrackListRenderer.tsx` | `useClipResizeGesture.ts`, trim `touch-action` CSS |
| `data-touch-gesture-mode` | `TimelineCanvas.tsx` (edit area) | `timeline-overrides.css` only — this attribute *is* the touch mechanism |
| `data-shot-group-drag-anchor-clip-id` / `-row-id` | `ShotGroupOverlay.tsx` | `useClipDrag.ts`, `TimelineCanvas.tsx` hit-test exclusions |
| `data-action-id`, `data-track-id` | clip/track markup | hit-test exclusions in `TimelineCanvas.tsx`, `useMarqueeSelect.ts` |
| `data-video-editor-shell-region` | `TimelineEditorShellCore.tsx` | grid-row regression test |

CSS cannot import TypeScript, so `timeline-overrides.css` repeats the tokens as literals; `lib/timeline-dom.test.ts` pins every selector the stylesheet builds from the contract (plus the attribute↔`dataset` key pairs), and fails until the CSS follows a rename. `compositions/` also emits `data-clip-id`, but on the Remotion render surface — a different DOM, not this contract.

---

## 5. Mobile interaction: policy vs mechanism

`lib/mobile-interaction-model.ts` is a **pure policy module**: device class (`desktop|tablet|phone`), input modality, interaction mode (`browse|select|move|trim|precision`), gesture owner, plus predicates (`shouldAllowTouchClipDrag`, `shouldAllowTouchMarquee`, `resolveTouchGestureMode`, `shouldExpandTouchTrimHandles`, `shouldPinHoverAffordances`, `shouldTapTimelineToolButtons`, `shouldEnableTimelinePinchZoom`, …). Device class is resolved once in `useTimelineState.ts`, which supplies the values `resolveTimelineDeviceClass` decides from.

**Device class inputs.** `useIsMobile` is true for *any* coarse pointer at *any* width, so `isMobile && !isTablet` alone is not a phone test. `resolveTimelineDeviceClass` takes four values — `isMobile`, `isTablet`, `viewportWidth` (`useViewportWidth`), `isTabletHardware` (tablet UA / iPadOS-like, from `shared/hooks/mobile/deviceDetection.ts`) — and applies the owner's rule: **large coarse-pointer screens are desktops unless the hardware is a tablet.** Below `TABLET_MAX_WIDTH` (1200) a coarse pointer still means `phone`; at or above it, tablet hardware keeps `tablet` (an iPad Pro 12.9 in landscape is 1366px, past `computeIsTablet`'s own band) and everything else is `desktop` (a touchscreen monitor gets the desktop editor). The shared signals keep their app-wide semantics — the correction lives at this seam. Pinned by `mobile-interaction-model.test.ts` ("device class").

Policy answers *may this gesture happen*. It cannot make it happen. The **mechanisms** live elsewhere:

| Mechanism | Where |
|---|---|
| `touch-action: none` on the gesture's owner element | `timeline-overrides.css`, selected by `[data-touch-gesture-mode='move']` (clips) / `'trim'` (handles) / `'marquee'` (the edit area itself) |
| Expanded trim handles + grip affordance | `TimelineCanvas.tsx` handle width, CSS `::after` |
| Pinned (non-hover) affordances | `TrackLabel.tsx` (`shouldPinHoverAffordances`) |
| Tap-to-place tool buttons | `TimelineCanvas.tsx` (`shouldTapTimelineToolButtons`) |
| Mode switchers | `components/TimelineModeSwitcher.tsx`, placed by `TimelineEditorShellCore.tsx` — `bar` variant in the phone's single-pane row, `compact` variant inline in the tablet toolbar; variant chosen by `resolveTimelineModeSwitcherVariant(deviceClass, layout)`, `null` on desktop · `PropertiesPanel/ClipPanel.tsx` move/trim buttons (non-desktop, **requires a selected clip**) |
| Editor inset from the app's floating pane tabs | `shouldReserveAppPaneRailGutter` + `APP_PANE_RAIL_GUTTER_PX` → `paddingInline` on the shell's `main` (tablet); `pr-14` on the preview chip row (phone); `pt-14` on the dev header in `pages/VideoEditorPage.tsx` (touch) |

**Rule: a new gesture policy is not done until its mechanism ships in the same PR.** A touch that starts on `touch-action: auto` is claimed by the browser for native panning and the pointer stream is cancelled mid-drag; `preventDefault()` on `pointermove` cannot undo that (see the doc comment on `resolveTouchGestureMode`). jsdom cannot observe this, so unit tests will pass either way.

**Reachability.** Every `TimelineInteractionMode` is now reachable on every non-desktop device class: one component (`TimelineModeSwitcher`) renders both presentations, so the mode list, the ops calls and the `aria-pressed` semantics cannot drift between phone and tablet. Desktop is deliberately modeless and renders no switcher. Pinned by `TimelineEditorShellCore.test.tsx` ("mode switcher reachability") and by `tests/e2e/timeline/tablet-gestures.spec.ts` (`npm run test:e2e:timeline`).

**Enforcement.** `lib/mobile-interaction-conformance.test.tsx` renders the canvas and the shell over the whole (device class × interaction mode) matrix and binds every predicate to the markup or stylesheet rule that implements it — plus a coverage gate: a new export of `mobile-interaction-model.ts` fails the suite until it is either bound to a mechanism or listed in that file's `EXCLUSIONS` with a reason of its own. jsdom cannot see a browser claim a touch stream, so the suite asserts DOM/CSS contracts only; the gesture itself is proven by the committed device specs in `tests/e2e/timeline/` (`npm run test:e2e:timeline`, opt-in: its flag makes Playwright boot both the dev server and the bridge stub).

*Closed (was the last live gap)*: `shouldAllowTouchMarquee` permits touch marquee on tablet in `select` mode, but `resolveTouchGestureMode` used to return a mode only for `move`/`trim`, so no `touch-action` rule covered the select-mode edit area. The consequence was worse than a dead gesture — the left-to-right drag overscrolled at `scrollLeft: 0` and Chromium turned it into the back-navigation swipe, navigating the tab off the editor (which read as "the shell unmounted"; no error was thrown, so no error boundary could have helped). `resolveTouchGestureMode` now derives a third owner, `marquee`, from `shouldAllowTouchMarquee` itself, and the edit area carries `touch-action: none` in that mode. Select mode therefore does not pan — `browse` is the mode that pans. Pinned by the conformance suite above and by `ipad.mjs` (`tablet marquee: shell survives the drag`, `… selects clips`).

---

## 6. App mode vs dev Local mode

| | App mode | Local mode (dev only) |
|---|---|---|
| URL | `?timeline=<id>` (+ project selection) | `?localProject=<slug>&localTimeline=<id>` |
| Enabled by | default | `import.meta.env.DEV` + either the `?localProject`/`?localTimeline` params on entry (self-activating, and persists the flag) or `dev.videoEditor.localMode` in localStorage, toggled by `DevModeToggle` |
| Data provider | `data/SupabaseDataProvider.ts` | `data/AstridBridgeDataProvider.ts` → HTTP to the Vite proxy `/api/astrid` → `127.0.0.1:$VITE_ASTRID_BRIDGE_PORT` (default 17333), `config/vite/vite.config.ts` |
| Runtime provider | `contexts/VideoEditorProvider.tsx` (**both modes**) | same |

Only the `dataProvider`, ids, and `remountKey` differ — the provider component and shell are identical. `EditorRuntimeProvider` is *not* the local-mode provider; it is the embed/browser host. `src/app/hooks/useVideoEditorRouteState.ts` must read **both** `timeline` and `localTimeline`, or local mode renders the full-height shell inside the scrolling page layout. Tests/harnesses use `testing/InMemoryDataProvider.ts`; the port contract and its factory-plus-conformance doctrine live in `data/DataProvider.ts` + `data/conformance/`.

---

## 7. Zoom and coordinate semantics

The names mislead. Read this before touching anything width-shaped.

| Name | Meaning | Declared in |
|---|---|---|
| `scale` | **Seconds per ruler division — a constant, not the zoom** (`SCALE_SECONDS = 5`) | `lib/coordinate-utils.ts` |
| `scaleWidth` | **Pixels per division — this is the zoom level** | store `data`/`chrome` slices |
| `pixelsPerSecond` | `scaleWidth / scale` | `createTimelineScale`, `lib/timeline-scale.ts` |
| Bounds / step | `MIN_TIMELINE_SCALE_WIDTH` 40, `MAX_TIMELINE_SCALE_WIDTH` 500, `TIMELINE_ZOOM_STEP` 1.4, `clampTimelineScaleWidth` | `lib/timeline-scale.ts` |
| Layout constants | `ROW_HEIGHT` 36, `LABEL_WIDTH` 144, `TIMELINE_START_LEFT` | `lib/coordinate-utils.ts` |
| Extent | `computeTimelineExtent` → `{ scaleCount, totalWidth }`, `maxClipEndSeconds`, `TIMELINE_TRAILING_RUNWAY_SECONDS` 20 | `lib/timeline-scale.ts` (see Key Invariant 4) |

Both zoom paths route through the constants: toolbar +/- in `TimelineEditorShellCore.tsx` and pinch in `TimelineCanvas.tsx`. Keep it that way — do not reintroduce inline `1.4`/`40`/`500`.

`TimeRuler` takes one presentational escape hatch, `labelRightInsetPx`: the touch tool cluster docks over the ruler's right end, so `TimelineCanvas` tells the ruler how wide that cluster is and the ruler drops the major-tick *labels* that would land under it. Ticks, `contentWidth` and the scroll extent are untouched, so this cannot break the invariant above — do not grow it into a width adjustment.

---

## 8. Extensions

Full platform docs: **`docs/video-editor/`** (`extensions-quickstart.md`, `extension-author-contract.md`, `extensions-trust-envelope.md`, `extensions-debugging.md`, migration + release checklist). Extensions import only `@reigh/editor-sdk`, an alias to `src/sdk/index.ts` (`tsconfig.json`, `config/vite/vite.config.ts`), enforced by `src/sdk/boundary.test.ts`.

**`TimelineOverlayContribution` is a reserved contract — declarable, not host-wired.** The scaffolding that pretended otherwise is gone: `getTimelineOverlayContributions`, the overlay host div in `TimelineEditorCore.tsx`, its scroll/pointer-claim state, and the `onScroll` prop on `TimelineCanvas` that only fed it were all removed. What remains in `runtime/extensionSurface.ts` are the two *types* (`TimelineOverlayContribution`, `TimelineOverlayRenderProps`), kept exported for forward compatibility and marked reserved in their doc comments — the same posture as the reserved slots served by `RESERVED_SLOT_CANARY` in `TimelineEditorShellCore.tsx`. `timelineOverlay` contributions still normalize into `runtime.config.overlays` via `families/timelineOverlayAdapter.ts`; nothing renders them. For timeline-scoped extension UI today, use a `contextMenuItem` on a timeline target (`ExtensionContextMenuItems`, wired in `TimelineCanvas.tsx`).

---

## 9. Failure containment

| Boundary | Wraps | Recovery |
|---|---|---|
| `runtime/ContributionErrorBoundary.tsx` (`HostContributionErrorBoundary`) | every extension slot / dialog / panel / inspector section | "Retry", bounded + debounced, driven by the lifecycle host's recovery key |
| `components/TimelineEditor/TimelineErrorBoundary.tsx` | the timeline region only, mounted around `<TimelineEditor>` in all three shell layout branches | "Reload editor" bumps a local epoch used as both `recoveryKey` and the subtree `key`, so the children re-mount instead of re-rendering over the state that crashed |

Both refuse to auto-reset on a children-reference change once a recovery key exists — a persistently malformed clip would otherwise crash→recover→crash on every parent render. The timeline boundary is deliberately *narrow*: a throw in `ClipAction`/`TrackListRenderer` must leave the toolbar (and therefore undo), the preview and the inspector mounted. Pinned by `TimelineEditorShellCore.test.tsx` ("timeline error boundary").

---

## Key Invariants

1. **Grid rows == stacked regions.** `gridTemplateRows` in `TimelineEditorShellCore.tsx` must declare one row for every `data-video-editor-shell-region` child. An undeclared row lands in an implicit `auto` track and collapses the preview's `1fr` to zero height. Pinned by `TimelineEditorShellCore.test.tsx` ("declares one grid row for every stacked region").
2. **Every policy-allowed gesture ships its mechanism.** If a predicate in `mobile-interaction-model.ts` permits a touch gesture, some element must carry `touch-action: none` (today: via `data-touch-gesture-mode`) and some rendered control must reach the mode on that device class. Policy without mechanism compiles, unit-tests green, and fails only on a real device. Reachability is owned by `resolveTimelineModeSwitcherVariant` + `TimelineModeSwitcher`; adding a mode means adding it there, not in a per-layout copy. Enforced by `lib/mobile-interaction-conformance.test.tsx`, which walks the device-class × mode matrix against the rendered DOM and the stylesheet text, and refuses to pass on a new policy export that has neither a mechanism binding nor a documented exclusion.
3. **`node:*` is never a static value import.** `runtime/processes/` runs inside the browser bundle; a static import is externalized into a stub that throws at module load. Resolve lazily through `process.getBuiltinModule` (see `loadNodeChildProcess` in `ProcessManager.ts`). Type-only imports are fine. Enforced by the Node-builtin `no-restricted-imports` blocks in `eslint.config.js` (blanket ban under `src/`, plus an `allowTypeImports` carve-out for `runtime/processes/**`) and by `src/app/entry-import.smoke.test.ts`.
4. **Timeline geometry has one owner.** `computeTimelineExtent` in `lib/timeline-scale.ts` is the only place total width / division count is computed. `TimelineEditorCore.tsx` calls it once (default `TIMELINE_TRAILING_RUNWAY_SECONDS` = 20s of drag runway past the last clip) and feeds the result to the canvas (as `minScaleCount` = `maxScaleCount`); `TimelineCanvas.tsx` calls it with an explicit `trailingRunwaySeconds: 0` because the runway is its owner's call, reaching it through those bounds. Ruler width, grid width and scroll-content width must agree — pinned by `timeline-scale.test.ts` ("makes the canvas agree with its owner") and `TimelineEditorCore.test.tsx` ("sizes the ruler and the grid from the shared timeline extent"). A second formula is a bug.
5. **DOM tokens in §4 are load-bearing.** Spell them only through `TIMELINE_DOM` in `lib/timeline-dom.ts`; a literal anywhere else re-opens the silent-rename hole.
6. **The editor stays out of the app's edge gutters.** The app shell parks fixed `PaneControlTab`s at the four viewport edges and this is the only full-bleed page, so its chrome is the only chrome that lands under them. Insets go through `shouldReserveAppPaneRailGutter` / `APP_PANE_RAIL_GUTTER_PX` (§5), never by moving the shared tabs — every other tool depends on where they are.
7. **Shared assembly, per-host options.** Registry, extension-lifecycle, proposal-sync and process-manager *wiring* lives once in `contexts/editorRuntimeAssembly.tsx`; edit it there, not in the hosts. What must be threaded through both hosts is the **option set**: a new capability flag added to `useEditorRuntimeAssembly`/`useEditorRuntimeSync` has to be passed at both call sites (`VideoEditorProvider.tsx` and `EditorRuntimeProvider.tsx`) or app mode and embed mode drift. Duplicating wiring into a host is the bug this invariant exists to prevent.

---

## Cross-Cutting References

| Concern | See |
|---|---|
| Extension platform, SDK, trust model | `docs/video-editor/` |
| Timeline patch operations | `docs/video-editor/timeline-patch-operations.md` |
| Frontend architecture, shared hooks | `frontend_architecture.md`, `shared_utilities.md` |
| Context/state audit and fat-context gate | `docs/state_management_context_audit.md` |
| File-size and anti-pattern standards | `docs/code_quality_audit.md` |
