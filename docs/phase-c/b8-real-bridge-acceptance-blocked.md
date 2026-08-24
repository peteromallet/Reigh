# Phase C B8 real-bridge acceptance — BLOCKED

Status: **BLOCKED at the pinned cross-repository route contract**

Evidence date: 2026-08-24

Reigh branch: `codex/phase-c-completion`

Required Astrid pin: `fb152312d3cb9b7bed5f637bfdf6845e7d638739`

## Decision

The full J1–J6 browser journey cannot honestly pass against the required
Astrid release. The clean checkout at the exact pin starts successfully and
serves project/timeline/CAS routes, but it does not mount task, generation, or
managed-media routes. Reigh must not add a fake bridge or a test-only route
adapter: that would test a product users cannot run.

B8 remains open. The current evidence is developer acceptance under local
permissions, not the frozen OS-firewall acceptance: a later release run must
still block non-loopback traffic at the OS boundary.

## Deterministic pinned route census

The updated harness refuses an unclean or wrong-revision checkout, launches
the checkout with `python3 -m astrid`, records its provenance, and adds
`--no-open-editor`. The observed startup line was:

```text
[real-bridge] Astrid provenance git:fb152312d3cb9b7bed5f637bfdf6845e7d638739
```

Against that process, the route census was:

```text
200 /health
200 /projects
200 /projects/demo-project/timelines
404 /projects/demo-project/tasks?limit=1
404 /projects/demo-project/generations?limit=1
404 /projects/demo-project/media/01UNKNOWN/content
```

Each missing route returned the pinned bridge's typed envelope, for example:

```json
{"error":"not_found","detail":"unknown route: /projects/demo-project/tasks"}
```

This agrees with both pinned authorities:

- `docs/contracts/astrid-bridge-v10.md` lists only health, projects,
  timelines, timeline save, timeline asset bytes, and Runaway reads.
- `astrid/core/integrations/reigh/local_bridge_server.py` has no task,
  generation, or project-media dispatcher branches.

## Browser evidence

Command (ports were isolated from other active work):

```bash
PLAYWRIGHT_TIMELINE_DEVICES=1 \
REAL_BRIDGE=1 \
ASTRID_CHECKOUT=/Users/peteromalley/Documents/reigh-workspace/Astrid-extension-rc \
ASTRID_BRIDGE_PORT=17339 \
PLAYWRIGHT_PORT=4179 \
BASE_URL=http://127.0.0.1:4179 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4179 \
npx playwright test --config playwright.config.ts \
  --project=timeline-devices --workers=1 \
  tests/e2e/timeline/real-bridge.spec.ts
```

Observed result: **1 passed, 1 failed, 1 did not run**.

- PASS: real timeline load/save/CAS surface.
- FAIL: the browser never reached the expected divergence UI after the edit.
- NOT RUN: the destructive bridge-death/watchdog case follows the failed
  serial case.

The retained trace shows the app repeatedly requesting
`/api/astrid/projects/demo-project/tasks`, receiving `404`, and rendering
`Task counters are partially degraded (processing, success, failure).`
The repeated retries are also a process friction: an unsupported terminal
route should be capability-gated or back off instead of creating a request
storm.

The same trace's host census found:

| Host | Requests | Interpretation |
|---|---:|---|
| `127.0.0.1:4179` | 6,217 | Vite app and same-origin bridge proxy |
| `127.0.0.1:17339` | 1 | direct real-bridge API setup request |
| `127.0.0.1:54321` | 31 | Supabase development host — forbidden fallback for J1–J6 |
| `fonts.googleapis.com` | 3 | external font dependency |
| `fonts.gstatic.com` | 12 | external font bytes |

Therefore the current run does **not** prove “no Supabase/provider-host
fallback.” A Playwright request allowlist can prove the developer-level
loopback boundary after C5 removes those calls; it is not a substitute for
the frozen OS-firewall evidence.

## `origin/oracle-run` route audit

Astrid `origin/oracle-run` at
`0b69557bfcca417bc32a3f0edff0753bac67712a` contains useful implementation
work, but it is not a drop-in replacement for the pin.

