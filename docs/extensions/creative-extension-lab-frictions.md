# Creative Extension Lab: Authoring Frictions

Date started: 2026-08-23

This is a live report. Each sequential implementation records what made a
public video-editor extension harder to author, validate, load, compose, or
test than it should be. Frictions are fixed in-scope when the correction is
small, general, and regression-testable; broader design work is recorded with
evidence and a concrete improvement direction.

## Baseline

- The pre-existing worktree contains uncommitted extension-foundation and
  timeline changes. New lab work must stay additive and must not overwrite or
  normalize those user-owned changes.
- `npm run test:extensions` initially failed inside the filesystem sandbox
  because `tsx` could not create its IPC socket under the macOS temporary
  directory (`listen EPERM`). Running the same suite with approved unsandboxed
  execution passed: 5 test files and 1,118 tests.
- Chrome was initially unavailable because the ChatGPT Chrome extension was
  not installed/connected. After installation it connected successfully and
  is now driving the real local editor for the end-to-end pass.

## Early architecture observations

1. **The authoring docs describe two generations of extension shape.**
   `docs/extensions/authoring.md` begins with an older `ExtensionPackage`
   manifest-plus-config example while current DEV examples use
   `defineExtension`, `ReighExtension`, flat contribution arrays, and
   `@reigh/editor-sdk`. This creates immediate uncertainty about the canonical
   starting point.

2. **A smallest useful extension spans several manually synchronized seams.**
   Authors currently coordinate the TypeScript definition, JSON manifest,
   imperative renderer/handler registration, `devLocalExtensions`, and one or
   more test harnesses. Contribution IDs, command IDs, and render IDs must stay
   aligned without a scaffold or single validation command tailored to one
   extension directory.

3. **Most creative persona choices converge on the ruler overlay.**
   The public overlay is a strong primitive, but it is ruler-only. Concepts
   that naturally want track-local bands, clip-body highlights, hover cards,
   or 2D panels must compress their interaction into markers or add another
   contribution family.

4. **Media intelligence is not a public extension service.**
   Audio beats, waveform silence, captions/transcripts, pixels, visual
   continuity, and semantic concepts are not generally available through the
   public snapshot. Honest deterministic V1s therefore use timeline structure,
   explicit metadata, or extension-owned cue data and must avoid implying real
   media analysis.

## Sequential build notes

### 1. Beat-Synesthesia Pulse Map

- Built as a public-SDK-only command plus interactive timeline overlay. Focused
  verification passes 7/7 tests and the release drift gate recognizes nine
  checked-in manifests with zero warnings.
- The first implementation incorrectly treated `TimelineSnapshot` clip timing
  as frame counts and divided it by a fixed 24fps. A Sol audit compared the
  extension to the production reader and renderer and proved that `clip.at` and
  `clip.duration` are already seconds. Because the unit tests copied the same
  mistaken fixtures, they were green while production output was wrong by 24x.
  All ten implementations, fixtures, and the public SDK comments now agree on
  seconds; a fractional-seconds regression prevents the assumption returning.
- The original drift scanner inspected only immediate child directories and
  warned that the `creative-lab` grouping folder lacked a manifest. The scanner
  now discovers manifests recursively, treats entrypoint-containing directories
  as extensions, and allows pure grouping directories. The release check proves
  the grouped manifest is validated.
- Interactive overlay drags can outlive the render snapshot that created their
  callback. The first implementation captured a stale snapshot. It now reads a
  fresh snapshot at commit time, and a regression assertion proves the emitted
  patch uses the newer base version.
- The marker layer makes time dragging straightforward, but its generic shape
  offers no built-in persistence/version helper. Every interactive overlay must
  repeat the fresh-read, normalize, namespaced-write, and error-handling pattern.

### 2. Soundtrack Cartographer

- Built as a structural pacing/terrain heuristic, explicitly not an audio
  analyzer. Focused verification passes 7/7 tests, ESLint passes, and the
  release drift gate validates ten manifests with zero warnings.
- The implementation agent finished the files but stalled during its broader
  validation phase and did not return after several bounded waits. The run was
  interrupted and the same focused Vitest, ESLint, and release drift checks
  completed directly in under two seconds. Extension authoring guidance should
  define a fast per-extension validation command before sending authors into
  repository-wide gates.
- This second overlay repeated nearly the same lifecycle harness, project-data
  guards, marker mapping, and fresh-snapshot commit plumbing as Pulse Map. That
  duplication is already strong evidence for a public test harness and a small
  namespaced marker-data helper, while keeping each example's creative analysis
  function independent.

### 3. Caption Safe-Zone Orchestra

- Built as an explicitly structural accessibility proxy: negative starts,
  caption-like clips shorter than 0.8 seconds, same-track overlaps, and
  caption-like clips placed on audio tracks. Focused verification passes 8/8
  extension tests; the drift gate validates eleven manifests.
- The public snapshot has no caption text, bounding boxes, rendered geometry,
  text contrast, or safe-area metadata. True caption safe-zone validation
  cannot be authored honestly on the current public surface. The extension's
  naming and diagnostics therefore call the V1 a structural proxy.
- The first implementation bounded persisted output but could still perform
  quadratic overlap work over an unbounded clip list. Analysis now caps input
  at 512 caption-like clips and stops each sorted interval scan as soon as
  overlap becomes impossible; the hostile-size test covers the bound.
- Three extensions repeated a verbose ten-position `createExtensionContext`
  call plus command/renderer registries. A shared Creative Lab lifecycle
  harness now centralizes that host-internal construction and exposes named
  snapshot, command, renderer, patch, and disposal operations. Its own focused
  regression test passes and remaining extension tests can use it.
- TypeScript and JSON manifests still duplicate declarations. Each extension
  currently needs an explicit alignment assertion; a generator or canonical
  manifest source remains the better long-term fix.

### 4. Emotional Weather Map

- Built as a structural pacing forecast from clip starts, durations, and gaps;
  no audio, transcript, semantic, or model signal is claimed. Focused
  verification passes 8/8 tests and the drift gate validates twelve manifests.
- This is the first extension test to use the shared Creative Lab harness. The
  activation/disposal and fresh-snapshot drag test is materially shorter and no
  longer depends on the positional context-factory signature.
- This extension originally repeated the same false fixed-24fps conversion as
  the earlier examples. The cross-extension correction now uses public reader
  seconds directly. The important platform lesson is that public unit comments,
  the production projection, and example fixtures need one executable contract
  test; local consistency among copied fakes is not enough.
- Sorting gives provider-order-independent output, but slicing after sorting
  only bounds expensive heuristic/marker work, not the initial sort over a very
  large snapshot. If host snapshots can become unbounded, the SDK should expose
  a time-ordered iterator/query rather than requiring every extension to sort
  the complete clip projection.

### 5. Timeline Faultline / Corruption Weather

- Built as a public-snapshot structural integrity map covering gaps, overlaps,
  missing tracks, non-finite timing, negative/zero durations, and extreme
  durations. Focused verification passes 8/8 tests; thirteen manifests validate.
- The concept had to be narrowed explicitly from “corruption” to structural
  anomalies. The public extension surface exposes no pixels, decoder errors,
  frame availability, or render diagnostics, so media-health claims would be
  misleading.
- The extension caps findings and the post-sort scan, while the same full-input
  sorting caveat from Emotional Weather Map remains.
- Focused lint is clean. The implementation agent observed unrelated existing
  hook-dependency failures in full-repository lint, reinforcing the value of a
  documented focused validation path during extension iteration followed by a
  deliberate repository-wide gate at the end.

### 6. Foley Constellation

- Built as a spatial cue-authoring extension with category, pan, distance, and
  intensity fields; it explicitly does not synthesize or render audio. Focused
  verification passes 9/9 tests and fourteen manifests validate.
- A manual review caught `timelineView.getSnapshot().time`, which Vitest and
  ESLint accepted because the test runner transpiles TypeScript without type
  checking. The correct public path is `getSnapshot().playhead.time`.
- The full TypeScript project check passes after that correction. This proved
  that “focused Vitest + focused ESLint + drift” was incomplete even when all
  three were green.
- `npm run test:creative-extension -- <slug>` now runs the four required gates
  in one command: focused Vitest, focused ESLint, TypeScript project check, and
  release drift validation. It avoids `tsx` IPC, fails fast on invalid/missing
  extension shapes, and completed for Foley Constellation with all checks green.
- The implementation agent again stalled after writing complete artifacts; the
  direct validation command finished quickly. Remaining agents are instructed
  to use the single new command and stop immediately after it completes.

### 7. Branching Cut / Sequential Clip-Link Scaffolder

- The original concept exposed “hold” and “jump” branches, including a
  self-targeting final branch, despite having no runtime that could execute
  those choices. The audit reframed it as a Sequential Clip-Link Scaffolder:
  complete adjacent links between valid clips on the primary unmuted visual
  track, anchored at source clip ends, with no invented terminal semantics.
- Audio, muted, auxiliary, invalid, and negative-duration clips are excluded
  from the graph. Stable source/target IDs survive insertion, and the complete
  graph is persisted while only the ruler display is bounded.
- The public surface still cannot execute a branch or mutate the timeline from
  this example. UI and metadata now say “non-executable” explicitly, while
  authored labels and marker offsets remain editable in extension-owned state.
- Legacy choice-gate arrays are migrated only when they contain a genuine
  non-self jump; terminal self-links are discarded rather than reintroduced.

### 8. Chromatic Constellation / Structural Pacing Palette

- The original “emotional color arc” sorted tracks by ID, included audio and
  muted auxiliaries, and made color sound like semantic analysis. It is now a
  read-only Structural Pacing Palette: timing-based classes with explicit
  thresholds, scoped to the first unmuted visual track and labeled with the
  real track name/order.
- The complete scoped stream is persisted, while the ruler displays at most
  128 markers with a coverage summary (`totalCandidates`, displayed/omitted
  counts, source track, and status). This avoids silently presenting a partial
  analysis as complete.
- Source IDs are now `clip.id` based and survive insertion. Legacy mood arrays
  migrate into timing classes, and generated version metadata makes stale
  suggestions inspectable. The ruler is non-interactive because these are
  derived suggestions, not authored clip edits.
- The public `combineDisposeHandles` helper remains the smallest reliable
  activation cleanup path: reverse-order, idempotent disposal is useful for
  every two-contribution Creative Lab extension.

### 9. Recall Pulse

- The original Recall Pulse name and categories implied concept recognition and
  learner-state inference that the public `TimelineSnapshot` cannot support.
  It is now the **Structural Learning-Review Scaffold**: every item is an
  interrogative, explicitly `unassigned`, and carries its structural heuristic
  and method string.
- Derivation is scoped to the first unmuted visual editorial track. Malformed,
  negative, zero-duration, missing-track, muted-picture, auxiliary-picture,
  audio, and other non-editorial clips are excluded rather than turned into
  fabricated review prompts.
- The former 128-item and 3,600-second caps created false terminal coverage.
  V2 reads the complete valid scope and preserves long-timeline seconds.
  Source/checkpoint IDs derive only from the source clip ID, so unrelated
  tracks and array reordering cannot rename existing suggestions.
- Persisted data is a versioned generated envelope with
  `generatedFromVersion` plus a deterministic signature of the selected track
  and eligible clip facts; reads sort canonically and expose a live `stale`
  signal only when those source facts change (or an impossible future version
  is observed). Unrelated extension project-data writes do not stale it.
  Suggestions are derived and read-only on the ruler; authored review
  assignments remain a future, separate data model.
- Activation now guards registration failures and build invocations without a
  valid editorial track. The remaining friction is that the SDK exposes a
  timeline version but no source-object fingerprint, so same-version external
  edits cannot be distinguished from a fresh read without a stronger host
  provenance contract.

### 10. Lockline Inspector

- Narrowed after independent audit to a read-only Registry & Provenance
  Preflight. Timeline Faultline remains responsible for timing and continuity;
  Lockline now reports only missing timeline-registry asset keys and public
  material/source references whose `clipId` disagrees with their carrier clip.
  Ordinary `managed: false` clips, short clips, audio gaps, muted alternates,
  and visual overlaps are not Lockline findings.
- Multiple missing material references on one clip are aggregated with their
  reference IDs and registry keys. Candidate findings are collected before
  severity-prioritized bounding, and the persisted versioned envelope records
  scanned, invalid, omitted-clip, and omitted-finding counts.
- Findings retain full second-based timestamps beyond one hour, carry a source
  signature plus `generatedFromVersion`, become visibly stale after relevant
  source changes, and render as non-draggable evidence with detailed labels.
  The source signature is authoritative across global version advances, so
  unrelated project-data writes from the other nine extensions do not falsely
  stale a Lockline report.
- The marker primitive currently couples click/keyboard activation to drag
  enablement through one `interactive` flag. Lockline chooses truthful
  immovability, so a future host API should separate `activatable` from
  `movable` before the extension adds clip-selection or a details popover.
- Activation now rolls back earlier registrations after a later registration
  failure, and build/disposal failures are routed to extension diagnostics.
- The public snapshot still cannot prove that a registered asset is locally or
  remotely available, decode media, inspect pixels/audio, or validate an
  export. Lockline therefore says “missing registry asset key,” never “offline
  media” or general finishing quality.

## Independent Sol audit and real-browser findings

### A green test suite can preserve a false contract

- The first two independent audits found the seconds-versus-frames defect even
  though every focused suite, ESLint, TypeScript, manifest validation, and the
  ten-extension lifecycle test was green. The tests asserted internally
  consistent fake values but never constructed a snapshot through the real
  `createTimelineReader` projection. This is the most important process finding
  so far: every extension that consumes a host projection needs at least one
  reader-backed contract test, not only a hand-built interface-shaped fixture.
- The correction removed every fixed-fps conversion from Creative Lab. The
  consolidated suite now passes 83/83 and project TypeScript and focused ESLint
  are clean.

### All ten are present, executable, and persistent in the real editor

- The isolated Creative Lab server exposes Scene Phase Markers plus all ten new
  extensions in the editor's real Extensions panel. Each is enabled and its
  command is discoverable in the real command palette.
- Commands were invoked one-by-one in Chrome. The demo timeline produced eight
  Pulse markers, eight Soundtrack markers, four Weather markers, eight Foley
  cues, four Branching gates, four Chromatic cues, four Recall cues, and four
  Lockline findings. Caption and Faultline correctly produced zero findings for
  the clean demo fixture rather than inventing results.

### 11. Timeline Faultline audit correction

- The original continuity scan grouped every track together. Sparse audio,
  muted picture, and auxiliary tracks therefore created false visual gaps.
  Continuity now uses the first unmuted visual track as the primary editorial
  track and ignores invalid clips for interval continuity while retaining
  explicit malformed-timing findings.
