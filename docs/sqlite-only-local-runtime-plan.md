# SQLite-Only Banodoco Workspace Local-v1 Plan

**Status:** Handoff-ready implementation blueprint; execution artifacts are not yet built  
**Date:** 2026-08-28  
**Long-term context:** [Creative Workspace Runtime Vision](./creative-workspace-runtime-vision.md)

**Astrid-first delivery variant:** [Astrid-First Production Trunk](./sqlite-only-local-runtime-astrid-first-plan.md). That companion keeps the same final architecture but makes a production-quality Astrid-only release the first complete vertical slice. This document remains the composed Astrid + Reigh + Reigh Worker plan.

## 1. Goal

Ship one cohesive local Banodoco stack in which:

- Reigh is the visual client;
- Banodoco Workspace Runtime is an independently owned package/service and the sole workspace authority;
- Astrid is a peer agent client;
- Reigh Worker is a local compute executor;
- one runtime process is the only SQLite writer;
- all durable structured workspace state lives in SQLite;
- all large immutable bytes live in a local content-addressed object store;
- the core creative journey works without Supabase, Turso, hosted services, RunPod, or cloud GPUs.

This is a real product cutover, not a compatibility mode. A one-time offline migrator may read old layouts, but the shipped runtime must not scan, fall back to, repair from, or dual-write legacy project files.

The final system is organized around one neutral center and three client integrations rather than around database cleanup in isolation. Two valid delivery shapes are documented: this composed-stack plan retains the parallel cutover, while the companion Astrid-first trunk ships the runtime, Python client, Astrid product, and Astrid executor slice first and makes the later Reigh work consume those released contracts.

This composed-stack variant proceeds as follows:

1. create the independently owned Banodoco Workspace Runtime and make its bridge the complete local workspace, media, task, worker, and event authority API;
2. in parallel, make Reigh Worker claim and settle through it, make Astrid use its Python client, and make Reigh use its TypeScript client;
3. compose those independently proven integrations into the complete local creative journey;
4. evolve SQLite and the object store only through durable contracts that remain valid for later cloud placement.

The bridge is not a separate data owner and is not an Astrid integration. It is the protocol surface of the independently owned Banodoco Workspace Runtime, which owns SQLite and the object store. The short-term release succeeds only when Reigh, Astrid, Reigh Worker, and the supervisor use that neutral surface coherently.

## 2. Non-goals

The local release does not include:

- Turso or bidirectional database synchronization;
- hosted Reigh to local-machine relay;
- RunPod or shared cloud GPU scheduling;
- Supabase-backed local paths;
- multi-user collaborative editing;
- third-party capability installation as a platform;
- live migration of existing production cloud accounts.

## 3. Frozen architectural decisions

1. **One structured authority.** SQLite owns every durable structured fact.
2. **One byte authority.** The object store owns immutable large bytes; SQLite records identity, location, relationships, and provenance.
3. **No project data directories.** No live `projects/`, `sources/`, `timelines/`, `runs/`, experiment folders, Markdown notes, JSON sidecars, or event-log files.
4. **No direct client database access.** Reigh, Astrid, and workers use generated clients for the neutral runtime protocol. None opens the workspace database. Even on one machine, clients cross the daemon boundary; they may not import runtime repositories, migrations, SQLite helpers, or object-store internals.
5. **IDs cross process boundaries.** Task specifications name project, timeline, media, capability, and expected version identities—not internal filesystem paths.
6. **Paths are attempt-local.** The executor materializes inputs into a fenced staging directory and settles outputs back through the runtime.
7. **No runtime legacy layer.** Migration is offline and one-way; compatibility code is removed after cutover.
8. **Local first.** Cloud placements must adapt to this contract later rather than shaping the critical path now.
9. **Neutral schema.** Core tables contain shared workspace concepts only. Product-specific concepts use runtime-owned schema extensions and migrations in the same SQLite authority; they never force the runtime to import Astrid or Reigh code.
10. **Neutral capabilities.** The runtime owns capability identity, definition digests, availability, admission, and task pinning. Executable capability code lives in independently registered executor packages and never becomes a runtime dependency.
11. **One realm per local workspace.** One local workspace realm maps to one runtime database and one object namespace; projects are rows inside that realm. Every protocol request carries realm identity even when one daemon initially serves one realm.
12. **Immutable admitted work.** Admission atomically pins the canonical task specification, capability digest, timeline revision, media digests, relevant settings, actor, and protocol version. Workers execute that snapshot rather than re-reading mutable current state.
13. **Epoch-fenced scheduling.** Claims and every attempt mutation carry coordinator epoch, task identity, attempt identity, lease identity, and expected status version.
14. **Independent release ownership.** Local v1 creates a sibling neutral repository and release artifact named `banodoco-workspace-runtime` (working product name). Its daemon, schema, migrations, protocol, generated clients, conformance suite, and release lifecycle do not live under Astrid, Reigh, or Reigh Worker.
15. **Absolute clean break.** The one-time offline migrator is the only component allowed to read an old database, route, file layout, or identifier form. Shipped clients and runtime contain no compatibility shims, legacy route aliases, schema views, dual clients, fallback readers, feature flags between authorities, shadow writes, or auto-repair from old state. Old client versions fail the compatibility handshake and must upgrade.
16. **One CAS writer.** The runtime daemon is the sole SQLite, CAS, queue, and migration authority. All staging, upload, publication, reachability, and collection operations cross its protocol; clients and workers never write CAS or invoke store internals.

## 4. Target process topology

```text
                 optional local stack supervisor
          readiness, startup, shutdown, diagnostics
                              |
          +-------------------+-------------------+
          |                   |                   |
       Reigh             Astrid agent        Reigh Worker
    visual client     intelligent client    compute executor
          |                   |                   |
          +----------- runtime protocol ----------+
                              |
              Banodoco Workspace Runtime daemon
                 sole neutral workspace authority
                              |
                 +------------+------------+
                 |                         |
          workspace.sqlite3       objects/sha256/...
```

## 5. Local layout and distribution

### 5.1 Repository and artifact ownership

