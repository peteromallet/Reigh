# Editor Branch Integration Disposition

Date: 2026-08-24

This note records how the extension ship-quality line relates to the other
active editor branches. It is an integration plan, not release evidence.

## Branch disposition

| Line | Audited head | Disposition |
|---|---|---|
| `codex/extension-ship-integration` | RC8 verifier/security hardening in progress | RC8 integration in progress; RC6 and RC7 are immutable historical candidates and their paired forensic roots are not RC8 receipts. |
| `timeline-patches` | `dbafe2cd4` | The committed Creative Lab patch was replayed as `7150085df` and subsequently hardened. Do not merge this commit again. Preserve and reconcile its uncommitted WIP separately. |
| `exec-goal-20260822` | `8376d8231` | Direct ancestor of `exec-sqlite-20260823`; do not merge separately. |
| `exec-sqlite-20260823` | `d21e6fc52` | Parked execution history. Do not merge wholesale: most changed paths are `.oracle` run artifacts. Forward-port reviewed product outcomes only. |
| `codex/phase-c-megado` | `ddfe01b211e1cf0ae6839013ad2a319ecb033924` base | B1-B7 and the extension-foundation merge are complete; the isolated Megado continuation owns only B8 real-browser/SQLite acceptance and evidence. |

Every line above forked from `6c02bd3ba`. Merge simulation found no textual
conflict markers, but Phase C and the exec lineage both modify sensitive bridge
and provider surfaces. Those overlaps require semantic review even when Git can
merge them automatically.

## Required order

1. Keep `timeline-patches` physically untouched until its 17 tracked edits and
   20 untracked files have been snapshotted to a dedicated safety branch.
2. Preserve completed Phase C B5-B7 and finish only B8 acceptance gates on the
   isolated `codex/phase-c-megado` branch.
3. Merge the completed Phase C line onto the clean extension integration branch
   `codex/extension-ship-integration` only through reviewed product commits.
4. Semantically review the shared bridge contract, data providers, external
   drop handling, `VideoEditorPage`, and real-bridge harness.
5. Forward-port the net exec outcomes in functional batches: wire parity,
   watchdog/lost-edit recovery, honest `409`/diverged behavior, recovery drafts,
   bridge-CAS-only document authority, FSA asset-only behavior, and reactive
   local-mode realtime gating. Exclude `.oracle` history and obsolete generated
   distributions.
6. Split and forward-port the live timeline WIP last.
7. Run the full Reigh/Astrid/schema, browser, persistence, render/export,
   recovery, rollback, and release gates on the combined line.

## Merge gate

The combined line is not merge-ready until Phase C B5-B8 are complete, each
semantic overlap has an explicit disposition, the exact pinned Astrid bridge is
used for the real-browser journey, and the combined repository is clean and
green. Passing an automatic Git merge without conflict markers is not evidence
that these contracts agree.