- Bounded output previously truncated after chronological sorting, which could
  discard actionable errors behind many warnings. The scan now prioritizes
  errors before truncation, then restores timeline order for display.
- Faultline findings are derived diagnostics, not authored markers. The ruler
  is now explicitly read-only, and the persisted state carries
  `generatedFromVersion` so consumers can tell which snapshot produced it.

### 12. Foley Cue Scaffolder audit correction

- The first Foley concept invented ordinal categories and spatial values from
  clip order. That looked creative but implied audio understanding the public
  SDK does not provide. It is now framed as Foley Cue Scaffolder: all new cues
  are `unassigned`, pan is centered, distance is neutral, and labels call out
  the source boundary and structural intensity proxy.
- Cue generation now scopes to the primary unmuted visual track, uses stable
  `clip.id + boundary` IDs, and preserves manual time offsets plus authored
  label/spatial/intensity edits when surviving source IDs are rebuilt.
- Both extensions reuse exact-time marker clustering. This keeps coincident
  boundaries visible without losing their underlying entries, while fresh
  snapshot reads protect drag commits from stale-version writes.
- The times align with actual clip boundaries in seconds: 0, 1.5, 4, 6.5, and
  10.5. A Pulse marker moved one frame by keyboard from 1.5 to 1.533 seconds,
  survived a full reload, disappeared immediately when its extension was
  disabled, and returned with the edited value when re-enabled. This covers
  command dispatch, patch save, namespaced data persistence, reload hydration,
  keyboard commit, activation disposal, and reactivation restoration.
- No extension-owned runtime errors appeared. The local page does emit unrelated
  auth/API-token network errors, repeated non-UUID Supabase warnings, render
  budget warnings, and a five-second auth-lock recovery after reload. These make
  extension failures harder to spot and materially slow browser iteration; the
  local editor mode should suppress remote-only queries and isolate its auth
  storage/locks.

### Multi-extension composition is currently visually broken

- Browser geometry proved the failure rather than relying on a screenshot
  impression. At the shared 4-second cut, eleven independent buttons from seven
  extensions had the exact same x=285, y=409, height=20, and z-index=10. At
  6.5 seconds there were fourteen coincident buttons. Long labels were painted
  on top of one another, and later layers won pointer hit testing.
- The host currently portals every marker layer into the same 30px ruler strip.
  Per-extension marker caps also stay below the layer-local culling threshold,
  so ten bounded extensions can still mount roughly a thousand offscreen,
  tab-focusable buttons. The cap must account for aggregate host population.
- A host-level layout correction is in progress: stable per-extension lanes,
  dense-mode label suppression/disclosure, independently reachable coincident
  markers, and aggregate-aware culling. This belongs in the host primitive;
  asking every extension to invent a different offset would make composition
  accidental and inconsistent.

### Product claims need stronger SDK support or narrower language

- Caption Safe-Zone Orchestra can only see clip timing/type and track kind. It
  cannot see caption semantics, text length, bounding boxes, contrast, pixels,
  or output safe areas. Generic `text`/substring matching produces false
  positives, and draggable diagnostic facts can become detached from their
  source clips. Until the SDK exposes explicit caption roles and layout/safe-area
  data, this should be named and presented as a low-confidence caption timing
  proxy; findings should activate remediation, not be freely repositionable.
- Pulse Map and Soundtrack Cartographer persist unversioned derived arrays whose
  IDs depend on ordinal sorting. Source edits can leave them stale, and rebuilds
  discard manual offsets. The common pattern should be a versioned generated-data
  envelope with a source timeline version, stable source-derived IDs, explicit
  dirty state, and user-offset preservation policy.
- Soundtrack cut density currently counts all clip starts across visual, audio,
  text, muted, and overlapping tracks. That is structural density, not editorial
  cut density. The SDK exposes enough track metadata to narrow the calculation;
  the extension should either do so or retain the more honest structural name.

### The transcript-to-video extension depends on the typed-data branch

- The `oracle-run` branch already contains the `dataKind` family, transcript
  adapter/assembly, lane UI, fixture provider, and a live Transcript Lane dev
  extension. The current `timeline-patches` worktree does not expose
  `ctx.dataKinds` or transcript items to extensions, so a robust author cannot
  fetch or map transcript segments here without using host internals.
- The smallest real follow-on is **Transcript Caption Foundry**: consume the
  host-mapped `reigh.transcript_segment/v1` lane items and create deterministic
  built-in text clips on a Captions track. Those clips already render in preview
  and remain editable through normal text controls. The typed lane remains the
  readable source; generated clip IDs make reruns update rather than duplicate.
- **Historical V1 limitation (now superseded by the review policy):** the source
  `reigh.transcript_segment/v1` lane was initially readable beside the generated
  editable video-text track only. Caption edits can now create durable,
  per-record source-update proposals with source/proposal comparison and
  accept/reject state. The source itself remains immutable in Reigh: applying an
  accepted correction is deliberately an upstream-owner acknowledgement bound
  to the handoff fingerprint, not a hidden editor-side mutation.

## Final deep-browser and typed-data pass

### The shared marker host needed to own composition

- The overlapping-marker failure above is now fixed in the host rather than in
  ten unrelated extensions. Each marker keeps an anchor at its exact timeline
  x-coordinate while the visible badge is assigned a deterministic lane/column;
  a leader line preserves the relationship when the badge is shifted. Drag
  preview, cancellation, commit, keyboard movement, zoom, and reload all retain
  the true time independently of the visual offset.
- With Scene Phase Markers and all ten Creative Lab extensions enabled together,
  Chrome showed eleven overlay layers and 24 visible Creative Lab markers on the
  clean demo. Caption Timing Proxy, Timeline Faultline, and Registry & Provenance
  Preflight correctly emitted no fabricated findings. At time zero the four
  colliding badges occupied separate offsets (-27, -9, +9, +27) while every
  anchor remained at the same true x-position.
- The composed result survived reload with the same ordered marker IDs. A Foley
  cue moved one frame to 0.033 seconds, kept its lane offset, and persisted after
  reload. A read-only Structural Pacing marker rejected the same keyboard edit.
  Two zoom-in/zoom-out cycles changed and restored x geometry without changing
  time or lane assignment.
- Responsive checks covered 1024x768 and 390x844. The tablet kept all 24 markers
  on screen; the phone kept page width at 390px with no body overflow while the
  timeline remained intentionally horizontally scrollable. The former aggregate
  virtualization concern is covered by bounded sparse windows: the 566-item
  typed interval lane mounts at most 128 items, while the performance gate also
  asserts DOM, scroll, memory, and overflow budgets.

### Global timeline versions are not source provenance

- Running extensions sequentially exposed a subtle false-stale bug: Learning
  Review and Lockline treated any later project-data write as proof their source
  had changed. In a ten-extension composition that meant a freshly built layer
  could announce itself stale immediately after the next command.
- Both now persist deterministic signatures of the precise source facts they
  consume. Arbitrary unrelated version increments stay fresh; relevant track,
  clip, registry, or material-reference changes stale the result. Chrome proved
  Learning Review remained fresh after rebuilding Timeline Faultline and after a
  full reload. The SDK should eventually provide host-authored object/revision
  fingerprints so every extension does not invent hashing independently.

### Command discovery exposes implementation IDs

- The command palette renders good display labels, but search in this build is
  keyed primarily by command ID. Searching for the visible extension language
  can return nothing while `buildRecallPulse` finds “Build Learning-Review
  Questions.” Extension authors need label, extension name, aliases, and command
  ID indexed consistently; otherwise browser automation and real users must know
  internal identifiers.
- Resolved during the frozen-browser pass: the palette had a correct host-side
  label/category/description filter followed by a second `cmdk` id-only filter.
  The second filter is now disabled for this caller, so exact visible labels,
  categories, tool descriptions, extension IDs, result families, and stable IDs
  share one deterministic search result. Focused tests cover matches that cannot
  accidentally succeed through the implementation ID, and Chrome confirmed the
  exact “Drop Foley Cue Scaffolds” label plus its category remain visible.

### Transcript Caption Foundry exposed track and typography gaps

- The timeline patch API originally only appended tracks, so generated captions
  could render below media even when the extension was otherwise correct.
  `track.add` now accepts a deterministic `before` relationship and the foundry
  inserts its caption track above the first visual track.
- Text clips have color and font size but no semantic caption style, background
  plate, outline, or stroke in the public schema. The built-in renderer now uses
  a tighter dark halo, and new captions default to 48px at 1280x720 with a higher
  58% placement. A browser-authored caption edit (text, 48px size, and y=418)
  survived reload and a second foundry run, proving reruns do not erase human
  refinements.
- The source `reigh.transcript_segment/v1` lane remains readable beside the
  generated editable video-text track. Caption changes are now captured as
  explicit review proposals rather than silently mutating source; the selected
  record exposes source/proposal comparison and per-record accept/reject. An
  accepted proposal becomes a fingerprinted upstream-owner handoff, so the
  remaining source-application step is auditable rather than a missing editor
  mutation capability.

### Astrid Runaway integration exposed bridge and pack-composition drift

- The real `oracle-unified-execution` branch was the correct base. The Astrid
  bridge now serves 566 typed `runaway_transitions` plus timing evidence for
  `runaway-piano-colour-demo`; Reigh renders them as one real interval data lane,
  ten populated region bands, and a `566 · 10/11 regions` summary. The empty S03
  region remains visible in evidence rather than being silently relabeled.
- Query parsing previously dropped a blank `run_id=` and accidentally treated it
  as an unfiltered request. Keeping blank values now returns a typed 400; unknown
  projects, empty projects, duplicate filters, run filtering, evidence, first
  and last intervals, frame/fps fallbacks, and invalid CSS colors are covered.
- Adding the fourth in-tree schema pack revealed hard-coded “three pack” lists in
  the factoring checker and registry tests. These now declare Runaway's table,
  repository, command, and bridge mount, and standard composition lazily creates
  the repository only when that pack is present. The broader factoring suite on
  this branch initially had authority-lint and reduced-kernel findings unrelated
  to Runaway; those have been fixed. The remaining requirement is the exact
  clean candidate-pair rerun, not a known Runaway factoring failure.
- **Historical virtualization finding (resolved):** rendering all 566 intervals
  at once made full accessibility snapshots time out. The `dataKind` host now
  supplies bounded sparse windows, density summaries, keyboard navigation, and
  performance coverage; the 566-item Runaway lane mounts 128 items rather than
  every interval.

### Validation ergonomics and local-environment noise

- A recursive manifest drift gate and `test:creative-extension -- --all` now make
  the ten-extension release check one command: focused tests, focused ESLint,
  full project TypeScript, and manifest/docs/schema drift. Serial execution was
  necessary under disk pressure; parallel transformed-test caches briefly hit
  ENOSPC even though the implementation itself was healthy.
- The paired release verifier originally invoked that command without `--all`,
  while the checker treated a missing slug as usage error 2. No-argument
  execution now deliberately means the complete shipped set; named-slug runs
  remain available for author iteration.
- **Historical local-test finding (resolved):** local editor mode previously
  performed remote token/auth work, emitted unrelated warnings, and obscured the
  extension signal. Explicit deterministic local-test mode now short-circuits
  authentication and Supabase work, exposes loader/runtime diagnostics, and the
  strict browser gate asserts zero unexpected Supabase requests, page errors, or
  console errors.
- The dedicated `npm run dev:editor` launcher now includes the existing
  DEV-only `localTest=1` contract in the URL it prints. A fresh Chrome tab loaded
  the real demo timeline with zero warning/error console entries after the
  change, instead of repeatedly attempting the authenticated API-token query.
  This fixes the supported deterministic launcher without weakening production
  authentication or changing ordinary application-mode behavior.

## Ship-quality hardening findings

### The reviewed bundle was still a development-only scratchpad

- All twelve reviewed extensions could pass unit, compatibility, and real DEV
  browser tests while remaining impossible to stage in a production build:
  `VideoEditorPage` placed the entire bundle behind `import.meta.env.DEV`.
  Rollout and rollback language in a runbook was therefore not executable.
- The page now resolves deployment-owned parent/child controls, defaults closed
  in production, requires a valid configuration revision, and never consults a
  query string or browser storage for production enablement. DEV keeps the fast
  authoring loop and its local Extension Manager toggles.
- The terminology was itself a friction: a file named `devLocalExtensions.ts`
  became the reviewed bundled registry. A future cleanup should split reviewed
  built-ins from the personal scratchpad so a casual experimental entry cannot
  accidentally become rollout-eligible.

### The telemetry port accepted arbitrary creative content

- The app-shell provider previously forwarded all extension telemetry arguments
  directly to `console.log`, `console.warn`, and `console.error`. That allowed
  extensions to emit prompts, transcripts, project IDs, paths, URLs, exception
  messages, or whole bridge payloads into production diagnostics.
- Extension-authored telemetry is no longer promoted into rollout metrics at
  all. A host-only adapter pins the deployment revision plus exact active
  manifest ID/version pairs, accepts only fixed event/error-class enums and
  bounded count/duration fields, contains hostile getters and failing sinks,
  and forwards records through a browser event boundary. The app shell now
  emits effective host activation, real per-extension lifecycle transitions,
  commands, persistence conflicts, browser render outcomes, and lane density.
- Core Astrid timeline load/save and the Runaway source now emit once per real
  request through the host adapter, with bounded latency and typed
  timeout/HTTP/invalid-response classes; cache hits do not inflate counts. The
  Runaway request also acquired the shared fixed bridge deadline during this
  work. Page-level discovery/listing, migration, and export-completion wiring
  remain explicit work; the typed adapter alone is not evidence that every
  source reaches production analytics.
- A schema is only the construction boundary. Actual production dashboards,
  retention/access policy, alert drills, and on-call ownership still require
  human/operator evidence before rollout; the release checklist must not infer
  those from unit tests.

### A reproducible cross-repository gate needs explicit executable paths

- Pinning only `Python 3.11` was insufficient: the validated Astrid release
  interpreter is Python 3.11.11, and nested `make ci` shell scripts independently fall back to
  `python3` unless both `PY` and `PYTHON_BIN` are carried through.
- The verifier now requires one absolute executable with an exact patch version
  and threads it through every Astrid gate. Node and npm are also exact pins.
  This turns toolchain drift into a preflight failure rather than a mysterious
  test difference halfway through the release run.
- Reigh cannot store its own final commit hash inside that same commit: changing
  the stored hash creates a different commit. The gate therefore requires a
  full immutable `REIGH_REF` equal to clean `HEAD`, records it in evidence, and
  checks it again after all gates. Astrid, being the paired external repository,
  remains pinned directly in the Reigh manifest.

### Broad-suite mocks hid remote work and lifecycle contract drift