| Component | Canonical source/release owner | Local-v1 artifact |
|---|---|---|
| Banodoco Workspace Runtime | new `https://github.com/banodoco/banodoco-workspace-runtime`, local sibling `/Users/peteromalley/Documents/reigh-workspace/banodoco-workspace-runtime`, default branch `main` | Python 3.11+ runtime wheel plus signed/self-contained macOS and Linux daemon/CLI bundles |
| protocol and generated clients | neutral runtime repository | `protocol/openapi.yaml`, migration/schema manifests, Python `banodoco-workspace-client`, npm `@banodoco/workspace-client`, conformance fixtures |
| Astrid | existing Astrid repository | agent/CLI and optional capability-executor package; protocol client only |
| Reigh | `banodoco/reigh-app` | Supabase-free local web/server bundle using generated TypeScript client |
| GPU execution | `banodoco/reigh-worker` | Linux/NVIDIA local-v1 execution artifact using generated Python client |
| rendering | new neutral `banodoco-render-executor` package, initially released from the runtime repository and separable later without protocol change | Node/Remotion/FFmpeg executor artifact |
| composition | neutral `banodoco-local` bootstrap/supervisor, initially released from the runtime repository | profile installer, lifecycle CLI, signed aggregate release manifest |
| legacy import | neutral repository build-only tool | separately invoked offline migrator artifact; absent from normal runtime/client dependency graphs and release entry points |

The neutral repository's first gate creates `schema/migrations/0001_initial.sql`, `schema/manifest.json`, `protocol/openapi.yaml`, closed JSON schemas, generated-client commands, conformance commands/fixtures, and a pinned toolchain lock. No product extraction or client cutover starts until those reviewed artifacts exist. Banodoco owns release approval; individual repository workstreams own implementation and tests, but cannot change the neutral contract unilaterally.

### 5.2 Workspace layout

```text
<workspace>/
  workspace.sqlite3
  workspace.sqlite3-wal
  workspace.sqlite3-shm
  objects/sha256/<shards>/<digest>
  staging/<active-attempt-id>/
```

Outside the workspace:

- application and capability code;
- model weights and ComfyUI/WGP installations;
- rebuildable caches and bounded logs;
- explicit user exports and portable backups.

Only the runtime daemon resolves the workspace path. Clients receive a runtime endpoint, realm identity, and scoped credential; they never receive the SQLite path as a composition primitive.

### 5.3 Installation and distribution contract

The neutral runtime is independently built, versioned, installed, upgraded, and runnable. Product installers may depend on it and make first run seamless, but that does not transfer ownership.

| Installation profile | Installed/started components | Required behavior |
|---|---|---|
| Astrid only | runtime + Astrid + optional local capability executor | Astrid's installer discovers a compatible runtime, installs it if absent, starts or connects to it, provisions Astrid-scoped credentials, and never opens its database |
| Reigh local | runtime + Reigh + Reigh Worker GPU pack + neutral render executor | Reigh performs the same discovery/compatibility flow, can create a fresh realm without Astrid, and supports the complete local creative journey |
| Reigh viewer/editor | runtime + Reigh | explicit reduced profile for browsing/editing only; generation controls truthfully report that no compatible executor is installed |
| Worker only | Reigh Worker protocol client | requires an explicit runtime endpoint/realm/token; does not install or own a workspace runtime by default |
| Full local stack | one runtime + Reigh + Astrid + one or more workers + optional supervisor | all products reuse the same runtime instance and realm; duplicate database owners are rejected |
| Runtime only | runtime daemon + CLI/doctor/conformance tools | workspace CRUD, tasks with a protocol-only fake worker, media, backup, restore, and shutdown work with all three products absent |

Installer and first-run behavior is frozen as follows:

1. Query the machine runtime registry or configured endpoint and perform a protocol handshake.
2. Reuse a compatible running runtime; never install a second owner for the same realm.
3. If absent, install the independently released runtime artifact, create/select a realm, start it, and wait for readiness.
4. Bootstrap distinct least-privilege credentials for Astrid, Reigh, worker, and supervisor actors.
5. On update, verify the client/runtime/protocol/schema compatibility matrix, take a pre-migration backup, let only the runtime apply migrations, and fail closed on an incompatible mix.
6. On uninstall, remove product binaries without deleting shared runtime data or stopping a runtime still used by another product. Workspace deletion is a separate explicit operation.

The logical release artifacts are independently versioned `banodoco-workspace-runtime` daemon/CLI, generated `banodoco-workspace-client` Python package, generated `@banodoco/workspace-client` TypeScript package, Astrid product package, Reigh application bundle, Reigh Worker execution artifact, optional `banodoco-local` supervisor/bootstrap, and one `banodoco-local-v1.manifest.json` pinning every artifact digest plus protocol/schema/capability versions. The bootstrap installs manifest-pinned artifacts into neutral Banodoco locations; a product bundle may carry the same verified runtime artifact for offline installation but may not vendor or run a private copy.

The render capability is not owned by Astrid. Local-v1 ships a separately registered `banodoco-render-executor` process (Node/Remotion/FFmpeg) with the Reigh-local and full-stack profiles. Reigh Worker supplies the pinned image/video GPU capability pack. Astrid capability executors are optional peers.

Luna repository audits must ground-truth package managers, desktop/CLI installers, current first-run behavior, daemon discovery, update paths, and uninstall behavior for every profile. No client may vendor a private runtime copy or silently create a product-specific database.

Local-v1 supports macOS and Linux. The default realm data root is `~/Library/Application Support/Banodoco/workspaces/<realm-id>/` on macOS and `${XDG_DATA_HOME:-~/.local/share}/banodoco/workspaces/<realm-id>/` on Linux; an explicit user-selected workspace may live elsewhere. Runtime discovery is an atomically replaced, owner-only `discovery.json` under the corresponding Banodoco runtime-support directory on macOS and `${XDG_RUNTIME_DIR}/banodoco-workspace-runtime/` on Linux. It contains endpoint, PID, runtime instance ID, realm IDs, protocol/schema versions and digests, and credential-file references—never raw secrets or a database path.

The daemon binds an ephemeral loopback port by default and writes it to discovery. Each actor receives a distinct 256-bit credential stored outside the workspace in an owner-only file (OS keychain integration may replace this later). The owner lock and runtime handshake, not a fixed port, prevent duplicate authorities. Local-v1 release artifacts are pinned together by one signed/hash-recorded release manifest; there is no mixed-version compatibility window.

One local-v1 daemon serves one active realm. Switching realms drains and stops that daemon, then opens a different realm; running several realms requires several explicitly named daemon instances and distinct owner locks/discovery entries. The default full-stack command operates one realm.

