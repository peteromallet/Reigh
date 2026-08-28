# Banodoco Workspace Runtime: Long-Term Product and Architecture Vision

**Status:** Long-term direction; local-v1 execution is specified separately
**Date:** 2026-08-28
**Scope revision:** 2026-08-29
**Scope:** Astrid, Reigh, GPU workers, local/cloud deployment, SQLite/Turso, media, and task execution

**Working name:** Banodoco Workspace Runtime; naming may change, ownership may not
**Canonical execution strategy:** [Local Workspace Runtime — Overall Strategy and Roadmap](./00-overall-strategy.md)

**Current sequencing note:** this document describes the long-term destination, not parallel delivery. The accepted order is Stage 1 Astrid, Stage 2 REIGH, then Stage 3 exhaustive hardening; the canonical strategy owns scope and timing.

## 1. Executive thesis

Astrid and Reigh should be independently useful products built on one neutral foundation:

- **Astrid** is the editable agent experience, planner, and source-authoring system for packs and skills.
- **Reigh** is the visual creative interface.
- **Banodoco Workspace Runtime** is the neutral, independently owned workspace control and data plane.
- **Executor workers** are replaceable execution engines for every durable capability, including CPU/GPU, Remotion/FFmpeg, agent/GPT, and configured-provider work.
- **Runtime Supervisor / Connector** starts and connects local components but owns no creative data.

The database and task queue do not belong to Astrid or Reigh conceptually or physically. They belong to the independently versioned Banodoco Workspace Runtime, which both products connect to as peer clients. All durable structured workspace state belongs in that database. Large immutable bytes belong in an object store referenced by database identity. Project directories, JSON sidecars, Markdown notes, run folders, and event-log files must not form parallel authorities.

The immediate goal is to ship the proper neutral architecture on one machine in stages: first Astrid from an editable checkout with registered executor workers, then Reigh and Reigh Worker as peer protocol clients. One Banodoco Workspace Runtime is backed by SQLite and a local content-addressed object store. Proven kernel code currently inside Astrid should be extracted and generalized into the neutral runtime rather than making Astrid the runtime's temporary owner. Turso, remote workers, and hosted connectors follow as new placements of the same contracts—not as a rewrite of the local system.

The cutover is intentionally absolute. A one-time offline importer may understand the old world, but the supported runtime and clients do not: no shims, legacy aliases, dual-write, fallback reads, backend-selection mode, schema compatibility views, or silent translation of old payloads. Active components use one compatible versioned protocol set or fail closed.

## 2. The product vision

### 2.1 Astrid

Astrid is the agent tool people talk to or invoke programmatically. It should work independently as:

- A local CLI and agent runtime.
- A desktop or background agent.
- A headless automation system.
- A cloud-hosted personal agent.
- An orchestration layer embedded in another creative product.

Astrid discovers capabilities, understands workspace state, converts intent into operations or task graphs, and explains or supervises the resulting work. Astrid plans and submits GPU, CPU, agent/GPT, render, analysis, and third-party-provider tasks; registered executor workers execute them.

Astrid's repository is also its open creative-engine source. Packs remain the authoring and discovery namespace for executors, orchestrators, and elements; skills and per-capability `STAGE.md` files remain the agent-facing operating layer. Local v1 removes legacy package-manager authority, not the ability to inspect, edit, add, validate, or run pack and skill source from an editable checkout.

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

The runtime is an independent product-neutral codebase, protocol, and daemon. It owns the durable meaning and lifecycle of creative work:

- Projects, shots, timelines, versions, and extensions.
- Media identity, locations, hashes, variants, and provenance.
- Runs, tasks, attempts, dependencies, leases, retries, and cancellation.
- Generation records and the relationship between inputs and outputs.
- Capability declarations and availability.
- Human, agent, service, and worker actor identity.
- Idempotency, receipts, audit history, recovery, and migrations.

