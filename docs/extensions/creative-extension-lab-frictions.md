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
- One public gap remains even on `oracle-run`: typed lanes are read-only. Editing
  generated text clips does not update the source transcript. True round-trip
  transcript editing needs a typed-data mutation callback/service; V1 must state
  that source-to-caption flow is one-way.

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
  timeline remained intentionally horizontally scrollable. One remaining host
  concern is aggregate virtualization: a 566-item typed interval lane makes
  accessibility/DOM snapshots expensive even though visual interaction remains
  responsive.

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
  generated editable video-text track, but the relationship is one-way. A future
  mutation/provenance contract should distinguish “regenerate from source,”
  “keep local caption edit,” and “write correction back to transcript.”

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
  this branch still has pre-existing authority-lint and reduced-kernel failures
  unrelated to Runaway; focused fourth-pack tests are green.
- Rendering all 566 intervals at once is visually useful for this piano piece but
  makes full accessibility snapshots time out. The `dataKind` host contract needs
  viewport bounds/virtualization and a density-summary hook so large typed lanes
  remain inspectable without mounting every interval as an interactive node.

### Validation ergonomics and local-environment noise

- A recursive manifest drift gate and `test:creative-extension -- --all` now make
  the ten-extension release check one command: focused tests, focused ESLint,
  full project TypeScript, and manifest/docs/schema drift. Serial execution was
  necessary under disk pressure; parallel transformed-test caches briefly hit
  ENOSPC even though the implementation itself was healthy.
- Local editor mode still performs remote token/auth work, emits React Router
  future warnings, skips non-UUID Supabase fixture IDs, and reports render-budget
  warnings. None were extension runtime failures, but they obscure the signal in
  deep browser testing. A deterministic local-fixture mode should silence remote
  services and expose extension diagnostics in a dedicated test surface.

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
- The host now accepts one fixed operational event object, rejects unknown keys
  and path-like/free-form tokens, contains hostile getters and failing sinks,
  and forwards sanitized records through a browser event boundary. The schema
  covers activation, disposal, command, bridge, persistence, migration, render,
  and lane-density outcomes without creative content.
- A schema is only the construction boundary. Actual production dashboards,
  retention/access policy, alert drills, and on-call ownership still require
  human/operator evidence before rollout; the release checklist must not infer
  those from unit tests.

### A reproducible cross-repository gate needs explicit executable paths

- Pinning only `Python 3.11` was insufficient: the available Astrid environment
  is Python 3.14.3, and nested `make ci` shell scripts independently fall back to
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