### 5.4 Canonical commands and lifecycle

The operational CLI is neutral and may be invoked directly or by a product installer:

```text
banodoco-local install --profile runtime|astrid|reigh|reigh-viewer|worker|full
banodoco-local up --realm <realm-id-or-name>
banodoco-local status|doctor --realm <realm-id>
banodoco-local update --manifest <signed-manifest>
banodoco-local backup --realm <realm-id> --output <bundle>
banodoco-local restore --backup <bundle> --new-realm <realm-id>
banodoco-local uninstall --profile <profile>
banodoco-local purge --realm <realm-id> --confirm <realm-id>
```

`up` discovers or creates the realm through the runtime, waits for readiness, provisions scoped actors, starts configured executors, and serves Reigh when present. The Reigh local server—not browser JavaScript—holds its runtime credential, proxies the canonical protocol byte-for-byte, and establishes an `HttpOnly`, `SameSite=Strict`, origin-bound browser session. Stale discovery is accepted only after PID/instance/owner-lock verification; otherwise doctor removes it and starts cleanly.

Update drains workers, stops clients, acquires the realm owner lock, verifies the signed manifest/artifact digests, creates and verifies a pre-migration backup, stages the entire exact-version release, runs migrations against a sibling workspace, executes health/conformance smoke tests, and atomically activates. Failure before activation leaves the old release/workspace active; after successful activation the old runnable artifacts are removed. Downgrade is unsupported. Recovery means explicitly restoring the pre-migration backup into a new realm with its matching full release, never translating it through the new runtime.

Uninstall removes only the requested product and stops the runtime only when no installed profile uses it. It preserves realms, backups, and managed media. `purge` is the sole destructive data-removal command and requires the realm ID repeated exactly; it is never called by uninstall.

Worker-only setup uses `reigh-worker configure --endpoint <url> --realm <id> --registration-token <token>` followed by `reigh-worker doctor` and `reigh-worker start`. The runtime issues a single-use registration token; successful registration returns a distinct expiring worker credential. Rotation, revocation, drain, and restart are runtime operations and generate durable events.

### 5.5 Platform and model boundary

- macOS and Linux support the runtime, Astrid, Reigh, and CPU render executor.
- Real local image/video generation in v1 is supported on the audited Linux/NVIDIA matrix only. macOS is an honest editor/agent/render profile and uses the deterministic fake executor in conformance; it does not claim GPU generation.
- Model installation is an explicit setup action, never an execution-time auto-download: `banodoco-local models install --profile local-v1-gpu --manifest <pinned-model-manifest>`. The manifest pins model IDs, immutable digests, license/source, disk budget, and compatible capability digests.
- Offline execution tests run only after models and artifacts are preseeded. Missing models keep the worker unready and Reigh/Astrid show the exact blocked capability and setup command.

### 5.6 Managed media

- Every byte used by local-v1 is hashed, copied into runtime-owned CAS, and reproducible.
- A selected user path is an ephemeral import source only. After import, no runnable project, media, task, or worker record retains or resolves that path.
- Migration fails closed if a required legacy byte cannot be read, hashed, and ingested. Workers never receive an arbitrary user path.
- Backup includes every reachable managed byte and never reports metadata-only media as complete.
- `staging/` is disposable attempt-local state and is excluded from backups.
- Exports are materialized outside the live workspace; SQLite retains their provenance, but exported files are not a second authority.

## 6. Structured-state cutover inventory

| Current state | Target authority | Cutover treatment |
|---|---|---|
| project metadata and `project.json` | `projects`, project settings | import missing data; delete file reads/writes |
| `plan.md` and project notes | versioned project-document table | import Markdown text; expose through SDK/API |
| source directories and `source.json` | media, managed objects, references, analysis records | hash/import all required bytes; persist no source path authority |
| timeline directories and sidecars | timeline document, registry, version, kernel events | SQLite wins; import only filesystem-only timelines |
| `run.json` | runs, tasks, attempts, outputs | stop projection; settle all result fields in kernel |
| `events.jsonl` | kernel events | remove preferred-file reads and projection writes |
| run output directories | media/object store plus task-output links | ingest durable outputs; discard temporary intermediates |
| experiments/reviews/conclusions | experiment domain tables plus referenced artifacts | import structured state and artifact IDs |
| project/user selection files | actor/workspace preferences | add transactional preference commands |
| extension selection/settings | extension installation/project-settings tables | keep executable code outside workspace; store state inside |
| render/timeline manifests | task/run specifications, pinned timeline versions, provenance | materialize only inside attempt sandbox or explicit export |

The local-v1 schema uses one neutral migration stream and the following concrete table families. Domain tables are preferred over an unbounded generic key/value store; JSON columns are limited to versioned documents, typed manifests/settings, and opaque provider metadata validated by a pinned schema.

| Family | Required tables |
|---|---|
| runtime | `schema_migrations`, `realms`, `coordinator_epochs`, `coordinator_state` |
| identity | `actors`, `actor_identities`, `actor_credentials` |
| creative state | `projects`, `project_documents`, `project_settings`, `preferences`, `timelines`, `timeline_revisions`, `shots`, `shot_items` |
| history/idempotency | `event_streams`, `events`, `command_receipts` |
| bytes/media | `objects`, `object_locations`, `object_staging`, `object_gc_candidates`, `media`, `media_relations` |
| generation/provenance | `generations`, `generation_variants`, `provenance_records` |
| execution | `runs`, `tasks`, `task_inputs`, `task_dependencies`, `execution_attempts`, `task_outputs` |
| creative review | `experiments`, `experiment_items`, `reviews`, `review_items`, `evidence_items` |
| extensions/capabilities | `extension_definitions`, `extension_project_state`, `capability_definitions`, `executor_registrations`, `executor_capabilities` |
| operations | `backup_records`, `export_records` |

Every mutable aggregate has an integer version used for compare-and-set commands. Every project/domain row is realm-reachable through foreign keys. Task rows pin capability and input digests, protocol version, admitted specification, parent attempt/depth, coordinator epoch, and idempotency identity. Attempts carry a unique lease plus epoch/status version. Events and receipts identify actor, realm/project, protocol version, epoch, and request hash. Managed object references require a verified digest. Required uniqueness, partial indexes, JSON validity, state checks, dependency indexes, and foreign-key delete policies are fixed in the first DDL review before repository extraction begins.

