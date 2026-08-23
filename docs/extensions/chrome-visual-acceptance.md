# Chrome visual acceptance — extension release candidate

Date: 2026-08-23 (Europe/Berlin)
Browser: Google Chrome controlled through the installed Codex Chrome bridge
Development URL: `http://127.0.0.1:2222/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline&timelineOverlayCanary=1&localTest=1&transcriptLaneFixture=1&runawayTimelineProject=demo-project`

Installed-Chrome follow-up URL: `http://127.0.0.1:2222/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline&localTest=1&timelineOverlayCanary=1&transcriptLaneFixture=render-matrix&runawayTimelineProject=runaway-8085`

## Disposition

**Conditional FAIL — the installed user-Chrome development journey now passes, but this is not yet a frozen or production acceptance gate.** The core extension host, all 13 shipped test extensions, Transcript Caption Foundry, Astrid Runaway, lifecycle and persistence, keyboard navigation, 566-item virtualization, multi-extension composition, degraded-data recovery, responsive lane actions, marker decluttering, the production runtime-control artifact, real browser renders, the installed-Chrome/Firefox/WebKit matrix, and the isolated 200% zoom/reduced-motion gate pass. The two concrete 1200 px defects found in the first review have host-owned fixes with fresh desktop/tablet/phone evidence. The remaining conditional-fail reasons are the signed-in production-surface checks, the frozen-candidate evidence run, human assistive-technology acceptance, and missing Edge availability.

The installed-Chrome follow-up is development-session evidence, not an immutable
release receipt. It does not convert the older screenshot ledger into evidence
for the eventual frozen candidate.

## Installed user-Chrome follow-up

The installed Codex Chrome bridge was connected to the real local editor after
the original capture run. The following behaviors were exercised in that live
session without touching unrelated browser tabs:

- Extension Manager showed all 13 reviewed extensions. Every extension was
  disabled and re-enabled; its contributions disappeared and returned without
  a page reload.
- Pulse Map disablement survived a full reload. Re-enablement also survived a
  full reload.
- All ten Creative Lab build commands were invoked through the real Command
  Palette. Together with Scene Phase Markers they produced 11 independently
  reachable marker layers across the host's two desktop pages. A later reload
  preserved the built extension data and Scene marker.
- The Runaway lane exposed 566 transitions at 48 fps across 8,085 frames while
  mounting at most 128 interactive items. End selected T0566 at frame 8,084 and
  shifted the window to 438–566; Home returned selection and the window to the
  start. Neither journey introduced body overflow.
- **Add missing** created one `Transcript Captions` track and four deterministic
  video-text clips for the non-empty render-matrix source items. Repeating the
  action did not duplicate IDs. Editing the first caption to include composed
  Unicode and emoji survived reload and another **Add missing** invocation.
  **Propose edits** followed by **Accept proposals** durably produced four
  `accepted-for-source-update` records while leaving the read-only transcript
  source separate from the editable video-text output.
- The short overlapping-caption edge discovered in this session now retains a
  selectable body between both trim handles; a handle click that never crosses
  the resize threshold selects the clip without resizing it.
- The live editor completed two consecutive user-Chrome renders. Each returned
  to the ready state with a fresh MP4 blob URL and timestamped download name;
  the second pass finished with zero console errors and zero failed tasks.
- Temporary viewport overrides at 390×844 and 768×1024 kept Render/Download,
  transcript actions, marker pagination, caption clips, and the virtualized
  Runaway lane usable and visually contained. The override was reset before
  handoff, leaving the editor at its normal desktop size.

The local follow-up recorded no unexpected editor console errors after the
deterministic local-test bootstrap fix. The user-Chrome blob remains available
as the live Download result but was not copied into release evidence, so the
retained, independently decodable MP4 claim below still comes from the
reproducible headless matrix.

## Completed acceptance matrix