- Deep merged-suite runs found stale public-context key inventories, SDK export
  ceilings, missing selection-store/provider wrappers, and page tests that
  accidentally mounted preference persistence against an uninitialized
  Supabase client. Several failures presented as unrelated timeouts until the
  real remote side effect was removed from the page-test boundary.
- The durable lesson is to make local-test zero-remote behavior executable and
  to keep shared mocks structurally aligned with public hooks/providers. Merely
  increasing timeouts would preserve the race and make browser failures harder
  to diagnose.

### The first release verifier was only hermetic at the argv boundary

- Fixed command arrays and `shell: false` looked safe, but every gate inherited
  the operator's full environment. `MAKEFLAGS=-n` made Astrid's `make ci` print
  recipes and exit successfully without executing them; three
  `ASTRID_CI_SKIP_*` variables could also weaken the run. The verifier tests
  asserted argv but never inspected the spawned environment.
- Passing `PY=/path` as a Make command-line variable crossed a second shell
  boundary inside recipes. A path containing shell metacharacters became code
  even though Node never invoked a shell itself. The durable gate now builds an
  allowlisted environment from scratch, puts only validated canonical Python
  paths in controlled step environment fields, and tests that bypass variables,
  test selectors, language hooks, credentials, and unknown keys never cross.
- This exposed a general release-engineering rule: hermeticity must be proved at
  every nested process boundary, not inferred from the outer process API.

### A child kill switch cannot erase a shared typed-data envelope

- The Runaway switch originally filtered extension registration but a bookmarked
  DEV URL could still issue `/runaway-transitions`. The source hook now receives
  the effective deployment gate and performs zero bridge IO when disabled.
- The generic timeline read still carries the shared `data_bundle`/`bundle`,
  because Transcript and future typed kinds use that same atomic envelope.
  Claiming that the Runaway switch stopped all bundle transport was both false
  and architecturally undesirable. The actual containment contract is now
  explicit: no Runaway-specific request, kind registration, projection,
  migration, command, or write; unrelated envelope data remains available.

### Idempotency has to short-circuit before validating a mutation

- Transcript Caption Foundry's preserve path correctly generated an empty patch
  when every deterministic caption already existed, then incorrectly sent that
  empty patch through the host mutation validator. Because empty mutations are
  invalid, a successful repeat action surfaced as an error.
- The extension now recognizes the successful no-op first, leaves all human
  edits untouched, and reports that captions already exist. The regression test
  asserts that neither validation nor apply is called. Extension authoring docs
  should make this ordering a standard idempotent-command pattern.

### Composition invalidated single-surface browser assumptions

- Several E2E locators counted every `[data-marker-id]` and assumed one overlay
  layer. With all ten Creative Lab extensions plus Scene Markers mounted, those
  selectors silently mixed host and extension markers. Tests now scope marker
  layers by their host-owned layer key; the combined composition remains the
  primary acceptance shape rather than an exceptional fixture.
- Touch tests also targeted the ruler's visual midpoint. Once composed marker
  buttons occupied that hit area, scrubs became marker clicks; at phone width a
  clip center could be outside the actual viewport even though the timeline was
  wider. Stable browser tests need semantic layer locators plus coordinates
  proven inside both the element and viewport, and must distinguish a product
  overflow from an automation miss.

### Repository-wide health numbers need scoped interpretation

- A fresh structural scan found strong mechanical health overall (94.0%) but
  weaker test health (84.5%), six import cycles, 22 low-cohesion files, 40
  overloaded directories, and hundreds of coverage/dead-export findings across
  the whole 777K-line repository. Its 23.5 strict score is not a release score:
  twenty subjective dimensions are still unreviewed and therefore count as
  zero. Treating that first-scan strict number as product evidence would be as
  misleading as ignoring the mechanical findings.
- For this release, the actionable result is to inspect extension/editor paths,
  security boundaries, cycles, test gaps, and large host modules explicitly,
  while tracking broader cleanup separately. Health tooling is useful evidence
  only when its zone, review state, and release scope are recorded.

### A non-root runtime exposed a build-tool write assumption

- Switching the production container to `USER node` was correct hardening, but
  Vite preview's TypeScript-config loader writes a timestamped `.mjs` sibling
  beside `config/vite/vite.config.ts`. The image copied `config/` as root-owned,
  so the hardened container could pass every source test and then fail at
  startup with `EACCES`.
- The runtime now owns `config/` as well as the generated `dist/` tree. Release
  checks assert both ownership declarations. The broader lesson is that a
  non-root image needs a real startup/health probe: static Dockerfile checks do
  not reveal runtime writes performed by ostensibly read-only config loaders.

### Service-worker fallback can silently defeat an emergency kill switch

- `fetch(..., { cache: 'no-store' })` was not enough to make the rollout
  document fail closed. The existing service worker cached every small
  same-origin response and replayed it when the network failed, so an older
  `hostEnabled: true` document could survive a deployment rollback or outage.
- The service worker cache generation is bumped and the exact versioned runtime
  config path bypasses interception entirely. A VM-level regression test proves
  that even a populated stale cache is never consulted. Deployment controls
  need tests at every browser cache layer, not only at the application fetch.

### A package-manager guard made the locked install less reproducible

- The repository's `preinstall` used `npx --yes only-allow npm`, but
  `only-allow` was absent from both dependencies and the lockfile. Every
  supposedly frozen `npm ci` and Docker build could therefore download and
  execute the registry's current package before installing reviewed code.
- The remote lifecycle guard is removed; exact package-manager versions are
  already enforced by the release manifest and verifier. The verifier now
  rejects `npx`, `npm exec`, `pnpx`, and `bunx` in install lifecycle scripts so
  this class of unlocked bootstrap cannot silently return.

### One-family media upgrades must move as a coherent dependency set

- Updating only `@remotion/web-renderer` pulled Mediabunny encoders 1.50.8 into
  a tree whose root Mediabunny remained 1.39.2. npm legally deduped the encoder
  peer to that older root; fresh dev servers then crashed on an export that did
  not exist in 1.39.2.
- Root Remotion, player, media, web-renderer, and Mediabunny are now exact and
  aligned. The vendor timeline package keeps its older exact media dependency
  in a nested tree. Release validation must exercise a fresh lock install—the
  incumbent `node_modules` tree can mask or invent compatibility outcomes.

### Diagnostic callbacks need stable identity and idempotent state updates

- A full serial suite appeared to freeze with one worker at sustained CPU. A
  Node inspector profile traced it to `ShaderInspector`: an inline diagnostics
  callback changed identity on every render, `SchemaForm` re-emitted a fresh
  diagnostics array from an effect, and the parent unconditionally stored it.
  The resulting render/effect loop produced no test output and looked like a
  crashed runner.
- The callback is now stable and the state setter preserves the current array
  when its JSON value is unchanged. Focused coverage completes in seconds. For
  extension UI surfaces, callbacks consumed by effects and diagnostic arrays
  crossing component boundaries both need explicit stability contracts; test
  timeouts alone only hide this class of failure.

### A static extension graph is not a timeline composition graph

- Runtime normalization eagerly creates a graph before any project timeline is
  available. Passing that edge-less graph as authoritative caused render
  planning to discard real shader metadata from the timeline snapshot, making
  an unmaterializable shader appear browser-exportable.
- Direct caller-supplied graphs remain authoritative, including intentionally
  empty ones. An eager runtime graph becomes timeline authority only after a
  projected `consumes` edge proves actual timeline usage; otherwise planning
  and export scanning use the timeline compatibility path and fail closed.
  Graph provenance matters as much as graph shape.

### A reproducible install must resolve peers without an escape hatch

- The release profile had acquired `npm ci --legacy-peer-deps`, which made the
  locked install complete by ignoring that Base UI 1.4 requires date-fns 4
  while the app declared date-fns 3. That is not a reproducibility guarantee;
  it is a request for npm to accept a potentially invalid tree.
- The app uses date-fns only through compatible formatting/validation APIs, so
  the root dependency is now pinned to 4.4.0 and the escape hatch is removed.
  A normal locked-install dry run exits zero and the timestamp hook suites are
  green. Release installation policy should treat peer-resolution bypasses as
  blockers requiring a written, package-specific exception.

### Concurrent auto-commits can resurrect an already-fixed release defect

- A background commit captured an older verifier snapshot after date-fns had
  been aligned and the peer-resolution bypass removed. Its otherwise unrelated
  container commit silently restored `npm ci --legacy-peer-deps`, even though a
  normal locked install now resolves without it.
- The bypass was removed again and the verifier regression assertion restored.
  Shared-worktree automation needs compare-and-swap semantics (or isolated
  worktrees plus reviewed integration) so a commit cannot overwrite a newer
  file version merely because its task began earlier. Final gates must inspect
  the resulting diff and rerun policy assertions after the last automated
  commit, not assume that an earlier green result survived concurrency.

### Observability migrations need executable database validation

- The first telemetry migration draft looked plausible in review but one view
  omitted its CTE join and the aggregate view referenced columns absent from
  its source. Both defects would have failed at deployment despite green
  TypeScript tests.
- The views were corrected and the complete migration was applied with
  `ON_ERROR_STOP=1` to a disposable PostgreSQL 14 cluster. Database migrations
  that define operational release gates need a real apply test in CI; parsing
  strings or testing only the browser emitter cannot prove the dashboard
  contract exists.

### A per-isolate telemetry counter is not production rate limiting

- The edge function's fixed batch cap and 120-request runtime-minute counter
  bound one isolate, but horizontally scaled or cold-started isolates do not
  share that state. Leaving the ingress anonymous would also make event-volume
  abuse unnecessarily easy.
- Ingress now requires a valid user JWT, stores no identity, rejects unknown
  reviewed-extension dimensions, and documents a distributed gateway quota as
  a rollout blocker. Authentication and payload privacy are separate controls;
  both are required.

### Package provenance cannot be inferred from human-readable status text

- The manager decided that a package was a read-only, host-supplied extension
  by comparing its mutable `stateReason` with one exact English sentence. A
  direct workspace extension that passed through repository-backed resolution
  could therefore acquire a normal loaded reason and incorrectly expose an
  enable/disable control whose repository write could never unload it.
- Package inventory now carries explicit `direct` or `installed` provenance
  through validation, conflict resolution, settings failures, and successful
  activation. Manager affordances use that host-owned field, with the old
  sentence retained only as a compatibility fallback. Control authority must
  be machine-readable and end-to-end; presentation strings are not policy.

### A lifecycle test is only meaningful when it controls the real package form

- The original browser manager-cycle scenario displayed a direct smoke
  extension while toggling an installed-package repository record. Its visible
  contribution looked convincing, but the two objects were governed by
  different authorities, so the scenario could not prove disable and re-enable
  of an installed extension.
- The harness now seeds a valid, integrity-checked installed pack and bundle,
  then asserts the active runtime inventory and durable enablement state across
  both transitions without refreshing. Browser acceptance fixtures should be
  rejected when the control under test and the observed object do not share an
  identity and authority path.

### Schemaless settings snapshots must survive a disable/re-enable cycle

- Extension disposal durably writes a settings snapshot, including an empty or
  legacy key-value object for packages with no declared JSON schema. The loader
  previously sent that snapshot through schema validation with an undefined
  schema and reclassified the package as `settings-error` on reactivation.
- An absent settings schema is now an intentional raw-settings path; validation
  runs only when the manifest actually declares a schema. A regression test
  preserves a legacy value and proves the package still loads. Persistence
  tests must cover state written during teardown, not only initial hydration.

### Deterministic local-test mode must short-circuit global application chrome

- The editor harness correctly selected its local provider, but the global
  header still initialized Supabase authentication. A test URL could therefore
  fail before reaching the editor when production credentials were absent,
  making a supposedly hermetic browser gate depend on unrelated infrastructure.
- Global-header authentication and referral effects now no-op in explicit
  local-test mode, with a unit test proving that no Supabase surface is touched.
  Deterministic mode is an application-shell contract, not a feature-local
  flag; every global side effect must honor it.

### Delayed UI enhancements must remain capability-safe after the action ends

- The full serial suite found an uncaught exception after a Copilot test had
  already completed: a delayed scroll callback saw a DOM element but assumed
  its host implemented `scrollIntoView`. The feature result was already saved,
  yet an optional animation could still poison the global test and error signal.
- The callback now checks that the method is callable before invoking it.
  Timers, focus restoration, scrolling, and animation scheduled after an
  extension command must be treated as optional capabilities and included in
  unhandled-error gates, not dismissed because the primary assertion passed.

### Modal state can make visually present controls semantically unreachable

- A phone recovery test could see the marker-layer pager in its snapshot after
  disabling a contribution, yet its role query waited for the full four-minute
  timeout. The Inspector modal was still open, so the rest of the editor was
  correctly `aria-hidden` and inert even though pixels remained visible.
- The scenario now closes the modal before asserting pager semantics, then
  explicitly returns to Select mode before tapping a clip. Mobile interaction
  tests must assert the active modal and input mode as part of their state;
  screenshots alone cannot prove that a visible control is accessible or
  actionable.

### Development and preview servers need the same bridge security boundary

- The first proxy guard registered only Vite's development-server hook while
  preview inherited the same Astrid proxy configuration. The production-like
  `serve` path could therefore forward bridge traffic even when missing the
  credential that made development fail closed.
- One plugin now registers the identical guard for dev and preview, and the
  proxy configuration is explicit in both modes. Tests invoke both hooks and
  prove they return `503` without touching an upstream. Security controls on a
  local proxy are deployment-mode contracts, not dev-server conveniences.

### Validate an upstream address before attaching a secret header

- Raw interpolation of `VITE_ASTRID_BRIDGE_PORT` produced a URL that looked
  loopback-only in source, but values containing user-info syntax could parse
  with a different hostname and receive the injected bearer token.
- Startup now accepts only a canonical integer from 1 through 65535 and builds
  the target from that number. User-info, paths, whitespace, fractional values,
  zero, and overflow all fail before a server starts. Every component used to
  construct a credentialed upstream must be validated before URL parsing.

### The real-service harness must exercise the production auth mode by default

- Enabling the real Astrid Playwright path disabled the unauthenticated stub
  exception but did not create a token or start `astrid serve --release-mode`.
  The named release test would therefore fail at Reigh's new guard unless the
  caller happened to preconfigure matching secrets.
- Playwright now creates one ephemeral token per real-bridge run, passes it to
  both managed servers, forbids reuse of mismatched hot servers, and requires
  Astrid release mode. A production-like test command should assemble its
  secure topology itself, not depend on undocumented ambient state.

### Protocol negotiation and deadlines apply to failures too

- The Runaway client checked the version header only after a successful HTTP
  status, so an incompatible service could supply trusted-looking error text
  and be misclassified as an ordinary bridge failure. The browser deadline also
  did not protect raw proxy callers from an indefinitely hung upstream socket.