### 6.1 Creative graph invariants

- A generation belongs to one project, references its admitted task/provenance, and points to one or more CAS-backed media outputs. A variant references its parent generation and its own media/provenance; promotion to a shot creates a `shot_item` relationship rather than copying identity.
- A shot is an ordered set of media/generation items plus versioned settings. Its shot-scoped timeline is a normal immutable timeline revision related to that shot. The project timeline references shot/timeline revision identities, never mutable “current” aliases inside an admitted task.
- Extension definitions are immutable manifests identified by `(id, version, digest)`. Project extension state pins enabled definitions and versioned settings. Each timeline revision pins the extension definitions/settings that affect its rendering. Disabling an extension affects future revisions only; existing revisions remain inspectable and renderable while the pinned executor is installed, otherwise they fail explicitly with `capability_unavailable`.
- Removing an executable package never deletes extension state or historical provenance. Local-v1 trusts only release-manifest-pinned built-in extensions/executors; third-party installation and sandboxing remain deferred.
- Audio is CAS-backed media with duration, codec, sample rate, channel count/layout, and loudness metadata. Timeline revisions contain ordered audio clips with media ID, source in/out, timeline start, gain, fades, and track order. The render executor pins these inputs and emits MP4/H.264 + AAC-LC 48 kHz stereo by default, preserving intentional silence when no clip exists. Browser content endpoints support range requests; FFprobe verifies duration, stream presence, codec, and A/V sync at release gate.

## 7. Workstreams

The dependency shape is **neutral runtime first → Worker/Astrid/Reigh integrations in parallel → composed local journey**. Schema, migration, packaging, and tests exist to make that path authoritative and durable.

### 0. Independent runtime extraction and proper bridge contract

- Establish the neutral runtime repository/package, daemon, schema ownership, versioning, protocol specification, generated Python/TypeScript clients, and conformance suite.
- Extract reusable SQLite kernel, object-store, task, event, receipt, migration, backup, and bridge code from Astrid without carrying Astrid agent/product dependencies across the boundary.
- Define the complete command/query, worker, media/object, progress/event, health, and capability endpoints required by all three clients.
- Make the bridge the only long-running mutation surface and the only way a worker claims or settles work.
- Provide stable typed clients for Python and TypeScript rather than duplicating route knowledge.
- Cover admission, idempotency, claim, start, heartbeat/control, cancellation, staged input/output transfer, fenced settlement/failure, task/run reads, and non-authoritative progress delivery.
- Bind every request to one workspace and actor; bind every worker mutation to its task/attempt/lease/version fence.
- Carry coordinator epoch on claim, heartbeat, control, child-task admission, settlement, and failure.
- Use OpenAPI 3.1 plus versioned JSON Schemas as the canonical local-v1 protocol artifact; generated clients are the only product dependency on runtime internals.
- Keep loopback-only local transport and scoped local credentials even before remote connectivity exists.
- Version the protocol and make schema/capability mismatch fail with actionable diagnostics.
- Replace Astrid-branded public routes and client types with the versioned neutral protocol. Do not retain permanent aliases; the one-time cutover updates all known clients together.
- Delete the displaced implementations after migration verification. A facade preserving an old method or payload shape is still a shim and is forbidden.

### A. Runtime and schema

- Own this work in the neutral runtime repository/package, not Astrid or Reigh.
- Inventory every filesystem-owned workspace datum and every reader/writer.
- Add missing domain tables, foreign keys, event streams, receipts, version checks, and indexes.
- Freeze concrete tables and namespaces for every local-v1 domain before implementation. Do not build a generic schema-pack/plugin mechanism until a second real extension proves it necessary.
- Make one realm/database/object namespace the daemon's composition root; never expose its database path to clients.
- Add an object-store service with staged publication, hash verification, reachability, and garbage collection.
- Complete ID-based command/query/media/task APIs.
- Add neutral capability-definition, immutable digest, executor-registration, and task-pinning records without importing executable packs.
- Define worker registration, capability/resource advertisement, readiness, heartbeat, drain, shutdown, token expiry, and exact version/digest rejection.
- Make root admission accept one immutable root task or atomic task graph. Make child creation a runtime operation fenced to an active parent attempt and constrained by capability allowlist, depth, fan-out, dependencies, and idempotency.
- Define transactional settlement: validate epoch/task/attempt/lease/version, verify staged output hashes, publish or register objects, write output/media/generation/provenance rows, advance task/run state, and append event/receipt atomically. Published-but-unreferenced bytes remain unreachable and garbage-collectable after a grace period.
- Remove filesystem discovery, fallback, repair, and projection code.
- Make backup/restore operate on a consistent SQLite snapshot and reachable objects.

### B. Astrid product and capabilities

- Remove workspace-kernel and bridge ownership from Astrid after extraction.
- Add/use the generated neutral Python client for all project, timeline, media, task, run, event, note, experiment, and preference operations.
- Let Astrid-only packaging install/start/discover the neutral daemon without absorbing its code or schema ownership.
- Replace project-path inputs with project/timeline/media identities.
- Introduce attempt-local materialization for capabilities that require paths.
- Settle structured results and artifacts through the neutral runtime protocol.
- Remove `plan.md`, run projections, file event preferences, source directories, timeline sidecars, and filesystem-owned experiment state.
- Update the public CLI/SDK, skill, documentation, and conformance suite to the database-only model.
- Run Astrid-hosted CPU/agent capabilities as registered executors over the same worker protocol when they produce runtime work; do not give them an in-process database shortcut.

### C. Reigh Worker

- Classify every task family as reusable compute, control-plane entangled, orchestrator-owned, or deferred.
- Preserve reusable model loading, workflow construction, inference, progress translation, and output discovery.
- Use the generated neutral Python client for claim, start, heartbeat, control, input fetch, progress, staged output, settlement, failure, and cancellation; no handwritten worker wire client or DTO layer.
- Ensure the worker never opens SQLite or receives Supabase credentials.
- Materialize CAS inputs into an attempt sandbox; collect outputs into staged objects.
- Move child-task ownership out of the worker: clients admit roots; a running capability may request a child only through the runtime's parent-attempt endpoint; the runtime validates and inserts it. The worker never inserts task rows.
- Establish golden-output parity in an isolated pre-cutover comparison harness, then delete the Supabase control path before shipping. The released stack never selects or calls both authorities.

