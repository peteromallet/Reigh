# Extension Release: Next Steps

Date: 2026-08-24

This is the execution plan from the stable integration branch to a signed,
frozen extension release candidate. The detailed requirements remain in the
[ship-quality checklist](extension-ship-quality-checklist.md), the executable
operator procedure remains in the
[release runbook](extension-release-runbook.md), and formal claims remain owned
by the [evidence ledger](extension-ship-evidence-ledger.md).

## Current disposition

`codex/extension-ship-integration` is stable as an **integration branch**, not yet a
release candidate. RC1, RC2, and RC3 paired receipts are retained as historical
evidence only. RC2's hostile-Host probe was a false positive because Node
`fetch` normalized the forbidden header. RC3 replaced that probe with a raw
`http.request` helper and added a regression test proving
`Host: attacker.invalid` reaches the server and yields the expected 403
response. RC3 then exposed a browser-entry regression: the editor eagerly
loaded React's Node server renderer and crashed before mounting. RC4 repairs
that import boundary and adds a source-level guard. The pinned Astrid source remains
`86153eefc14aa995402927df0c7bb178f48f8ead`.

The formal ledger correctly remains 0/23 because no exact candidate has been
frozen or signed. The final monolithic Reigh/Astrid run has not been repeated
after the last fixes because the clean verifier requires at least 11 GiB free;
the machine currently has about 5.3 GiB. No release claim may infer green status
from the focused runs alone.

## Phase 1 — publish and lock the integration baseline

1. Push `codex/extension-ship-integration` without `scorecard.png` or the untracked
   `artifacts/` directory.
2. Require review of the code commits through the production startup-budget
   gate. Do not add feature work to this branch after the evidence rehearsal
   begins; fixes discovered by a gate receive a focused commit and restart the
   affected evidence phase.
3. Keep Astrid pinned to
   `86153eefc14aa995402927df0c7bb178f48f8ead`; the RC3 raw-host fix and RC4
   browser-entry repair must be included before the next candidate is tagged.

Exit: the remote branch resolves to the same clean tracked tree as the local
integration branch and the release plan commands remain deterministic.

## Phase 2 — recover disk and run exact-pair evidence rehearsals

1. With explicit owner approval, remove only the surveyed unused Docker build
   cache and the two regenerable Reigh test images. Confirm at least 11 GiB free
   with `df -h /System/Volumes/Data` before starting.
2. Use fresh worktrees at the exact Reigh commit and pinned Astrid commit. Run
   the individual local release gates, complete unit suites, production build,
   three-engine browser/device/accessibility suites, visual baselines, container
   rollback, and the standalone paired Reigh/Astrid E2E journey.
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
   `extension-ship-quality-rc4`, and permit only evidence/ledger/status commits
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