- Version validation now precedes all response-body handling, including 4xx and
  5xx paths, while both proxy socket deadlines share the client's ten-second
  bound. Failure envelopes are part of the wire protocol, and transport limits
  must exist on every hop rather than only in the nicest caller.

### Timeline gesture coordinates must include the host-owned label gutter

- A desktop browser test scrubbed at a fixed ruler offset, but the playhead's
  transform includes the track-label gutter. At some layouts the pointer-down
  landed inside that non-scrubbable gutter, so the later marker command could
  appear to work while still reading time zero.
- The test now reads the initial playhead transform, starts inside the
  host-owned ruler strip relative to that boundary, and asserts the movement as
  a delta before materializing and reloading the marker. Geometry assertions
  should be relative to semantic layout boundaries, not convenient viewport
  constants.

### A pairwise matrix is incomplete when its inventory is hand-curated

- The compatibility gate called itself complete but enumerated the ten Creative
  Lab extensions plus Transcript and Runaway while omitting Scene Phase Markers,
  even though the browser product surface ships all thirteen together. It also
  inferred single-extension compatibility from pair activation and never
  exercised the full live reorder/disable/re-enable sequence in one host.
- The canonical gate now enumerates all thirteen, locks the resulting 78 unique
  pairs, activates each extension alone, mounts all thirteen together, and
  proves that reorder is non-churning while disable/re-enable advances only the
  selected extension's recovery generation and leaks no registrations. Release
  inventories need an asserted cardinality and product-surface reconciliation;
  a green combinator cannot reveal an extension it was never given.

### Source-code scanners can turn an innocent regex into broken release CSS

- **Historical build finding (resolved):** the production build stayed green but
  warned about an invalid `-: .TZ;` CSS
  declaration. Tailwind's content scanner had interpreted the timestamp cleanup
  regex character class as an arbitrary utility and emitted a malformed rule;
  the TypeScript behavior itself was correct, so unit-only gates could not see
  the defect.
- The timestamp now removes all non-digits with a scanner-safe expression and a
  deterministic unit test locks the exact run-ID format; the malformed generated
  CSS warning no longer occurs. Production builds must still treat CSS parser
  warnings as actionable release findings, even when the offending token
  originated in non-style source code.

### A contiguous virtualization window is not an interval query

- The first viewport implementation used a prefix maximum to locate an old
  interval that still overlapped the viewport, then applied the 128-item budget
  as a contiguous slice around the current time. In a 50,000-item lane, dense
  expired history between a very long interval and the viewport could evict the
  long interval even though it visibly spanned the screen.
- The host now builds a max-end interval tree, queries actual intersections,
  and applies a deterministic relevance cap. Non-contiguous selections carry
  host-owned absolute indices so extension renderers preserve correct ARIA set
  positions. Virtualization tests must combine adversarial overlap structure
  with a budget overflow; a small overlap fixture cannot prove the cap is safe.

### Data lanes need scroll extent without becoming duration authority

- Keyboard End could select and pin a data item beyond the last clip, while the
  shared scroller remained capped to clip-derived width. The item mounted only
  because it was pinned, could never enter the viewport, and prevented the row
  from returning to normal viewport virtualization.
- Visible data-lane extents now expand canvas scroll geometry but do not change
  project duration or export range. An integration test drives an ordinary
  scroller event, and the keyboard test places its target far beyond clip
  content. Duration ownership and viewport reachability are separate contracts.

### Green release tests are meaningless when their inputs are ignored files

- The first paired gate archived exact Git commits but addressed Runaway
  migration inputs under Astrid's ignored `projects/` tree. Those paths existed
  in the developer checkout and disappeared from `git archive`, guaranteeing a
  delayed `FileNotFoundError` after the expensive dependency build.
- Astrid now ships byte-pinned tracked release fixtures with executable SHA-256
  checks. Production-like gates should preflight every required file from the
  exact archive before expensive work and must never depend on ignored local
  state merely because it is present on the author's machine.

### A configurable test server is useless when the spec hardcodes its old port

- Playwright correctly started an isolated editor on the requested port, but
  the timeline support module independently defaulted every navigation to
  port 2222. The original browser proof passed only because its invocation
  happened to choose that same number; a concurrent-safe rerun on 2237 failed
  immediately with `ERR_CONNECTION_REFUSED`.
- Timeline specs now derive their origin from `BASE_URL`,
  `PLAYWRIGHT_BASE_URL`, or the validated `PLAYWRIGHT_PORT`, in that order, and
  the real-bridge script no longer reintroduces a fixed origin. Parallel test
  isolation must be verified by actually running a non-default port; merely
  parameterizing the server command does not parameterize the client.

### A moving shared worktree cannot issue immutable release evidence

- Long-running suites were first launched from branches that other workers were
  still advancing. Even when every executed assertion was green, the final log
  could not identify one source snapshot, and an external cleanup process could
  reap a child whose command line happened to match its stale-test heuristic.
- Release gates now reject dirty controller and dependency worktrees, archive
  exact commits into private trees, retain their own process handles, and wait
  through TERM/KILL completion. Broad process or temporary-directory cleanup is
  forbidden while evidence runs. A log is admissible only when its code identity
  and process lifetime are controlled end to end.

### Synthetic migration data can prove the verifier while missing the product

- A deterministic 566-row generator made the migration path hermetic, but the
  verifier authored both the input and its expected count. It could stay green
  while the actual Runaway segment structure, timebase, prompts, or derived audio
  path became incompatible.
- The paired gate now consumes Astrid-owned, tracked release fixtures with
  independently frozen hashes and records those hashes in its receipt. Release
  fixtures need an owner outside the assertion that consumes them and semantic
  checks beyond a shared row-count constant.

### Evidence receipts cannot hash an index that hashes the receipt

- Writing the artifact index before the receipt left the final pass/fail claim
  outside the tamper-evident set; embedding the index hash back into the receipt
  would instead create an impossible self-reference.
- The gate writes a canonical receipt first, then an index covering that receipt
  and every other artifact except the index itself, and prints the detached index
  hash for external retention. Evidence formats must define their acyclic trust
  root before implementation.

### Sparse virtualization is an SDK capability, not an invisible optimization

- Non-contiguous overlap selection fixed correctness for adversarial intervals,
  but existing renderers could still infer absolute positions as
  `startIndex + localIndex` under the unchanged API version. Sorting all 50,000
  simultaneous overlaps also spent tens of milliseconds to retain only 128.
- Sparse windows now require an explicit registration opt-in; legacy renderers
  receive a bounded contiguous window, while opted-in renderers receive absolute
  indices. Selection uses bounded top-k work and is tested with 50,000 concurrent
  overlaps. Host optimizations that change observable collection shape need
  capability negotiation and worst-case fixtures.

### Pixel density is not semantic render evidence

- The first overlap probe passed at 25fps even though its extracted frame showed
  only one speaker. The longer single caption happened to occupy more pixels
  than the shorter baseline, so a whole-frame density threshold certified the
  wrong visual result.
- The release matrix now derives overlap frames from rounded caption boundaries
  and checks both expected vertical caption bands at every supported frame rate.
  Visual assertions must measure the structure the user expects, not a scalar
  proxy that unrelated text length can satisfy.

### Global editor shortcuts can break otherwise accessible extension controls

- Extension toggles exposed native buttons and appeared keyboard reachable, but
  the editor's global Space handler intercepted activation before the button
  could change state. Component semantics alone did not reproduce the host-level
  failure.
- The manager now contains keyboard events from its native controls, exposes
  pressed/expanded state, retains focus through enable/disable, and runs in
  Chromium, Firefox, and WebKit at desktop, tablet, phone, reduced-motion, and
  deterministic 200% content zoom. Accessibility gates must execute controls
  inside the real host shortcut stack.

### Tracked build output can shadow the package source of truth

- Reigh's vendored Python timeline-schema package had an ignored but still
  tracked `build/lib` tree. Its schema hash (`44e6…`) predated the source schema
  (`3dfe…`) and omitted extension `app` metadata. Sparse working trees hid the
  files, while `git archive` restored them; a clean wheel build then packaged
  the stale schema and could reject valid extension provenance.
- Generated package build directories must never be tracked. The paired gate
  installs hash-locked build tools, builds from the exact archive, and compares
  the installed resource hash with the source resource before running Astrid.
  Testing an import is insufficient when two valid-looking copies can exist.

### A clean Astrid environment exposed an undeclared paired dependency

- Focused Astrid tests used a developer Python environment that already
  contained `banodoco_timeline_schema`. A clean archive installed Astrid's
  declared runtime lock and then failed timeline validation because the shared
  schema distribution actually lives in Reigh's vendored release input.
- The paired verifier now provisions that distribution from the exact archived
  Reigh commit with dependency and build isolation disabled, records its source
  tree and installed resource hashes, and proves Astrid resolves only from the
  pinned archive. Cross-repository dependencies need an executable install
  contract, not a setup note or a fortunate global environment.

### Clean Git status does not mean exact release inputs

- Git status ignores ignored files, but Vite consumes ignored environment files
  and copies ignored public asset directories. A release run from an apparently
  clean developer checkout could therefore build bytes that never existed in
  the tagged candidate. Index flags and replacement refs created similar false
  views of history.
- Release gates now neutralize Git replacement/config state, reject hidden index
  flags, and run the full Reigh profile in a fresh detached worktree at the
  verified evidence-controller commit. Exact-commit execution must be a property
  of the harness, not an operator promise about their checkout.

### Short overlapping captions can lose their only selection target

- At low zoom, a 210 ms caption rendered only as wide as its two trim handles;
  when another caption overlapped it, every exposed pixel initiated a resize and
  a mouse user could not select the caption to edit it in the inspector.
- Clip geometry now reserves one handle-width of selectable body between both
  handles on desktop and touch layouts. A handle press/release that never crosses
  the resize threshold selects the clip, while a real drag remains resize-only.
  The focused interaction tests and live Chrome probe cover both geometry and
  selection without changing timing.

### Transcript acceptance is a durable proposal, not a hidden source mutation

- A real browser round-trip materialized four deterministic captions, preserved
  a human Unicode edit across reload and repeated generation, and persisted four
  review records through proposal and acceptance. Accepted records use
  `accepted-for-source-update`; the transcript lane remains the immutable source
  until an upstream owner explicitly applies them.
- This separation makes provenance inspectable and prevents an extension action
  from silently rewriting source data. Browser acceptance tests must inspect the
  stored review record, the generated output, and the source lane independently;
  checking only the visible caption would miss a policy violation.

### “Accepted” must not visually collapse into “applied”

- The first round-trip surface had durable batch accept/reject actions, but no
  selected-record comparison and no state proving that an upstream transcript
  owner actually consumed an accepted handoff. A user could inspect persistence
  data, yet the editor offered no precise place to compare source and proposal
  or understand that acceptance was still waiting on another system.
- Transcript Caption Foundry now renders current source beside proposed
  text/timing in the selected-item inspector, with source-specific accessible
  accept/reject labels while preserving the batch actions. The properties host
  also forwards stable source identity, artifact reference, and provenance;
  dropping those fields made an occurrence id look like source identity.
- Acceptance now creates a fingerprinted handoff and is labelled as awaiting
  upstream acknowledgement. Only an upstream-owner contract bound to that exact
  handoff, owner, returned revision, and applied-source fingerprint advances the
  record to `acknowledged-by-source-owner`. Exact replay is idempotent and a
  conflicting replay fails closed. The dev adapter remains immutable and cannot
  self-acknowledge, so local UI success is not mistaken for production source
  application.

### Data-lane selection must clear stale clip ownership before inspector dispatch

- Installed-Chrome testing found a one-render race after reload: selecting a
  caption clip and then clicking a Transcript source item marked the lane item
  active, but the Properties inspector could remain stale until another data
  lane was selected. Component-only inspector tests had missed the host shell's
  selection-to-inspector synchronization.
- `DataLaneList` now clears clip and track selection synchronously before it
  publishes the data context and inspector target. A regression exercises one
  lane-item click with a live clip selection and asserts the ordering. The exact
  installed-Chrome journey passes both hot and after a full page reload: the
  per-record source/proposal inspector appears on the first click and the stale
  clip placeholder does not reappear.
- The broader lesson is that extension surfaces sharing an inspector must test
  ownership handoff through the assembled host, not only the leaf renderer or
  Properties panel in isolation.

### A failed immutable candidate needs a new release line, not a retag

- RC1 reached its immutable Reigh candidate and controller, but the paired
  release probe found that a hostile `Host` request incorrectly returned `200`
  instead of the required forbidden response. The failure is retained as a
  typed RC1 artifact under its historical evidence root; it is not a passing
  receipt and cannot be replayed into a later release.
- RC2 therefore starts from the latest RC1 controller ancestry, resets the
  release ledger to a fresh integration state, pins the corrected Astrid SHA,
  and uses a new annotated tag. The old RC1 tag and controller remain stable
  references for auditing. Once RC2 is tagged, its controller may change only
  the RC2 evidence closure, ledger, and status-only manifest freeze. Release
  tags must never be force-moved after a failed gate.

### A security probe can lie when the client normalizes forbidden headers

- RC2's Astrid bridge probe used Node's global `fetch` to send
  `Host: attacker.invalid`. Undici treated `Host` as a protected URL-derived
  header and transmitted the loopback authority instead, so Astrid returned
  `200` and the gate reported a false failure/success boundary rather than
  testing host policy. A request-level security assertion is meaningless unless
  the harness verifies what reached the server.
- RC3 uses a bounded, non-reused `node:http` request helper for all Astrid
  rejection probes. The regression server records the received Host and would
  return `200` if normalization occurred; the test therefore proves the exact
  `attacker.invalid` value, bridge-version response header, JSON error payload,
  and expected `403`. The direct live probe against Astrid
  `86153eefc14aa995402927df0c7bb178f48f8ead` also returned
  `403 forbidden` with `X-Astrid-Bridge-Version: v1`.
- RC1 and RC2 receipts stay immutable under their historical evidence roots;
  the raw-header correction starts RC3 rather than retagging either failed
  candidate. Future forbidden-header probes must use the raw helper and retain
  the exact response body/header assertions.

## RC6 browser/release hardening pass (2026-08-24–25)

RC6 remains an integration sequence, not a frozen release receipt. The
preceding hardening commits are historical implementation context; the exact
source candidate will be computed from a fresh clean snapshot after the
native-tool attestation commit, and no moving branch head is a candidate
identity.

### Browser fixtures must share one deterministic contract

- The Runaway stub's generated rows previously used a local spacing heuristic
  that did not exactly span the declared 8,085-frame, 48-fps envelope. The
  fixture now derives frame, start, and duration from one rounded frame-time
  function, asserts monotonic frames and exact total duration, and exposes the
  typed `v1` protocol/version header in its contract test.
