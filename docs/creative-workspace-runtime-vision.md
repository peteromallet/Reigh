# Banodoco Workspace Runtime: Long-Term Product and Architecture Vision

**Status:** Long-term direction; local-v1 execution is specified separately  
**Date:** 2026-08-28  
**Scope:** Astrid, Reigh, GPU workers, local/cloud deployment, SQLite/Turso, media, and task execution

**Working name:** Banodoco Workspace Runtime; naming may change, ownership may not  
**Companion plan:** [SQLite-Only Local Runtime Plan](./sqlite-only-local-runtime-plan.md)

## 1. Executive thesis

Astrid and Reigh should be independently useful products built on one neutral foundation:

- **Astrid** is the agent experience and intelligent orchestration layer.
- **Reigh** is the visual creative interface.
- **Banodoco Workspace Runtime** is the neutral, independently owned workspace and task control plane.
- **Workers** are replaceable capability-based execution engines.
- **Runtime Supervisor / Connector** starts and connects local components but owns no creative data.

The database and task queue do not belong to Astrid or Reigh conceptually or physically. They belong to the independently versioned Banodoco Workspace Runtime, which both products connect to as peer clients. All durable structured workspace state belongs in that database. Large immutable bytes belong in an object store referenced by database identity. Project directories, JSON sidecars, Markdown notes, run folders, and event-log files must not form parallel authorities.

The immediate goal is to ship the proper neutral architecture on one machine: one Banodoco Workspace Runtime backed by SQLite and a local content-addressed object store; Reigh, Astrid, and Reigh Worker as peer protocol clients; and a local GPU executor. Proven kernel code currently inside Astrid should be extracted and generalized into the neutral runtime rather than making Astrid the runtime's temporary owner. Turso, remote workers, and hosted connectors follow as new placements of the same contracts—not as a rewrite of the local system.

The cutover is intentionally absolute. A one-time offline importer may understand the old world, but the released runtime and clients do not: no shims, legacy aliases, dual-write, fallback reads, backend-selection mode, schema compatibility views, or silent translation of old payloads. Installed products upgrade together to the versioned neutral protocol or fail closed.

## 2. The product vision

### 2.1 Astrid

Astrid is the agent tool people talk to or invoke programmatically. It should work independently as:

- A local CLI and agent runtime.
- A desktop or background agent.
- A headless automation system.
- A cloud-hosted personal agent.
- An orchestration layer embedded in another creative product.

Astrid discovers capabilities, understands workspace state, converts intent into operations or task graphs, and explains or supervises the resulting work. It may submit GPU tasks, CPU tasks, agent tasks, renders, analysis jobs, or third-party provider tasks through the runtime.

Astrid is not required for every operation. A visual client or API caller must also be able to submit valid typed tasks directly.

### 2.2 Reigh

Reigh is the visual creative application. It should also work independently:

- Fully local through a neutral local runtime backed by SQLite, a local object store, and local processing.
- Local UI with cloud processing.
- Hosted UI with a cloud workspace and shared processing.
- Hosted UI connected securely to a user's local workspace and GPU.
- Alongside Astrid, sharing exactly the same workspace authority.

Reigh translates direct manipulation into commands: save a timeline, generate an image, travel between images, render a video, apply an extension, or inspect a generation. Reigh should not need to know whether the underlying database is a local file or Turso, or whether execution is local, RunPod, or another provider.

### 2.3 Banodoco Workspace Runtime

The runtime is an independent product-neutral foundation, package, protocol, and daemon. It owns the durable meaning and lifecycle of creative work:

- Projects, shots, timelines, versions, and extensions.
- Media identity, locations, hashes, variants, and provenance.
- Runs, tasks, attempts, dependencies, leases, retries, and cancellation.
- Generation records and the relationship between inputs and outputs.
- Capability declarations and availability.
- Human, agent, service, and worker actor identity.
- Idempotency, receipts, audit history, recovery, and migrations.

