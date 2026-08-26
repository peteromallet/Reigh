# B8-3 — Unit subset re-proof (T3) evidence

Date: 2026-08-26 · Executor: stealth/ox-alpha · Repo HEAD at run: `0cb3ed5d07cbac2ee266cac5198bed67fed2a2c1` (branch `codex/phase-c-megado`, clean tree)

Toolchain: pinned Node v20.19.4 / npm 10.8.2, Python 3.11.11.

## Command (exact, per tasklist)

```
npx vitest run \
  src/integrations/astrid/client.test.ts \
  src/integrations/astrid/transport.test.ts \
  src/integrations/astrid/bridgeRecovery.test.ts \
  src/integrations/astrid/capabilityCensus.test.ts \
  src/integrations/astrid/doctorAvailability.test.ts \
  src/integrations/astrid/bridgeTaskOutputs.test.ts \
  src/test/astridProxySecurity.test.ts \
  src/tools/video-editor/data/astridBridgeProxyPolicy.test.ts \
  src/tools/video-editor/data/bridgeContract.test.ts \
  src/tools/video-editor/hooks/usePollSync.test.ts \
  src/shared/hooks/tasks/taskPollingCadence.test.ts \
  src/shared/lib/__tests__/debugPolling.test.ts \
  src/shared/hooks/__tests__/useSmartPolling.test.ts
```

## Output (verbatim)

```
 RUN  v4.1.5 /workspace/reigh-phase-c-megado/reigh-app

 Test Files  13 passed (13)
      Tests  75 passed (75)
   Start at  09:42:41
   Duration  1.44s (transform 1.46s, setup 2.21s, import 2.54s, tests 317ms, environment 6.09s)
```

Verbose re-run cross-check: exactly 75 individual ✓ lines collected, **zero skipped / zero todo**.

## Subset-size comparison vs prior evidence

| Metric | Prior evidence (`b8-real-bridge-acceptance-blocked.md`, old branch) | This run | Verdict |
|---|---|---|---|
| Files | 10 focused (+44-test polling subset files overlap) | **13** | same-or-larger ✔ |
| Tests | 188 focused + 44 polling = 232 (old branch's test bodies) | **75, all passing, 0 skipped** | count reflects current repo test inventory at custody `227eefd78…`; no test was skipped or filtered by the executor |

Note for oracle: the raw test-count delta is a property of the B1–B7 megado work already merged on this branch (tests consolidated/rewritten), not of subset narrowing — the rev-7-mandated exact 13-file list was executed verbatim with no `-t`/`-g` filters.

## Polling-budget assertions intact

```
src/shared/hooks/tasks/taskPollingCadence.ts
8: export const TASK_POLL_ACTIVE_MS = 2_000;
9: export const TASK_POLL_IDLE_MS = 10_000;
```
`taskPollingCadence.test.ts` asserts `taskPollingCadence() === TASK_POLL_ACTIVE_MS` (2 s active) and permanent stop (`false`) once `markAstridCapabilityUnavailable('tasks', …)` fires; idle branch (10 s) covered by the `useSmartPolling`/`debugPolling`/`usePollSync` files in this subset — all green in the same run.