- Short overlapping caption clips could expose only their two trim handles,
  making the selection target ambiguous. Clip geometry now reserves a
  selectable body between handles; a press/release that never crosses the
  resize threshold selects, while a real drag still resizes. The browser
  journey covers the 210 ms case.
- The development extension-harness route was lazy-loaded without its own
  `Suspense` boundary. It now has an explicit loading fallback and a route
  regression test. The stub's incomplete protocol/version envelope is likewise
  covered by a direct contract command (`npm run test:e2e:timeline-harness`),
  rather than remaining an orphaned test file.

### Isolated browser runs need an owned target and reset

- A configurable server was still unsafe when clients retained a fixed port,
  when `BASE_URL` and `PLAYWRIGHT_BASE_URL` disagreed, or when a stale process
  survived on the default port. The harness now canonicalizes exact loopback
  roots, rejects false/stale targets, allocates separate editor and bridge
  ports, uses atomic reservations with stale-lock reclamation, closes locks on
  early exit, and refuses occupied explicit ports. The bind probe is only a
  check; the lock covers its TOCTOU gap.
- Fixture reset now performs a health check, validates registry identity,
  sends `expected_version` for CAS, checks the incremented version, compares
  the complete saved config and registry with deep equality, and serializes
  concurrent resets. Tests must prove post-reset identity, not merely a 200.
- The browser evidence path defaults to untracked Playwright artifacts. A
  deliberate `PLAYWRIGHT_REFRESH_TRACKED_EVIDENCE=1` is required before a
  release owner refreshes tracked screenshots; ordinary release tests must not
  mutate committed evidence.

### Proxy and paired-server identity are security boundaries

- The Vite Astrid proxy now has one explicit boundary for loopback `Origin`,
  `Host`, bearer auth, and `X-Astrid-Bridge-Version`: same-origin loopback
  requests may have their browser Origin consumed at the trusted proxy, while
  cross-origin values remain visible and rejected. Dev and preview install the
  same fail-closed auth middleware. The RC3 raw `http.request` probe remains
  necessary because Node `fetch` normalizes `Host` and can make a forbidden
  request look valid.
- Paired Vite dev and preview now require `--strictPort`. Readiness is an
  exact per-run identity containing a fresh nonce and the full Reigh commit;
  an HTTP 200 with the wrong revision is not readiness. Browser workers never
  receive the bridge token. These checks prevent a healthy stale server from
  satisfying a new candidate's gate.

### Visual evidence and release progression must be immutable

- RC6 visual provenance binds the exact six-image inventory, old/new source
  commits, source-file hashes, browser/tool versions, viewport/config metadata,
  image hashes and metrics, human/agent review metadata, and the three retained
  red diff-mask PNGs. The verifier decodes pixels and checks each mask, so a
  plausible screenshot or missing state cannot silently enter the ledger
  (`docs/extensions/evidence/releases/extension-ship-quality-rc6/`).
- Failed candidates remain historical: RC1–RC5 tags/receipts are not retagged,
  and RC6 is the current integration cycle with no RC6 tag or signed 23/23
  ledger. A source fix invalidates any future freeze and requires a new clean
  candidate/controller sequence.
- Focused local machine tests are useful diagnostics, but they do not replace a
  clean exact-pair run. Disk headroom is an operator preflight, not a release
  receipt, and must be measured again on the clean candidate machine.

### Product seams that remain honest blockers

- The paired release path now proves its bounded caption contract: exactly two
  persisted captions are bound by ID/text/interval/region and checked at first,
  midpoint, and last frames, with a no-caption control containing the seeded
  media card. This does not make the public SDK semantically complete. It still
  lacks general caption roles/text/layout/safe-area/contrast/media APIs, so
  Caption Safe-Zone Orchestra remains a structural timing proxy and cannot
  claim broad caption semantics beyond the paired verifier's fixture.
- The combined host inventory is now thirteen extensions, and all-13
  activation/reorder/disable/re-enable and browser evidence must be rerun on
  the current candidate. Local auth is a narrow editor-route/Supabase seam:
  local Astrid mode must stay backend-free, while ordinary cloud/legacy Reigh
  routes retain Supabase. No global Supabase removal is authorized.
- Exact paired evidence, production/observability and rollback drills, a real
  upstream transcript-owner acknowledgement, Edge/physical-device and
  accessibility sessions, four human acceptance personas, and two independent
  reviewers remain open. A green focused test or agent visual review cannot
  close those human/external gates.

### Release evidence needs host identity and one-shot ownership

- The paired gate now resolves and byte-attests `ffmpeg`, `ffprobe`, Tesseract,
  ImageMagick, Tesseract English traineddata, and the pinned host platform
  before provisioning. This native-tool attestation is a prerequisite to
  computing the exact candidate; a later source fix starts a new candidate
  sequence.
- Every command has a phase timeout with diagnostics. Long-running servers use
  per-server randomized process scopes and a detached supervisor that is
  acknowledged before target code starts. Cleanup revalidates PID/PGID/start
  identity, signals only exact scoped processes, requires three empty scans,
  and reaps descendants when readiness or the verifier itself dies. Avoiding a
  negative-PGID kill after a leader exits prevents an unrelated reused process
  group from becoming a cleanup target.
- Evidence is add-once: exclusive file creation, receipt before artifact index,
  detached index hash, and read-only final evidence. Reruns/corrections use a
  new untracked root and receipt rather than overwriting an earlier claim.
- Dynamic editor/bridge ports are allocated per phase and included in readiness
  identity. A fixed port, stale server, or mismatched `BASE_URL` is an explicit
  failure, not a convenience for local testing.

### Release commands need a stable launch gate, not a cleanup-time snapshot

- The first bounded-command implementation scanned `ps` only after a command
  returned or timed out. Under twenty concurrent calls, a detached child could
  start, write its delayed marker, and exit between snapshots while the wrapper
  still reported success. Increasing a delay only moved the race.
- Bounded commands now register a unique environment scope with one private
  per-host broker, attach an inert process-group leader before sending target
  code, retain every observed identity, and require three quiescent scans. A
  nested invocation preserves all ancestor scope keys so the outer owner can
  still reap inner helpers.
- Broker, wrapper, and launch-gate processes receive minimal environments;
  command/environment/scope payloads travel over private stdin rather than
  argv. The target never receives the internal broker session. A short private
  socket path works across the supported macOS Node versions, and stale broker
  replacement is serialized so concurrent candidates cannot delete a new
  owner's lock or socket.
- Supervisor loss is a first-class test case: broker death invokes a local
  scope-drain fallback, wrapper death makes the gate kill its pinned group, and
  host death makes the broker destroy partial client handshakes and drain every
  registered scope. These paths are covered with delayed detached markers,
  direct SIGKILL, corrupt lock/socket state, and broker restart.

### Test isolation is part of determinism

- Node's top-level test-file concurrency ran native hashing/provenance work
  beside tight process-lifecycle assertions. The contained implementation was
  correct in exclusive runs, but machine scheduling made timing evidence
  nondeterministic. The release-verifier files now run serially; intentional
  concurrency remains inside the explicit twenty-scope stress test.
- Authoritative candidate evidence must likewise run on an isolated host phase.
  Parallel audit agents may review source, but they must not start competing
  browser servers or release helpers while timing-sensitive evidence is being
  captured.

### Negative provenance tests must not mutate tracked evidence

- A visual-provenance test used a fixed temporary filename inside the tracked
  evidence directory. An interrupted run left a directory behind, so the next
  run failed before exercising the intended invariant. Temporary artifacts now
  use per-process names and recursive cleanup.
- Another negative test appended a byte to a tracked diff-mask PNG and restored
  it in `finally`. A SIGKILL could leave the worktree corrupted. The verifier
  now accepts an in-process artifact reader for this negative test, allowing it
  to prove worktree-byte divergence without changing committed evidence.

### Agent instructions must be versioned with the dependency pin

- The globally installed Astrid skill described a newer `doctor --json`
  contract (`state: "uninitialized"`, `ok: true`, and `next_action`) than the
  retained RC6 Astrid commit. At `86153eef`, a missing store intentionally
  fails closed and emits only `ok` plus `checks`; pin-local tests and the
  pin-local skill freeze that behavior.
- Release agents must read dependency-owned instructions from the exact pinned
  checkout before interpreting a cross-repository result. Global instructions
  are useful discovery aids, but they cannot silently redefine an immutable
  dependency's contract.
- This skew does not weaken the paired lane: it initializes Astrid before using
  `doctor` and runs the check after backup restoration against a real store.
  Backporting the newer clean-machine UX would create a new Astrid SHA, require
  every Reigh pin and runbook binding to change, and start a fresh paired
  evidence cycle; that is a deliberate future upgrade, not an RC6 hot fix.

### A shared mutable browser stub needs a complete atomic reset

- The timeline Playwright project reused one Astrid stub process across its
  serial scenarios, while its reset helper restored only tracks and clips.
  Tests that changed output settings, extension `app` metadata, or registry
  assets therefore contaminated later files. Order-dependent failures looked
  like unrelated viewport, overlay, and persistence regressions.
- The stub now serializes every mutation and exposes a test-only atomic hard
  reset that replaces the complete config and registry with a freshly built
  pristine fixture while monotonically advancing the CAS version. Playwright
  calls it before every ordinary stub test and verifies the public read surface;
  real-bridge mode refuses the control route. The full 26-test timeline suite
  passes twice in succession, proving reset behavior across repeated process
  lifetimes rather than only in a unit fixture.

### Browser test inventory must encode service authority

- Real-bridge, caption-export, and caption frame-rate matrix specs were
  collected by the generic stub project even though the stub intentionally
  cannot admit or execute render tasks. Four authenticated real-bridge cases
  failed at the first request, then serial mode hid the remaining cases as
  unrun. A file's presence under one directory is not evidence that every
  project provides its required services.
- The ordinary timeline project now owns only deterministic stub scenarios;
  the authenticated bridge command owns the real bridge contract. Caption
  export remains a separate renderer-owned concern until its real Astrid task
  executor and fixtures exist. List-only tests and explicit commands should
  freeze these inventories so adding a spec cannot silently move authority.

### Expected capability probes can emit two browser failure signals

- A deliberate missing-media probe returns the expected HTTP 404, but Chromium
  also emits `requestfailed` with `net::ERR_ABORTED` for the same request. Tests
  that allowed only the response still failed; broad suppression of aborted
  requests would have hidden unrelated network defects.
- The affected suites now ignore only the exact sentinel pathname paired with
  the exact abort error, while retaining every other 4xx/5xx and request
  failure. Browser noise allowances need both URL and failure-class identity,
  not message-prefix filtering alone.

### A readiness script can be green in unit mode while its browser topology is absent

- `test:readiness:e2e` started Vite but not the Astrid stub required by its
  explicit local-test URLs. The first full run produced 33 failures and repeated
  `/health` connection refusals. Eleven stale expectations were then repeated
  across desktop, tablet, and phone: state attributes moved to package cards,
  duplicate packages were incorrectly counted as runtime issues, the invalid
  route omitted deterministic local parameters, and the empty fixture was
  expected to invent an activity region.
- The readiness command now explicitly opts into its isolated bridge topology,
  while unrelated default Playwright projects remain bridge-independent. The
  assertions target the current accessible contract without weakening counts
  or geometry, and all 171 device cases pass. A named release script must own
  every server its URL implies; ambient dev processes are not dependencies.

### Task admission is not real video export

- Reigh correctly admits project-scoped `render_export` work to Astrid and
  polls the common task ledger, but the pinned Astrid capability resolves that
  family to `rendering.timeline_visualize`. Its adapter publishes an evidence
  directory, not an H.264 MP4, and the paired/browser harness starts no worker
  that could settle an admitted render. A Download button assertion would
  therefore wait until timeout even though admission, persistence, and bridge
  authentication all work.
- Astrid already contains a genuine `rendering.render` MP4 executor, but it has
  no task adapter connecting timeline snapshot authority, managed inputs,
  completion media, and the bridge ledger. Ship-quality requires that dedicated
  adapter plus a bounded executor in the paired harness; adding auth headers or
  fabricating a stub MP4 would only disguise the missing authority. The
  seven-rate caption matrix remains valuable renderer-owned coverage and must
  not be silently counted as a real-bridge pass until its assets and Runaway
  fixtures are seeded through Astrid's managed stores.

## 2026-08-25 — Paired real-render friction audit

The first real `render_export` round-trip exposed a second class of problems:
the contract can be admitted and authenticated while the actual renderer,
inputs, settlement authority, or installed runtime is absent. These findings
are evidence from the paired worker/bridge path, not claims that a focused
unit test is equivalent to release evidence.

### Render authority must be distinct from visualization

- The admitted `render_export` family initially resolved to
  `rendering.timeline_visualize`. That executor produced a plausible evidence
  directory, so task admission and a superficial download check could look
  successful while no H.264 MP4 was rendered. The resolution is a dedicated
  adapter that invokes canonical `rendering.render` against the admitted
  timeline snapshot and managed inputs, then completes a real MP4 media record
  whose bytes begin with the MP4 `ftyp` signature.
- The pinned paired topology also had no serve-owned worker to claim and settle
  the task; admitted work could remain queued forever. The resolution is an
  explicitly owned bounded worker lifecycle (claim, heartbeat, render,
  multipart complete, detail reconciliation, failure/cancel, and shutdown),
  with browser tests assigned only to a topology that actually owns that
  authority.

### Caller locators are not asset authority

- A registry `file` field is required for compatibility, but trusting its
  absolute path, URL, or user-controlled locator lets a render read outside
  the project. Valid entries now require a project-owned `media_id` and
  verified digest/location; a benign relative display filename is retained
  only as metadata. Absolute paths, URLs, traversal, missing/foreign media,
  and digest mismatches fail closed.
- The adapter stages verified managed bytes under a deterministic
  `render-inputs` directory and rewrites the renderer registry to those staged
  paths. The renderer never receives the caller's locator as authority.

### Idempotency and completion fencing cross more boundaries than admission

- An idempotency key alone was insufficient: changing the output filename,
  correlation, expected version, destination, materialized input, or timeline
  while reusing the key must mismatch; an identical replay after the timeline
  head advances must reuse the original task/snapshot. The stored caller
  envelope is now compared exactly before reuse.
- Heartbeats mutate `status_version`. Serializing that version into a
  completion manifest and then heartbeating during upload made a slow upload
  self-conflict with `409`. Each completion attempt now extends the lease once,
  freezes its fence, rebuilds the deterministic manifest/body, and streams
  without version-mutating callbacks. A lost completion ACK or lost detail GET
  retries/reconciles the same key, file, and body rather than rerendering.