The runtime exposes commands and queries through a stable, language-neutral API. Clients never require raw database access. Its package and schema must not import or require Astrid agent concepts, Reigh UI concepts, or worker implementation concepts. It must start, operate, migrate, back up, restore, and pass conformance tests without any of those products installed.

The local-v1 schema contains concrete runtime-owned tables and namespaces for every required shared and product domain. It uses one neutral migration stream and does not introduce a generic schema-pack/plugin mechanism merely to preserve current package ownership; such an extension mechanism is deferred until a second real independent extension demonstrates the contract. The runtime stores and pins neutral capability definitions and executor availability, while executable capability packages remain outside it.

### 2.4 Workers

Workers execute capabilities. Examples include:

- WGP / Wan2GP generation.
- VibeComfy / ComfyUI workflows.
- FFmpeg and Remotion rendering.
- Transcription, analysis, or enhancement.
- RunPod or another remote GPU provider.

A worker advertises its capabilities and resources, claims a compatible task, heartbeats while running, and returns verified output bytes. It does not own project meaning, mutate the database directly, or maintain a second authoritative queue.

### 2.5 Runtime Supervisor and Connector

A thin operational component should:

- Start the local runtime.
- Wait for readiness and migrations.
- Mint or load scoped local credentials.
- Start configured local workers.
- Optionally start the local Reigh server.
- Optionally maintain an outbound connection to a hosted Reigh relay.
- Report health and shut components down in the correct order.

It owns processes and connectivity, not projects, tasks, or media.

### 2.6 Installation independence

The runtime is an independently released dependency, not something a user must understand or install manually before using Astrid or Reigh. Each product installer performs the same neutral discovery and exact-version handshake: reuse one compatible runtime if present; otherwise install and start the independently signed runtime artifact. Installing a dependency does not transfer ownership of its source, daemon, database, CAS, schema, migrations, or data lifecycle.

An Astrid-first and a Reigh-first installation converge on the same runtime and realm. Worker-only installations receive endpoint/realm/scoped registration credentials and never install a database owner. Product uninstall preserves shared realm data; explicit runtime data purge is a separate destructive operation. Releases upgrade as one digest-pinned set with pre-migration backup and fail closed on version mismatch—there is no mixed-version compatibility window or translation layer.

## 3. Architectural model

```text
                              Experiences
                  ┌────────────────┴────────────────┐
                  │                                 │
             Astrid Agent                        Reigh
        chat / CLI / automation          visual editor / gallery
        planning / orchestration          direct manipulation
                  │                                 │
                  └──────── Command/Query API ──────┘
                                    │
                                    ▼
                       Banodoco Workspace Runtime
        ┌──────────────────────────────────────────────────┐
        │ Workspace kernel                                 │
        │ Task graph, claims, leases, retries, receipts    │
        │ Capability registry and admission                │
        │ Media identity, generations, and provenance      │
        │ Identity, policy, events, and recovery            │
        └─────────────────┬──────────────────┬─────────────┘
                          │                  │
                    Metadata store      Artifact store
                   SQLite / Turso      Local CAS / S3 / R2
                          │                  │
                          └────────┬─────────┘
                                   ▼
                           Execution fabric
                 Local workers / RunPod / shared cloud
```

This separates four concerns:

1. **Experience plane:** Astrid and Reigh.
2. **Control plane:** workspace authority and task lifecycle.
3. **Data plane:** metadata database and artifact storage.
4. **Execution plane:** workers and providers.

## 4. Why the database and queue belong to the runtime

The database contains facts required by both Astrid and Reigh. Assigning it to either product would make the other an accidental dependent.

The queue is not fundamentally separate from those facts. A durable task row plus dependency, availability, priority, attempt, and lease state is the local queue. A separate broker can be introduced later for wakeups or high throughput, but it must not become a second semantic authority.

The runtime therefore owns:

- Task admission and canonical specification.
- Which task is ready.
- Which worker owns the current attempt.
- Whether a completion wins its lease/version fence.
- How verified outputs become media and generations.

