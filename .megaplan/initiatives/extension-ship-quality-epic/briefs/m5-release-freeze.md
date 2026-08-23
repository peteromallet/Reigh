# M5 — Rollout, Observability and Frozen Release Candidate

## Outcome

Freeze a reproducible paired Reigh/Astrid release candidate with staged flags,
privacy-minimized observability, support/rollback runbooks and one final
clean-machine verifier.

## In scope

- Separate production flags for extension host, Foundry and Runaway.
- Metrics for activation/command/bridge/conflict/render/lane-density outcomes.
- Release, data-recovery, rollback and alert-severity runbooks.
- Pinned dependencies, paired commit manifest, evidence inventory and two
  independent final reviews.
- `scripts/release/verify-extension-ship.sh` (or equivalent) that installs,
  migrates twice, starts, exercises, restarts, renders, compares, rolls back,
  and fails closed on any drift.

## Done criteria

- Clean worktrees and reproducible build from pinned revisions.
- Final verifier passes from a clean checkout.
- Completion manifest hashes every required proof artifact.