The runtime exposes commands and queries through a stable, language-neutral API. Clients never require raw database access. Its source and schema must not import or require Astrid agent concepts, Reigh UI concepts, pack code, or worker implementation concepts. It must start, operate, migrate, back up, restore, and pass conformance tests with those product checkouts absent from its import path.

Local v1 gives concrete runtime-owned tables only to the shared semantics already needed by two clients: identity, realm/project, media, timelines/revisions, minimal shots/references, tasks/runs/attempts/events, capabilities, relations, evidence, receipts, and storage accounting. Theme/style, experiment, and review state begin as schema-validated, versioned documents linked through generic relations and evidence; they earn dedicated neutral operations only when independent clients need shared behavior that documents cannot express. Rich galleries, generation/variant UX, extension state, and richer composition are specified in Stage 2 rather than guessed in Stage 1. The runtime uses one neutral migration stream and does not introduce a generic schema-pack/plugin mechanism merely to preserve current package ownership. It stores and pins neutral capability definitions and executor availability, while executable Astrid pack source remains outside it.

### 2.4 Workers

Workers execute capabilities. Examples include:

- WGP / Wan2GP generation.
- VibeComfy / ComfyUI workflows.
- FFmpeg and Remotion rendering.
- Agent/GPT reasoning and tool work.
- Configured third-party provider calls.
- Transcription, analysis, or enhancement.
- RunPod or another remote GPU provider.

An executor worker advertises its capabilities and resources, claims a compatible task, heartbeats while running, and returns immutable typed outputs. Any durable state change is either a client-applied proposal or a predeclared settlement effect that the runtime validates and applies transactionally. A worker receives no general workspace-mutation credential: it does not own project meaning, mutate the database directly, or maintain a second authoritative queue.

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

### 2.6 Source and deployment independence

Local v1 runs Astrid from an explicit editable checkout. The neutral runtime runs from its own sibling checkout/environment and is something the bootstrap starts and discovers, not source that Astrid imports or owns. The beta proves independence with separate processes, separate import environments, generated clients, and runtime-only conformance—not with an installer or binary distribution. Compatibility has three layers: protocol/schema versions gate connections; each admitted task pins the implementing capability definition/source digest; whole-checkout commit, dirty state, and dependency-lock digests are recorded diagnostics and provenance, not a reason to reject an otherwise compatible connection.

An Astrid-first and a later Reigh-first composition converge on the same runtime and realm. Worker-only compositions receive endpoint/realm/scoped registration credentials and never become a database owner. Removing or relinking an application checkout preserves shared realm data; explicit runtime data purge is a separate destructive operation. Future installers and signed artifacts may automate the same boundary, but they are post-beta lifecycle work and must not change its ownership.

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
- legacy creative-project source folders and project-side state manifests;
- experiment, review, or conclusion folders;
- capability-produced manifests retained as untracked authority.

They may exist only as explicit imports, exports, backups, software installation files, or temporary attempt-local materializations. The normal runtime never scans them to discover state, never falls back to them, never repairs the database from them, and never dual-writes them.

This prohibition does not apply to Astrid's editable application source, pack manifests, executor/orchestrator/element components, `STAGE.md` files, or skills. Those are executable or guidance source outside the realm, never workspace authority.

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

For the single-user beta, the CAS is append-only. The runtime records object usage and active reservations, rejects work before predictable low-space failure, and permits only logical deletion of workspace references. Reachability-based collection, retention policy, orphan reclamation, and adversarial disk/corruption testing belong to Stage 3; Stage 1 does not risk deleting immutable user bytes merely to claim complete storage lifecycle support.

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

### Worker effects and minimum resource contract

Worker output is an immutable, schema-validated result envelope. A capability may additionally declare a closed settlement-effect schema—for example, publish a media identity and attach it to the completing generation. The runtime checks the active lease, capability version and digest, effect allowlist, referenced identities, expected versions, output hashes, and idempotency key before applying that effect in the settlement transaction. Anything outside that declaration is returned as a proposal for an authorized client to apply later.

