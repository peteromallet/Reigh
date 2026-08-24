# Extension Release: Next Steps

Date: 2026-08-25

This is the execution plan from the stable integration branch to a signed,
frozen extension release candidate. The detailed requirements remain in the
[ship-quality checklist](extension-ship-quality-checklist.md), the executable
operator procedure remains in the
[release runbook](extension-release-runbook.md), and formal claims remain owned
by the [evidence ledger](extension-ship-evidence-ledger.md).

## Current disposition

`codex/extension-ship-integration` is the current RC6 **integration cycle**, not
a frozen release candidate. Reigh's latest source head is
`925a954b39dbe5c8e2ec667d2e9c2b3564612f73` in the
`/Users/peteromalley/Documents/reigh-workspace/reigh-app-extension-rc`
worktree; the tracked worktree is clean. The manifest status remains
`integration` until the exact candidate is frozen. Astrid's
paired bridge worktree is
`/Users/peteromalley/Documents/reigh-workspace/Astrid-editor-bridge-integration`
on `codex/editor-bridge-integration` at
`97314ccee7caa7adfe04004e6854d7a8ba6b6dfd`. The manifest-pinned Astrid source
for the release gate remains
`86153eefc14aa995402927df0c7bb178f48f8ead`.

RC1–RC5 tags and paired receipts remain immutable historical evidence; RC6 has
no tag, no frozen candidate, and no signed ledger. The formal ledger is 0/23.
The RC6 line has landed deterministic Runaway timing, clip-body selection,
Suspense/bridge-stub contracts, isolated ports and CAS fixture resets, proxy
Origin/Host/auth/protocol boundaries, strict-port plus nonce/commit readiness,
tracked-evidence protection, and exact visual-baseline provenance. Local
focused machine tests are mostly green, but that is not a release receipt.
Current `df` output is about 14 GiB free (roughly 12 GiB in the release
check); the clean paired verifier requires at least 11 GiB.

## Phase 1 — publish and lock the integration baseline

1. Finish the current focused fixes and keep `scorecard.png`, `artifacts/`, and
   Playwright output outside the tracked release tree.
2. Require review of the RC6 code commits through the production startup-budget
   gate. Do not add feature work to this branch after the evidence rehearsal
   begins; fixes discovered by a gate receive a focused commit and restart the
   affected evidence phase.
3. Keep the exact Astrid pin above; the RC3 raw-Host fix, RC4 browser React
   renderer repair, `2e7f6a937` local-auth seam repair, and RC6 hardening must
   all be present before a candidate tag is created.

Exit: the remote branch resolves to the same clean tracked tree as the local
integration branch and the release plan commands remain deterministic.

## Phase 2 — recover disk and run exact-pair evidence rehearsals

1. Confirm at least 11 GiB free with `df -h /System/Volumes/Data`; the machine
   currently has enough headroom, but avoid unnecessary artifact-heavy work.
2. Use fresh clean worktrees at the exact Reigh candidate and pinned Astrid
   commit. Run the individual local release gates, complete unit suites,
   production build, three-engine browser/device/accessibility suites, visual
   baseline provenance, container rollback, and the standalone paired
   Reigh/Astrid E2E journey.
3. Retain complete logs, canonical database/state hashes, the decoded MP4 and
   every-frame report, screenshots, rollback hashes, dependency inventories,
   and the detached artifact-index hash. Rerun any failing phase after its root
   fix; do not waive a shipped-path failure.

Exit: the exact pair completes every locally executable gate with a clean tree,
no unexpected errors, reproducible persisted state, and retained hash-addressed
evidence.

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
and all four human personas have signed receipts.

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

- Approval to delete the surveyed unused Docker cache and two Reigh test images.
- Production target/access plus observability and on-call owners.
- Edge/physical-device availability or an explicit release exception.
- Four human participants and two independent reviewers, with their Ed25519
  public identities.
