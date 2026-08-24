# Phase C B7 backup/restore browser hooks — BLOCKED

Status: **BLOCKED at the cross-repository contract boundary**

Batch: B7 / T7.1

Evidence date: 2026-08-24

Pinned Astrid release: `fb152312d3cb9b7bed5f637bfdf6845e7d638739`

## Decision

Reigh does not implement backup or restore browser hooks in this batch. The
pinned Astrid release has the operational CLI family (`astrid backup create`
and `astrid backup restore`) but does not expose backup, restore, or full doctor
operations through the HTTP editor bridge. Adding Reigh hooks or fake routes
would invent a second, unratified contract and would make tests pass against a
surface users cannot run.

The browser may use the existing `GET /health` route only as a liveness check.
Detailed diagnosis remains owned by the read-only
`python3 -m astrid doctor --json` CLI.

## Endpoint evidence

Inspected in the pinned Astrid checkout:

- `astrid/core/integrations/reigh/local_bridge_server.py`, handler
  `do_GET`: `health`, `projects`, timeline discovery/load, Runaway reads, and
  timeline asset bytes.
- The same handler's `do_HEAD`: timeline asset bytes only.
- The same handler's `do_POST`: timeline save only.
- Unknown GET and POST paths return typed `404 not_found` envelopes.
- `astrid/core/gateway/dispatch.py` owns `doctor` and `backup` as CLI gateway
  families; it does not mount them as HTTP routes.

Reigh's frozen client agrees with that boundary:

- `src/integrations/astrid/client.ts` exposes `tasks`, `gallery`, `media`, and
  `timelines`; it has no ops client.
- `src/tools/video-editor/data/bridgeContract.ts` defines health and product
  route schemas; it has no backup/restore request or response schema.

Reproduction commands:

```bash
git -C /Users/peteromalley/Documents/reigh-workspace/Astrid-extension-rc rev-parse HEAD
rg -n "def do_GET|def do_HEAD|def do_POST|backup|restore|doctor" \
  /Users/peteromalley/Documents/reigh-workspace/Astrid-extension-rc/astrid/core/integrations/reigh/local_bridge_server.py
rg -n '"doctor"|"backup"' \
  /Users/peteromalley/Documents/reigh-workspace/Astrid-extension-rc/astrid/core/gateway/dispatch.py
rg -n "backup|restore|doctor" \
  src/integrations/astrid src/tools/video-editor/data/bridgeContract.ts
```

## Unblock contract

Before Reigh can add these hooks, an Astrid release must own and publish all of
the following:

1. Explicit HTTP route names and methods for create, restore, and progress or
   terminal result reads.
2. Typed request, success, and failure envelopes, including overwrite consent,
   idempotency/replay behavior, and interrupted-operation recovery.
3. Local-only authentication, request-size limits, and concurrency semantics
   consistent with the existing bridge.
4. A real bridge round-trip test against the pinned Astrid release.
5. A shared fixture update only after the real endpoint exists.

When those are committed upstream, Reigh can add an ops route group to
`AstridLocalClient`, mirror the published schemas, and exercise the backup →
restore round trip in Vitest and browser E2E. Until then, this blocked report is
the required B7 acceptance evidence; no speculative code is present.