Local v1 reserves only the resource semantics needed to run broadly on the supported machine: worker `max_concurrency`, named resource keys/classes, per-capability requirements, lease-bound reservations, storage preflight, and exact blocked reasons. It deliberately does not promise GPU bin-packing, CPU/RAM arbitration, priorities or fairness, model-affinity scheduling, thermal control, provider quotas, or multi-machine placement. Those policies can be added behind the same task/capability/reservation boundary without changing who owns state.

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

The missing composition seam is an independently owned runtime repository/service and protocol, extracted from the reusable kernel pieces without importing Astrid product concepts. On top of that boundary, Stage 1 needs one generic Astrid pack-executor host using the neutral worker protocol and an explicit capability-parity map; Stage 2 later adapts functionality that still exists only in Reigh Worker.

## 10. Local-first implementation seam

The first implementation sequence is specified in the canonical [Overall Strategy and Roadmap](./00-overall-strategy.md). Its beta boundary is deliberately narrower than this vision:

- one local runtime process is the only SQLite writer;
- Stage 1 supports the current Mac and one selected realm; multi-realm switching, named daemons, Linux certification, and polished lifecycle operations follow later;
- Stage 1 runs Astrid from an editable checkout with one generic pack-executor host; rendering remains an Astrid pack capability behind the neutral worker contract, not a separately implemented neutral render component;
- a narrow generated TypeScript second-client proof freezes only the REIGH seam needed for actor/handshake, project, managed media bytes, minimal timeline/shot/reference state, task/run/event observation, fake settlement, and render invocation; Stage 2 owns richer REIGH domains;
- every durable structured workspace concept is migrated into SQLite;
- immutable large bytes are settled into the local object store;
- every capability advertised ready—including GPT/provider, CPU/analysis, generation, orchestration, and rendering—executes in a registered worker process through the neutral protocol;
- broad parity is proven per distinct behavior and adapter: every manifest validates/registers/preflights, real end-to-end evidence covers each distinct adapter plus unique/high-risk/high-use paths, and equivalent variants may use declared fixtures;
- capability readiness is driven by the supported current-machine profile and preflight, not by a blanket local-GPU requirement;
- no Supabase, Turso, hosted relay, RunPod, cloud GPU, or filesystem compatibility path participates;
- the normal runtime contains no legacy fallback or dual-write behavior after the one-time offline migration.

That plan has been ground-truthed through successive repository audits and now carries the handoff-ready work breakdown, dependency order, deletions, migration rules, and acceptance gates. Its first execution gate creates and reviews the concrete DDL, OpenAPI, generated clients, conformance suite, and source-composition manifest before product cutover begins. This vision remains the durable destination; the companion document is the current delivery blueprint.

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
4. Letting editable-checkout convenience blur the independent daemon, process, and protocol boundary.

The local release validates the same command and worker protocols needed by the cloud system. Cloud deployment then becomes a placement, storage, identity, and transport extension—not a new creative model.

## 12. Long-term evolution

### 12.1 Independent runtime boundary from Stage 1

The runtime is conceptually and physically independent from Stage 1. Local v1 creates a sibling neutral repository/service named `banodoco-workspace-runtime` (working product name), with its own schema migrations, OpenAPI/JSON Schema protocol specification, generated clients, conformance suite, compatibility version, and daemon entry point. It may run from its own editable checkout/environment during the beta. Existing code may be moved from Astrid, but Astrid must consume the result through generated protocol clients rather than remain its owner or import its storage internals.

```text
Astrid ─────► Generated runtime client ─► daemon
Reigh ──────► Runtime API/client
Workers ────► Worker protocol

Runtime ─X─► Astrid agent layer
Runtime ─X─► Reigh UI
Runtime ─X─► Reigh Worker implementation
```

