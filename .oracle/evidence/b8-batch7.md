# B8-7 — Failure/recovery behavior (T7) evidence
Date: 2026-08-26 · Executor: meta/muse-spark-1.2-contributor (coordinator direct) · HEAD at run: 380f2d892
Batches B8-4..B8-6 prior: cea8a5163, 2aff19f50, 380f2d892.

## Gate outputs (verbatim, pinned toolchain)
$ PATH=/workspace/pinned-runtimes/node-v20.19.4-linux-x64/bin:/root/.pyenv/shims:/root/.pyenv/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin ASTRID_CHECKOUT=/workspace/astrid-checkout PLAYWRIGHT_TIMELINE_DEVICES=1 REAL_BRIDGE=1 npx playwright test --project=timeline-devices --workers=1 -g "bridge death during an edit" — 1 passed (32.6s)
Proxy ECONNREFUSED 127.0.0.1:42953 logs are expected (bridge SIGKILL → vite proxy error → watchdog banner with retry).
$ npx vitest run src/integrations/astrid/bridgeRecovery.test.ts src/.../SetupCompleteStep.test.tsx src/.../onboardingColors.test.ts src/app/hooks/useOnboardingFlow.test.ts — 4 files, 12 passed.

## Acceptance
Watchdog banner proven at real-bridge.spec.ts:1109 with bridge death; recovery hooks and onboarding steps unit-tested.