- Deterministic client errors such as `413` are not replayed. Ambiguous
  transport/5xx outcomes may reconcile, but an authoritative non-running state
  (`queued`, `blocked`, `failed`, `cancelled`, and similar) means ownership was
  lost; only `running` may retry and `succeeded` is accepted as completion.

### Streaming, leases, shutdown, and process trees are one failure domain

- Completion now hashes and uploads in bounded chunks, checks stop/deadline
  controls while hashing and streaming, and requests a lease long enough for
  the bounded render plus settlement margin. The control path must continue
  through post-render settlement rather than abandoning a task at the first
  stop signal.
- A signal handler that synchronously joined the worker deadlocked the bridge
  needed for reconciliation. Shutdown now starts one coordinator, keeps HTTP
  available while the worker settles or fenced-fails its task, then shuts down
  HTTP and closes the writer. A stopped worker cannot remain as a daemon with a
  long-running claim.
- Renderer descendants escaped when cleanup assumed the child PID was its
  process group or ran only on exceptions. On Darwin, process enumeration uses
  `sess=` (not unsupported `sid=`); cleanup tracks descendants and detached
  grandchildren and runs after both success and failure. The regression uses a
  detached grandchild marker and proves no owned process remains.

### Wire-shape normalization matters at the SQLite boundary

- SQLite projections exposed integer booleans (`0`/`1`) where bridge consumers
  required JSON booleans, and hash fields arrived with inconsistent bare versus
  `sha256:` forms. Those shape mismatches made task detail, completion, and
  media assertions disagree even when the underlying row was correct.
- The resolution is canonicalization at the database/bridge boundary plus
  exact JSON-shape assertions in route and worker tests; callers do not infer
  truthiness or normalize hashes ad hoc.

### An editable checkout is not an installed renderer runtime

- Forced-caption/text timelines initially auto-routed through media-only
  FFmpeg tests, masking that the installed wheel omitted the server-owned
  Remotion bundle, Node dependencies, and package data. In a clean artifact,
  qualified Remotion could not execute even though source-checkout tests were
  green.
- Remotion is now a trusted, server-configured runtime: readiness validates
  its package, Node/npm entrypoints, dependencies, and generated registries;
  forced non-media timelines fail before claim when it is unavailable. The
  caller cannot choose `project_dir`, backend, engine, or backend config.

### External editable schema paths can create false readiness

- `banodoco_timeline_schema` resolved in one test interpreter only because an
  external editable Reigh worktree/vendor path was ambient on `sys.path`;
  another clean interpreter failed with the required schema import. Changing
  the child interpreter symlink did not fix the packaging defect.
- Readiness now provisions or names a trusted schema root, runs a bounded clean
  interpreter probe with sanitized `PYTHONPATH`, verifies the imported module's
  origin is inside that root, and checks the complete package including
  `theme.py` and `derive`. A pre-cached ambient module cannot satisfy the
  probe; worker and renderer children inherit only the validated runtime.

### A release verifier must not compete with the product worker

- Starting a verifier-owned render worker beside Astrid's serve-owned worker
  created a claim race: either process could win, so the gate could fail
  nondeterministically or prove the helper instead of the shipped topology.
- The authoritative lane now has one claimant. Playwright captures the exact
  server-issued task ID, and the verifier binds Astrid's winning attempt,
  primary media ID, bare digest, byte size, authenticated media bytes, and the
  browser download. Its production-shaped fixture keeps attempts and outputs
  nested under `task`; the earlier top-level mock hid a guaranteed live failure.

### Version checks do not pin the executable that actually runs

- Attesting Node and npm versions did not help while npm's env shebang and a
  bare `npx` could resolve different binaries through ambient `PATH`. Worse,
  invoking npm's internal `lib/cli.js` exited zero without executing npm, so a
  superficially bounded command could become a false success.
- Astrid now requires an absolute server-owned Node and invokes the locked
  project-local Remotion CLI directly. The paired verifier invokes npm's real
  `bin/npm-cli.js` through that attested Node, validates the internal target
  only for containment, records hashes, and uses hostile-PATH tests with real
  version output and a side effect to prove the requested tool actually ran.

### Why focused happy paths missed the frictions

Media-only adapter fixtures exercised FFmpeg, not Remotion; mocked transports
and child processes did not exercise real descendant cleanup, HTTP settlement,
lost acknowledgements, SQLite serialization, or interpreter origin. Unit tests
also ran inside the editable source checkout, where ambient schema and Node
dependencies hid installed-artifact omissions. Finally, no single focused test
owned the complete serve-worker, paired bridge, and browser topology, so green
admission tests were mistaken for a real export. The release claim therefore
requires the full path, not a larger pile of isolated happy paths.

### Remaining release gate

This lane is not release-ready until a clean isolated Python wheel, a separately
provisioned pinned npm/Remotion runtime, and a separately provisioned canonical
timeline-schema install pass the real MP4 task round-trip. The complete paired
verifier (including loss/retry, lease/fence, shutdown, and process-tree cases)
and the browser/E2E suite must also pass with no leaked processes, ambiguous
task leases, or unowned render work.

## 2026-08-25 — Final installed-Chrome edge audit

The post-integration Chrome pass was deliberately run after restarting Vite and
the deterministic bridge, rather than trusting pages that had accumulated HMR
state. It exercised all 13 enabled extensions together, the five-item mixed
Unicode transcript fixture, four materialized caption clips, the 566-item
Runaway lane, cross-reload persistence, proposal rejection and acceptance, and
fresh console collection.

### Minimum-width geometry needs separate interaction and paint policies

- Short transcript intervals and caption clips are narrower than a readable
  label at the 40-second overview zoom. A CSS minimum hit width made pointer and
  keyboard selection possible, but overlapping horizontal hit boxes initially
  caused an Ava click to select Boris. The host now assigns deterministic
  vertical lanes to overlapping text-clip hit targets without changing their
  timeline interval.
- The source transcript lane had the inverse problem after its hit targets were
  corrected: Chromium clipped a direct flex text node into partial, garbled
  Unicode glyphs. The painted label now lives in a shrinkable ellipsis span,
  while the complete accessible name and title remain intact. A tiny interval
  is therefore honestly compact instead of pretending its full phrase fits.
- Empty source text previously mounted as a zero-height blank control. It now
  displays `(no text)`, remains selectable and inspectable, and is still
  excluded from caption materialization. Diagnostic visibility and output
  eligibility must be independent decisions.

### A saved equivalent IndexedDB draft is not a recovery event

- Timeline mutations write the IndexedDB recovery slot before the debounced
  save. The save acknowledgement clears it asynchronously. With multiple tabs
  or a late draft write, a tab could load a record that was byte-for-byte
  equivalent to the server snapshot and still show “We recovered unsaved
  changes” beside a `saved` status.
- Recovery now compares the draft's stable config/registry signature with the
  loaded server signature. Equivalent slots are silently cleared; only a
  genuinely divergent draft is offered to the user. The clean Chrome repeat
  materialized four captions, reloaded them, and showed no recovery banner.
- Bridge hydration can take roughly six seconds in the full editor. An
  acceptance probe that inspected at 2.8 seconds saw the base timeline and
  would have reported false data loss; the same page converged to the saved
  captions after the later authoritative read. Product loading state and test
  helpers should expose hydration completion rather than requiring timing
  folklore.

### The lightweight bridge and the real render bridge own different truths

- `npm run dev:editor` intentionally starts an unauthenticated deterministic
  bridge with no `/projects/:project/tasks` admission route. Pressing the real
  Render button there fails explicitly. This is an honest limitation, but the
  default local editor does not make it obvious before the click that export is
  unavailable in that topology.
- The authenticated `real-bridge-serve.mjs` harness originally proved release
  protocol, CAS, discovery, task admission, idempotency, cancellation, and
  media routes but not a real export. Its seed had a source filename without a
  managed-media row, and its launcher did not validate the pinned Node,
  Remotion closure, or canonical schema path. The harness now imports the seed
  through Astrid, validates those release runtimes, records truthful pin
  provenance, and cleans an owned seed root when setup fails.
- The first corrected render then exposed two deeper ownership bugs. Remotion's
  browser could fetch the media URL but not use it because Astrid's owned asset
  server omitted CORS; Astrid now advertises only the exact owned Remotion
  origin. The next render produced a valid MP4 but Reigh rejected task detail
  because SQLite's integer `is_primary` leaked onto the JSON wire; the bridge
  now projects that flag to a boolean and its route test asserts the exact type.
- The final installed-Chrome repeat succeeded through the real pinned bridge.
  The editor exposed the managed-media Download link, Chrome loaded the MP4 at
  1920x1080 with `readyState=4`, and playback reached the complete 4.053-second
  duration. The authenticated content route returned `video/mp4`, 176,694
  bytes, and the final tab had no console warnings or errors. This path is now a
  useful live acceptance lane; the paired verifier remains the release
  authority because it additionally binds task, attempt, digest, bytes, and
  frozen-repository provenance.

### Browser automation can itself invalidate responsive evidence

- The installed Chrome connector advertised a 390x844 viewport override and
  returned success, but both existing and newly opened tabs still reported an
  `innerWidth` of 1200 and desktop pointer mode. The override was reset and no
  phone claim was made from that session.
- The committed Chromium/Firefox/WebKit device suite remains the responsive
  authority for this integration sequence. Manual Chrome receipts must record measured
  `innerWidth`/`innerHeight`, not only the dimensions requested from the
  automation layer.

## 2026-08-25 — Frozen-candidate verifier edge audit

### Redacting process output before consuming it corrupts structured probes

- The bounded-command helper correctly treated environment values as sensitive,
  but replaced the literal string `false` before the paired verifier parsed
  `npm ls --json --all`. All 282 boolean `overridden` fields became unquoted
  `[REDACTED]` tokens, so valid npm JSON failed as if the dependency tree were
  corrupt.
- Bounded commands now have an explicit JSON mode that parses the bounded raw
  stream in memory before redaction and returns a frozen payload to the verifier,
  while evidence logs and diagnostics receive only the separately redacted text.
  The npm and schema exceptions were removed; plain-text commands retain the
  original fail-closed environment redaction.
- Machine-readable stdout must use that structured mode. Structured probes should
  still emit validated relative identifiers when possible, and callers must not
  stringify raw payloads into failure messages without field-level sanitization.

### An absolute npm invocation does not pin `node` inside an npm script

- Invoking npm's exact `npm-cli.js` through Node 20 still let the package-script
  shell resolve a bare `node` from ambient `PATH`, producing Node 24 inside the
  verifier. The frozen manifest correctly failed the mismatch before product
  execution.
- Candidate runbooks must invoke the verifier itself with the pinned Node and a
  toolchain-first path, then let the verifier attest the exact npm CLI and every
  native executable. A version check after startup is useful only when the
  startup executable is already under custody.

### Browser installation and browser-path proof are separate gates

- Playwright successfully downloaded the lock-aligned Chromium, FFmpeg, and
  headless shell into its isolated cache. The following executable probe still
  failed because its absolute cache path was scrubbed before `existsSync` used
  it. A green installer log therefore did not prove a launchable browser.
- The durable contract is: install the lock-aligned revision, derive a relative
  executable path under the owned cache, reject traversal or escape, reconstruct
  the absolute path locally, and hash the executable before launch.

### Canonical paths can contain a lexical environment path without being equal to it

- On macOS the verifier supplied a lexical `/var/folders/...` runtime root, while
  Python reported the same files through the canonical `/private/var/folders/...`
  path. Substring redaction removed the lexical portion from inside the canonical
  path, producing `/private[REDACTED]-venv/...`; the containment check then
  correctly rejected a path that the logger had fabricated.
- The repair is class-wide rather than a schema-only exception: structured JSON
  is validated from the original bounded bytes, while the on-disk probe remains
  redacted. Regressions reproduce the lexical-versus-canonical prefix collision,
  `CI=true` boolean corruption, malformed JSON, and npm-like path payloads before
  proving the preserved in-memory payload satisfies the pinned-root checks.
- The more durable pattern for future structured probes is to emit relative
  paths under explicit owned roots, reconstruct them in the verifier, and apply
  lexical plus realpath containment there. Astrid backup JSON currently includes
  absolute destination/database paths; the verifier consumes only its boolean
  result today, but those fields must be normalized before they become receipt
  or validation inputs.

### Version negotiation stopped at the JSON/media boundary

- RC9 reached the direct managed-media content probe and received the expected
  bytes and cache/range headers, but the response omitted
  `X-Astrid-Bridge-Version`. JSON routes identified the wire protocol while the
  binary route used by preview, render, and export did not, even though release
  requests must declare the version and CORS already exposed the response name.
- Treating this only as a verifier exception would preserve an asymmetric
  contract: a client could validate structured metadata but not the media bytes
  consumed from the same bridge. RC10 therefore extends the additive v1 response
  contract across asset `200`, `206`, `304`, `HEAD`, malformed-range `400`, and
  unsatisfiable-range `416` paths, with the same `nosniff` and referrer policy.
- The edge audit also found that malformed Range responses omitted CORS. Those
  responses are now readable by an allowed browser origin and remain opaque to
  disallowed origins. Tests cover both persisted timeline assets and the exact
  `/projects/:slug/media/:media_id/content` route that the paired gate exercises.

### Preview and development Vite readiness are different contracts

- RC10 exposed a harness ambiguity: the production-like Vite preview must serve
  the exact revision-bound runtime-config document and fail closed when it is
  missing or malformed, while the development server intentionally does not
  fetch that document and defaults flags open for local authoring. Treating the
  runtime-config fetch as universal readiness makes the development lane look
  broken or weakens the preview contract.
- Use the exact runtime-config probe and per-run nonce/commit identity only for
  preview. Development readiness should prove only that the bounded root
  server started on its strict port; development intentionally has no
  runtime-config identity claim. Continue labeling editor/reload/render browser
  coverage as development-only until production local-bridge selection is
  implemented; do not infer production rollout safety from that lane.

### A synthetic fixture can silently become the acceptance contract for a real repository

- RC11's paired run reached the real Astrid bridge, migrated all 566 Runaway
  transitions, and returned complete typed provenance, but Reigh rejected the
  response because its release validator still pinned the older in-process stub's
  fabricated run id, uniform regions, frames, labels, and row ids. The combined
  predicate misleadingly reported the real provenance as missing.
- Stub fixtures remain useful for isolated browser states, but real-repository
  acceptance must bind to the independently owned migration contract. RC12 pins
  the real source SHA, stable migration run, summary facts, segment histogram,
  first/last semantics, and a normalized semantic hash across every prompt and
  metadata field. It also verifies frame-derived timings and row integrity.
