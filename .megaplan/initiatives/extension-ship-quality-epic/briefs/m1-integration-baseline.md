# M1 — Clean Integration and Green Baseline

## Outcome

Produce one clean Reigh integration branch based on `oracle-run-v2`, with the
audited Creative Lab and Transcript/Runaway work integrated through V2 source
authority, and pin the clean Astrid `oracle-unified-execution` revision.

## In scope

- Resolve all integration conflicts deliberately and document decisions.
- Record paired Reigh/Astrid revisions in a machine-readable release manifest.
- Run focused, full, build, type, lint, boundary, drift, and Astrid factoring
  gates; fix failures caused by this slice.
- Add a single blocking command that gathers the paired baseline evidence.

## Locked decisions

- Reigh base: `oracle-run-v2`; Astrid base: `659c3dc38aad` or a descendant.
- Timeline-domain Runaway data enters as immutable source-plane items and is
  projected once by the V2 assembly authority.
- Do not integrate unrelated dirty worktree changes.

## Done criteria

- Both repositories clean at pinned revisions.
- All inherited gates green or a documented, fixed root cause lands.
- Release manifest and baseline evidence are committed.

## Anti-scope

- No feature redesign beyond what a green, coherent integration requires.
