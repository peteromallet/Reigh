# Local Workspace Runtime — Overall Strategy and Roadmap

**Status:** canonical execution strategy
**Date:** 2026-08-28
**Scope revision:** 2026-08-29
**Audience:** an implementation team starting without prior conversation context
**Long-term direction:** [Banodoco Workspace Runtime Vision](./vision.md)

## 1. Outcome

Build one local creative workspace authority shared by Astrid and REIGH:

- one independently owned and runnable `banodoco-workspace-runtime` daemon owns SQLite, CAS, migrations, tasks, events, and coordination;
- Astrid and REIGH are clients through generated Python and TypeScript protocol packages;
- Astrid remains an open, editable source checkout whose packs and skills define its creative capabilities and agent guidance;
- executor processes claim immutable, fenced work, run pack code—including GPT/provider work—and settle verified outputs through the runtime;
- structured state lives in SQLite, immutable media lives in managed CAS, and paths are temporary attempt-local details;
- the supported source/process graph contains no legacy project-tree authority, direct product database access, dual write, fallback reader, or Supabase local authority.

This is a clean cutover, delivered in three ordered stages. Astrid-first is delivery sequencing, not runtime ownership.

## 2. Decision record

The current decision is a single-user beta on the owner's current machine, followed by REIGH, followed by exhaustive hardening.

Required before the overall beta is called complete:

1. full deletion and static/runtime proof of every legacy Astrid filesystem, bridge, direct-SQLite, and direct-CAS authority path;
2. broad Astrid capability parity: every currently useful capability on the supported machine has a working neutral-worker route; optional, unavailable, unsupported, or retired status requires a concrete platform/credential/dependency reason and explicit approval rather than being a scope-cut default;
3. one verified, rollbackable migration of the owner's current Astrid workspace;
4. a basic REIGH journey on the same realm: projects, managed media, timeline edit/save, task/run/event inspection, cancel/retry, render, play, and export, with zero Supabase traffic;
5. minimum data-safety checks: backup/restore, SQLite/foreign-key/CAS integrity, restart persistence, idempotency/lease fencing, scoped local credentials, and an end-to-end editable-checkout composition smoke test.

The current-machine delivery decision is:

- Astrid, its generic pack-executor host, and its packs/skills are run from an editable checkout, normally through editable Python installation and the repository's pinned Node environment;
- packs remain the first-class source namespace for executors, orchestrators, and elements; only the old Git install/update/rollback package manager is removed;
- skills remain first-class source guidance, with lightweight harness sync/link tooling allowed as non-authoritative support state;
- source revisions, dirty-tree state, manifest hashes, and capability definition digests are recorded so editable code is reproducible enough for the beta;
- the legacy thread system is deleted completely rather than migrated or preserved as a compatibility domain; surviving semantics use runs, task graphs, generations, variants, and evidence; and
- Stage 1 supports one configured realm on the owner's current Mac, one generic Astrid pack-executor host, and append-only CAS; multi-realm UX, Linux certification, automatic GC, and specialised executor topology are follow-up work;
- the first worker/resource contract includes typed settlement effects, bounded concurrency, named resource keys, lease-bound reservations, waiting reasons, and low-space preflight, but not sophisticated scheduling; and
- signed installers, wheels as the product boundary, and independently updatable binary artifacts are not Stage 1 acceptance requirements.

Explicitly deferred until Stage 3 or later:

- exhaustive crash/race/transaction-boundary, disk-full, corrupt-SQLite/CAS, credential, adversarial-input, and security testing;
- signed/notarized installers, polished update/rollback/uninstall/purge, general migration UX, cross-platform certification, multi-user support, and production support/SLA;
- hosted auth/credits/storage, Supabase Edge Functions, cloud collaboration, RunPod/cloud GPUs, and Turso synchronization;
- full Reigh Worker/GPU orchestration beyond what the Stage 2 product scope explicitly accepts.

The one-time migration, backup, integrity, and rollback requirements are not general product polish. They are retained because the only user's real data is in scope.

## 3. Frozen architecture