Workers and clients interact through the runtime API. They do not open SQLite or receive broad Turso credentials.

## 5. Storage model

### 5.1 One structured authority

SQLite or Turso stores every durable structured workspace fact, including project notes, settings, timelines, shots, generations, runs, task state, attempts, events, experiment state, provenance, extension selection, and references. JSON and Markdown may remain useful representations inside typed columns, but they are values in the database rather than independently writable files.

```text
Structured authority:
  SQLite locally / Turso in a future cloud placement

Immutable byte authority:
  local content-addressed objects / future cloud objects
```

The runtime depends on two explicit abstractions:

- `WorkspaceStore`: all durable structured state and transactional meaning.
- `ObjectStore`: large immutable bytes addressed by digest and authorized through workspace records.

The following are not live workspace data formats:

- project directories;
- `project.json`, `plan.md`, `run.json`, or `events.jsonl`;
- timeline or asset-registry JSON sidecars;
- source folders and source manifests;
- experiment, review, or conclusion folders;
- capability-produced manifests retained as untracked authority.

They may exist only as explicit imports, exports, backups, software installation files, or temporary attempt-local materializations. The normal runtime never scans them to discover state, never falls back to them, never repairs the database from them, and never dual-writes them.

### 5.2 Local workspace layout

```text
<workspace>/
  workspace.sqlite3
  workspace.sqlite3-wal
  workspace.sqlite3-shm
  objects/sha256/<shards>/<digest>
  staging/<active-attempt-id>/
```

Model weights, application code, ComfyUI installations, rebuildable caches, and logs are installation/runtime data outside the creative workspace. Backups and user exports are explicit boundary artifacts, not live authority.

### 5.3 Local mode

- One local runtime owns the SQLite writer.
- All durable structured state lives in SQLite.
- Every usable local-v1 media byte is imported into and hash-verified in the runtime-owned content-addressed object store. A source path exists only during import and is never persisted as runnable authority.
- Local workers communicate over loopback HTTP or an equivalent local transport.
- Workers receive media and timeline identities, materialize paths only inside an attempt sandbox, and settle verified outputs back through the runtime.
- The system can operate without internet access when the required models are present.

### 5.4 Cloud mode

- One runtime service is the active workspace coordinator.
- The workspace maps to a scoped Turso database.
- Large artifacts live in S3/R2-compatible object storage.
- Workers use task-scoped runtime credentials, not database credentials.

Turso's current Platform API explicitly supports isolated database-per-user or database-per-agent deployments and scoped tokens. Its current guidance recommends Turso Sync rather than legacy embedded replicas for new true local-first read/write systems:

- <https://docs.turso.tech/api-reference/introduction>
- <https://docs.turso.tech/sync/usage>
- <https://docs.turso.tech/sdk/authorization>

### 5.5 Tenancy boundary

The durable isolation boundary should be a **workspace realm**, not necessarily one human user:

- A personal account can have a personal realm.
- A team can share a team realm.
- A production or sensitive project can use a separate realm.

Each realm can map to its own SQLite/Turso database and artifact namespace. The schema should not assume a realm can only ever have one human owner.

## 6. Scheduling authority and split-brain prevention

Local-first database synchronization does not automatically make distributed scheduling safe. Concurrent database writes are not equivalent to one coherent lease authority.

Each workspace realm should have exactly one active coordinator epoch:

```text
Local mode:   local runtime owns scheduling
Cloud mode:   cloud runtime owns scheduling
Hybrid mode:  one runtime is active; others are clients/caches
Handoff:      drain old coordinator → advance epoch → activate new coordinator
```

Workers claim through the active runtime endpoint. They never claim by independently reading a synchronized database replica. Attempt and completion fences should include coordinator epoch, attempt identity, lease identity, and status version.

This rule is essential for supporting arbitrary local/cloud combinations without duplicate execution or split-brain publication.

## 7. Capability and task specification

Tasks should request versioned capabilities rather than hard-code machines or providers. Example identifiers:

```text
banodoco.video.travel@2
banodoco.image.generate@3
openai.audio.transcribe@1
runway.video.generate@1
```

A capability declaration should include:

- Stable ID and semantic version.
- Input and output schemas.
- Human description and agent-facing semantics.
- Optional client-neutral presentation metadata; Reigh-specific UI behavior remains in Reigh.
- Resource requirements and execution environments.
- Permission and network requirements.
- Retry, timeout, cancellation, and determinism policy.
- Provenance requirements.
- Whether child tasks are allowed.
- An allowlist of child capabilities and maximum graph depth/fan-out.
- Immutable definition digests and mismatch-rejection rules; the runtime performs no payload translation.

Astrid can inspect this registry to plan. Reigh can use it to drive controls. Workers advertise the capability versions they implement. The runtime performs admission and matching.

### Worker-created child tasks

A worker may request child work only through a fenced parent attempt:

```text
parent attempt → child-task request → runtime validation → durable child task
```

The runtime checks the parent lease, idempotency key, allowed child capability, depth, fan-out, resource policy, and dependency graph. A worker never inserts a child row directly.

## 8. Deployment combinations the architecture must support

| User configuration | Active runtime | Metadata | Artifacts | Execution |
|---|---|---|---|---|
| Astrid entirely local | Local | SQLite | Local CAS | Local CPU/GPU |
| Astrid cloud-only | Cloud | Turso | Cloud objects | Shared GPU/RunPod |
| Reigh entirely local | Local | SQLite | Local CAS | Local worker |
| Reigh cloud-only | Cloud | Turso | Cloud objects | Shared cloud |
| Reigh local, cloud GPU | Local or cloud, explicitly selected | SQLite or Turso | Hybrid | RunPod |
| Reigh hosted, local files/GPU | Local via outbound connector | SQLite | Local CAS | Local worker |
| Astrid + Reigh local | One shared local runtime | SQLite | Local CAS | Local/cloud |
| Astrid + Reigh cloud | One shared cloud runtime | Turso | Cloud objects | Shared cloud/RunPod |

The command, query, worker, and artifact contracts should remain the same across these modes.

## 9. Current implementation reality and extraction seam

The current repositories already contain much of the local control-plane foundation, but it is placed inside Astrid and exposed to Reigh as an Astrid integration. That is implementation source material, not the target ownership boundary:

- Astrid currently contains a repository-backed SQLite kernel and single-writer composition that should be extracted into the neutral runtime.
- The current Astrid bridge exposes task admission, capability-aware claims, heartbeats, failure, cancellation, and fenced multipart completion; those routes should become the versioned Banodoco Workspace protocol.
- Bridge media routes can serve project-scoped, hash-verified content.
- Astrid contains WGP and VibeComfy task-handler bindings.
- Astrid contains a general execution service with staged output validation and atomic completion.
- Astrid's serve composition currently demonstrates usable process and worker patterns, but the neutral runtime must not depend on Astrid to start.
- Reigh can consume project, timeline, gallery, generation, and task state through an Astrid-named proxy that should become a neutral workspace client/proxy.

The current Reigh Worker remains materially coupled to Supabase:

- Its database runtime is hard-coded to Supabase despite accepting a `--db-type` flag.
- Claims use Supabase Edge Functions.
- Status, completion, storage upload, retries, and some child orchestration assume Supabase.
- Its local mode adds local file ingress but does not replace the queue authority.
- RunPod orchestration injects Supabase credentials and derives scaling state from Supabase.

The missing composition seam is an independently owned runtime repository/package and protocol, extracted from the reusable kernel pieces without importing Astrid product concepts. On top of that boundary, the local release needs a general executor using the neutral worker protocol and an explicit capability-parity map for functionality that still exists only in Reigh Worker.

## 10. Local-first implementation seam

The first implementation slice is specified in the companion [SQLite-Only Local Runtime Plan](./sqlite-only-local-runtime-plan.md). Its release boundary is deliberately narrower than this vision:

- one local runtime process is the only SQLite writer;
- Reigh, Astrid, and Reigh Worker are peer clients of the independently owned runtime contract;
- every durable structured workspace concept is migrated into SQLite;
- immutable large bytes are settled into the local object store;
- the worker executes at least real image generation, travel/video generation, and rendering on local compute;
- no Supabase, Turso, hosted relay, RunPod, cloud GPU, or filesystem compatibility path participates;
- the normal runtime contains no legacy fallback or dual-write behavior after the one-time offline migration.

That plan has been ground-truthed through successive repository audits and now carries the handoff-ready work breakdown, dependency order, deletions, migration rules, and acceptance gates. Its first execution gate creates and reviews the concrete DDL, OpenAPI, generated clients, conformance suite, and release manifest before product cutover begins. This vision remains the durable destination; the companion document is the current delivery blueprint.

## 11. Why this is the shortest faithful path

This path reuses the strongest existing assets without preserving their current ownership:

- Astrid contains proven SQLite authority and task-protocol code that can seed the neutral runtime.
- Reigh already has bridge-backed visual surfaces.
- WGP and VibeComfy bindings already exist inside Astrid.
- Reigh Worker already contains mature compute behavior that can be extracted or adapted.

It avoids four expensive traps:

1. Rebuilding the local queue in Reigh Worker.
2. Making Reigh or Astrid directly depend on Turso before the runtime contract is stable.
3. Moving SQLite between machines or exposing it to RunPod.
4. Letting repository convenience blur the independently released daemon and protocol boundary.

The local release validates the same command and worker protocols needed by the cloud system. Cloud deployment then becomes a placement, storage, identity, and transport extension—not a new creative model.

## 12. Long-term evolution

### 12.1 Independent boundary from the first release

The runtime is conceptually and physically independent from the first release. Local v1 creates a sibling neutral repository and release artifact named `banodoco-workspace-runtime` (working product name), with its own schema migrations, OpenAPI/JSON Schema protocol specification, generated clients, conformance suite, release version, and daemon entry point. Existing code may be moved from Astrid, but Astrid must consume the result through generated protocol clients rather than remain its owner or import its storage internals.

```text
Astrid ─────► Generated runtime client ─► daemon
Reigh ──────► Runtime API/client
Workers ────► Worker protocol

Runtime ─X─► Astrid agent layer
Runtime ─X─► Reigh UI
Runtime ─X─► Reigh Worker implementation
```

The release must prove independence by starting the runtime, creating and editing workspace state, executing tasks through a protocol-only fake worker, backing up, and restoring without Astrid, Reigh, or Reigh Worker installed. Astrid-only and Reigh-only distributions may declare, install, discover, and launch the independently versioned runtime dependency, but neither may absorb its source, schema, database path, migrations, or daemon lifecycle authority. When both products are installed, they discover and reuse one compatible runtime rather than installing competing copies.

### 12.2 Cloud workspace runtime

Add:

- Turso workspace-store adapter.
- Cloud artifact-store adapter.
- Per-realm identity and token provisioning.
- Runtime event delivery suitable for hosted clients.
- Backups, migration orchestration, quotas, and observability.

### 12.3 Hosted Reigh with local resources

A hosted browser should connect through a same-origin relay to an outbound local connector. The connector authenticates the device and proxies only the runtime API/media operations allowed for that workspace. The laptop should not expose a raw unauthenticated bridge port.

### 12.4 RunPod and shared cloud execution

RunPod workers receive:

- Runtime relay URL.
- Short-lived executor identity.
- Allowed capabilities and resource profile.
- One claimed task at a time or a bounded concurrency lease.

They fetch task-scoped media, heartbeat, and upload verified outputs. They never receive the SQLite file, broad Turso credentials, or authority to mutate arbitrary workspace records.

Autoscaling reads queue summaries and executor registration from the runtime. It owns placement only.

## 13. Security and reliability invariants

