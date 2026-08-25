# Extension Release: Next Steps

Date: 2026-08-25

This is the execution plan from the stable integration branch to a signed,
frozen extension release candidate. The detailed requirements remain in the
[ship-quality checklist](extension-ship-quality-checklist.md), the executable
operator procedure remains in the
[release runbook](extension-release-runbook.md), and formal claims remain owned
by the [evidence ledger](extension-ship-evidence-ledger.md).

## Current disposition

`codex/extension-ship-integration` is the current RC6 **integration cycle**;
resolve its moving synchronization head with `git rev-parse HEAD` rather than
copying that value into release evidence. Its paired Astrid input is
`bd5998aee6e3659d009041bc66177b9e6f1838b3` on
`codex/extension-ship-astrid-integration`. The Astrid repair is committed,
pushed, clean, and synchronized with its upstream branch. Its focused gates
pass. A fresh clean CI proof at the preceding pin passed 603 tests before
exposing one ambient-package contract test and two missing-explicit-Node
harness failures. The hermetic package-contract repair and both real-render
paths now pass together under coverage (12 tests); the new exact pin above
contains that repair. No single full clean rehearsal at the new pin has yet
produced the final zero-exit transcript, so this is not a frozen release
candidate. The local
integration checkout and its upstream
remote are synchronization points for the hardening sequence, not a release
identity; do not infer the candidate from a moving branch head or from a dirty
developer checkout. The manifest-pinned Astrid source remains the required
paired input. The exact Reigh candidate `C` will be computed from a fresh clean
snapshot after the current bridge/runtime fixes and all source changes are
reviewed. Until then, the manifest status remains `integration` and no final
SHA, tag, or controller pair is promised.

RC1–RC5 tags and paired receipts remain immutable historical evidence; RC6 has
no tag, no frozen candidate, and no signed ledger. The formal ledger is 0/23.
The RC6 line has landed deterministic Runaway timing, clip-body selection,
Suspense/bridge-stub contracts, runtime-isolated ports and CAS fixture resets,
proxy Origin/Host/auth/protocol boundaries, strict-port plus nonce/commit
readiness, tracked-evidence protection, and exact visual-baseline provenance.
Native-tool attestation, crash-safe bounded-command/paired-server containment,
managed-media seeding, exact runtime resolution, owned-origin Remotion CORS,
and JSON task-output boolean normalization are now on the pushed pair. The
current integration product head passed 13,674 tests with two intentional
skips across 1,199 passing files. All ten disk-light static release gates also
pass, as do 1,160 extension contract tests, 102 Creative Lab tests, the 97-case
compatibility matrix, 33 production-smoke tests, runtime-rollout tests, and a
production build. Installed pre-freeze browser diagnostics pass across
Chrome/Firefox/WebKit (9 cases), accessibility and responsive layouts (12),
performance and degraded mode (2), visual baselines (6), the complete timeline
device suite (28), the extension readiness harness (171), and the authenticated
real-Astrid bridge suite (5). The
installed Chrome acceptance lane also completed a real authenticated
Reigh-to-Astrid export: the managed MP4 loaded at 1920x1080, played its complete
4.053-second duration, exposed the Download link, and left no console warnings
or errors. These are useful pre-freeze diagnostics, but they are not release
receipts. `C` must still be computed from the final clean snapshot after the
disk-gated fresh-install/browser/paired rehearsal and any resulting fixes.

The current exact Reigh head also has fresh implementation-level diagnostics
for the two previously weak resource lanes. Large-lane virtualization passed
108 focused tests at 500, 5,000, and 50,000 intervals, plus a real Chromium
late-scroll test with a 128-item DOM cap and zero unexpected errors. The
performance/degraded-mode browser gate passed both cases and recorded bounded
startup, activation, command search, virtual scrolling, DOM, project data,
bridge traffic, and heap growth. These remain pre-freeze diagnostics rather
than candidate-bound receipts.

## Phase 1 — publish and lock the integration baseline

1. Keep the pushed process-containment and native-tool-attestation checkpoints
   intact; keep `scorecard.png`, `artifacts/`, and Playwright output outside the
   tracked release tree.
2. Require review of the RC6 code commits through the production startup-budget
   gate. Do not add feature work to this branch after the evidence rehearsal
   begins; fixes discovered by a gate receive a focused commit and restart the
   affected evidence phase.
3. Keep the exact Astrid pin above; the RC3 raw-Host fix, RC4 browser React
   renderer repair, `2e7f6a937` local-auth seam repair, and RC6 hardening must
   all be present before a candidate tag is created.

Exit: the reviewed integration sequence is ready to be materialized as a fresh
clean candidate; the release plan commands remain deterministic. Remote/local
branch synchronization is recorded separately from candidate identity.

## Phase 2 — recover disk and run exact-pair evidence rehearsals

1. Confirm at least 11 GiB free with `df -h /System/Volumes/Data`. Removing only
   orphaned task-owned pytest and Astrid temporary roots restored roughly
   12 GiB free without touching user caches, Playwright, active Chrome data,
   release worktrees, or live release servers. The current margin above the
   enforced floor is small, so recheck it before and after every heavyweight
   phase and remove only verified task-owned residue.