- Database-generated row/evidence/project ids and timestamps are validated for
  shape, uniqueness, and consistency but excluded from the restart fingerprint.
  This lets a fresh migration compare equal without allowing a changed prompt,
  manifest row, colour, timing, or provenance summary to pass.
- Failure diagnostics now distinguish a missing evidence receipt, a wrong run
  identity, wrong summary facts, malformed rows, timing drift, and whole-fixture
  semantic drift instead of collapsing them into “missing typed provenance.”

### A visual-only seed cannot exercise sound-derived extension behavior

- RC12 proved the real Runaway lane and then timed out waiting for the transcript
  lane. The development transcript decorator was present and enabled, but the
  paired timeline contained only a PNG. The lane loader deliberately profiles
  only video or audio assets, so no source asset was eligible and the fixture
  provider was never called.
- Release fixtures must represent every media capability they claim to test.
  RC13 adds a tracked AAC source with an exact Git blob, SHA-256, byte size,
  codec, channel, sample-rate, and duration contract; imports it into Astrid's
  managed media store; registers it in the same timeline document; and places an
  eight-second clip on `A1`. The authenticated bridge is required to return the
  exact audio bytes and headers before browser acceptance starts.
- File-extension MIME and timeline media type are adjacent but distinct
  contracts. Astrid imports `.aac` as `audio/x-aac` and serves that persisted
  MIME, while Reigh's timeline registry uses the normalized `audio/aac` type.
  The paired gate now attests both and binds the registry media ID to the exact
  idempotent import instead of assuming one spelling can stand in for both.
- An AAC stream in an MP4 was previously optional evidence: the verifier only
  rejected a wrong codec when a stream happened to exist. RC13 requires an
  eight-second AAC stream, decodes the source and output to canonical mono PCM,
  rejects silence, and bounds output/source RMS and peak ratios. This closes the
  “timeline shows audio but export drops it” false positive.
- The sound-bearing filter remains unchanged. Loosening it so an image could
  synthesize a transcript would make the test pass while violating the product
  contract. Future extension fixtures should inventory their required carrier
  types up front and fail preflight when the seeded timeline lacks one.

### Wrapping npm in pinned Node erased its command budget

- RC13's clean paired run was killed while Vite was normally rendering chunks.
  The release harness assigned a ten-minute budget to npm, but its pinned-runtime
  helper executes `node /path/to/npm-cli.js`; the generic classifier therefore
  misidentified the build as a 30-second probe. Cold snapshot builds could fail
  even though the same candidate built successfully outside the harness.
- RC14 recognizes the pinned `npm-cli.js` argument as npm at the command boundary,
  preserving the npm budget without weakening probe timeouts. A regression test
  exercises the exact Node-wrapped argv shape. The failed RC13 evidence root and
  bounded-command diagnostic remain preserved for audit.

### A cancelled media request is not evidence that audio failed

- RC14 reached a complete editor UI with the real audio clip, decoded waveform,
  transcript lane, Runaway lane, and extension contributions, but the browser
  gate rejected one `net::ERR_ABORTED` AAC request. The trace showed Chromium's
  metadata loader first requesting the leading range, cancelling it after it had
  enough information, and then successfully fetching the tail range. Independent
  full-file analysis fetches had already returned all 457,980 bytes.
- Ignoring every abort would conceal real transport failures. The durable browser
  contract permits at most one cancellation for the exact AAC URL, `GET`, media
  resource type, `net::ERR_ABORTED`, and leading-byte range. The same run must
  separately prove an exact-size `200` analysis fetch, a successful `206` media
  tail, a visible decoded waveform, a finite-duration audio element with no media
  error, and zero other failed requests.
- A standalone Chromium reproduction with the tracked carrier reached
  `readyState=4`, duration `39.156558`, and no media error while exhibiting the
  same cancellation. No `AudioTrack` product change is warranted; the defect was
  an over-broad harness invariant.

### Content-addressed storage erased the asset MIME at the bridge boundary

- The same trace exposed a separate real defect: Astrid imported the AAC as
  `audio/x-aac`, but the timeline asset route guessed MIME from the verified
  managed path. Managed paths are hash-addressed and suffixless, so the bridge
  served `application/octet-stream` despite holding a typed repository row.
- The repository media row is the authority already used for project scoping,
  identity, and byte verification. The asset route now serves its persisted MIME
  rather than inferring from the storage implementation. Exact AAC `GET`, `HEAD`,
  and `Range` coverage plus the complete local-bridge server suite prevent the
  metadata and transport contracts from drifting again.

### Broker election leaked zombie children during synchronous release bursts

- The bounded-command helper launched a detached `lockf`/`flock` election
  candidate for every synchronous command. Losing candidates exited immediately,
  but no listener retained and reaped them while the JavaScript event loop was
  blocked in the next `spawnSync`. Long release preflights accumulated direct
  zombie children and repeatedly scanned a growing process table.
- The helper now validates the ready sentinel's PID, nonce, wrapper path, and
  socket before launching an election, so a healthy shared broker is reused.
  Election candidates are retained until `error` or `close`; elected brokers stay
  detached and stale/dead broker recovery remains fail-closed.
- A real macOS regression performs repeated bounded commands in a holder process,
  yields to the event loop, and asserts zero direct zombie children. Broker death,
  corrupt-sentinel, concurrent recovery, and complete descendant cleanup tests
  remain green; a source-string assertion alone would not have caught this class.

### A second hardcoded release pin made the real bridge test reject the candidate

- RC15's in-place real-bridge browser gate failed before startup even though the
  Astrid worktree was clean at the manifest pin. The bridge launcher retained an
  older RC6 Astrid SHA as a second source of truth and therefore rejected the
  current `config/releases/extension-ship-quality.json` candidate.
- The launcher now reads and validates the exact lowercase 40-character
  `astrid.commit` from the checked-in release manifest. Missing, abbreviated,
  uppercase, or malformed pins fail before any server starts. The real bridge
  still verifies clean worktree status and exact `HEAD`; only the duplicated pin
  ownership was removed.
- The adjacent user-specific checkout fallback was removed as well. The pinned
  git-checkout lane now requires an explicit absolute `ASTRID_CHECKOUT`, so a
  clean machine cannot accidentally use one developer's ambient worktree or fail
  with a misleading path error. The documented `ASTRID_SERVE_BIN` escape hatch
  remains explicitly provenance-unverified for development; if it supplies a
  checkout path, that path must also be absolute and it cannot produce a pinned
  candidate receipt.
- A lightweight provenance regression binds the launcher to the manifest, while
  the live real-bridge browser suite proves that the resolved checkout actually
  starts. Candidate tags remain immutable: discovering this after RC15 was tagged
  requires a new candidate rather than moving or overwriting the existing tag.

### Dense sparse windows could evict the keyboard-focused transition

- RC16's exact paired run selected `T0566` in the inspector after pressing
  `End`, but then removed its button from the DOM. The retained screenshot and
  accessibility snapshot showed the inspector on `T0566` while the 128 mounted
  controls stopped at `T0565`, leaving keyboard focus nowhere. The failed raw
  evidence root remains under the local `reigh-paired-release-evidence`
  directory with artifact-index SHA-256
  `42733cd8dc0054bca22cec14d36b6416750dfc9ee963da2b109c11ab8336fb59`;
  it is diagnostic history, never an RC17 receipt.
- The hand-off pin correctly mounted the target for one render. Once scrolling
  made its time range visible, the sparse overlap ranker immediately reclaimed
  the window and could rank the focused short interval below 128 older,
  long-running overlaps. Selection state therefore looked correct while the
  accessibility contract was broken.
- Sparse virtualization now reserves one of the existing 128 slots for the
  keyboard focus target when that target intersects the viewport. It replaces
  the lowest-priority retained overlap rather than increasing the DOM budget;
  ordinary unselected windows keep their deterministic ranking unchanged.
- The regression uses 566 dense transitions, widens the sparse query beyond the
  DOM budget, navigates from the first item to the far-edge last item with
  `End`, flushes the pin-to-viewport hand-off, and asserts both
  durable focus and an exact 128-control ceiling. Because the defect is in
  candidate source, RC16 remains an immutable failed candidate and the fix must
  first entered RC17, whose paired run advanced past this edge, and carries
  forward into RC18.

### Lifecycle acceptance depended on presentation-case text

- RC17 passed the 566-item keyboard-focus edge and then stopped at the first
  extension lifecycle probe. The extension row was visible and enabled, its
  toggle had accessible name `Disable com.reigh.scene-phase-markers` and
  `aria-pressed=true`, and the row reported `4 contributions · 1 active`; the
  gate nevertheless required a case-sensitive `Active` substring.
- Human-facing summary copy is not the lifecycle contract. The paired gate now
  proves the row is visible and asserts the toggle's accessible name plus
  `aria-pressed` state before disable, after disable, and after re-enable. It
  still separately proves command/lane removal and restoration, so replacing
  the brittle copy check does not weaken extension behavior coverage.
- The failed raw evidence has artifact-index SHA-256
  `d8da64fb5bd14f6c981d47be5077c33e76d152e90720fe18ced05082b0dd01d0`.
  It is retained as RC17 diagnostic history and is not a passing receipt.

### A shared virtualized viewport made mounted transcript chips look like lost source data

- RC18 passed the Runaway focus and semantic lifecycle edges, then stopped when
  transcript acceptance counted zero mounted chips. The same screenshot showed
  `transcript 0/2` beside `Runaway 128/566` at the timeline tail: the two typed
  transcript source rows still existed, but `End` navigation for `T0566` had
  correctly moved the shared horizontal viewport beyond both early captions.
- Mounted controls are a viewport projection, not the data contract. The paired
  gate now first proves the tail state—Runaway retains focused `T0566` within
  the 128-control ceiling while transcript reports two total source items and
  zero mounted chips. Only then does the reusable transcript helper set the
  real shared scroller to zero, dispatch a bubbling scroll event, wait for
  React's `data-viewport-start` to synchronize, and read two row-scoped chips.
- Resetting only the DOM property would be a false pass because React could keep
  its stale viewport state. Resetting before the tail assertions could also hide
  destructive projection loss. The helper is shared by initial, reload, and
  restart checks so later phases cannot reintroduce the mounted-equals-source
  assumption.
- The failed raw evidence has artifact-index SHA-256
  `6642b45c9ca6f0d0d85a763953cbd85eb6c803f6fbf06373167cf7576ad5f80f`.
  It is retained as RC18 diagnostic history and is not a passing receipt.

### Browser evaluation cannot close over release-runner helpers

- RC19 proved the Runaway tail, authoritative transcript count, React viewport
  synchronization, and two remounted chips, then failed while turning those DOM
  attributes into expected caption clips. The `evaluateAll` callback called
  `transcriptCaptionClipId`, a Node-side helper that Playwright serializes by
  source rather than lexical closure. It therefore existed in the runner but
  was undefined in the browser utility world.
- Page evaluation now performs only the browser-owned operation: extracting
  `title` and `aria-label` strings from the two row-scoped elements. Identity,
  timing parsing, validation, and `transcriptCaptionClipId` mapping run back in
  Node, where their owning functions and failure diagnostics are available.
  This makes the execution boundary explicit instead of duplicating the helper
  inside the page or weakening the expected-caption contract.
- The failed raw evidence has artifact-index SHA-256
  `9d38e5983ee06ed1a3fff9b612b5ad3efaf6bd271f6acea17395eccd477774ff`.
  It is retained as RC19 diagnostic history and is not a passing receipt.

### Selecting lane data must not override the user's properties-panel tab

- RC20 advanced through transcript materialization and reached the Runaway
  lifecycle action. The transition chip was visible and selectable, but the
  gate waited for its provenance inspector while the Properties panel still
  showed the explicitly selected Extensions tab. Inspectors render under the
  sibling Inspector tab; item selection intentionally does not seize the
  user's panel choice.
- Lifecycle acceptance now clicks the real chip, explicitly opens Inspector,
  verifies the Runaway provenance component, and returns to Extensions before
  testing disable/re-enable behavior. This proves both selected-item state and
  panel navigation without requiring surprising automatic UI navigation or
  weakening the inspector assertion.
- The failed raw evidence has artifact-index SHA-256
  `c88e06d1a127247cdb0a17cb3c7386869d5ed1714bf1029978df7a7ab30bfeff`.
  It is retained as RC20 diagnostic history and is not a passing receipt.

### Persisted documents and extension snapshots express clip duration differently

- RC21 advanced through transcript materialization and the full Runaway
  lifecycle, then reported that Pulse Map never persisted. Its captured
  network evidence proves the opposite: the third successful CAS request used
  `expected_version: 3`, wrote eight Pulse Map entries for the two authored and
  two generated caption clips, and received `config_version: 4` with the same
  envelope. The extension and bridge save path were working.
- The semantic validator counted only clips carrying a test-only `duration`
  property. Real persisted timelines carry authored `hold` timing or
  `from`/`to`/`speed`; the host-owned extension reader derives `duration` when
  it creates `TimelineSnapshot`. The validator therefore expected zero entries
  from the real document and rejected the valid eight-entry output.
- Release validation now projects persisted timing through the same public
  duration rules before checking extension output. Each polling attempt also
  reads the output and its source timeline config from one bridge envelope, so
  an asynchronous save cannot pair a new output with an older source snapshot.
  A hold-and-trim regression uses persisted shapes rather than another
  extension-shaped fake. Poll failures now expose the final validation object
  and reason instead of the initialization-time `not read` placeholder.
- The failed raw evidence has artifact-index SHA-256
  `d763ee5a0259a2d21b4d28d58a70abf5b083a6ab9b4c175becd3559f178b130c`.
  It is retained as RC21 diagnostic history and is not a passing receipt.

### Media decoders cancel valid non-leading byte ranges too

- RC22 passed the clean build, bridge bootstrap, audio import, and editor boot,
  then rejected one `net::ERR_ABORTED` AAC request before extension lifecycle.
  All independent audio proofs had already passed: an exact 457,980-byte
  analysis fetch, successful typed `206` media transport, a visible waveform,
  and an audio element at metadata readiness with finite duration `39.156558`
  and no media error.
- The network trace shows Chromium issuing several valid single media ranges:
  the complete `bytes=0-457979`, a middle `bytes=32768-425983`, and the tail
  `bytes=425984-`. The prior cancellation exception admitted only the two
  leading-range spellings. That assumption was narrower than Chromium's real
  metadata/decoder behavior and could turn a healthy cancellation into a false
  transport failure.
- The exception remains tightly bounded to one request for the exact asset URL,
  `GET`, media resource type, `net::ERR_ABORTED`, and one syntactically valid
  in-bounds byte range. Missing, malformed, multiple, reversed, or out-of-file
  ranges still fail. The positive `206` proof is stronger too: request and
  response ranges must agree exactly, end at the known last byte, declare the
  known total, and carry the exact derived content length. Unclassified failure
  messages now retain resource type and range so another browser variation is
  diagnosable from the receipt rather than requiring inference from the trace.