1. One active coordinator epoch per workspace realm.
2. No worker or UI direct database access.
3. No remote mounting or copying of the live SQLite database.
4. Scoped, expiring worker and connector credentials.
5. Every mutation idempotent and actor-attributed.
6. Every completion fenced by attempt, lease, version, and coordinator epoch.
7. Every published artifact hash-verified and project-scoped.
8. Secrets live outside ordinary project/task payloads.
9. Child task creation is capability-allowlisted and bounded.
10. Local-only mode makes no accidental cloud calls.
11. Offline/local work never silently merges conflicting scheduler authority.
12. Migrations use pre-migration backup, validation, and explicit restore-based rollback; they do not preserve old runtime behavior through compatibility code.

## 14. Decisions recommended now

1. Adopt the independently owned Banodoco Workspace Runtime boundary.
2. Treat Astrid and Reigh as peer clients of that runtime.
3. Extract reusable kernel/bridge code from Astrid into the neutral runtime now; do not use Astrid as its temporary architectural home.
4. Keep the task queue transactionally backed by runtime task state for the local release.
5. Keep SQLite as the first store and make storage an adapter boundary.
6. Make the neutral Banodoco Workspace API the only worker/client authority boundary.
7. Build the general local executor and supervisor before Turso or RunPod work.
8. Move task-graph orchestration out of workers and into the runtime.
9. Put all durable structured workspace state in the workspace database and only immutable large bytes in the object store.
10. Define coordinator epochs before introducing synchronized local/cloud writers.
11. Permit no filesystem authority, fallback, repair, or dual-write path after the one-time offline migration.

## 15. Open questions and uncertainties

### Product and naming

- Should the neutral layer be called Creative Workspace Runtime, Banodoco Runtime, Astrid Runtime, or something else?
- Should a Reigh-only user know that a shared runtime exists, or should it remain an implementation detail?
- Is the primary isolation unit a user, workspace, team, or project?

### Packaging and ownership

- The independent repository/release boundary and language-neutral protocol are frozen for local v1; finalize the public product name, artifact names, signing, and release channel.
- Which system package, Python, Node, and desktop distribution mechanisms should carry the runtime on macOS, Linux, and later Windows without creating private product-owned copies?
- What machine registry/socket/config mechanism lets Astrid and Reigh discover one compatible runtime and prevents duplicate owners for a realm?
- Local-v1 has no mixed-version compatibility window; finalize the coordinated release cadence and artifact-signing process.
- How should uninstall preserve shared workspaces and a runtime still used by another installed product?

### Database and synchronization

- Does current Turso Sync preserve every transaction, locking, migration, and durability property the kernel depends on?
- What conflict policy applies to creative edits when local and cloud copies both change?
- Can the same data model support offline edits while preserving one active scheduling coordinator?
- What is the exact coordinator handoff and disaster-recovery protocol?
- Is one database per realm operationally and economically preferable to one database per user with realm partitioning?

### Task and capability model

- Should task capability versions use semantic versions, immutable definition digests, or both?
- Which policies belong in a capability declaration versus runtime configuration?
- Can third-party capability packages be trusted in-process, or must they execute out of process?
- Which existing Reigh Worker task handlers contain hidden Supabase or child-task coupling?
- What is the minimum parity set required for the first local release?

### Media

- What is the canonical local/cloud content-addressed layout?
- When should local media be uploaded for cloud execution?
- What explicit import UX best communicates that selected user files are copied into managed CAS?
- What retention, garbage collection, and quota rules protect reproducibility?

### Security and identity

- What signs worker, connector, user, and agent identities?
- How are worker tokens scoped to task, capability, workspace, and time?
- How does a hosted Reigh session authorize an outbound local connector without exposing the whole machine?
- How are untrusted third-party tasks sandboxed and network-restricted?

### Operations

- Is a database-backed queue sufficient for expected cloud throughput, with a broker used only for wakeups?
- What observable signals drive RunPod autoscaling without becoming a second authority?
- What are the supported shutdown, drain, upgrade, rollback, and stuck-task procedures?
- How does the runtime behave under disk-full, lost network, expired credentials, corrupt media, or incompatible worker versions?