| Area | Result | Evidence and exact observation |
| --- | --- | --- |
| Deterministic local-test bootstrap | PASS | `window.__REIGH_LOCAL_TEST__` reported enabled loader/runtime diagnostics. The strict Playwright gate made zero Supabase requests and emitted no console or page errors after the `useApiTokens`/`useOnboarding` fixes. |
| Extension inventory | PASS | Extension Manager listed 13 extensions: Scene Phase Markers, Transcript Caption Foundry, Astrid Runaway Timeline, and all ten Creative Lab extensions. |
| Enable/disable lifecycle | PASS | Each of the 13 toggles was disabled and enabled in Chrome. Its extension-specific surfaces disappeared while disabled and returned after re-enable. |
| Ordering | N/A | The current Extension Manager exposes enable/disable controls but no user reordering control. No unsupported ordering behavior was claimed or simulated. |
| Enablement persistence | PASS | The original joint Transcript/Runaway/Pulse Map cycle persisted. The installed-Chrome follow-up independently repeated Pulse Map disable → reload and enable → reload; both states persisted. |
| Transcript alone | PASS | The 2/2 transcript lane rendered with Runaway disabled. See [05](evidence/chrome-acceptance/05-transcript-lane-alone-runaway-disabled.png). |
| Runaway alone | PASS | The 10/10 Runaway fixture rendered with Transcript disabled. See [04](evidence/chrome-acceptance/04-runaway-lane-alone-transcript-disabled.png). |
| Transcript + Runaway composition | PASS | Both lanes remained distinguishable and readable together; selection/focus and provenance were visible. See [06](evidence/chrome-acceptance/06-combined-stable-desktop.png) and [09](evidence/chrome-acceptance/09-runaway-provenance-inspector.png). |
| Transcript caption materialization and round trip | PASS in installed-Chrome development session; upstream-owner acknowledgement pending | The original two-item fixture remains captured in [07](evidence/chrome-acceptance/07-transcript-captions-materialized.png) and [08](evidence/chrome-acceptance/08-transcript-caption-track.png). The follow-up render-matrix fixture created exactly four deterministic clips on one track, preserved an edited Unicode/emoji caption across reload and **Add missing**, and persisted review records without mutating the read-only source lane. The per-record inspector was then exercised in installed Chrome with mixed states: Boris persisted as `accepted-for-source-update`, the final overlapping source persisted as `rejected`, and the remaining records stayed pending. Selecting a caption clip and then a Transcript source showed the source/proposal inspector on the first click both hot and after a full reload. This proves materialization, proposal, individual review, persistence, and immutable-source behavior; a real upstream owner must still acknowledge an accepted fingerprint before `acknowledged-by-source-owner` can be signed off. |
| Persisted-caption no-op | PASS after fix | A fresh render preflight exposed an uncaught empty-patch validation error when **Add missing** was pressed after captions already existed. `renderTranscriptAsCaptions` now handles the intentional zero-operation preserve result before host validation; its activation-path regression passes and the browser probe emits no error. |
| Transcript keyboard navigation | PASS | Transcript items are buttons with roving `tabIndex`; click + End moved focus and selection to the final item and updated the inspector. Runaway Home/End navigation also selected the first/final item. See [10](evidence/chrome-acceptance/10-transcript-keyboard-focus.png). |
| Runaway provenance | PASS | Selecting T0007 displayed manifest/segment, milliseconds, frame/FPS, colour, run/task IDs, generated prompt, and summary. The selected lane item and inspector state were visually apparent. See [09](evidence/chrome-acceptance/09-runaway-provenance-inspector.png). |
| Runaway 566-item virtualization | PASS in installed-Chrome development session | The 48 fps / 8,085-frame lane reported 566 total transitions while mounting 128. End selected T0566 at frame 8,084 and moved the virtual window to 438–566; Home restored T0001 and the 0–128 window with no body overflow. |
| Creative Lab commands | PASS after host decluttering fix | All ten real command-palette build commands were invoked and persisted after reload. The original fully composed state is [11](evidence/chrome-acceptance/11-all-extensions-built-composed.png). Marker contributions are now deterministically paged without disabling their extensions: six layers per desktop/tablet page, three on phone, with a visible host legend and Prev/Next controls. See [25](evidence/chrome-acceptance/25-marker-layers-page-1.png), [26](evidence/chrome-acceptance/26-marker-layers-page-2.png), and [27](evidence/chrome-acceptance/27-marker-layers-phone.png). All 11 layers remain reachable and pointer ownership was exercised across all four pages in the integration gate. |
| Production build | PASS | A fresh pinned-Node-20 run of `npm run build` passed on the runtime-config implementation: 5,310 modules transformed and built in 4m 03s. The artifact loads `/runtime-config/v1/extensions.json`; release flags are no longer compiled into distinct bundles. Compile warnings are recorded below rather than hidden. |
| Parent/child kill-switch contract | PASS for built-artifact/runtime separation; signed-in production UI pending | `node --test scripts/runtime/*.test.mjs` passed 10/10 across four suites against the optimized artifact. The exact same bundle accepted the reviewed runtime variants without changing application assets; Docker/container invariants and the service-worker exclusion also passed. Runtime reads have a 4 s abort timeout and fail closed. Actual surface-removal evidence still requires the signed-in production page; the local installed-Chrome journey cannot substitute for it. |
| Real client render and download | PASS in headless Chromium and installed user Chrome development session | User Chrome completed two consecutive renders, exposing a fresh timestamped MP4 Download result each time; the second pass had zero console errors and zero failed tasks. Separately, the reproducible WebCodecs flow produced the retained Remotion 4.0.503 [MP4](evidence/chrome-acceptance/28-headless-caption-render-remotion-4.0.503.mp4). `ffprobe` verifies H.264 + AAC, 1280×720, 30 fps, and 315 H.264 packets ending exactly at the 10.500000 s composition boundary. AAC ends at 10.581333 s because of 81.333 ms encoder priming/padding, within the enforced five-block (106.667 ms) allowance. The retained artifact is 1,173,616 bytes. Extracted representative frames visibly prove the first and last fixture captions are encoded: [first](evidence/chrome-acceptance/29-remotion-4.0.503-first-caption.png), [last](evidence/chrome-acceptance/30-remotion-4.0.503-last-caption.png). The pinned-Node-20 gate recorded zero page errors, zero `CanvasFontStretch` console warnings, and zero matching CDP log entries. One Chromium GPU-driver `ReadPixels` warning remains, with exact text/location in [diagnostics](evidence/chrome-acceptance/28-render-console-diagnostics.json). |
| Runaway degraded states | PASS in headless Chromium; user Chrome pending | Typed loading, empty, error, retry, and recovery states are visible and accessible. Malformed data manually retries to two chips; offline makes one deduplicated request/error path and the `online` event automatically recovers on the second request. Strict local-test mode records zero Runaway console errors and zero page errors. See [17–21](#screenshot-ledger). |
| Cross-browser extension gate | PASS for installed Chrome, Firefox, and WebKit; Edge blocked by availability | Under Node 20.19.4, all three ship-critical flows passed per engine (9/9 total in 3.0m): inventory/host/diagnostics, composed 11-marker + Transcript + Runaway keyboard semantics, and 390×844 overflow/pager/menu geometry. Versions: Playwright 1.60.0; Chrome 151.0.7922.170; Firefox 150.0.2; WebKit 26.4. Edge is not installed at `/Applications/Microsoft Edge.app`, so no Edge pass is claimed. See [the dedicated gate](cross-browser-release-gate.md). |
| Accessibility and responsive extension-manager gate | PASS in isolated Chromium, Firefox, and WebKit; human assistive-technology acceptance pending | All 12 browser cases passed: the complete 13-extension inventory, accessible toggle names and pressed state, keyboard disable/re-enable with focus retention, visible focus, 24 px minimum targets, tablet/phone containment, 200% CSS page-content zoom, reduced motion, diagnostics expanded state, and sampled 4.5:1 text contrast. Run with `npm run test:e2e:extension-accessibility`; screenshots and traces are retained by Playwright. |

## Visual assessment at 1200 × 606

These are product observations, not capture-only artifacts:

- **PASS after fix — Transcript actions no longer clip.** Captures [07](evidence/chrome-acceptance/07-transcript-captions-materialized.png) and [09](evidence/chrome-acceptance/09-runaway-provenance-inspector.png) prove the original bug was real. Actions are now declarative data-kind descriptors rendered by the host as one sticky `Actions (3)` affordance. Its portal menu clamps to the viewport and remains fully visible at 1,440, 768, and 390 px in [22–24](#screenshot-ledger). Invocation is error-contained, receives the complete lane rather than the 128-item DOM window, supports full menu keyboard navigation, and recovers after a bounded 15 s timeout.
- **PASS after fix — the 390 px lane action rail no longer masks the transcript chip.** The host reserves an opaque sticky 80 px gutter only when actions exist. The phone gate independently proves the trigger and gutter are viewport-bounded, a readable chip segment remains visible, the chip and trigger do not overlap, pointer hit-testing reaches the trigger, and keyboard/menu focus behavior remains intact. Desktop density is unchanged.
- **PASS after fix — composed marker layers are deterministic and legible.** The original crowding is visible in [11](evidence/chrome-acceptance/11-all-extensions-built-composed.png). The host now pages marker primitives with a left-gutter legend: six layers on desktop/tablet and three on phone. It does not deactivate extensions or hide their non-marker UI. Captures [25–27](#screenshot-ledger) show materially lower density and distinct pages.
- **PASS after fix — shell and Scene Marker controls remain inside narrow viewports.** The shell preview/mode/edit regions are bounded at 1,600×1,000, 834×1,194 portrait, 1,180×820 landscape, and 420×820 phone. The Scene Markers row preserves the dense desktop line and wraps to two tablet rows and three phone rows; Mark, Track, Tail, Align, and Clear are all visible and interactive. See the shell captures in the ledger.
- **Human typography acceptance remains.** Transcript and Runaway inspectors use dense 11 px inline text. Automated 200% zoom, overflow, focus, reduced-motion, and sampled contrast checks now pass in Chromium, Firefox, and WebKit, but the human accessibility participant must still judge sustained readability and screen-reader flow.
- **Host-shell issue — floating edge rails obscure timeline boundaries.** The left/right pane-lock rails overlap the timeline edges at this height. They are global editor rails rather than extension surfaces, but they materially reduce the usable extension viewport.
- **Not an extension defect — low-contrast bottom labels are reserved placeholders.** `codePanel — M4`, `writingPanel — M4`, and `stagePanel — M3` are inert reserved shell slots. Their low contrast communicates placeholder chrome, but they should not be presented as active extension results in a production UI.
- **PASS — the data lanes themselves translate the model clearly.** Transcript phrases, Runaway transitions, the active selection/focus state, and provenance detail remain visually separable when both extensions are enabled.

A headless-Chromium geometry probe against the original implementation corroborated that action clipping was responsive behavior, not screenshot cropping: at 768 and 390 px all three controls remained at `x=1217…1431`. The post-fix gate performs pointer hit-testing, an actual trigger click, complete menu bounds assertions, and console/page-error collection at desktop/tablet/phone widths; all three pass. The installed user-Chrome follow-up also visually passed 390×844 and 768×1024 before restoring the default viewport; the frozen candidate still needs its signed manual receipt.

The accepted shell baseline changes are intentional layout corrections rather than relaxed tolerances. Desktop preview moved from `y=132, h=412` to `y=52, h=464`, while the edit area moved from `y=656, h=244` to `y=628, h=276`. Tablet portrait preview moved from `y=176` to `y=52`, edit area from `y=796, h=300` to `y=732, h=332`, and mode switcher from `x=60, y=620` to `x=88, y=500`. Phone preview moved from `y=368, h=164` to `y=216, h=268`, edit area from `y=612` to `y=564`, and mode switcher from `y=248` to `y=100`. Tablet landscape preview moved from `y=176, h=236` to `y=52, h=272`, with the edit area moving from `y=552, h=168` to `y=512, h=208`. Every measured region remains within its viewport.

## Pending Chrome gates

| Gate | Status / required evidence |
| --- | --- |
| Desktop, tablet, phone responsive matrix | PASS in headless Chromium and installed user Chrome development session for lane actions, marker density, shell containment, and render/download reachability; a signed frozen-candidate receipt remains pending. |
| 200% zoom and keyboard focus visibility | PASS in the isolated three-engine accessibility gate; frozen-candidate user-Chrome confirmation remains pending. |
| Empty/loading/malformed/offline/recovery in user Chrome | PASS in headless Chromium; manual confirmation in the frozen user-Chrome candidate remains pending. |
| Production preview UI | BLOCKED on signed-in production access. Production intentionally disables URL local mode; use the real signed-in application path and document any authentication/data prerequisite rather than adding a production backdoor. |
| Production parent/child surface removal | Built-artifact/runtime matrix PASS; actual signed-in production surfaces remain BLOCKED on production access. Exercise the same artifact with host-off, Transcript-off, and Runaway-off same-origin configs and prove UI/commands disappear. |
| Real Render and export in user Chrome | PASS twice in the installed development session with fresh MP4 blob/download results and zero console errors on the second pass. Repeat on the frozen candidate and retain the signed artifact before release. |
| Final Chrome console/page-error audit | Local installed-Chrome development journey PASS; a final signed-in production run must also be clean. |
| Microsoft Edge | BLOCKED by missing browser availability. Install Edge and run the opt-in `edge-stable` project; Chromium/Chrome evidence is not presented as an Edge substitute. |

## Automated evidence

Commands run against the reconciled release tree. The final focused source rerun used the pinned runtime (`node --version` → `v20.19.4`; `npm --version` → `10.8.2`):

```text
npx vitest run src/tools/video-editor/runtime/extensionReleaseControls.test.ts src/tools/video-editor/pages/VideoEditorPage.test.tsx
Result: 2 files passed, 48 tests passed

PLAYWRIGHT_TIMELINE_DEVICES=1 PLAYWRIGHT_PORT=2222 BASE_URL=http://127.0.0.1:2222 ASTRID_BRIDGE_PORT=17334 npx playwright test --config playwright.config.ts --project=timeline-devices --workers=1 tests/e2e/timeline/desktop-interaction.spec.ts
Result: 1 passed (19.2 s); zero forbidden Supabase calls; zero console/page errors

PATH=/Users/peteromalley/.nvm/versions/node/v20.19.4/bin:$PATH npm run test:e2e:extension-cross-browser
Result: PASS; 9/9 in 3.0m, one worker; Chrome stable 3/3, Firefox 3/3, WebKit 3/3

npm run build && node --test scripts/runtime/*.test.mjs
Result: PASS under Node v20.19.4; 5,310 modules transformed in 4m 03s; runtime/service-worker/container/artifact suites 10/10 passed

npx vitest run src/tools/video-editor/dev/runaway-timeline/runawayTimelineData.test.ts src/tools/video-editor/components/TimelineEditor/DataLaneList.test.tsx src/tools/video-editor/runtime/dataKindRegistrationService.test.ts src/tools/video-editor/dev/transcript-lane/__tests__/transcriptLane.test.tsx src/tools/video-editor/components/TimelineEditor/TimelineExtensionOverlayHost.integration.test.tsx
Result: PASS; 5 files, 77 tests

PLAYWRIGHT_TIMELINE_DEVICES=1 PLAYWRIGHT_PORT=2222 ASTRID_BRIDGE_PORT=17334 npx playwright test --config playwright.config.ts --project=timeline-devices --workers=1 tests/e2e/timeline/runaway-degraded-states.spec.ts tests/e2e/timeline/lane-action-responsive.spec.ts tests/e2e/timeline/marker-layer-pagination.spec.ts
Result: PASS under Node v20.19.4; 8 tests in 1.4m; zero unexpected page errors/console errors in the asserted flows

PLAYWRIGHT_OUTPUT_DIR=artifacts/playwright/chrome-acceptance-bkey-fixed-isolated ... extension-overlays.spec.ts --grep "B key marks"
Result: PASS under Node v20.19.4; 1/1 in 38.9 s

PLAYWRIGHT_OUTPUT_DIR=artifacts/playwright/chrome-acceptance-caption-bkey-fixed-sequence ... caption-render-export.spec.ts extension-overlays.spec.ts --grep "renders the materialized|B key marks"
Result: PASS under Node v20.19.4; 2/2 in 53.2 s, including caption-render → B-key ordering

PLAYWRIGHT_OUTPUT_DIR=artifacts/playwright/chrome-acceptance-phone-overlay-repeat ... extension-overlays.spec.ts --grep "touch marker drag and disable-mid-drag on phone"
Result: PASS under Node v20.19.4; 1/1 in 40.1 s; prior isolated repeat also passed 1/1 in 34.2 s
```

Test-harness friction found during the serial run: the old B-key probe treated the playhead's absolute `translateX(144px)` label-gutter origin as proof of a nonzero scrub because it only asserted `>40`. Its pointer-down also began inside that 144 px gutter, so the ruler handler could remain untouched while the assertion passed. The corrected probe starts beyond the measured zero-time transform and asserts the final-minus-initial content-position delta before checking the persisted marker. The once-failing caption-render → B-key order now passes with the stronger assertion. Per-run `PLAYWRIGHT_OUTPUT_DIR` support also prevents concurrent acceptance lanes from cleaning each other's traces.

The malformed generated-CSS warning found during the initial build review has
been fixed and is retained in the frictions log as a historical finding. The
build still reports the 5.23 MB main-chunk and mixed dynamic/static-import
warnings; they did not fail compilation, but remain release-quality debt rather
than clean-build evidence.

The first real-render probe additionally surfaced an upstream console-noise defect in `@remotion/web-renderer` 4.0.438: its text drawing path assigned computed CSS `fontStretch` value `100%` directly to `CanvasRenderingContext2D.fontStretch`, whose enum accepts named stretch values. Remotion 4.0.503 explicitly fixes percentage font-stretch rendering (#9918) and is now pinned. The repeatable Playwright render gate listens to both page console warnings and CDP `Log.entryAdded`; it now passes with zero matching warnings/entries. No warning was suppressed. The remaining single GPU `ReadPixels` warning is browser-driver performance telemetry at line/column 0 of the editor URL, not a JavaScript exception or a `CanvasFontStretch` recurrence.

Runtime rollout is configured with container/runtime environment variables, not `VITE_*` build variables:

```text
EXTENSION_HOST_ENABLED=true
TRANSCRIPT_CAPTION_FOUNDRY_ENABLED=true
RUNAWAY_TYPED_TIMELINE_ENABLED=true
EXTENSION_RELEASE_CONFIG_REVISION=rc1-chrome
```

The container writes these values to the same-origin runtime JSON and must be restarted to change the served configuration. The optimized application assets are reused unchanged.

### Superseded compile-time kill-switch bundle matrix

All four builds were made from Reigh `2fd5dcc4ea0e39fd3f224a92365cb91054b59221`. They are retained only as reproducible evidence that the resolver handled each raw flag combination. They **do not** prove a shippable rollback mechanism: changing an embedded Vite value requires a new build/deploy, and the reviewed Docker path did not supply these values. The same-origin runtime-config matrix must replace this evidence for the release gate.

| Variant | Compiled effective inputs | Result | Entry bundle SHA-256 |
| --- | --- | --- | --- |
| All on | `host=true`, `transcript=true`, `runaway=true`, `revision=rc1-chrome` | PASS (1m 40s) | `fd5761fcf6e46842054feda71657867f0a1a7cb81a8fee9af65d995b5c3ccf01` |
| Parent off, children requested on | `host=false`, `transcript=true`, `runaway=true`, `revision=rc1-host-off` | PASS (2m 48s) | `ac2c9ab3599fc5d73c3d0f002af9a0b6cd6274dab726605ea3c427461e5c22b8` |
| Transcript child off | `host=true`, `transcript=false`, `runaway=true`, `revision=rc1-transcript-off` | PASS (3m 06s) | `39b2e4befa48ddf2b45a62e8ce9cb7e0d535ec32c1e869a3123900de22688f89` |
| Runaway child off | `host=true`, `transcript=true`, `runaway=false`, `revision=rc1-runaway-off` | PASS (3m 06s) | `cf6c3fc1fe5387a00f1876cbbf465bce0f262b35aec5821853bb5724c1eb281e` |

The parent-off row intentionally retains `true` as the two raw child inputs. The tested runtime resolver still computes both child outcomes false because they depend on the parent. That proves the dependency rather than merely compiling all three inputs false.

## Screenshot ledger

Screenshots 06–11 are the historical pre-freeze evidence set. Captures 06–09 were taken on baseline `097bc6ece` plus the in-flight release/bridge changes later committed in this sequence; 10 additionally contains the Transcript keyboard fix later committed as `3450bdc3c`; 11 contains the composed Creative Lab state immediately after `f1c388a56` was committed. The later commits `91a025ca3`, `42a133208`, `642a4b485`, `0c0cf73fd`, `55ae69a9c`, and `2fd5dcc4e` were reconciled through focused automated tests and the fresh production build. The installed-Chrome follow-up above exercised the newer tree, but no new committed screenshot set was created; fresh captures still belong to the frozen-candidate evidence run.

| Capture | Time (+02:00) | SHA-256 |
| --- | --- | --- |
| [06 combined stable desktop](evidence/chrome-acceptance/06-combined-stable-desktop.png) | 18:31:29 | `9a39ad86c2a51df209ef2bf076ac0291f23101008bfd32529b2327c994f28082` |
| [07 captions materialized](evidence/chrome-acceptance/07-transcript-captions-materialized.png) | 18:32:13 | `8b5e1f55db57538690c237dbb1a4236e0d473a683d9a6b828f78470b163de155` |
| [08 caption track](evidence/chrome-acceptance/08-transcript-caption-track.png) | 18:32:23 | `e73bef35bb35a5c686ea3f1568923d06b7f35fd6aa5babf116a0224053907e8e` |
| [09 Runaway provenance inspector](evidence/chrome-acceptance/09-runaway-provenance-inspector.png) | 18:34:46 | `c098a22c8fdd8ca45d06a5eaab453a609e3fdbf4fdc935293894bd89bb31f052` |
| [10 Transcript keyboard focus](evidence/chrome-acceptance/10-transcript-keyboard-focus.png) | 18:37:15 | `ee37ed9944d0e5dc92f047c400b00f032b12f055d54f046026a1af4991c9f4a2` |
| [11 all extensions composed](evidence/chrome-acceptance/11-all-extensions-built-composed.png) | 18:45:18 | `efba0404e14beb0c0d3c94d5dbe5f2cf5ae556d693caf67c6ae7311e652c16a3` |
| [12 headless render complete](evidence/chrome-acceptance/12-headless-render-complete.png) | 19:09 | `281acd12e8631f77c8f4b0a5b804af0aac51383b1de4e6c3c9debe8efb261d40` |
| [12 rendered MP4](evidence/chrome-acceptance/12-headless-caption-render-timeline-render-2026-08-23T17-09-45-313Z.mp4) | 19:09 | `6372998e1485e750953bc6a1d9cbeb428a07cb42eb314733737a42ca7cae69e8` |
| [13 first caption preview at 3.57 s](evidence/chrome-acceptance/13-headless-first-caption.png) | 19:09 | `798293424ce65bc04ed9aa95944e1e8caebeae93ba4ab82279cb7cd91b756615` |
| [14 last caption preview at 9.43 s](evidence/chrome-acceptance/14-headless-last-caption.png) | 19:09 | `54b263554f3f4e45170465d900cf77f70799e76fd685abb11d4b1588de162d` |
| [15 first encoded caption frame](evidence/chrome-acceptance/15-export-first-caption.png) | 19:11 | `45722fdbce10f889680527546f5545edb14aff67dfe1cc80e381f419d7eb2883` |
| [16 last encoded caption frame](evidence/chrome-acceptance/16-export-last-caption.png) | 19:11 | `5d8164998232272e60ead9f7083f711a5caefab92e27fdde825fd2742823fc46` |
| [17 Runaway loading](evidence/chrome-acceptance/17-runaway-loading.png) | 20:10:28 | `fb35336edee66aa463a78aa99b015a2a8355d05c09d07b91438bfe7ee257652a` |
| [18 Runaway empty](evidence/chrome-acceptance/18-runaway-empty.png) | 20:10:28 | `1e3d96699550cf210ccbdc72b0f833ec29bc928afab9d081c6db9ae768684583` |
| [19 Runaway malformed/retry](evidence/chrome-acceptance/19-runaway-malformed-retry.png) | 20:10:38 | `ec4f7230f3a5644af5dc4764d6a3190fd5c4bef4a93e5b4e61bc66a2f1c4f7f5` |
| [20 Runaway offline](evidence/chrome-acceptance/20-runaway-offline.png) | 20:10:47 | `09ba6329dd232172a90ecb0da7aad97dee89677d6b4f48ff81f672ad3b91c06b` |
| [21 Runaway online recovered](evidence/chrome-acceptance/21-runaway-online-recovered.png) | 20:10:47 | `1d41b8b71aba1a5241765e1fccc99a240f005f68e0bcd50ad04f7f7b2c94a375` |
| [22 lane actions desktop](evidence/chrome-acceptance/22-lane-actions-desktop.png) | 20:09:56 | `061d75e41eb391c0a3d669ed3182cca234b09a97bf98413276b81236a03b9b48` |
| [23 lane actions tablet](evidence/chrome-acceptance/23-lane-actions-tablet.png) | 20:10:02 | `4993c0bd9644a587cc23c0fc5e35be4cdbe0900039f943f2e684ac9ad655611d` |
| [24 lane actions phone](evidence/chrome-acceptance/24-lane-actions-phone.png) | 20:10:08 | `32434ec8d86b29bdc0a05ad1ebcfc52c389b71ddf48d9ce358ef5ea198419f61` |
| [25 marker layers page 1](evidence/chrome-acceptance/25-marker-layers-page-1.png) | 20:10:14 | `1807885290e580f52a5747215522f35e4309f48627a935bd4954cdb037dc2aae` |
| [26 marker layers page 2](evidence/chrome-acceptance/26-marker-layers-page-2.png) | 20:10:14 | `60f89852331211095d57151de5537ccf458472fd555d3902398105e4ca59ec97` |
| [27 marker layers phone](evidence/chrome-acceptance/27-marker-layers-phone.png) | 20:10:20 | `aea3c25473eeabca34bddff54cacce617e06a26d9455ecfe92829ccddc6efcc1` |
| [25 responsive shell desktop](evidence/chrome-acceptance/25-shell-desktop-node20.png) | 20:10 | `024632a9c76b4beb8e9a9124012e772a04b1cdae8530997fc0b49cf3a2ad0c76` |
| [26 responsive shell tablet portrait](evidence/chrome-acceptance/26-shell-tablet-portrait-node20.png) | 20:10 | `0bdfc034521271103149c6ceae4d308e2c9a4b5dd7c480bd978d89585ff9db1e` |
| [27 responsive shell phone](evidence/chrome-acceptance/27-shell-phone-node20.png) | 20:10 | `fb9d1b63167bcaab80b4c9c5ffc6f2b3773d63e06cc906dc5bf3a0851e9f1fea` |
| [28 Remotion 4.0.503 render complete](evidence/chrome-acceptance/28-headless-remotion-4.0.503-render-complete.png) | 20:08 | `0a4e1f04b713e2308dab0b4ad5b0d2bbf57f52a7e50ec8131325b6cc051fd74c` |
| [28 Remotion 4.0.503 rendered MP4](evidence/chrome-acceptance/28-headless-caption-render-remotion-4.0.503.mp4) | 20:08 | `5079266095c956c87e03829c442da919f2d70a706f5ebbfcc275fa96e6b3e742` |
| [28 render console/CDP diagnostics](evidence/chrome-acceptance/28-render-console-diagnostics.json) | 20:08 | `830947ddc9e24f5e53a207e132e7773df8616fe28049bcc3cdcabc5a4458097e` |
| [29 first encoded caption after upgrade](evidence/chrome-acceptance/29-remotion-4.0.503-first-caption.png) | 20:08 | `2b90b7153c0e8d0c827d5918d0e91e37f87f28d0fff78acf738c6ba617e887b0` |
| [30 last encoded caption after upgrade](evidence/chrome-acceptance/30-remotion-4.0.503-last-caption.png) | 20:08 | `f102c972d2ffeb0c10f346deb459f064f39fda297d0ac33bb0c9d84c316f5001` |

Captures 17–27 were produced from the reconciled shared release tree after the Runaway recovery, host lane-action, marker paging, and responsive shell changes. The exact committed bases for the two host UI fixes are `5adf31f7b` and `75d9bca8b`; capture-time follow-up keyboard/timeout hardening in `DataLaneRow.tsx` was still unstaged at capture time and landed later. This distinction is intentional: the ledger records what the pixels prove and does not pretend that an in-flight shared worktree was a frozen release candidate.