### D. Reigh

- Make the local distribution use exactly one backend: the neutral runtime. Supabase-backed releases, if maintained separately during organizational transition, share no local-v1 entry graph, fallback, feature flag, route alias, or runtime package.
- Route projects, timelines, shots, gallery, generations, settings, tasks, events, extensions, and media through the runtime client.
- Remove every Supabase/auth/credits/storage/Edge Function read, write, import, and provider from the local distribution.
- Make timeline and shot editing use database version/CAS semantics.
- Use runtime media URLs/streams rather than storage URLs or local absolute paths.
- Add responsive non-authoritative progress delivery while retaining durable task reads as truth.
- Hide or truthfully disable unavailable cloud actions.

### E. Supervisor and local packaging

- Provide one start command or desktop action.
- Ask the runtime to create or open a realm. The runtime alone resolves and owns its storage path.
- Start the neutral runtime; the runtime itself acquires the sole-owner lock, applies its migrations, and exposes readiness/doctor results.
- Start the neutral runtime first, then the configured local worker and Reigh, and connect Astrid as another client.
- Keep the supervisor non-authoritative. It is required in the Reigh-local/full-stack product bundles and optional for runtime-only/Astrid-only operators who invoke the daemon directly.
- Report ports, process identities, runtime health, and aggregated GPU/model/disk readiness and recovery actions. Workers register their own capabilities directly with the runtime; the supervisor never becomes capability authority.
- Implement the installation profiles and first-run/update/uninstall rules in section 5.3, including shared-runtime discovery and incompatible-version refusal.
- Drain and stop processes without corrupting or falsely completing work.
- Keep machine configuration, models, caches, logs, exports, and backups outside the workspace authority.

### F. One-time offline migration

- The neutral repository owns a separately built `banodoco-workspace-migrate-v1` artifact. It accepts an explicit source kind/version and source root plus a new destination realm; it is not importable by runtime/client packages and is absent from their dependency graphs.
- Design and test the migrator alongside each schema change, even though final cutover occurs after the clients are ready.
- Freeze writers and create a verified recovery backup.
- Import file-only structured state into new domain tables.
- Ingest durable bytes into the object store and create media/output relationships.
- Treat existing kernel rows as authoritative where both forms exist.
- Fail closed on unexplained divergence; never silently merge.
- Verify row counts, object hashes, foreign keys, event heads, receipts, and domain invariants.
- Publish the new workspace atomically and retain the old layout only as a separately named recovery archive.
- Ship no compatibility reader or dual-write path in the normal runtime.
- Do not ship the migrator as an implicit startup fallback. Migration is an explicit offline command that produces a newly validated workspace or fails without activating it.

#### F.1 Migration and activation sequence

1. Stop and lock out every old writer, worker, bridge, orchestrator, and editor.
2. Create a timestamped read-only recovery archive of the old tree and databases with a byte/hash manifest.
3. Inventory old SQLite rows, JSON/Markdown, sources, timelines, runs, experiments/reviews, preferences, and media without modifying them.
4. Create a fresh sibling workspace using only the neutral schema and CAS.
5. Import existing Astrid kernel database rows first. A frozen Reigh snapshot may fill Reigh-only domains. Old files may fill genuinely absent facts only. Identity overlap requires semantic equality; any disagreement fails closed with a machine-readable conflict report rather than merging.
6. Import documents/preferences, hash and ingest every required media byte into CAS, and convert timelines, shots, generations, runs, experiments, reviews, extensions, and provenance.
7. Mark legacy in-flight attempts abandoned; never resume an old unverifiable lease.
8. Retain old kernel events as history. Treat file event logs as import provenance, never replayable commands.
9. Validate SQLite integrity/foreign keys, row reconciliation, hashes, event heads, receipts, timeline digests, uniqueness, and reachable objects.
10. Write and fsync an activation manifest containing source archive hash, destination database/object-manifest hashes, runtime/schema/protocol versions, importer build, and validation report.
11. Atomically activate under the runtime owner lock, then run CRUD, timeline CAS, media, fake-worker settlement, restart, backup/restore, and GC smoke tests.
12. After the explicit retention gate, remove the old authorities. A migration crash before activation leaves the old workspace untouched; recovery during activation uses the manifest through a dedicated migration recovery command, never the normal runtime.

Recovery archives live outside the active realm, are never discoverable by the runtime, and default to 30-day retention. `banodoco-local migration purge --archive <archive-id> --confirm <archive-id>` deletes one explicitly identified archive after verified backup/signoff. Old-format backups can be inspected only by the matching offline migrator release; the new runtime refuses them.

### G. Verification and deletion gates

- Deterministic fake executor end-to-end before GPU work.
- Golden image/video output comparison against current Reigh Worker.
- Fresh-machine installation for runtime-only, Astrid-only, Reigh-only, worker-only, and full-stack profiles; all tests execute installed artifacts outside every source checkout.
- Astrid-first then Reigh, and Reigh-first then Astrid, each discover and reuse one runtime/realm. Concurrent first run and duplicate daemon start produce one owner and an actionable loser.
- Exact release-manifest digest and protocol/schema handshake; partial install, port conflict, corrupt discovery, incompatible component, failed migration, and interrupted upgrade recover or fail closed.
- Fresh workspace, migration, restart, backup/restore, and garbage-collection suites.
- Failure injection for duplicate admission, lease loss, stale completion, worker kill, bridge restart, cancellation, disk-full, corrupt objects, and incompatible schema/capability versions.
- Two-worker registration/claim/drain/restart races with unique sessions and stale-epoch rejection.
- Browser acceptance for Reigh gallery, variants, shot-scoped timeline, main timeline, task progress, cancellation, playback, and export.
- Packaged-browser acceptance covers project create/edit/save/reload, stale-write rejection, image generation/variants, shot and project timelines, travel/video generation, extension composition, media range fetch, audio playback, and exported media whose audio/video streams are verified with FFprobe.
- Real local NVIDIA GPU acceptance for the minimum capability set, plus deterministic fake-executor coverage on macOS without a GPU.
- Accessibility keyboard/screen-reader checks, supported Chromium viewport/device matrix, and visual-regression baselines for single/multiple extensions and large timelines.
- Persistence across client/runtime/worker restarts and machine reboot; uninstall/reinstall preserves realm data, while explicit purge is separately verified destructive.
- Credential permission/scope/expiry/revocation, origin policy, path traversal, malformed payload, object poisoning, secret-log, and least-privilege tests.
- Network capture proving zero Supabase, Turso, hosted-processing, or cloud-GPU requests.
- Filesystem assertion proving the workspace contains only SQLite, object storage, and active staging.
- Static enforcement preventing reintroduction of legacy path helpers or path-based task specifications.
- Static and runtime enforcement proving no compatibility modules, old public route aliases, old schema views, backend-selection flags, or legacy payload translation remain in shipped packages.
- Reproducible artifact/dependency-closure verification plus signed/hash-recorded `acceptance.json`, `authority-census.json`, `network-capture.json`, backup/restore evidence, and final `SHIP.md`.