1. The runtime is a neutral sibling repository/service and imports no Astrid, REIGH, or Reigh Worker code.
2. The runtime daemon is the only SQLite, CAS, queue, coordinator, and schema-migration writer.
3. Products and executors receive endpoint, realm ID, and scoped credential—not a database path.
4. One realm is one database plus one object namespace; projects are rows within the realm.
5. All commands cross a versioned OpenAPI/closed-JSON-Schema protocol through generated clients.
6. Admitted work pins capability/protocol/schema versions, inputs, actor, idempotency identity, and task/attempt/lease fences.
7. Runnable local media is ingested into managed CAS. Persistent `external_local` or project-relative runnable authority does not ship.
8. Legacy readers exist only in the separately invoked one-time migrator and are absent from normal source, import, and process graphs.
9. A persistent neutral realm catalog is distinct from ephemeral live process discovery.
10. Later REIGH requirements enter as neutral, versioned contract deltas; REIGH never consumes Astrid types, routes, lifecycle state, credentials, or paths.
11. Compatibility has three levels: protocol/schema compatibility gates a connection; capability/source digests pin each admitted task; whole-checkout commit/dirty state is recorded diagnostics, not a connection gate.
12. Workers return immutable typed outputs and may affect structured workspace state only through a predeclared runtime-validated settlement effect or a proposal later applied by a normal client command.
13. The runtime performs minimal resource admission and reservation in Stage 1; workers and the host enforce hardware limits. Advanced placement, fairness, quotas, telemetry optimisation, and cloud bursting are deferred.
14. Stage 1 CAS is append-only. It reports usage and rejects work that cannot reserve sufficient space; automatic deletion/GC begins only with the later reachability and fault-injection gate.
15. Stage 1 gives dedicated neutral operations only to the shared core required by Astrid plus the narrow TypeScript proof. Theme/style and experiment/review use schema-validated versioned documents, evidence, and relations; Stage 2 owns gallery, extension, richer composition, and other REIGH-specific contract expansion.

### 3.1 Ten provocative boundary tests

These are deliberately sharp. If implementation makes any statement false, it has crossed a system boundary and must be redesigned or the decision record must be changed explicitly.

1. **Astrid may be intelligent, but it is not authoritative.** It interprets intent, plans, discovers capabilities, submits work, and explains results; it never owns the durable workspace, queue, or object store.
2. **The runtime may know what work means, but it never performs creative work.** It validates commands, stores state, schedules and fences tasks, and verifies settlement; it never calls GPT, FFmpeg, Remotion, ComfyUI, or pack `run.py` code.
3. **A worker may execute anything, but it decides nothing about project truth.** It receives an immutable task snapshot and scoped attempt access, then returns typed outputs; the runtime may apply only its predeclared settlement effects, and the worker never opens SQLite, invents arbitrary durable state, or maintains another queue.
4. **The Astrid checkout is the open creative engine.** Packs remain editable source namespaces for executors, orchestrators, and elements; removing the old pack installer must never turn Astrid into a closed or fixed capability appliance.
5. **Skills teach agents; they do not store projects.** Skill and `STAGE.md` source stays beside the code and may be linked into agent harnesses, but skill-sync state is disposable and cannot affect workspace recovery.
6. **A GPT call that matters is a task, not a side channel.** Ephemeral conversation may remain conversational, but paid/provider work, artifact creation, reproducible analysis, and every durable mutation cross the runtime command/task boundary.
7. **REIGH uses Astrid's editable creative engine without using the Astrid agent as a server.** REIGH submits neutral commands and tasks directly; bootstrap may start the generic Astrid pack host, but no Astrid agent process or Astrid-shaped API is required.
8. **Threads are gone, not hidden.** No thread table, file, identifier, compatibility API, or migration target survives; the useful semantics are represented directly by runs, task graphs, generations, variants, and evidence.
9. **Theme is project data; elements are executable source.** SQLite versions style/theme documents and timeline pins, CAS holds their assets, and pack workers load element code—SQLite never becomes a TSX or Python package store.
10. **Editable does not mean untraceable—or globally frozen.** Every admitted task pins its capability definition/source digest, while whole-checkout commit and dirty state remain diagnostics; changing unrelated source does not break a connection, and changing a pack affects newly admitted work only.

## 4. Delivery landmarks

