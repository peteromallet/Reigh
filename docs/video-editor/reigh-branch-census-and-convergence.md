# Reigh Branch Census and Convergence Record

**Date:** 2026-08-28  
**Scope:** `banodoco/reigh-app`, `banodoco/reigh-worker`, and `banodoco/reigh-worker-orchestrator`  
**Canonical product direction:** [Creative Workspace Runtime Vision](../creative-workspace-runtime-vision.md) and [SQLite-Only Local Runtime Plan](../sqlite-only-local-runtime-plan.md)

## Executive decision

The canonical Reigh application line is the local `main` checkout at `aefe34c10`. It contains the four accepted timeline convergence commits recorded below. The shot-scoped timeline UI work is backed by document-derived Astrid timeline data, with save recovery, idempotent scene markers, stable seeded timeline IDs, and anchored empty-shot creation included in the accepted line.

The branch population is much larger than the amount of unmerged product work. Most app refs are strict ancestors of `main`, patch-equivalent duplicates, historical execution/evidence branches, or superseded architecture.

The final cleanup target is one canonical Reigh app checkout: all non-`main` local and remote Reigh app branches and all other Reigh app worktrees are disposable after the verified recovery bundle is retained. Release tags remain. Reigh Worker, the worker orchestrator, Astrid, VibeComfy, and all other repositories are outside this cleanup and remain untouched.

## What was integrated

### Reigh app

Local `main` advances from `d738cd342` through these four accepted commits:

1. `abea7a212` — reconcile saves and make scene markers idempotent.
2. `f183d5822` — use ULIDs for seeded default timelines in the real-bridge harness.
3. `35b691acb` — preserve newer drafts during recovery.
4. `aefe34c10` — add the anchored empty-shot workflow.

Together these commits complete the accepted local timeline convergence without introducing a fallback to Supabase.

Final local-main validation:

- 205 focused Vitest tests passed.
- 11 timeline harness checks passed.
- Changed-surface ESLint passed.
- TypeScript compilation passed.
- Production build passed.
- Browser validation passed.
- The broad Vitest run was resource-starved and interrupted. It is not claimed green and was not used as the acceptance gate.

### Explicitly rejected broker harvest

Commit `0c88173ea` (`fix(release): avoid full process scans on broker hot path`) is explicitly rejected from the canonical line. Its process-cleanup behavior was not proven sufficiently, so no broker cleanup change from that harvest is accepted.

### Worker orchestrator

The convergence branch adds five commits on top of remote `main` at `37b2d578`:

1. `193b9e3` — avoid false live-test pod zombie errors.
2. `5c042ab` — exclude live-test workers from the reverse zombie check while preserving current `WorkerLifecycle` behavior.
3. `e64065c` — apply a two-hour stale-task window to known long-running generation task types.
4. `a151d70` — select the required `updated_at` field and add regression coverage for ordinary, long-running, and orchestrator timeout classes.
5. `b9b65a5` — remove an import-coverage assertion for a script that never existed in the repository.

Validation with a clean Python 3.10 virtual environment and both repository requirement sets:

- Focused orchestrator tests: 10 passed.
- Full orchestrator suite: 163 passed, one third-party deprecation warning.
- Python syntax compilation: passed.

### Reigh worker

Nothing was merged. Current worker `main` is `68b70149`; both local worktrees are clean and identical. Eleven remote branches are ancestors of `main`. The sole divergent baseline branch is stale and would reintroduce obsolete comparison artifacts. The worker remains Supabase/PostgREST-oriented, so its neutral SQLite runtime client is a new workstream, not lost branch work.

## Reigh app census

Audit totals at the freeze point:

- 45 local branches.
- 34 live remote heads.
- 13 registered worktrees.
- 48 tags, including 44 extension release-candidate tags.

### Already represented on `main`

These local refs have no product work left to merge because they are strict ancestors or fully patch-equivalent:

```text
codex/bridge-transport-negative-cases
codex/extension-ship-integration
codex/extension-ship-long-clip-port
codex/extension-ship-quality
codex/extension-ship-rc45-integration
codex/extension-virtualization-proof
codex/fix-broker-cleanup-race
codex/full-repo-green
codex/gallery-authority-guard
codex/luna-acceptance-preflight
codex/luna-astrid-pin-refresh
codex/luna-audio-reactive-renderer
codex/luna-authority-noise
codex/luna-authority-noise-v2
codex/luna-bridge-hardening
codex/luna-browser-scale-gate
codex/luna-local-rc-preflight
codex/luna-preflight-json
codex/luna-preflight-test-fix
codex/luna-recovery-migration-a13
codex/luna-release-gap
codex/luna-supabase-history
codex/migration-outcome-telemetry
codex/phase-c-completion
codex/rc-safe-fixes
codex/rc45-negative-scale-integration
codex/real-bridge-probe-cleanup
codex/reigh-main-extension-merge
codex/release-disk-preflight
codex/release-doc-closure
codex/render-matrix-all-frames
codex/transcript-per-record-review
codex/unhandled-rejection-browser-gate
codex/verifier-astrid-reigh-contract
oracle-run-v2
```

Matching remote refs in this class can also be removed after a recovery manifest is retained. Remote `oracle-run` and the remote tip of `timeline-patches` are ancestors of `main`, although their local branches differ and must be preserved separately.

### Clean temporary worktrees safe to remove

All are patch-equivalent to `main` and clean:

```text
/private/tmp/reigh-api-tokens.ksEUl8                 12fe54ce4
/private/tmp/reigh-authority-noise.2yum0C           18ba5b244
/private/tmp/reigh-dialog-dom-nesting.xMYhEB        603ef13b8
/private/tmp/reigh-joinclips-noise.3UHChV            1438af1c6
/private/tmp/reigh-local-project.LGLtDJ              340fd4215
/private/tmp/reigh-shot-scoped-timelines             abea265bb
/private/tmp/reigh-ulid-investigate.1UBkIl           032ac5f9e
```

The shot-scoped detached tip is specifically patch-equivalent to `main` commit `23e4a3832`; it must not be merged again.

### Historical/superseded remote lines

- `exec-goal` and `exec-goal-20260822` point to the same tip. They mix older timeline/CAS work with hundreds of Oracle artifacts; preserve one archive, then delete the duplicate.
- `exec-sqlite-20260823` is a descendant of that history and is dominated by evidence/vendor artifacts. It is not the neutral runtime implementation described by the current plan.
- `local/extension-foundation-completion` and `extension-foundation-finish-20260707` are stale July foundation histories.
- `megaplan/slot-first-m1-schema` is old Supabase slot-first work and conflicts with the clean SQLite direction.
- `megaplan/slot-first-m2-frontend` contains accidental agent-home artifacts and no product source.
- `phase-c` contains meaningful document-native changes, but it is an alternate cutover line superseded by the later frozen C5/main lineage. Compare behavior; do not merge the branch wholesale.
- `phase-c-exec` contains acceptance evidence and a real-bridge journey, not the missing core implementation.
- `fix/long-clip-drag-planning` is superseded by main commit `697514544`.
- `video-editor-source-proxy-preview-codex` is an older proxy architecture; the long-clip part is superseded and the proxy contract needs a product decision rather than a blind merge.

## Candidate work requiring a separate decision

These remain intentionally unmerged:

1. **Root persistence and scene-marker WIP.** The dirty `timeline-patches` checkout contains useful lost-ack reconciliation, immediate conflict gating, pending-save flush, idempotent scene-marker shot creation, and local-ULID query guards. It is not coherent yet because empty-shot creation still crosses a relational shot path. Harvest as a clean tested series.
2. **Broker scan failsafe.** Commits `ee24cb05e` and `25c0ce8d9` are directionally useful, but the dirty successor failed 7 of 34 cleanup/concurrency tests and still performs broad process scans. Redesign and retest before merge.
3. **`sdk/host` relocation.** The dirty `oracle-run-surface` worktree mechanically moves extension-host modules and introduces a structural registry type. It aligns with boundary cleanup but remains Reigh-internal rather than the independent neutral runtime. Treat as a future extraction patch.
4. **Sequence creator / asset slots / WAN 2.2.** `8b198c621` is a substantial older feature across 55 files and the prior Supabase/sequence architecture. Rebase by product behavior, not wholesale history.
5. **Phase-C behavior comparison.** The eight `phase-c` commits should be used as a checklist for missing document-native behavior, not cherry-picked as an alternate architecture.
6. **Real-bridge B8 journey.** Selectively port `c96da6a74` only after the neutral runtime endpoint exists and the assertions target that contract.
7. **Extension RC evidence.** The dirty RC worktree has unresolved conflicts and blocked legs. Preserve useful restart tests only after they are adapted to the neutral runtime.
8. **Capacity reconciler.** The orchestrator `megaplan/capacity-reconciler-20260513` branch is substantial but incomplete and tightly coupled to the old Supabase/Postgres control plane. Archive it; do not merge into the SQLite plan.

## Worktrees captured before cleanup

The following dirty worktrees were captured in the recovery bundle before cleanup. Their paths are historical capture sources, not exceptions to the final one-checkout state:

```text
/Users/peteromalley/Documents/reigh-workspace/reigh-app
/Users/peteromalley/Documents/reigh-workspace/reigh-app-extension-rc
/Users/peteromalley/Documents/reigh-workspace/reigh-app-megado-surface
/Users/peteromalley/Documents/reigh-workspace/reigh-app-oracle-v2
/private/tmp/reigh-luna-broker-failsafe
/Users/peteromalley/Documents/reigh-workspace/reigh-worker-orchestrator
/Users/peteromalley/Documents/reigh-workspace/reigh-worker-orchestrator-capacity-reconciler
```

Each contained uncommitted owner work, generated evidence, or an unresolved historical operation at capture time. The recovery bundle preserves those materials; after verification, these non-`main` worktrees are included in the cleanup target.

## Recovery bundle and final cleanup state

Recovery was recorded at `/Users/peteromalley/Documents/reigh-app-cleanup-recovery-20260828` and includes the complete app ref bundle plus captured status, tracked diffs, and untracked-file archives. Both recovery checks passed:

- `sha256sum -c /Users/peteromalley/Documents/reigh-app-cleanup-recovery-20260828/SHA256SUMS` — all entries `OK`.
- `git bundle verify /Users/peteromalley/Documents/reigh-app-cleanup-recovery-20260828/reigh-app-all-refs.bundle` — bundle is valid and records complete history.

The cleanup completed on 2026-08-28 with this verified final outcome:

1. One canonical Reigh app checkout at `/Users/peteromalley/Documents/reigh-workspace/reigh-app`, on `main`, with its working tree clean and `origin/main` matching.
2. `git worktree list` reports exactly that one checkout; the local branch set is exactly `main`; the remote branch set is exactly `origin/main` plus its symbolic `origin/HEAD`.
3. All non-`main` local and remote Reigh app branches and all other Reigh app worktrees were deleted after the verified recovery bundle was retained.
4. Reigh app tags were retained as immutable historical release records.
5. Reigh Worker, `reigh-worker-orchestrator`, Astrid, VibeComfy, and every other non-Reigh repository were untouched.

## Next implementation seam

Branch convergence does not create the neutral runtime. The next major delivery starts from the frozen vision and plan:

1. Create the independent `banodoco-workspace-runtime` repository and freeze its SQLite schema, CAS rules, OpenAPI contract, generated clients, and conformance suite.
2. Cut Reigh, Astrid, and Reigh Worker over as peer protocol clients with no direct database access and no compatibility shims.
3. Remove Supabase from the shipped local paths only after the neutral runtime journeys are green.
4. Re-evaluate the candidate patches above against that concrete protocol, harvesting behavior rather than old ownership boundaries.