## 8. Required protocol and lifecycle contracts

Repository audits must turn this matrix into exact versioned operations, request/response schemas, authorization scopes, transaction boundaries, idempotency scopes, expected-version behavior, errors, and conformance tests before client implementation begins.

The local-v1 transport is loopback HTTP/1.1. JSON commands and queries use canonical `/v1/...` routes; bytes use authenticated `PUT`/`GET` with `Range`, `HEAD`, and `ETag`. Reigh may use a same-origin transport-only proxy that preserves methods, paths, headers, status, and payload bytes exactly; it performs no renaming or translation. The sole protocol artifact is `protocol/openapi.yaml` in the neutral repository: OpenAPI 3.1 with JSON Schema 2020-12 components and generated Python/TypeScript clients. Schemas are closed (`additionalProperties: false`) except for explicitly typed opaque provider metadata.

Handshake requires exact protocol major/version, schema digest, realm, actor/scopes, coordinator epoch, and capability-catalog digest. Mismatch fails before any mutation with HTTP 426. Local-v1 exposes no unversioned routes, `/api/astrid`, old headers, handwritten DTO variants, uppercase-ID aliases, or payload translation.

All realm operations live below `/v1/realms/{realm_id}`. Canonical top-level discovery is `GET /v1/health`, `GET /v1/discovery`, and `POST /v1/handshake`. Realm operations cover open/inspect/doctor/backup/restore/export/delete; creative resources expose ID-based commands and queries; tasks expose admission/graph admission/read/control/cancel/retry; workers expose register/advertise/ready/heartbeat/drain/shutdown; attempts expose claim/start/heartbeat/control/abandon/fail/settle/children; objects expose stage/upload/verify/publish/fetch/reachability/collect; media exposes metadata/content/relations; durable observation uses `GET .../events?cursor=&limit=&wait_ms=` with opaque resumable cursors. `/settle` is the only completion operation.

Every durable mutation requires `Idempotency-Key`, scoped to `(realm_id, actor_id, operation, key)`, and a canonical RFC 8785/JCS request hash. Exact replay returns the original receipt/result; key reuse with a different request returns `409 idempotency_mismatch` without mutation. Semantic commands use one `BEGIN IMMEDIATE` transaction.

Read-only `GET`/`HEAD` requests do not require an idempotency key. Staged byte `PUT`s are idempotent by `(staging_id, offset, byte-range digest)`; all stage creation, verification, publication, claim, heartbeat, control, and settlement commands require a key. Heartbeats additionally carry a monotonically increasing worker/attempt sequence so retries replay rather than extend a lease twice.

Success envelopes contain `protocol_version`, `schema_digest`, `realm_id`, `request_id`, `data`, and—when a mutation occurred—`receipt_id`. Error envelopes contain the same protocol/request identity plus `{code, message, retryable, details}`. Secrets, absolute paths, SQL errors, and stack traces never cross the public protocol.

The frozen error codes are: `invalid_request`, `schema_invalid`, `invalid_id`, `invalid_cursor`, `unauthenticated`, `credential_expired`, `forbidden`, `realm_scope_denied`, `not_found`, `stale_version`, `idempotency_mismatch`, `fence_mismatch`, `task_terminal`, `coordinator_epoch_stale`, `worker_session_stale`, `lease_expired`, `graph_cycle`, `dependency_unsatisfied`, `capability_unavailable`, `capability_digest_mismatch`, `object_digest_mismatch`, `output_invalid`, `realm_draining`, `worker_draining`, `protocol_version_mismatch`, `schema_digest_mismatch`, `not_ready`, `coordinator_unavailable`, `object_store_unavailable`, `insufficient_storage`, and `internal`.

HTTP mapping is fixed by category: validation `400`; authentication `401`; authorization/scope `403`; absence `404`; version/idempotency/fence/state/dependency/digest conflicts `409`; protocol/schema handshake mismatch `426`; insufficient storage `507`; readiness/coordinator/object-store availability `503`; unexpected internal failure `500`.

Scopes are realm- and actor-bound: runtime discovery/handshake; realm read/create/delete/doctor/backup/restore/export; creative read/write; task read/admit/control/child-admit; worker read/register/advertise/ready/drain/shutdown; attempt claim/execute/heartbeat/control/settle; object stage/read/publish/collect; and event read. Workers receive only their registration, attempt, object, and event scopes—never database, creative-admin, backup, or realm-delete authority.

| Surface | Required operation families | Authority rule |
|---|---|---|
| realm/workspace | create/open/inspect/doctor/backup/restore/export/delete | runtime alone resolves storage and applies migrations |
| creative state | project, timeline, revision, shot, variant, settings, extension-state commands and queries | mutations use expected version/CAS plus idempotency receipt; conflicts return current version without partial writes |
| admission | submit immutable root task or atomic graph; inspect/cancel/retry | admission pins all inputs and capability digests in one transaction |
| worker lifecycle | register/advertise/ready/heartbeat/drain/shutdown | runtime validates actor, protocol, capability digests, resources, token, and epoch |
| attempts | claim/start/heartbeat/control/settle/fail/abandon | every mutation is fenced by coordinator epoch, task, attempt, lease, and status version |
| child work | request child from active parent attempt | runtime validates lease, allowlist, depth, fan-out, dependencies, and idempotency, then inserts durably |
| objects/media | stage/hash/publish/register/fetch/verify/reachability/collect | no database row may reference unverified bytes; arbitrary paths never cross the worker boundary |
| events/progress | durable cursor reads plus reconnectable non-authoritative progress | durable state is truth; reconnect resumes from cursor and may discard duplicate progress |

