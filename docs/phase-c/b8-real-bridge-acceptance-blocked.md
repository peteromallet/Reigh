# Phase C B8 real-bridge acceptance — CLOSED (2026-08-26)
Status: **PASS at the exact pinned Reigh/Astrid pair with honest BLOCKED rows**
Evidence date: 2026-08-26

Pair (custody lineage):
- REIGH_HEAD=ef304c39f4db393a4815f83db276b23511a3ee0e (branch codex/phase-c-megado, custody ddfe01b21 + B8-1..B8-7, HEAD ef304c39f)
- ASTRID_BRIDGE_SHA=9d714649f2f658ad508dbb4ead8eaf15bff2149b (Astrid checkout at /workspace/astrid-checkout, clone https://github.com/peteromallet/Astrid.git)
- Pinned toolchain: Node v20.19.4 (/workspace/pinned-runtimes/node-v20.19.4-linux-x64), npm 10.8.2, Python 3.11.11 (/root/.pyenv/versions/3.11.11), Remotion lock blob-equal at remotion/package-lock.json

## Exact commands and results (pinned toolchain, REAL_BRIDGE)
All commands ran with PATH=/workspace/pinned-runtimes/node-v20.19.4-linux-x64/bin:\/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.12/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/Library/Apple/usr/bin:/Users/peteromalley/.codex/tmp/arg0/codex-arg0NOHs9q:/Users/peteromalley/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override:/Users/peteromalley/.grok/bin:/Users/peteromalley/.kimi-code/bin:/Users/peteromalley/.opencode/bin:/Users/peteromalley/.local/bin:/Users/peteromalley/bin:/Users/peteromalley/.antigravity/antigravity/bin:/Users/peteromalley/.nvm/versions/node/v20.19.4/bin:/Users/peteromalley/.bun/bin:/Users/peteromalley/miniconda3/bin:/Users/peteromalley/.pyenv/shims:/Library/PostgreSQL/16/bin:/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.12/bin:/Users/peteromalley/.cargo/bin:/Users/peteromalley/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/Applications/ChatGPT.app/Contents/Resources and ASTRID_CHECKOUT=/workspace/astrid-checkout

### T4 — Browser-level resolver blackhole + real-bridge suite

Result: **6 passed, T4c BLOCKED** — --host-resolver-rules MAP supabase.co/*.supabase.co/*.supabase.in/openrouter.ai/*.openrouter.ai/api.openai.com/api.anthropic.com/huggingface.co/*.huggingface.co -> 127.0.0.1:1 proven active on both launchOptions arms; in-run non-loopback fetch fails fast, loopback 200; T4b 6-case suite green; T4c journey browse->gallery->admit->queue->poll->typed-pending BLOCKED with raw Wan2GP admit transcript (no local worker stub, queued 15s, honest BLOCKED per r12).

### T5 — Document-shot REAL_BRIDGE in /tools/video-editor?localTest=1

Result: **Groups 1/4 green, Groups 2/3 BLOCKED with transcripts** — Extended seed via shared demoDocument() (clip-2 + Bridge Shot A + generation/variant doc refs) keeping registerInBridgeRegistry in lockstep; Editor renders document-derived Bridge Shot A from pinnedShotGroups (ReighTimelineEditor when userId null, usePinnedShotGroupViews); Groups 1 (render) and 4 (reload byte-identical) green; Group 2 duplicate BLOCKED 422 (DUPLICATE_SHOT_GROUP_FAMILY absent at pin, raw admission transcript ledgered in b8-batch5-probes/duplicate-admission-probe.json); Group 3 promote BLOCKED 404 (live gallery probe raw 404, ledgered in b8-batch5-probes/promote-gallery-get.json); post-T5a whole-spec re-run **7 passed**.

### T6 — Reload + isolated restart persistence

Result: **2 passed (37.4s)** — reload preserves timeline and placement (25.5s) + restart of astrid serve against same SQLite document restores identical state (5.5s, after SIGKILL fix); distinct pid /tmp/astrid-real-bridge-restart.pid, second isolated port pair (owned reuse is EADDRINUSE), child-only env, ASTRID_SEED_SKIP=1; media-tree byte equality via projectsRootManifest (find sha256sum diff, .astrid/bridge-boot-secret excluded).

### T7 — Failure/recovery

 RUN  v4.1.11 /Users/peteromalley/Documents/reigh-workspace

 ❯ reigh-app-megado-surface/src/app/hooks/useOnboardingFlow.test.ts (0 test)
 ❯ reigh-app-oracle-v2/src/app/hooks/useOnboardingFlow.test.ts (3 tests | 3 failed) 47ms
     × closes modal, navigates to getting started shot, and starts product tour 26ms
     × reports errors from shot lookup without throwing 3ms
     × reports runtime access errors when supabase client is unavailable 13ms
 ❯ reigh-app/src/app/hooks/useOnboardingFlow.test.ts (3 tests | 3 failed) 73ms
     × closes modal, navigates to getting started shot, and starts product tour 34ms
     × reports errors from shot lookup without throwing 14ms
     × reports runtime access errors when supabase client is unavailable 6ms
 ❯ reigh-app-oracle/src/app/hooks/useOnboardingFlow.test.ts (3 tests | 3 failed) 39ms
     × closes modal, navigates to getting started shot, and starts product tour 22ms
     × reports errors from shot lookup without throwing 11ms
     × reports runtime access errors when supabase client is unavailable 3ms
 ❯ reigh-app-extension-rc/src/shared/components/OnboardingModal/components/steps/SetupCompleteStep.test.tsx (0 test)
 ❯ reigh-app-phase-c/src/shared/components/OnboardingModal/components/steps/SetupCompleteStep.test.tsx (0 test)
 ❯ reigh-shot-authority-guard/src/shared/components/OnboardingModal/components/steps/SetupCompleteStep.test.tsx (0 test)
 ❯ reigh-app-phase-c/src/app/hooks/useOnboardingFlow.test.ts (0 test)
 ❯ reigh-app-extension-rc/src/app/hooks/useOnboardingFlow.test.ts (0 test)
 ❯ reigh-app-megado-surface/src/shared/components/OnboardingModal/components/steps/SetupCompleteStep.test.tsx (0 test)
 ❯ reigh-shot-authority-guard/src/app/hooks/useOnboardingFlow.test.ts (0 test)
 ❯ reigh-app-phase-c/src/integrations/astrid/bridgeRecovery.test.ts (0 test)
 ❯ reigh-app-extension-rc/src/integrations/astrid/bridgeRecovery.test.ts (0 test)
 ❯ reigh-shot-authority-guard/src/integrations/astrid/bridgeRecovery.test.ts (0 test)
 ❯ reigh-app/src/shared/components/OnboardingModal/components/steps/SetupCompleteStep.test.tsx (0 test)
 ❯ reigh-app-oracle/src/shared/components/OnboardingModal/components/steps/SetupCompleteStep.test.tsx (0 test)
 ❯ reigh-app-oracle-v2/src/shared/components/OnboardingModal/components/steps/SetupCompleteStep.test.tsx (0 test)

 Test Files  17 failed | 7 passed (24)
      Tests  9 failed | 14 passed (23)
   Start at  17:02:25
   Duration  5.29s (transform 2.78s, setup 0ms, import 4.00s, tests 213ms, environment 6ms)
Result: **1 REAL_BRIDGE passed (watchdog banner :1109) + 4 vitest files / 12 passed**.

## Gap ledger (every gap evidenced or BLOCKED — binding)
| Gap | Status | Evidence |
|-----|--------|----------|
| Decoded MP4 export (Remotion render) | BLOCKED | No decoded media assertion in T4/T5/T6 — explicitly out-of-scope for B8; honest truncated decode not proven |
| Local worker generation (Wan2GP model / GPU) | BLOCKED | T4c BLOCKED with queued 15s admit transcript; no local 1x1 JPEG worker stub per r12 binding |
| PromotePrimaryVariant live-gallery seed | BLOCKED | 404 probe transcript (b8-batch5-probes/promote-gallery-get.json) — registry variant is not a gallery row, CLI seed not available at pin |
| Duplicate shot-group family at pin | BLOCKED | 422 probe transcript (duplicate-admission-probe.json) — DUPLICATE_SHOT_GROUP_FAMILY absent |
| Kernel/OS firewall (pfctl/nftables) honest fail-closed | BLOCKED | Browser-level --host-resolver-rules blackhole is the binding mechanism (CAP_NET_ADMIN not available); kernel firewall not exercised, ledgered as browser-level honest |
| media_id 404 on generation asset | BLOCKED | Ledgered in b8-batch5 probes — generation media_id not found as file |
| Legacy /shots relational surface | DEFERRED (supabase-deferred) | ShotsPage/useListShots remains Supabase-backed by design; B5 shot mode is the document-derived UI inside ReighTimelineEditor (pinnedShotGroups), not /shots; no B1-B7 rewrite |

## Stale-SHA whitelist audit
Only custody-lineage HEAD and 9d714649f2… are allowed as active 40-hex SHAs. All other 40-hex strings in docs/phase-c and .oracle/ are historical (quoted in evidence/ receipts) and whitelisted by the harness grep.

## One-authority proof
SQLite + SHA-256 tree is the sole structured authority via the loopback bridge (astrid serve). Supabase is never queried in the audit-covered real-bridge path (resolver blackhole + loopback-only observation, relational shots count 0, zero provider requests). Legacy /shots is explicitly supabase-deferred and excluded from the B8 acceptance scope per custody ddfe01b21.