Stage 1 must prove independence by starting the runtime in its isolated environment, creating and editing workspace state, executing tasks through a protocol-only fake worker, backing up, and restoring with Astrid, Reigh, and Reigh Worker absent from its import path. Astrid and the narrow fake TypeScript client discover and use the same independently owned runtime, but neither may absorb its source, schema, database path, migrations, or daemon lifecycle authority. Astrid remains an editable checkout and proves separation through process/import boundaries rather than a packaged distribution. Stage 2 must prove that REIGH can start or reuse the same generic Astrid pack-executor host and invoke its registered render capability without starting or importing the Astrid agent. Product launchers converge on one compatible runtime owner rather than creating competing owners.

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
13. Worker settlement applies only immutable outputs and predeclared, runtime-validated effects; no worker holds a general workspace-mutation credential.
14. Resource reservations are owned by and expire with the attempt lease; blocked work reports the precise missing or occupied resource.
15. Local-v1 CAS objects are append-only; logical deletion and accounting do not imply byte collection before Stage 3 proves GC safe.
16. Rendering is neutral at the protocol boundary, not by relocating Astrid pack implementation code into the runtime.

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
12. Gate connections on protocol/schema compatibility, pin capability/source digests per admitted task, and retain whole-checkout state as diagnostics rather than a connection gate.
13. Use one generic Astrid pack-executor host in Stage 1 and keep rendering as pack code behind the neutral worker contract.
14. Keep the Stage 1 scheduler and CAS deliberately minimal; implement advanced resource policy and object collection only after the end-to-end products work.

## 15. Open questions and uncertainties

### Product and naming

- Should the neutral layer be called Creative Workspace Runtime, Banodoco Runtime, Astrid Runtime, or something else?
- Should a Reigh-only user know that a shared runtime exists, or should it remain an implementation detail?
- Is the primary isolation unit a user, workspace, team, or project?

### Post-beta packaging and ownership

- The independent repository/process/protocol boundary is frozen for local v1; public artifact names, signing, release channels, and coordinated installers remain later lifecycle decisions.
- Which future system package, Python, Node, and desktop distribution mechanisms should carry packaged components on macOS, Linux, and later Windows without creating private product-owned runtime copies or closing Astrid's editable pack/skill workflow?
- What machine registry/socket/config mechanism lets Astrid and Reigh discover one compatible runtime and prevents duplicate owners for a realm?
- Local-v1 has no mixed-protocol/schema compatibility window; later finalize any coordinated artifact cadence and signing process.
- How should future uninstall or current checkout removal preserve shared workspaces and a runtime still used by another active product?

### Database and synchronization

- Does current Turso Sync preserve every transaction, locking, migration, and durability property the kernel depends on?
- What conflict policy applies to creative edits when local and cloud copies both change?
- Can the same data model support offline edits while preserving one active scheduling coordinator?
- What is the exact coordinator handoff and disaster-recovery protocol?
- Is one database per realm operationally and economically preferable to one database per user with realm partitioning?

### Task and capability model

- Capability identity uses a stable semantic version plus an immutable definition/source digest; what compatibility promises later semantic versions make remains a post-beta policy question.
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

1. **Boundary conformance:** Does the proposed first local composition make the Banodoco Workspace Runtime actually independent, or does any schema, source/import, startup, or protocol seam still make it Astrid-, Reigh-, or worker-owned?
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
- Third parties can add versioned capabilities without modifying the core task model or requiring a Stage 1 dynamic pack package manager.
- Users can understand where their data and computation live and deliberately change those choices.
- Local-first, cloud-only, and hybrid modes have explicit authority, security, and failure semantics.

The foundational judgment is therefore:

> **Build one neutral creative workspace and execution runtime. Let Astrid be its intelligent agent interface, Reigh its visual interface, and workers its execution fabric. Ship the local composition first, then extend the same contracts to Turso, connectors, and RunPod.**