### 8.1 Admission and execution state machine

1. A client submits one canonical root task or atomic graph with an idempotency key and expected creative-state versions.
2. In one transaction, the runtime validates authorization/dependencies, resolves and pins immutable inputs, records the capability digest and protocol version, inserts tasks, appends events, and returns a stable receipt.
3. A compatible registered worker claims a ready task and receives an attempt, lease, coordinator epoch, status version, and immutable admitted snapshot.
4. Start, heartbeat, progress control, cancellation observation, child requests, settlement, and failure all present the same fence. A stale epoch, lease, attempt, or version is rejected without mutation.
5. Lease expiry makes the attempt abandoned and allows policy-controlled retry; a late worker cannot settle it. Cancellation races resolve through the stored status version and a documented transition table.

Task states are `blocked`, `ready`, `claimed`, `running`, `cancel_requested`, `succeeded`, `failed`, and `cancelled`. Attempt states are `claimed`, `running`, `succeeded`, `failed`, `cancelled`, and `abandoned`.

- Dependencies resolving transitions `blocked → ready` transactionally.
- Claim transitions `ready → claimed` and creates one `claimed` attempt/lease.
- Start transitions both task and attempt to `running`.
- Cancel on `blocked` or `ready` transitions directly to `cancelled`; cancel on `claimed` or `running` transitions the task to `cancel_requested`, after which settlement is rejected and worker acknowledgement/lease expiry terminates it as `cancelled`.
- Attempt failure or lease expiry makes the attempt `failed` or `abandoned`; the task returns to `ready` only when retry policy allows, otherwise becomes `failed`.
- Settlement transitions task and attempt to `succeeded` in the same transaction.
- Manual retry is a versioned command from `failed` or `cancelled` back to `ready`; it never resurrects an old attempt or lease.
- Claim-vs-claim, start-vs-cancel, heartbeat-vs-expiry, settle-vs-cancel, fail-vs-retry, and child-admission-vs-parent-cancel each have exactly one transactional winner. Losing operations return the relevant stale/fence/terminal error without side effects.
- Runtime restart increments coordinator epoch, invalidates old worker sessions, abandons their active attempts, applies retry policy, and emits recovery events before accepting new claims.

### 8.2 Output publication and settlement

The runtime-owned sequence is `stage → hash/verify → publish unreachable object → transactional settlement → reachable`. Settlement revalidates the full attempt fence, registers object/media/output/generation/provenance relationships, advances task/run state, and appends the event and idempotency receipt atomically.

- Crash before publication: discard or expire staging.
- Crash after publication but before settlement: object remains unreferenced and becomes garbage-collectable after a grace period.
- Crash after settlement: committed reachability and receipt make retry idempotent.
- Backup is a consistent SQLite snapshot plus every reachable managed object; restore verifies schema, hashes, identity, and event heads before activation.

### 8.3 Identity and compatibility handshake

Local bootstrap creates distinct scoped actors and expiring credentials for Reigh, Astrid, each worker, and the supervisor. Loopback transport is not authorization. Connection handshake returns protocol version, schema version, realm identity, actor/scopes, coordinator epoch, and capability-catalog version. Incompatible clients or workers fail before mutations or claims.

## 9. Delivery order and hard gates

1. **Boundary and census.** Fix the neutral repository/package ownership, then complete file-authority, bridge-route, client-operation, and task-family inventories.
2. **Independent runtime extraction.** Move/generalize the kernel, schema, migrations, object store, and bridge into the neutral release; prove it starts and passes conformance without Astrid, Reigh, or Reigh Worker installed, using only generated clients and a protocol-only fake worker with no source-checkout imports.
3. **Proper bridge + database kernel.** Complete the authority API and missing tables/services; prove CRUD, media transfer, tasks, events, history, and backup without project directories.
4. **Independent fake clients.** Generated Python and TypeScript clients plus a fake worker each pass the neutral runtime conformance suite independently.
5. **Parallel client cutovers.** Run three parallel workstreams after gate 4:
   - Reigh Worker claims, heartbeats, materializes, executes, stages, settles, fails, cancels, and recovers without Supabase or database access;
   - Astrid agent and CLI operations use the neutral Python client, and path-dependent capabilities use attempt materialization;
   - Reigh completes projects, galleries, shots, variants, timelines, settings, tasks, progress, media, and extensions through the neutral TypeScript client with zero Supabase traffic.
6. **Fake composed stack.** Supervisor + neutral runtime + the three cut-over clients settle work through the same protocol and survive restart.
7. **Real local parity.** Image, travel/video, and render capabilities pass golden, browser, and recovery gates.
8. **Offline migration and deletion.** Convert representative and adversarial workspaces, then remove file authorities, old route names, all compatibility code, obsolete Supabase-local control paths, and the migrator from normal startup/import graphs.
9. **Frozen local release.** Run the full browser, failure, backup, restore, cleanup, offline, and filesystem-shape acceptance suite.

No later stage may paper over a failed earlier gate with a fallback path.

## 10. Definition of done

With networking disabled except loopback, a fresh user can:

1. start the stack once;
2. create a project and timeline in Reigh;
3. import media;
4. generate an image locally;
5. create variants and a shot;
6. edit the shot-scoped and project timelines;
7. generate a travel video locally;
8. render and play an export with audio;
9. inspect and submit work from Astrid against the same state;
10. cancel, retry, and recover from a killed worker;
11. restart all processes with state intact;
12. back up, restore, and clean the workspace;
13. observe no Supabase, Turso, hosted-service, RunPod, or cloud-GPU request;
14. inspect a workspace filesystem containing only SQLite, content-addressed objects, and active staging.

The same acceptance suite must also start the neutral runtime, exercise workspace CRUD/tasks/media/backup through generated clients and a protocol-only fake worker, and shut it down successfully with Astrid, Reigh, and Reigh Worker absent. This independence gate is blocking, not aspirational.

## 11. Future-placement seams fixed in local v1

Local v1 implements only SQLite, local objects, loopback transport, and local identity, but freezes these neutral seams:

- `WorkspaceStore`: transactional structured state, migrations, locks, version checks, and primary-only scheduling operations;
- `ObjectStore`: stage, publish, authorize, fetch, verify, enumerate reachability, and collect;
- `IdentityProvider`: actors, scoped tokens, roles, and expiry;
- `RuntimeClock`: lease and deadline authority controlled by the runtime;
- `EventDelivery`: durable event reads plus non-authoritative progress notification;
- `CapabilityCatalog`: immutable definitions/digests and executor availability;
- language-neutral protocol schemas with generated Python and TypeScript clients.