| Landmark | Outcome | Blocking gate |
|---|---|---|
| Stage 1: Astrid beta | independent runtime; one current-Mac realm; complete Astrid client cutover; one generic pack-executor host; broad truthful capability parity; minimal resource/settlement contracts; one-time migration; legacy authority deleted | Astrid works end to end after restart; real data reconciles; authority/capability censuses have zero unclassified entries |
| Stage 2A: basic REIGH | REIGH uses the generated TypeScript client and the same realm for the basic visual journey; R0 adds any REIGH-specific neutral contract deltas no longer pre-built in Stage 1 | recorded browser journey, shared identities/state, zero Supabase/direct-DB traffic |
| Overall single-user beta | Stage 1 plus Stage 2A integrated on the current machine | combined editable-checkout composition smoke, backup/restore, integrity, restart, and rollback evidence |
| Stage 2B+: fuller REIGH | adds gallery/extension/full-composition contracts when proven by REIGH, progressively replaces the remaining REIGH/Reigh Worker local control plane, and expands the accepted worker/resource profile without reopening authority boundaries | each accepted product slice deletes its old authority before activation |
| Stage 3: hardening | begins only after Stage 2 R7; adds verified CAS GC and exhaustively tests the integrated fuller REIGH + accepted worker/resource profile, packaged components where applicable, and the supported Astrid editable-checkout lifecycle | full hardening matrix passes with reproducible evidence |

## 5. Source and dependency order

```text
neutral DDL + OpenAPI + conformance fixtures
                      |
                      v
          banodoco-workspace-runtime
             /          |           \
            v           v            v
   Python client   TypeScript client  worker protocol/fake worker
       |                  |                    |
       v                  v                    v
 Astrid + pack host   REIGH local adapter   later Reigh Worker
       |                  |
       +--------+---------+
                v
        one shared local realm
                |
                v
       exhaustive hardening
```

Code may be extracted from Astrid or REIGH, but the final dependency direction never reverses.

## 6. Cross-stage execution rules

- Freeze a machine-readable authority, public-surface, shared-domain, and capability census before cutover. Completion requires zero unclassified entry.
- Develop the one-time migrator alongside schema extraction, not after schema decisions have drifted.
- Generate and conform both language clients before Astrid freezes the protocol.
- Delete replaced authority in the same tranche that activates its replacement; no indefinite compatibility phase.
- Every gate runs with the runtime, Astrid/generic pack host, and REIGH in separate processes and isolated environments. Editable checkouts are allowed; direct source imports across the protocol boundary are not.
- Evidence is machine-readable where practical: source revisions and dirty-tree digests, manifests, capability hashes, censuses, reconciliation reports, filesystem traces, and network captures.
- A deferred exhaustive test does not excuse a known data-loss, authority, or security-critical bug found during beta work.

## 7. Estimates and planning assumptions

- Stage 1 Astrid: **18–30 engineer-weeks**.
- Stage 2A basic REIGH: **5–9 engineer-weeks**, including contract work deliberately moved out of Stage 1.
- Combined path to the overall single-user beta: **23–39 engineer-weeks**, approximately **9–13 calendar weeks with three focused engineers**, or roughly **5–8 months solo**.
- Stage 2B fuller REIGH/Reigh Worker after the beta gate: **15–25 additional engineer-weeks**, subject to the R0 census.
- Total Stage 2 from Astrid handoff through fuller REIGH: **20–34 engineer-weeks**.
- Stage 3 exhaustive hardening and verified GC/resource lifecycle: **8–13 engineer-weeks** before any scope discovered by testing.

The largest uncertainty is Astrid capability parity; the next largest is the distance between current REIGH timeline/media behavior and the neutral protocol.

## 8. Canonical stage documents

- [Stage 1 — Astrid beta](./01-astrid-beta.md) contains the detailed extraction, launch, capability, migration, deletion, and Astrid acceptance plan.
- [Stage 2 — REIGH next](./02-reigh-plan.md) contains the basic beta slice and the clean path to fuller REIGH/Reigh Worker.
- [Stage 3 — hardening](./03-hardening.md) owns every consciously deferred production-quality test and lifecycle concern.

If the documents disagree, the frozen architecture and scope decision in this strategy win until a dated decision change updates all affected stage documents.