- The failed raw evidence has artifact-index SHA-256
  `ca8cb4c05ef5825d025fd0cb9717d4e17053b10c7e64079b99089c7909e2d6a0`.
  It is retained as RC22 diagnostic history and is not a passing receipt.

### Release validators can drift behind an extension's persisted schema

- RC23 passed the pinned build/runtime, real bridge bootstrap, authenticated
  proxy, audio transport and decode proofs, and the first six command
  extension lifecycles. Timeline Faultline then wrote its current versioned
  `{schemaVersion, generatedFromVersion, entries}` envelope, but the paired
  validator still required the pre-migration raw findings array.
- The extension's producer, reader, focused tests, and public type all agree on
  the envelope. The release inventory fixture was the outlier: it supplied
  `[]`, so its broad contract test blessed a shape the real command no longer
  produces. The validator now checks the versioned envelope and derives the
  exact deterministic findings from the same public timeline projection.
  Regressions cover both a clean zero-entry demo and a real gap, and explicitly
  reject a legacy raw array, invalid envelope provenance, and forged timing.
- This is a release-harness friction as much as a one-line schema bug: every
  persisted extension contract needs a producer-shaped fixture, otherwise a
  generic validator can remain green while rejecting the live application.
- The failed raw evidence has artifact-index SHA-256
  `325aaaf2ed0034f11ddc015c968fa2e7f32049e4d14b1c88dc3726e071ae07bc`.
  It is retained as RC23 diagnostic history and is not a passing receipt.

### Omitted persisted defaults must be normalized like the extension host

- RC24 passed the pinned build/runtime, bridge bootstrap, audio proofs, and the
  first six command lifecycles. Timeline Faultline persisted the exact expected
  one-gap envelope for the generated transcript-caption track, but the release
  validator derived zero gaps from the same document.
- The persisted JSON correctly omitted the default-false `muted` property. The
  extension host materializes that default as `muted: false` in its public
  `TimelineSnapshot`; the validator required an explicitly persisted false and
  therefore ignored every default-unmuted visual track. Validation now mirrors
  the host boundary: only `muted: true` excludes a track. Regressions prove that
  omitted and explicit false are equivalent while explicit true remains muted.
- The polling assertion also discarded the validator's final reason behind a
  generic `valid: false` diff. It now reports the bounded validation reason,
  count, and fingerprint, preserving the original assertion text without
  dumping project payloads. Future semantic mismatches should be diagnosable
  from the primary receipt rather than requiring manual trace extraction.
- The failed raw evidence has artifact-index SHA-256
  `7cab29d356d6fc80b959bfd68cb2cf65a5d19e407e767d0e56d658da15efab1d`.
  It is retained as RC24 diagnostic history and is not a passing receipt.

### Shared count helpers can erase an extension's distinct clip semantics

- RC25 proved that the new validation diagnostic is actionable: Foley
  Constellation reported `expected 0 entries, got 4` directly in the primary
  browser receipt. The command correctly created start/end cues for two text
  clips on the primary transcript-caption track.
- Its release validator reused a helper built for visual-media extensions. That
  helper deliberately excludes text clips, but Foley's public producer accepts
  every valid clip on the primary unmuted visual track. A superficially generic
  boundary count therefore encoded the wrong product contract.
- Foley validation now derives the complete producer-shaped cue set: host
  default normalization, primary-track selection, persisted duration
  projection, 64-clip/128-cue bounds, ordering, deduplication, exact IDs,
  boundary times, neutral spatial/category fields, structural intensity, and
  labels. Canonical equality rejects plausible-looking but forged cue output;
  regressions use default-unmuted text clips and prove explicit mute exclusion.
- The failed raw evidence has artifact-index SHA-256
  `092eb5ec7db34ede275a6c38a32872eb8327217a96cff040315f16e2dd34c4dd`.
  It is retained as RC25 diagnostic history and is not a passing receipt.

### Release oracles need per-extension semantics and phase-aware persistence

- RC26 advanced through Foley and then exposed the same abstraction failure in
  Sequential Clip-Link Scaffolder: a visual-media helper excluded the two text
  clips that its producer intentionally links, so the validator expected zero
  links while the command correctly persisted one.
- Auditing the remaining command tail found the broader pattern before another
  candidate cycle. Chromatic and Recall also consume text clips and persist
  complete streams beyond their 128-marker viewport; their validators had
  excluded text and imposed a false persistence cap. Lockline consumes registry
  asset keys plus projected material/source references, but its validator was
  not receiving those facts and only checked loose coverage inequalities.
- Each remaining validator now independently derives its exact public contract:
  adjacent links; pacing classifications and truthful display coverage; review
  categories, questions, and host FNV source signatures; and bounded Lockline
  findings, coverage, registry references, and source signature. Regressions
  cover default-unmuted text tracks, forged values, 129 persisted suggestions,
  and concrete missing/mismatched registry provenance.
- The multi-phase gate also deliberately drags a clip after commands run. On
  restart, those derived outputs may be honestly stale. First phase therefore
  performs semantic validation; restart proves byte-identical persistence
  against the first phase's trusted fingerprints rather than recomputing output
  against a timeline the commands never observed.
- The failed raw evidence has artifact-index SHA-256
  `9f251171350b6be6d482f5f56a6b86fb4fefcc6df1d58ba246e4c15041989c8d`.
  It is retained as RC26 diagnostic history and is not a passing receipt.

### Closed asset-registry projections silently sever stable media identity

- RC27 passed the pinned build, real bridge bootstrap, byte transport, editor
  load, extension lifecycles, and browser edit before the persisted-state check
  found that `motion-output-audio.aac` had retained its file and MIME type but
  lost its Astrid `media_id`. The create response and first persisted baseline
  both contained the ID, proving the bridge and Astrid repository had not
  stripped it.
- Reigh rebuilt edited documents through `buildTimelineData` and
  `canonicalizeTimelinePair`. The registry sanitizer used a closed field list
  which omitted `media_id`, so the next otherwise-valid CAS save durably wrote
  the projected entry without its stable identity. The shared schema, bridge
  contract, public type, sanitizer, and Astrid validator now all carry an
  optional non-empty `media_id`; a load -> edit rebuild -> debounced save
  regression covers the complete failure path rather than only the helper.
- Regenerating the vendored schema exposed another release friction: its local
  dependency directory lacked its declared TypeScript and schema-emitter
  versions, allowing the application root's incompatible Zod toolchain to be
  hoisted into the build. Installing the package's declared versions locally
  made generation complete in seconds and revealed older committed source
  fields whose generated JSON, declarations, and Python types were stale.
  The canonical build is now deterministic across a second generation pass;
  generated artifacts must be checked at candidate freeze instead of trusting
  an ambient monorepo dependency graph.
- The failed raw evidence has artifact-index SHA-256
  `b78841bd6dd5a113097dcea8cd2b7322a5acd7fa38fa5ab74b2f57efe9cac00e`.
  It is retained as RC27 diagnostic history and is not a passing receipt.

### One transient process-table timeout must not poison a successful gate

- RC28 proved the repaired media-identity path in the real browser: the first
  paired Playwright phase completed successfully in 1.2 minutes. The release
  still failed after Playwright exited zero because its shared process-scope
  broker gave one `ps eww` scan only 1,000 ms. That scan timed out under the
  production-build/browser load, permanently failed the broker client, and
  converted a successful command plus completed local fallback cleanup into a
  `cleanup-error` before restart, restore, and render could run.
- Process discovery remains fail-closed, but an individual operating-system
  scan is now treated as transient uncertainty. The broker, stale-owner probe,
  and local fallback share a bounded three-attempt retry policy; exhausting all
  attempts still fails with `EPSCAN`, and broker loss still produces the
  existing cleanup error after locally draining the scope. The broker connect
  window covers the complete retry budget so recovery cannot create a new
  startup race, and the outer synchronous cleanup allowance is derived from
  the maximum broker-plus-fallback scan budget rather than a shorter magic
  timeout. Deterministic tests prove both two-timeout recovery and terminal
  failure after the full budget, while the existing orphan, PID-reuse, broker
  death, and concurrent-cleanup suite remains green.
- The failed raw evidence has artifact-index SHA-256
  `128350457ed70e42b46790a04b487e37665e1abf89cdf2c187e18a54ceda5fbf`.
  It is retained as RC28 diagnostic history and is not a passing receipt.

### Standalone heavy gates need the same early disk budget as the orchestrator

- RC29's first paired run passed exact-ref provenance and began provisioning,
  then exhausted the host volume while downloading the isolated Playwright
  browser. The top-level ship verifier already requires 5 GiB on the temporary
  volume and 2 GiB on a separate Astrid volume before this heavy step, but the
  standalone paired command did not apply that policy. A direct invocation
  could therefore spend minutes and substantial I/O before failing with
  `ENOSPC` instead of rejecting the machine state at preflight.
- The standalone gate now delegates to the same code-owned heavy-step disk
  policy before native-tool attestation or runtime materialization. It groups
  requirements by physical volume, fails closed below either threshold, and
  records the successful byte measurements in the immutable paired receipt.
  Deterministic tests cover exact-threshold success and one-byte-short failures
  on both volumes, preventing the standalone and orchestrated entry points from
  drifting apart again.
- The failed raw evidence has artifact-index SHA-256
  `f3d8ff7e303d0f7dd72f9cf6b38edcfcdb400099bd1b8f9a10623c2def9bce31`.
  It is retained as RC29 diagnostic history and is not a passing receipt.

### A positive viewport origin is not proof that early data is virtualized out

- RC29's second paired run passed the complete first browser phase and the
  hardened cleanup path, then failed during restart because the transcript
  helper interpreted any `data-viewport-start > 0` as the Runaway tail. The
  trace reported `0.46875s` with a viewport ending at `34.65625s`; both fixture
  captions occupy `2–8s`, so the two visible chips in the screenshot were the
  correct product behavior.
- The redundant conditional assertion has been removed from caption recovery.
  That helper now resets the shared scroller, waits for React's viewport state
  to reach exactly zero, and proves both caption chips and their semantics.
  The distinct Runaway-tail proof remains authoritative and is stronger: it
  requires the shared viewport to move beyond the transcript fixture's actual
  8-second end before requiring zero mounted transcript chips. Fractional
  scroll offsets can no longer masquerade as a virtualization boundary.
- The failed raw evidence has artifact-index SHA-256
  `4913cbb585276ce337eb748b0d65eaf83ee9af9992ce2aa37c8ad0ba1daaaceb`.
  It is retained as RC29 diagnostic history and is not a passing receipt.

### Cross-repository schema drift must fail with bounded, actionable diagnostics

- RC30 passed the complete browser lifecycle, persistence, restart, and visual
  checks, then failed during the first real render. Reigh legitimately emitted
  `TimelineClip.label`, clip `keyframes`, and top-level `TimelineConfig.app`,
  but the pinned shared timeline schema rejected those fields. Astrid's second
  semantic allowlist also rejected `label`. The RC30 worker discarded both
  child streams, so the release receipt collapsed the real validation reason
  into `render_export child failed` and the browser surfaced only a timeout.
- The shared TypeScript source, generated TypeScript/JSON/Python artifacts,
  Reigh SDK boundary tests, and Astrid allowlist now carry the same three
  fields. Replaying RC30's exact task snapshot after that repair produced a
  valid 493,241-byte MP4 with SHA-256
  `09fc6b41fd6eda7a0c2d0cf35eb54425d2c72cfdfbfb37a0a303f891dc9ca6a1`.
- Astrid now drains bounded stdout/stderr tails from the render child from the
  moment it starts, retains exit code and useful tail markers, and preserves
  structured renderer support reasons without copying command, task, or
  ambient environment data into the error. The child receives a canonical
  allowlisted environment instead of inherited API keys or bridge tokens.
  Noisy-child tests prove the pipes cannot deadlock and diagnostic payloads
  remain bounded.
- Cleanup then exposed a second masking failure: two server supervisors polled
  the full process table every 40 ms while the shared cleanup broker scanned it
  too. Three 1-second scan timeouts obscured the primary render failure. Server
  supervisors now perform an authoritative fail-closed readiness scan, poll
  only parent liveness during the run, and share the release scan budget for
  teardown. Process discovery remains fail-closed without generating a scan
  storm under browser/build load.
- The failed RC30 evidence has artifact-index SHA-256
  `574720b2453841f0e0376de071d32c6e69779d2c0d381171a1a331cefac9cc07`.
  It is retained as diagnostic history and is not a passing receipt.

### Sanitized package-manager configuration paths must remain distinct

- RC31's full verifier stopped at the first npm identity probe, before any
  product gate. The verifier correctly refused user and machine npm config,
  but assigned both `NPM_CONFIG_USERCONFIG` and
  `NPM_CONFIG_GLOBALCONFIG` to `/dev/null`. npm 10.8.2 treats that as the same
  config file loaded under two roles and exits before resolving configuration.
- The sanitized environment now uses two distinct paths inside the verifier's
  private release home. Neither path can resolve to operator configuration,
  and an executable regression launches the pinned npm CLI under the exact
  allowlisted environment. RC31 remains immutable preflight-failure history;
  no product or browser result is claimed from it.

### Browser media cancellation must be classified by chronology, not count alone

- RC32 reached the real paired browser and proved a healthy 39.156558-second
  AAC element, a complete 457,980-byte waveform fetch, and a valid terminal
  `206` media range. It nevertheless stopped because the gate assumed Chromium
  would abort at most one metadata request. The trace showed two distinct,
  valid probes (`bytes=0-457979` followed by `bytes=65536-`) being replaced
  before the successful tail request; there was no duplicate retry or server
  transport failure.
- The gate now accepts no more than two valid, distinct abort signatures. A
  two-probe sequence must progress from byte zero to a later offset, while the
  separate full-fetch, terminal-range, finite-duration, ready-state, and media
  error checks remain mandatory. Duplicate aborts, more than two probes,
  malformed ranges, wrong URLs/types, and non-abort failures all fail. This
  encodes the observed browser state machine without hiding request storms.
- The same audit exposed a false uniqueness assertion: applying `.first()`
  before `toHaveCount(1)` could never detect duplicate exact-source audio
  elements. The gate now counts the unqualified exact-source locator first,
  then inspects that sole element. It also requires exactly two successful
  full-file fetches—the intentional waveform and audio-analysis producers—so
  an added consumer cannot silently amplify network and decoding work.
- The failed RC32 evidence has artifact-index SHA-256
  `39e5e5885559ad31a7feaf0e55975b8d0222a09cf634d6cd2f3dff265ff54609`.
  It remains immutable diagnostic history and is not a passing receipt.