### What matches Phase C

- `e372a79f`: public task admission with `Idempotency-Key`, bounded task
  list/detail reads, cancellation, claim/heartbeat/completion, task output
  publication, and typed errors.
- `0b69557b`: bounded generation list/detail plus project-scoped managed-media
  `GET|HEAD` with Range/ETag behavior.
- Task status and DTO fields broadly match `bridgeContract.ts`; optional
  `spec` omission on polling summaries is accepted by Reigh.
- Gallery and variant shapes broadly match Reigh's Zod schemas.
- `e46f5aa8`: document-native timeline registry merge needed for completed
  output placement visibility.
- `7fc0e3fa` + `936facd3`: publish-before-commit durability for output bytes.

### Blocking mismatches at the oracle tip

1. **The production serve root does not compose the task bridge.**
   `astrid serve` calls `create_local_bridge_server(...)` without
   constructing or passing `ReighTaskBridge`. Oracle tests manually compose
   it in fixtures, so they prove an in-process test topology, not the shipped
   CLI process B8 requires. With the real CLI, task/gallery routes fail closed.
2. **The normative bridge document is stale.** The tip's
   `docs/contracts/astrid-bridge-v10.md` route table still omits tasks,
   generations, and managed media even though the server contains handlers.
3. **The branches diverged at `dd1bbe3a`.** The required pin contains later
   release security, `/v1` compatibility, Runaway, and hardening changes that
   oracle-run does not contain. Merging or cherry-picking the route commit as
   a blob risks regressing those guarantees.
4. **Wire vocabulary drift remains.** Oracle emits route-specific codes such
   as `idempotency_mismatch`, `generation_not_found`, `media_not_found`, and
   `media_bytes_missing`, while Reigh documents five generic categories.
   Reigh's permissive error parser accepts them, but the written contract does
   not.
5. **Materialized-input shape is wider in Reigh.** The TypeScript schema
   permits `generation_id`/`url`-only entries; oracle admission requires a
   project-owned `media_id` and a target/role. The two sides must freeze the
   same validation rules.
6. **`starred=false` is not an unstarred filter upstream.** Oracle treats it
   as no filter. That behavior must be explicit in the shared contract or be
   fixed before callers depend on false-only filtering.

## Minimal safe forward-port onto the pin

This must be a semantic forward-port with a new Astrid release commit, not a
wholesale merge of `origin/oracle-run`:

1. Port the shots v2 generation schema and repository from `57fd4e82` and
   `66caa67b`, retaining the pin's manifest-derived migration discipline
   (`5d265593` where still applicable).
2. Port the capability registry from `d7c73634`.
3. Port publish-before-commit durability from `7fc0e3fa` and `936facd3`, with
   the fault matrix as required evidence rather than optional history.
4. Port the evented timeline registry merge from `e46f5aa8`.
5. Semantically port task/multipart routes from `e372a79f` onto the pinned
   server, preserving all pinned auth, request limits, canonical `/v1`
   aliases, Runaway reads, receipt secrecy, and loopback hardening. Do not
   replay `eaa915e4` over the stronger pin blindly.
6. Port gallery/media reads from `0b69557b` with its paging helper and tests.
7. Add the missing production composition: `astrid serve` must construct one
   `ReighTaskBridge` from the already-open writer/registry, inject generation
   and timeline repository factories, and pass it to the server. Add a
   subprocess test that launches the real CLI and exercises every public
   route; fixture-only composition is insufficient.
8. Integrate the lease-expiry sweeper from `3cbb3224` or equivalent so a
   crashed worker cannot wedge a running task forever.
9. Publish the expanded route/DTO/error/security contract in Astrid, then
   update Reigh from that authority and add cross-repository fixture parity.
10. Cut a new pinned Astrid SHA and rerun the full J1–J6 browser journey with
    request interception, console capture, restart/recovery, media Range/ETag,
    document-native placement, and finally the OS-firewall release gate.

The useful oracle-run commits are source material, not release evidence. The
unblock condition is a clean pinned Astrid release whose real `astrid serve`
process exposes the shared, documented route contract.
