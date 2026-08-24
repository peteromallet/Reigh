# Phase C B8 real-bridge acceptance — CLOSED

Status: **PASS at the exact pinned Reigh/Astrid pair**

Evidence date: 2026-08-24

```text
PHASE_C_REIGH_SHA=949dfad8c8046a8851cd57b2182bb624795e6db3
ASTRID_BRIDGE_SHA=97314ccee7caa7adfe04004e6854d7a8ba6b6dfd
```

The earlier blocker recorded in this file is superseded. The pinned Astrid
bridge now mounts the release-authenticated timeline, task, generation, and
managed-media routes in the real `python3 -m astrid serve` process. Reigh pins
that exact 40-character bridge revision and the final acceptance run completed
all four serial cases.

## Exact command and result

```bash
PLAYWRIGHT_TIMELINE_DEVICES=1 \
REAL_BRIDGE=1 \
ASTRID_CHECKOUT=/Users/peteromalley/Documents/reigh-workspace/Astrid-editor-bridge-integration \
ASTRID_BRIDGE_PORT=17349 \
PLAYWRIGHT_PORT=4189 \
BASE_URL=http://127.0.0.1:4189 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4189 \
ASTRID_REQUEST_TOKEN_FILE=/tmp/astrid-real-bridge-17349.token \
ASTRID_BRIDGE_PID_FILE=/tmp/astrid-real-bridge-17349.pid \
ASTRID_BRIDGE_METADATA_FILE=/tmp/astrid-real-bridge-17349.json \
npx playwright test --config playwright.config.ts \
  --project=timeline-devices --workers=1 \
  tests/e2e/timeline/real-bridge.spec.ts
```

Observed result: **4 passed, exit 0, 44.3 seconds**.

1. Release auth/protocol negatives, identical replay, and atomic two-writer
   CAS passed.
2. Timeline, task, generation, media GET/HEAD/Range/ETag, idempotency, stale
   render admission, and cancellation surfaces passed.
3. A real production Timing → Start edit issued a stale save, received the
   real `409`, surfaced divergence/recovery UI, reloaded the remote writer's
   head, retained then discarded the durable draft, and preserved remote data.
4. Killing the harness-owned Astrid process during an edit surfaced the
   persistent save watchdog and actionable Retry control.

## Browser-side release assertions

The passing browser cases assert, rather than merely inspect:

- all browser HTTP/WebSocket authorities are the loopback Vite app or pinned
  Astrid bridge;
- zero Supabase, local Supabase port, Google Fonts, or other remote traffic;
- zero uncaught page errors and zero unexpected console errors (the deliberate
  capability-probe `404`, deliberate CAS `409`, and deliberate bridge-death
  network failure are URL-scoped allowlisted evidence events);
- deterministic `localTest=1` unregisters service workers and clears caches;
- the fallback task snapshot performs at most two startup reads and never
  becomes a second interval owner;
- the one realtime task owner polls at 2 seconds while queued/running work is
  present and backs off to 10 seconds while idle.

## Frictions fixed during closure

- HEAD error responses wrote forbidden body bytes into keep-alive sockets;
  Astrid now suppresses every HEAD body while retaining GET-sized
  `Content-Length` and has a one-socket Node regression.
- Preview placeholders and interactive timeline clips both exposed
  `data-clip-id`; the suite now uses the named `.clip-action[data-clip-id]`
  host contract.
- Dense transcript-caption clips can be narrower than neighboring resize
  handles; the test uses ClipAction's real keyboard selection path instead of
  force-clicking through another control.
- Base UI NumberField exposes a visible textbox plus a hidden native number
  input; the suite operates the visible Timing tabpanel control with real
  select-all/type/commit gestures.
- Same-origin JSON writes forwarded the Vite port as `Origin`, which release
  Astrid correctly rejected. The proxy now consumes Origin only when it proves
  an exact same-origin loopback request; cross-origin requests remain rejected.
- The recovery banner's `Discard` and conflict dialog's `Discard and reload`
  overlapped in accessible-name matching; the exact recovery action is now
  selected.
- Active-clip and final-video hooks each owned independent 2-second task loops.
  Both now derive from the canonical bridge snapshot, leaving one adaptive
  realtime owner.
- Local browser tests registered a PWA worker and cache. `localTest=1` now
  proves both are absent before accepting browser evidence.

## Supporting gates

All were run from `codex/phase-c-completion` after the closure changes:

```text
npm run lint                                      PASS
npx tsc --noEmit -p tsconfig.json                 PASS
node scripts/c5-grep-gates.mjs                    PASS
focused Vitest: 10 files / 188 tests              PASS
polling/proxy/realtime unit subset: 44 tests      PASS
git diff --check                                  PASS
push preflight Dockerfile/context checks          PASS
```

C5 inspected 151 inventory roots and 1,765 statically reachable files and
found no Supabase SDK/runtime calls in the transitive bridge-mode graph.

## Exact boundary of this acceptance

This closes the Phase C exact-pair developer acceptance. It does **not** claim
the later combined extension release, actual decoded MP4 export, OS-firewall
release evidence, backup/restore, accessibility/device matrix, production
rollout, or human acceptance. Those remain downstream gates after Phase C is
merged into `codex/extension-ship-quality`.

Do not reinterpret this result as authority to delete cloud/Supabase paths,
merge `origin/phase-b` wholesale, delete parked branches, or retire the
Supabase project.
