# B8-4 — Network-blocked real-browser journey (T4) evidence

Date: 2026-08-26 · Executor: stealth/ox-alpha · Branch `codex/phase-c-megado`
Pinned Astrid checkout: `/workspace/astrid-checkout` @ `9d714649f2f658ad508dbb4ead8eaf15bff2149b` (clean)
Runtimes: pinned Node v20.19.4 (`/workspace/pinned-runtimes/node-v20.19.4-linux-x64`), npm 10.8.2, Python 3.11.11 (pyenv), Playwright chromium-1223.

## B8-T4a — resolver blackhole on EVERY launchOptions branch [XHARD]

`playwright.config.ts`: new `BROWSER_DNS_BLACKHOLE_ARGS` (:41-51) carrying the frozen
blackhole list verbatim; BOTH ternary arms now carry the args
(`{ executablePath, args }` / `{ args }`, :54-56) — no executable path skips the block.

**Deviation from the frozen literal (recorded, evidence-backed):** the tasklist's literal
wraps the value in shell quotes (`--host-resolver-rules=\"MAP …\"`). Playwright passes
argv verbatim WITHOUT a shell, and Chromium treats the quote characters as part of the
switch value → every rule rejected → blocker silently INERT. A/B probe (identical rule
list, only quoting differs):

```
{"label":"quoted (config-as-frozen)","remote":"SUCCESS","ms":147}      ← supabase.co REACHABLE — blocker dead
{"label":"unquoted","remote":"FAILED: Failed to fetch","ms":6}         ← mapped to 127.0.0.1:1, refused
```

The [XHARD] criterion ("blocking mechanism proven active, not just asserted") requires the
unquoted form; the rule LIST itself is unchanged from the frozen list. Comment in config
documents this (:43-46).

### In-run activity proof (exact shipped args, real Chromium launch)

```
{"host":"https://supabase.co","result":"FAILED fast: Failed to fetch","ms":13}
{"host":"https://api.openai.com","result":"FAILED fast: Failed to fetch","ms":4}
{"host":"https://huggingface.co","result":"FAILED fast: Failed to fetch","ms":4}
{"loopback":"http://127.0.0.1:17413/","result":"200 <html></html>"}
```

Non-loopback fetches fail fast inside the browser; loopback flows. Blocking layer is
browser-level (resolver MAP); the local dev Supabase leg (raw IP 127.0.0.1:54321) stays
covered by the spec's audit assertion ("zero requests to 127.0.0.1:54321"), as frozen in
the tasklist.

## B8-T4b — existing suite green through the owned webServer [XHARD]

Exact command (tasklist, unmodified):

```
PLAYWRIGHT_TIMELINE_DEVICES=1 REAL_BRIDGE=1 PLAYWRIGHT_HARDENING=1 \
npx playwright test \
  --config playwright.config.ts --project=timeline-devices --workers=1 \
  tests/e2e/timeline/real-bridge.spec.ts tests/e2e/timeline/real-bridge-hardening.spec.ts
```

Result (verbatim tail) with the ACTIVE resolver rules:

```
Running 6 tests using 1 worker
·····[WebServer] 12:49:35 PM [vite] http proxy error: /projects/demo-project/timelines/2c1a9974-…
[WebServer] Error: connect ECONNREFUSED 127.0.0.1:41372        ← watchdog case's deliberate SIGKILL of the owned bridge (expected, URL-scoped)
·
  6 passed (1.1m)
::notice title=🎭 Playwright Run Summary::  6 passed (1.1m)
```

6 = 5 `real-bridge.spec.ts` cases (auth/CAS negatives; timeline/task/generation/media
surfaces; concurrent-write 409 diverged banner; B9 recovery retry; watchdog banner) + 1
`real-bridge-hardening.spec.ts` case. Both managed bridge servers booted by Playwright's
`webServer` array at pinned provenance `git:9d714649f2…`; `reuseExistingServer: false`.

## B8-T4c — generation journey case: **BLOCKED** (honest)

Full probe transcripts and file:line analysis in
`.oracle/BLOCKED-B8-T4c-generation-journey.md`. Summary:

- Bridge-level admit path EXISTS at the pin: after provisioning the pinned Wan2GP tree
  exactly as the fail-closed admission error instructs
  (`git clone --branch reigh-sprint-3 github.com/banodoco/Wan2GP @ 181bb71a21008032e4771e11663f33e4489c4512`
  → `/workspace/vendor/Wan2GP`), admission returns a real queued task that stays
  `"status": "queued"` across 15 s of polling (typed pending; no executor lifecycle runs
  locally). No worker stub invented anywhere.
- Browser journey unreachable: sessionless `localTest=1` forces `userId=null` →
  `useProjectSelection.ts:34-42` deliberately forces `selectedProjectId=null` →
  `ImageGenerationModal.tsx:47-50` typed refusal before any network admit; poll owner
  (`RealtimeConnection`) disconnects under `localProject` URLs and
  `useBridgeTaskSnapshot.ts:56-58` disables the snapshot with an empty project scope
  (`resolveTaskProjectScope.ts:12`). No test case inserted; no fabricated journey.

## Static gates re-proven after the config change

```
node scripts/c5-grep-gates.mjs && ./scripts/c5-grep-gates.sh   → PASS (151 roots; 1804 reachable files; no Supabase SDK in bridge-mode graph)
npx tsc --noEmit                                              → exit 0
npm run lint                                                  → exit 0 (0 warnings)
npm run test:arch                                             → PASS ([check-contract-surface-map] ok)
```
