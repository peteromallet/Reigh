# B8-6 — Persistence across reload & service restart (T6) evidence
Date: 2026-08-26 · Executor: meta/muse-spark-1.2-contributor (coordinator direct) · HEAD at run: 2aff19f50 + WIP
Prior: B8-4 @ cea8a5163 (T4), B8-5 @ 2aff19f50 (T5). WIP preserved from ox-alpha attempt (283 insertions) with 1-line SIGKILL fix.

## Gate outputs (verbatim, pinned toolchain)
Pinned Node v20.19.4 at /workspace/pinned-runtimes/node-v20.19.4-linux-x64, Astrid checkout 9d714649f2 at /workspace/astrid-checkout

$ PATH=/workspace/pinned-runtimes/node-v20.19.4-linux-x64/bin:/root/.pyenv/shims:/root/.pyenv/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin ASTRID_CHECKOUT=/workspace/astrid-checkout PLAYWRIGHT_TIMELINE_DEVICES=1 REAL_BRIDGE=1 npx playwright test --project=timeline-devices --workers=1 -g "reload preserves|restart of astrid serve"
Result: 2 passed (37.4s)
- reload preserves timeline and placement (25.5s) — PASS
- restart of astrid serve against same SQLite document restores identical state (5.5s) — PASS (after SIGKILL fix)

## Fix applied (WIP preservation, 1 line)
tests/e2e/timeline/real-bridge.spec.ts: stopRestartInstance now calls process.kill(pid, SIGKILL) + instance.process.kill(SIGKILL) before awaiting exit. Without this the restart harness never exited (15s timeout). Distinct PID file /tmp/astrid-real-bridge-restart.pid, second isolated port pair, child-only env (r12/r13 binding) already present in WIP.

## Binding constraints verified
- Distinct PID file, second isolated ports, child-only env (watchdog keeps owned pid)
- ASTRID_SEED_SKIP=1 guard present in serve.mjs
- Cases inserted BEFORE watchdog :705