2. Use fresh clean worktrees at the exact Reigh candidate computed after native
   attestation and the pinned Astrid commit. Run the individual local release
   gates, complete unit suites,
   production build, three-engine browser/device/accessibility suites, visual
   baseline provenance, container rollback, and the standalone paired
   Reigh/Astrid E2E journey.
3. Retain complete logs, canonical database/state hashes, the decoded MP4 and
   every-frame report, screenshots, rollback hashes, dependency inventories,
   native-tool/platform attestation, and the detached artifact-index hash.
   Rerun any failing phase after its root fix; do not waive a shipped-path
   failure. Evidence paths are add-once: a rerun uses a new untracked root and
   a correction gets a new receipt/path rather than overwriting a captured one.

Exit: the exact pair completes every locally executable gate with a clean tree,
no unexpected errors, reproducible persisted state, and retained hash-addressed
evidence.

The paired receipt's render gate is code-owned. It requires exactly the two
persisted captions (`Fixture segment one` at 2–4 seconds and `Fixture segment
two` at 5–8 seconds), bound by ID, text, interval, and render region. It probes
each caption at its first, midpoint, and last encoded frame (six probes total),
then probes a no-caption control interval. The control must contain the
committed 1280×720 paired-release test card with its metadata/hash and pixel
probes; caption frames must pass exact OCR plus region, occupancy, and
frame-vs-control contrast checks. The MP4 is fully decoded and its codec,
dimensions, frame rate, duration, frame count, and media bytes are bound to the
persisted state. This replaces the old shorthand of “two caption midpoints.”

The Runaway/API/UI proof is likewise one chain: apply the Astrid-owned tracked
Runaway fixtures twice (566 transitions, one evidence receipt, stable project/run
identity); prove the release-mode bearer and `v1` bridge contract and exact
media response; exercise the built Reigh preview's authenticated same-origin
proxy, including hostile-header rejection; then run the development-only local
editor journey with the 566-item lane, 48-fps/8,085-frame bounds, keyboard
first/last navigation, inspector selection, persistence after restart, and
render/export. Astrid and Reigh receive newly allocated ports for every phase;
no fixed developer port is evidence.

Every external command is bounded by a phase budget and writes timeout
diagnostics. Detached server groups receive TERM and up to five seconds to
exit, then KILL and another five seconds; readiness failure reaps the complete
group even when the child handle has not yet been returned. Native attestation
resolves and byte-hashes `ffmpeg`, `ffprobe`, `tesseract`, and ImageMagick,
checks exact version/build identity and Tesseract `eng.traineddata`, and pins
the host platform before dependency provisioning. The standalone path records
that no container was used.

## Phase 3 — close environment and product-owner gates

1. Install/authorize Edge or record a release-owner exception; execute physical
   touch, trackpad, Retina, slower-device, screen-reader, and sustained
   typography sessions.
2. Connect a real upstream transcript owner and prove that an accepted handoff
   advances to `acknowledged-by-source-owner` only for the exact fingerprint,
   returned revision, owner, and applied-source fingerprint.
3. Supply a production deployment target and access. Deploy Stage 0 with all
   extension flags dark, configure cohort routing, distributed rate limiting,
   dashboards, alerts, and named on-call owners, then perform disable, bridge
   outage, failed migration, corrupt data, and restore drills.
4. Complete four distinct human sessions: video editor, accessibility user,
   transcript specialist, and first-time extension author. Resolve every
   release-blocking finding.

Exit: production drills are captured, the upstream acknowledgement is proven,
and all four human personas have signed receipts. The paired caption path is
now machine-proven; general SDK caption semantics and Caption Safe-Zone
Orchestra's text/layout/contrast/media acceptance remain limited and must not
be represented as a broader semantic-caption guarantee. Local Astrid mode does
not authorize removing Supabase from ordinary cloud or legacy Reigh routes.

## Phase 4 — independent review and frozen RC

1. Register six authenticated Ed25519 principals: the four human personas and
   two independent reviewers. Keep private keys outside the repository.
2. Freeze product candidate `C`, create annotated tag
   `extension-ship-quality-rc6`, and permit only evidence/ledger/status commits
   in controller history `C..H`.
3. Bind every receipt and artifact hash to the exact Reigh candidate, controller
   commit, annotated tag object, Astrid commit, toolchain, and dependency locks.
4. Have both independent reviewers reproduce the evidence, verify rollback,
   sign their dispositions, and advance the ledger only when all 23 workstreams
   are genuinely supported.
5. Run `npm run verify:extension-ship` from the clean controller commit. Any
   source fix invalidates the freeze and starts again from Phase 2.

Exit: the immutable verifier exits zero, the evidence ledger reports 23/23,
both reviewers approve, rollback is proven, and the Release DRI signs the final
disposition.

## Inputs still required from the owner

- Approval to delete the surveyed 2.7 GiB Codex Sparkle update cache at
  `~/Library/Caches/com.openai.codex/org.sparkle-project.Sparkle`; the tiny
  Docker cache is no longer a meaningful recovery target.
- Production target/access plus observability and on-call owners.
- Edge/physical-device availability or an explicit release exception.
- A real upstream transcript owner for the exact-fingerprint acknowledgement.
- Four human participants and two independent reviewers, with their Ed25519
  public identities.