## 16. Questions for an oracle review

The oracle should review the vision adversarially and answer these questions with explicit reasoning and evidence from the current repositories where possible:

1. **Boundary conformance:** Does the proposed first release make the Banodoco Workspace Runtime actually independent, or does any schema, package, startup, or protocol seam still make it Astrid-, Reigh-, or worker-owned?
2. **Extraction path:** Which existing Astrid kernel and bridge modules can move into the neutral runtime unchanged, which require generalization, and which are product-specific and must stay behind?
3. **Control-plane ownership:** Produce an exact move/retain/delete map across the neutral runtime, Astrid, Reigh, and Reigh Worker.
4. **Queue design:** Is the transactional task table adequate as the semantic queue locally and in the first cloud deployment? If a broker is needed, how does it remain a non-authoritative wakeup layer?
5. **Split brain:** Is the proposed active coordinator epoch sufficient for local/cloud sync and failover? Specify the exact claim, handoff, and stale-completion fences.
6. **Turso feasibility:** Audit the current kernel's SQLite usage against current Turso Database/Turso Sync behavior. Identify incompatible SQL, transaction, locking, migration, or concurrency assumptions.
7. **Tenancy:** Recommend database-per-user, database-per-realm, or a hybrid, including collaboration, backup, token scope, cost, and deletion consequences.
8. **Capability contract:** Propose the minimum complete capability schema and versioning model that supports agents, UI generation, local workers, third-party providers, and reproducible provenance.
9. **Worker reuse:** Identify which Reigh Worker compute paths are safely reusable behind the neutral worker protocol and which are too coupled to Supabase or worker-owned orchestration.
10. **Media architecture:** Recommend the local/cloud artifact contract, upload policy, caching, verification, retention, and garbage-collection model.
11. **Security:** Threat-model hosted Reigh → local connector, cloud runtime → RunPod, worker-created child tasks, and untrusted capability packages.
12. **Migration seam:** Define the safest sequence from the current repositories to the target without breaking the already-working local timeline/gallery/editor integration.
13. **Release scope:** State the smallest capability and user-journey set that makes the local release useful rather than merely architectural.
14. **Kill criteria:** Identify any proposed abstraction that is premature and should be explicitly deferred.
15. **Confidence:** List the experiments or code probes required to turn remaining architectural assumptions into evidence.

### Requested oracle output

Ask the oracle to return:

1. Verdict: endorse, revise, or reject the core boundary.
2. Top five architectural risks, ranked by severity and likelihood.
3. Concrete corrections to this document.
4. A current-code ownership map.
5. A capability-parity matrix.
6. A sequenced local-release plan with acceptance gates.
7. A cloud-evolution plan that does not contaminate the local critical path.
8. Explicit answers to all open decisions that block implementation.
9. A list of experiments needed before committing to Turso Sync or repository extraction.
10. Final confidence score and the evidence that would raise it.

## 17. Definition of strategic success

The direction is successful when:

- Astrid can operate independently with local or cloud workspace authority.
- Reigh can operate independently against the same runtime contracts.
- Using both provides one coherent workspace rather than synchronized product silos.
- Local SQLite/local GPU is the simplest supported deployment, not a test-only exception.
- Cloud Turso/shared GPU is a placement and storage configuration, not a different product architecture.
- Workers are replaceable and cannot become hidden authorities.
- Third parties can add versioned capabilities without modifying the core task model.
- Users can understand where their data and computation live and deliberately change those choices.
- Local-first, cloud-only, and hybrid modes have explicit authority, security, and failure semantics.

The foundational judgment is therefore:

> **Build one neutral creative workspace and execution runtime. Let Astrid be its intelligent agent interface, Reigh its visual interface, and workers its execution fabric. Ship the local composition first, then extend the same contracts to Turso, connectors, and RunPod.**