No Turso, S3/R2, relay, or remote-worker adapter is implemented in this release. The local implementations must nevertheless pass contract tests that a later placement must satisfy, and scheduling code must never assume that a client can open the store directly.

## 12. Repository-grounding ledger

Successive Luna audits populated this ledger. Each row names the current seam, target disposition, and evidence. The architectural decisions and dependency order are frozen for handoff; Gate 1 turns them into reviewed DDL, OpenAPI, generated-client, conformance, and release-manifest artifacts before any client cutover begins.

### 12.1 Astrid and neutral-runtime extraction

| Current seam and evidence | Disposition | Required proof |
|---|---|---|
| SQLite open/writer/UoW/ownership in `Astrid-live-main/astrid/core/store/database.py:1-105`, `writer.py:471-623`, `ownership.py:72-131` | move/generalize into neutral runtime | clean-room daemon owns lock/migrations with Astrid absent; static product-import ban |
| repositories for projects/tasks/runs/media/evidence/events plus migrations, receipts, hash-chained events | move/generalize | generated clients pass CRUD/idempotency/event conformance without repository imports |
| CAS/import/resolution in `astrid/core/io/cas.py:1-83`; backup/restore in `astrid/core/backup/operations.py` | move/generalize; delete project-file materialization | object crash matrix, reachable-object backup/restore, hash verification, GC |
| Astrid SDK composes database/application directly in `astrid/sdk/client.py:46-103` and `astrid/application.py:309-446` | replace with generated Python protocol client | Astrid source checkout absent from runtime test; Astrid receives no SQLite path |
| bridge route surface in `astrid/core/integrations/reigh/local_bridge_server.py:83-118` | replace atomically with neutral versioned protocol; no aliases | all known clients cut over together; old routes return absent, not translated |
| `local_bridge.py:317-365,486-566,856-953,1042-1056` reads/writes timelines, registries, `sources.json`, and source paths | delete from shipped graph after offline import | negative tests prove normal commands cannot discover, read, write, or repair from those files |
| `project/project.py:54-126`, `project/workspace.py:1-85`, `project/source.py:18-106`, `project/run.py:185-321`, timeline paths/event log, and experiment `review.state.json` | import into concrete SQLite tables/CAS, then delete authorities | adversarial migration parity, interruption recovery, filesystem-shape assertion |
| capability packs, model/setup catalogs, generation/render logic, skill/harness adapters | retain in Astrid executors | attempt-local materialization only; all durable settlement through protocol |

### 12.2 Reigh Worker and execution

| Current seam and evidence | Disposition | Required proof |
|---|---|---|
| `reigh-worker/source/runtime/worker/server.py:47-104,829-1033` initializes Supabase and uses it for polling/status/shutdown | replace with endpoint/realm/token protocol client; remove Supabase dependency from local package | worker clean-room tests run without Supabase/PostgREST installed |
| claim/status/completion in `source/core/db/task_claim.py:338+`, `task_status.py:101-677`, `task_completion.py:24-129` use Edge Functions/storage | delete and replace with register/claim/start/heartbeat/control/stage/settle operations | exactly-one claim; retry/cancel/lease/stale-completion failure matrix |
| dependency/child code in `task_dependencies.py:25-464` and travel orchestration around `travel/orchestrator.py:2252-2388` owns fan-out and cancellation | retain algorithms, move durable admission/dependencies/cancellation to runtime | idempotent child admission; canceled/stale parent cannot create children |
| model/workflow handlers and registry in `task_types.py`, `dispatch_manifest.py`, `task_registry.py`, `task_execution.py`, `task_conversion.py` | retain as execution pack | golden coverage for every admitted task family and unsupported-capability rejection |
| output paths and local HTTP materializer return paths/upload to Supabase | retain staging hygiene; replace with authorized object handles and runtime settlement | digest/MIME/size/provenance checks; no path crossing protocol; orphan cleanup |
| preflight, guardian, heartbeat, idle release, fatal handler | adapt to runtime-owned worker registration/session/epoch/readiness/drain | two workers have unique identities; restart rejects old session mutations |
| `reigh-worker-orchestrator` Supabase/RunPod control plane | exclude from local-v1; later split capacity supervision from runtime authority | local stack has no orchestrator import/process/network dependency |

The present worker test suite is not yet a neutral baseline: without the locked environment it fails collection because `source` is not importable, and with `PYTHONPATH=.` it still requires missing `postgrest`. Local-v1 protocol tests must be split into a dependency-light suite before implementation claims can be accepted.

### 12.3 Reigh and supervisor

| Current seam and evidence | Disposition | Required proof |
|---|---|---|
| `scripts/dev-editor.mjs:3-45` starts an in-memory bridge stub; real bridge reports owner `astrid serve` and embeds render execution | replace with independently installed neutral daemon plus separate worker | production-like local startup uses real SQLite/CAS; no stub in acceptance path |
| typed clients in `reigh-live-main/src/integrations/astrid/{client,projectRoutes,timelineRoutes,mediaRoutes,galleryRoutes,taskRoutes}.ts` | retain semantics, regenerate/rename as neutral client | route/schema conformance; no Astrid-named public URL or type remains |
| `/api/astrid` transport and Vite proxy to `127.0.0.1:17333` | replace with runtime discovery/session transport; delete old proxy alias | runtime-down/version mismatch is actionable; old URL absent |
| `dataAuthority.ts:12-37` permits `supabase-deferred`; full `AppProviders` mounts cloud providers in local mode | remove from local-v1 build graph, not merely disable at runtime | static bundle/import and network-capture gates show no Supabase/Auth/credits/Edge Function code or traffic |
| project/timeline/gallery/generation/task/media semantics already exist; settings and extension events remain incomplete/legacy | preserve semantics through typed runtime tables/commands | browser acceptance across persistence, conflicts, variants, shot/project timelines, extensions, playback/export |
| current product-specific startup/doctor/install paths | replace with independent runtime artifact and shared discovery; optional supervisor remains non-authoritative | Astrid-only, Reigh-only, runtime-only, worker-only, and full-stack install/reuse/update/uninstall tests |
