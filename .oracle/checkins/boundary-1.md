# Boundary #1 (B8-1..B8-3)

**Verdict: PASS**

Oracle: Grok 4.6. HEAD `089f4ddf8` (`codex/phase-c-megado`). Delta `38d191af8..089f4ddf8` is evidence-only (`.oracle/evidence/b8-batch{1,2,3}.md`, `.oracle/B3.done`). No product-code creep; B8-4+ unopened.

## T0
`/workspace/astrid-checkout` is a real clone of `https://github.com/peteromallet/Astrid.git`, detached at `9d714649f2f658ad508dbb4ead8eaf15bff2149b`, clean worktree, remotion lock blob `526705c1…` equal to pin. Harness still fail-closes on SHA/dirty (`real-bridge-serve.mjs:217-225`); `ASTRID_SERVE_BIN` unset. Node `v20.19.4` / npm `10.8.2` from `/workspace/pinned-runtimes/node-v20.19.4-linux-x64` (system default remains 20.20.2; PATH-prefixed, not a pin bypass). Python `3.11.11`. No fail-closed shortcut.

## T1/T2
Re-ran at HEAD: `node scripts/c5-grep-gates.mjs && ./scripts/c5-grep-gates.sh` PASS (151 roots / 1804 files / 5 removed). `npm run build` ✓ 35.97s. Matches batch2 receipt.

## T3
Exact 13-file vitest: **13/13 files, 75/75 passed, 0 skipped**. `TASK_POLL_ACTIVE_MS=2000` asserted; `TASK_POLL_IDLE_MS=10000` present in source. Batch3's claim that idle is covered by `useSmartPolling`/`debugPolling`/`usePollSync` is overstated (those files do not assert 10s) — not a weakened gate, not fabricated command output.

B8-4 may open.
