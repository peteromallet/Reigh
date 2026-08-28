# Stage 2 — REIGH on the Local Workspace Runtime

**Status:** Canonical Stage 2 delivery plan; implementation has not started
**Date:** 2026-08-28
**Scope revision:** 2026-08-29
**Stage 1 dependency:** [Astrid-First Single-User Beta Trunk](./01-astrid-beta.md)
**Overall strategy:** [Local Workspace Runtime — Overall Strategy and Roadmap](./00-overall-strategy.md)
**Next stage:** [Stage 3 — Exhaustive Hardening](./03-hardening.md)
**Long-term context:** [Creative Workspace Runtime Vision](./vision.md)

## 1. Goal

Attach REIGH to the neutral local workspace produced by Stage 1, first as the smallest useful visual slice required for the single-user beta, then as the full local creative application with Reigh Worker behind the same runtime contract.

The beta slice must open the already selected realm and let the user:

1. create and select projects;
2. browse and import managed media;
3. create, open, edit, and save a timeline;
4. inspect tasks, runs, and durable events;
5. cancel and retry work;
6. render through Astrid's registered render pack capability, executed by the generic pack host through the neutral worker contract;
7. play the managed result; and
8. export it explicitly.

That journey uses the generated TypeScript client and makes zero Supabase, Turso, hosted REIGH, Edge Function, or cloud-worker requests. Stage 2 does not create a REIGH database, copy the Stage 1 realm, or make Astrid a server dependency.

After the beta gate, Stage 2 expands the same boundary to the fuller local REIGH product and adapts Reigh Worker to the already proven worker protocol. It does not introduce a second authority or a compatibility mode.

## 2. Fixed dependency direction

Stage 2 consumes Stage 1 components and contracts in this direction only:

```text
banodoco-workspace-runtime
  ├── OpenAPI / JSON Schemas / conformance fixtures
  ├── generated @banodoco/workspace-client
  ├── realm catalog, discovery, identity, SQLite, CAS, events, backup
  ├── worker protocol and fake worker
  └── worker/effect/resource contracts + core TypeScript fixture
                 |
                 v
        REIGH local server
   scoped actor + transport-only proxy
                 |
                 v
          REIGH browser client

worker protocol + generated Python client
        |                         |
        v                         v
Astrid generic pack host   Reigh Worker local process
 (including rendering)       (full follow-on)
```

The dependency rules are blocking:

1. The runtime imports no REIGH, Astrid, or Reigh Worker code.
2. REIGH imports no Astrid Python types, SDK facades, CLI payloads, pack code, credentials, process lifecycle, bridge route names, or filesystem paths.
3. REIGH and Reigh Worker never open SQLite, write CAS, invoke runtime repositories, or apply runtime migrations.
4. The generated clients are the only product wire clients. REIGH does not maintain handwritten route DTOs or translate a legacy payload into the canonical protocol.
5. A new REIGH requirement changes the neutral DDL/OpenAPI first. Both clients are regenerated, runtime conformance passes, and Astrid conformance is rerun before REIGH consumes the change.
6. The neutral bootstrap owns runtime discovery, realm selection, credentials, process startup, and compatibility checks. REIGH may invoke that bootstrap but may not duplicate it.

## 3. Stage 1 entry gate

Stage 2 begins only from one hash-recorded, Stage 1-compatible composition containing:

- an independently runnable `banodoco-workspace-runtime` daemon with one realm, one SQLite writer, managed CAS, staging, events, receipts, backup/restore, and doctor;
- the reviewed neutral DDL/schema manifest, OpenAPI 3.1 document, closed JSON Schemas, error/scoping rules, and protocol/schema compatibility handshake;
- generated Python and TypeScript clients that pass the shared conformance suite without cross-repository source imports;
- the realm catalog, live discovery advertisement, scoped actor credentials, owner lock, and neutral bootstrap;
- project, versioned document/preference, minimal timeline/revision and shot/reference, media/relation/evidence, run/task/attempt/output, event/receipt, provenance, capability/executor, declared settlement-effect, and resource-reservation records required by the Stage 1 core contract;
- authenticated media `GET`, `HEAD`, `Range`, and `ETag` behavior plus explicit export;
- Astrid's registered render pack capability running through the generic pack-executor host, plus a protocol-only fake worker;
- Stage 1 authority and capability censuses, static deletion proof, migration reconciliation, activation manifest, rollback archive, and editable-checkout Astrid composition evidence; and
- one activated realm containing the verified one-time migration of the user's Astrid state.

Stage 2 does not accept a partial Stage 1 handoff. In particular, it may not compensate for a missing runtime operation by reading the migrated database, calling an Astrid route, scanning the old project tree, or restoring a Supabase path.

**Entry gate:** REIGH's generated TypeScript client and scoped fake product actor pass `second-client-core-v1.yaml`: actor/handshake, project, media ingest/read including `GET`/`HEAD`/`Range`/`ETag`, minimal timeline/shot/reference state, task/run/event observation, fake settlement, and render invocation. Protocol/schema compatibility gates the connection; the render task pins its capability/source digest; the recorded Astrid checkout state remains diagnostic provenance. The runtime-only and Astrid editable-checkout suites remain green before REIGH application code is connected.

## 4. Scope

### 4.1 Included in the REIGH beta slice

- reuse of the Stage 1 realm, catalog, runtime process, protocol/schema-compatible generated client, and recorded composition diagnostics;
- a minimal REIGH launch composition that invokes the neutral bootstrap and starts or reattaches the generic Astrid pack-executor host from the editable Astrid checkout; it verifies the registered render capability's digest/readiness without starting or importing the Astrid agent;
- a distinct least-privilege REIGH actor and credential;
- a local REIGH server that holds the credential and exposes a same-origin browser session;
- a transport-only proxy that terminates the browser session, replaces browser cookies/session headers with the scoped upstream runtime credential, strips hop-by-hop/auth headers, and otherwise preserves canonical method, path, status, body, and non-auth headers;
- project create/list/show/select/current sufficient for the visual journey;
- managed media import, list, inspect, authenticated content reads, and playback;
- timeline create/open/edit/save with immutable revisions and expected-version conflict handling;
- narrow shot/reference placement sufficient to bind managed media into the Stage 1-proven renderable timeline shape;
- task/run reads, durable cursor-based event observation, cancel, and retry;
- neutral task admission for the registered Astrid render capability, progress, settlement, managed output, playback, and explicit export;
- restart persistence and cross-client identity proof with Astrid; and
- deletion of every old REIGH local Supabase/Astrid-bridge/in-memory-stub authority path from the beta build and runtime graph.

### 4.2 Omitted from the beta slice

- Reigh Worker and local GPU image/video generation;
- gallery generation and variant creation UX beyond displaying already managed media needed by the basic journey;
- advanced shot-scoped editing, project composition, travel-between-images, advanced audio editing, and extension authoring/composition UI; the minimum shot/reference placement needed to make the beta timeline renderable is included;
- hosted authentication, credits, billing, Supabase Storage, Edge Functions, hosted REIGH, relay, remote collaboration, Turso, RunPod, and cloud GPUs;
- existing REIGH/Supabase account migration;
- multi-user behavior, sharing, permissions UI, and collaborative conflict resolution;
- third-party extension installation or untrusted capability execution;
- signed/notarized public installers, automatic update/rollback, production support SLAs, and the exhaustive hardening matrix.

Unavailable controls are removed from the beta UI or report a precise unavailable capability and setup/profile requirement. They never submit to another backend.

### 4.3 Included after the beta gate

The fuller local REIGH follow-on adds, in order:

1. gallery, generations, variants, provenance, and promotion into shots;
2. shot-scoped and project timelines, references, composition, audio, and richer export;
3. runtime-backed settings, preferences, and release-pinned extension state/composition;
4. Reigh Worker registration, readiness, claim, materialization, heartbeat, cancellation, staged output, settlement, failure, and recovery;
5. the minimum audited local image and travel/video generation capability set;
6. explicit one-time import of selected legacy REIGH-only state where required; and
7. a clean handoff to Stage 3 containing packaged-component evidence where applicable and Astrid editable-checkout composition evidence.

The follow-on does not restore hosted identity, credits, Supabase, Turso, RunPod, or collaboration to the local artifact.

## 5. Runtime, server, and browser topology

```text
                  neutral bootstrap
           discovery / compatibility / lifecycle
                           |
                           v
            Banodoco Workspace Runtime
         sole SQLite / CAS / task authority
              |                       |
      generated TS client      generic Astrid pack host
              |                 render; later, Reigh Worker
              v
        REIGH local server
   scoped credential + origin policy
              |
      same-origin browser session
              |
              v
          REIGH browser UI
```

The browser never receives a runtime actor credential. The local server exchanges the owner-only REIGH credential for an `HttpOnly`, `SameSite=Strict`, origin-bound session. For each upstream `/v1` request it terminates that session, removes browser `Cookie`/session-auth and hop-by-hop headers, injects the scoped runtime `Authorization` credential, and otherwise preserves method, path/query, request body, response status/body, and non-auth end-to-end headers. The generated TypeScript client therefore speaks the canonical `/v1` shape at the same origin; the server is not a second DTO/route dialect. It may add browser session enforcement and static asset serving, but it may not rename fields, synthesize workspace state, implement task transitions, resolve filesystem paths, or become a cache authority.

Durable state is read back from the runtime. Reconnectable UI progress may be non-authoritative, but task/run rows and durable event cursors are truth. Media playback uses authenticated runtime content routes with range support. Export is a runtime command that materializes an authorized managed object outside the realm and records export provenance.

## 6. REIGH authority cutover

| Current REIGH local seam | Stage 2 disposition | Required proof |
|---|---|---|
| `/api/astrid` and Astrid-named bridge client/types | delete; use canonical `/v1` protocol through generated TypeScript client | old route absent; no alias or translation; contract tests pass |
| `scripts/dev-editor.mjs` in-memory bridge stub | remove from supported/acceptance path | accepted source/build journey starts the real independent runtime and persists across restart |
| `dataAuthority` modes such as `supabase-deferred` | delete from the local build | one local authority is compiled; no backend selector or fallback flag exists |
| Supabase client/providers/auth/credits/storage/Edge Function imports | remove from the local entry and dependency graph | static bundle/import scan and network capture are clean |
| direct project/gallery/generation/task queries | replace with generated client services | IDs, versions, receipts, and typed errors round-trip unchanged |
| local absolute media paths and Supabase storage URLs | replace with authenticated runtime media identities/content routes | original import path may be removed; range playback and export still work |
| browser-side authority or mutation cache | make runtime reads/events authoritative | reload and restart reproduce committed state; stale writes reject |
| worker-owned/Supabase task transitions | omit until Reigh Worker cutover; runtime owns every transition | beta controls use fake/render executors only; no local Supabase queue call |
| hosted REIGH product code retained in the repository | isolate outside the supported local composition if still maintained | dependency closure and bundle graph prove no hosted authority is reachable |

Deletion is part of each tranche, not a final cleanup sweep. Once a replacement route is accepted, the displaced local route, provider, DTO, flag, test fixture, and documentation are removed. A compatibility facade preserving an old URL or payload is forbidden.

## 7. Delivery tranches and hard gates

### R0 — Lock the Stage 1 handoff and REIGH census

Deliver:

- accepted protocol/schema versions, Stage 1 core conformance fixture, capability-digest rules, and diagnostic source/composition manifest;
- a machine-readable census of every REIGH project, media, timeline, task, event, render, playback, and export reader/writer;
- a second census of every Supabase, storage, auth, credits, Edge Function, Astrid bridge, local stub, absolute-path, and backend-selection dependency reachable from the local entry graph;
- the richer generated TypeScript contract and conformance additions now owned by Stage 2: gallery/generation/variant queries, extension state and pinning, richer shot/composition semantics, and any browser media operations beyond the Stage 1 core fixture;
- browser-session, credential-translation/transport-proxy, media-range, render-input, and export contracts;
- a route-by-route mapping from the beta UX to generated TypeScript client calls;
- a deletion ledger naming every old local authority module, route, environment variable, provider, fixture, and document; and
- recorded baseline fixtures for the minimum browser journey.

**Gate R0:** Every beta-path read, mutation, byte transfer, task control, and minimum shot/reference placement has exactly one neutral runtime operation and one deletion disposition. The regenerated client still passes `second-client-core-v1.yaml`; new REIGH operations have their own closed schemas, authorization rules, and conformance fixtures. The R3 render fixture is the same minimum valid timeline→shot/reference→managed-media shape already proven by Astrid's render pack capability. Any contract change regenerates both clients and reruns Astrid core conformance, but does not require Astrid to adopt REIGH-only UX.

### R1 — Establish the local REIGH application boundary

Build the supported local REIGH server composition, realm discovery, REIGH actor provisioning, compatibility handshake, same-origin session, and credential-translating transport-only proxy. REIGH invokes the existing neutral bootstrap, which starts or reattaches the generic Astrid pack-executor host and requires the render capability's matching digest and preflight before reporting ready. This launch path uses pack code from the editable Astrid checkout but starts no Astrid agent and imports no Astrid types into REIGH. Remove the Astrid proxy alias, local in-memory bridge acceptance path, and all Supabase/auth/credits providers from the beta entry graph.

The runtime may be absent, stopped, incompatible, or unhealthy. REIGH reports the exact neutral configure/up/restart/doctor action and never creates a private database or starts a second owner.

**Gate R1:** A clean REIGH launch reuses the selected Stage 1 realm and owner, provisions its own actor/session, and idempotently starts or reattaches one matching generic pack host. Concurrent Astrid/REIGH launch still yields one runtime owner and one compatible host rather than competing product-owned executors. Runtime-down, stale discovery, expired credential, wrong scope, missing/mismatched render capability, and protocol/schema incompatibility fail closed. A changed unrelated checkout file is diagnostic only; a changed render capability affects later admissions through its digest. Static dependency closure and runtime tracing show no alternate authority. REIGH-only smoke runs with no Astrid agent while retaining access to the editable Astrid pack source.

### R2 — Cut over projects, media, and timelines

Implement project create/list/show/select/current, managed media import/browse/show/content, timeline create/open/edit/save, and the narrow shot/reference placement required to attach imported managed media to a renderable timeline through the generated client. Use runtime IDs, immutable media digests, timeline revisions, shot/reference identities, and expected versions throughout. Remove corresponding direct Supabase queries, storage URLs, local-path handling, bridge DTOs, optimistic write authorities, and fallback fixtures.

Keep the beta editor deliberately narrow. Unsupported generation, advanced shot editing/composition, extension, and cloud actions are absent or truthfully unavailable; they do not preserve an old request path.

**Gate R2:** In a real browser, create/select a project, import media, place it through the minimum shot/reference composition, delete the source file, create and save a renderable timeline, reload both REIGH and the runtime, and recover the same IDs and content. Two editors racing a save produce one winner and one actionable stale-version response without lost updates.

### R3 — Cut over tasks, events, render, play, and export

Implement run/task lists and details, durable cursor event reads, cancellation, retry, render admission, progress display, output settlement, authenticated range playback, and explicit export. Rendering runs as Astrid pack code in the generic host through the neutral task/worker/effect contract; it does not execute inside the browser, REIGH server, Astrid agent, or runtime.

Delete all remaining beta-path Supabase queue/status/completion/storage calls and any client-generated terminal state. UI progress may be optimistic, but completion, failure, cancellation, retries, outputs, and receipts always reconcile to runtime truth.

**Gate R3:** A browser saves a timeline, renders it to a CAS-backed result, verifies and plays it with range requests, exports it, cancels one task, retries one failed/cancelled task, reconnects the event cursor after restart, and observes the same durable run/output state from Astrid. FFprobe verifies the rendered container, video stream, and audio behavior required by its profile.

### R4 — Delete old local authority and close the beta

Remove every displaced beta-path module, public route alias, schema/payload adapter, provider, environment variable, backend selector, local stub, and legacy documentation entry. Produce real isolated-process evidence from the supported source/build composition rather than accepting in-memory mocks or direct cross-repository imports.

After the R3 browser journey, create a runtime backup and restore it into a new realm. Run SQLite quick/integrity checks, foreign-key checks, schema/activation verification, reachable-CAS hash verification, and event-head reconciliation. Verify from both generated clients that the restored realm contains the newly written project, imported media, timeline revision, shot/reference composition, task/run/events, render output, and export provenance with the expected identities/digests.

Publish:

- `reigh-beta-acceptance.json`;
- `reigh-authority-census.json` with zero unclassified local writers/readers;
- `reigh-network-capture.json`;
- local bundle/dependency-closure and forbidden-import reports;
- cross-product identity/restart evidence;
- media playback/export verification; and
- post-REIGH-write backup/restore/integrity/reconciliation evidence;
- an updated diagnostic composition manifest for runtime/client/REIGH artifacts plus Astrid checkout revision, dirty-tree digest, dependency locks, pack manifests, and admitted capability/source digests.

**Gate R4 — combined single-user beta:** The complete section 1 journey runs in the supported browser/source composition against the migrated Stage 1 realm with zero Supabase/Turso/hosted-service traffic and no legacy authority path. Its resulting state passes the new-realm backup/restore and integrity proof above. Astrid remains useful from its editable checkout with REIGH absent; REIGH launches the generic pack host and renders without an Astrid agent process; the runtime passes with both products and all pack hosts absent.

### R5 — Expand to the full local REIGH creative model

Add runtime-backed galleries, generations, variants, provenance, shot promotion, shots/references, shot-scoped and project timelines, composition, audio, settings/preferences, and release-pinned extension state. Stage 2 owns the neutral schemas, operations, authorization, migration, generated-client changes, and conformance for these richer domains; it may promote a Stage 1 versioned document into dedicated tables only when the REIGH behavior proves that generic documents are insufficient.

Extension executable code remains outside the runtime. A timeline revision pins every definition/settings digest that affects rendering. Removing an executor never deletes historical state; unavailable historical renders fail explicitly.

**Gate R5:** Browser acceptance covers project/gallery/variant/shot/main-timeline workflows, extension composition, audio playback, stale writes, restart persistence, backup/restore, and export. All additions remain visible to Astrid or a neutral client by shared identity; no REIGH-only hidden authority is introduced.

### R6 — Adapt Reigh Worker to the neutral worker protocol

Classify every Reigh Worker task family as reusable compute, control-plane-entangled, orchestrator-owned, or retired. Preserve model loading, workflow construction, inference, progress translation, and output discovery where reusable. Replace Supabase claim/status/completion/storage and worker-owned child insertion with the generated Python client and runtime operations for:

- registration, capability/resource advertisement, readiness, heartbeat, drain, and shutdown;
- claim, start, attempt heartbeat/control, cancellation, failure, and fenced settlement;
- authorized input fetch and attempt-local materialization;
- staged output upload, hash verification, publication, media/generation/provenance settlement; and
- parent-attempt child admission with allowlist, depth, fan-out, dependency, epoch, lease, version, and idempotency checks.

Reigh Worker receives endpoint, realm, and scoped expiring credential only. It receives no SQLite path, Supabase credential, broad object-store access, or authority to insert task rows.

R6 must preserve the Stage 1 worker fence: immutable typed outputs, client-applied proposals or predeclared runtime-validated settlement effects, no general mutation credential, lease-bound resource reservations, and exact blocked reasons. Reigh Worker may advertise richer resource requirements but may not introduce a second scheduler.

**Gate R6:** A dependency-light worker source/build suite passes without Supabase/PostgREST present. Two workers prove unique sessions, exactly-one claim, stale-epoch/lease rejection, cancel/retry, kill/restart recovery, child-admission fencing, declared-effect enforcement, reservation release/expiry, digest-verified settlement, and orphan accounting. Every manifest validates/registers/preflights; real end-to-end evidence covers each distinct adapter plus unique/high-risk/high-use behavior, while explicitly equivalent variants may use declared fixtures.

### R7 — Compose the full local stack and migrate REIGH-only state

Extend the neutral bootstrap with the full REIGH/Reigh Worker profile. Prove both installation orders reuse one compatible runtime and realm. If selected legacy REIGH-only data is required, migrate it with the separate offline migrator: freeze writers, create a verified source backup, import only facts absent from the activated realm, fail on semantic disagreement, ingest required bytes, validate, and activate atomically.

The normal runtime and products never read the legacy source. After validation, delete every remaining local Supabase queue/storage/Edge Function authority and exclude the migration code from normal dependency and startup graphs. Preserve the source only as an explicitly named rollback archive until its retention gate.

**Gate R7:** The full local creative journey survives process restart and machine reboot, old/new identity reconciliation and object hashes match, rollback is rehearsed, and static/runtime scans prove no legacy REIGH or Supabase authority is reachable. Astrid-first-then-REIGH and REIGH-first-then-Astrid converge on the same realm without translation.

## 8. Critical path

```text
Stage 1 exact release + activated realm
                    |
                    v
          R0 contract/census lock
                    |
                    v
       R1 server/session boundary
                    |
                    v
       R2 projects/media/timeline
                    |
                    v
  R3 tasks/events/render/play/export
                    |
                    v
       R4 BASIC REIGH BETA GATE
                    |
                    v
       R5 full creative model
                    |
                    v
       R6 neutral Reigh Worker
                    |
                    v
   R7 composition/migration/deletion
                    |
                    v
       STAGE 3 HARDENING HANDOFF
```

R5 discovery work and R6 compute-path classification may begin after R0, but neither may alter the beta entry graph or bypass the R1–R4 gates. Runtime contract changes are serialized through neutral review and regenerate both clients.

## 9. Acceptance

### 9.1 Basic REIGH beta acceptance

- clean launch and reuse of the selected Stage 1 realm without creating another database, realm, or runtime owner;
- distinct scoped Astrid and REIGH actors observing the same project, timeline, media, task, run, event, output, and receipt identities;
- project create/select plus managed media import whose original source can be deleted before later playback/render;
- timeline create/open/edit/save/reload plus the minimum shot/reference placement required by the frozen Stage 1 render fixture and deterministic stale-write rejection;
- durable task/run reads and event-cursor reconnect after REIGH/runtime restart;
- cancel and retry with terminal state derived only by the runtime;
- render through the registered Astrid pack capability to verified managed output, authenticated `HEAD`/`Range`/`ETag` playback, and explicit export with provenance;
- runtime-down, incompatible release, invalid realm, expired credential, missing renderer, and insufficient-storage states produce precise recovery actions;
- browser session origin/CSRF policy, owner-only credential storage, authorization on all non-health routes, and no secret leakage;
- network capture proving zero Supabase, Turso, hosted REIGH, Edge Function, RunPod, cloud-GPU, and uninvoked provider requests;
- static import, bundle, route, environment, and dependency scans proving no old local authority or compatibility shim;
- realm filesystem shape remains SQLite, CAS objects, and active staging only; and
- backup after the REIGH journey restores into a new realm and verifies SQLite/foreign keys/schema, reachable CAS hashes, event heads, cross-product identities, render output, and export provenance;
- runtime-only isolated, Astrid-only editable-checkout, REIGH-only, and Astrid+REIGH composition smoke suites all pass.

### 9.2 Full local REIGH and Worker acceptance

- galleries, generations, variants, provenance, shots/references, shot/project timelines, audio, settings, and extension state persist across restart and backup/restore;
- project creation/edit/save/reload, image generation/variants, shot composition, travel/video generation, rendering, media range fetch, audio playback, and export pass in the supported browser matrix;
- every registered worker capability advertises an immutable definition/source digest and becomes ready only after dependency/model preflight;
- two-worker claim/drain/restart races, lease expiry, stale completion, cancellation, retry, child admission, runtime restart/epoch change, and duplicate settlement have exactly one transactional winner;
- real supported local GPU outputs pass golden/semantic checks; deterministic fake execution covers non-GPU platforms;
- FFprobe verifies expected duration, streams, codecs, and A/V sync for rendered/exported media;
- backup/restore contains every reachable object; storage accounting identifies reachable, staged, and published-but-unreferenced objects, while physical CAS collection remains disabled until Stage 3;
- migration conflict, interruption, validation failure, and rollback leave the activated Stage 1 realm or verified source archive recoverable;
- the supported current-Mac, one-realm restart/reboot path preserves shared realm data; broader checkout, multi-realm, packaged-component, and purge lifecycle matrices remain Stage 3 work; and
- minimum source/build-composition accessibility/keyboard smoke, scoped credential/loopback authorization, restart persistence, backup/restore integrity, and static/network authority proof pass; exhaustive failure/security/platform matrices are handed to Stage 3.

## 10. Definitions of done

### 10.1 Basic REIGH beta

The combined single-user beta is complete when a user can launch REIGH through the neutral bootstrap, reuse the migrated Astrid realm, create/select a project, import media, make the minimum renderable shot/reference composition, edit and save a timeline, observe/cancel/retry work, render through the generic pack host, play, export, restart, restore the post-journey backup into a new realm, and see the same verified state from Astrid—with zero Supabase traffic and no old local authority in the supported composition graph.

The beta is not described as full local REIGH. Reigh Worker, GPU generation, advanced creative surfaces, existing REIGH data migration, public installer polish, and exhaustive production hardening remain explicitly unavailable until their gates pass.

### 10.2 Full local REIGH

Full local REIGH is complete when the supported gallery-to-generation-to-variant-to-shot-to-project-timeline journey, audio/extension composition, local image/travel/video execution, render/play/export, restart, backup/restore, migration, and recovery all run through the neutral runtime and registered executors. No local build path imports, contacts, or falls back to Supabase, Astrid bridge code, legacy storage, or a worker-owned queue.

### 10.3 Stage 3 handoff

Stage 2 is ready for hardening when one independently owned runtime and realm serves Astrid, fuller REIGH, the generic Astrid pack host, and the accepted Reigh Worker profile; protocol/schema compatibility, per-task capability digest pinning, recorded source diagnostics, and clean authority deletion are proven; and Stage 3 receives reproducible manifests, authority/network evidence, backup/restore fixtures, storage accounting, known risks, and fault-injection hooks. Only [Stage 3](./03-hardening.md) may make the production-readiness claim.

## 11. Explicitly deferred beyond Stage 2

- Turso and synchronized local/cloud storage;
- hosted REIGH-to-local relay and remote connector;
- RunPod or shared cloud GPU scheduling;
- multi-user collaboration and team tenancy UX;
- hosted auth, credits, billing, and account migration;
- third-party capability/extension marketplace and untrusted sandboxing; and
- automatic mixed-version compatibility or legacy payload translation.

These require later placement, identity, security, or product plans. They may reuse the frozen `WorkspaceStore`, `ObjectStore`, `IdentityProvider`, `RuntimeClock`, `EventDelivery`, `CapabilityCatalog`, and language-neutral protocol seams, but they do not enter the Stage 2 critical path.

## 12. Estimate

- R0–R4, the basic REIGH slice required for the overall single-user beta: **5–9 engineer-weeks**. This includes the richer TypeScript contract work deliberately moved out of Stage 1.
- R5–R7, the fuller local creative model, Reigh Worker adaptation, composition, and any selected one-time REIGH-only import: **15–25 additional engineer-weeks**.
- Total Stage 2 from the Stage 1 handoff through the fuller local handoff: **20–34 engineer-weeks**.

The largest uncertainty is how much current editor state and worker behavior is entangled with Supabase semantics rather than merely transported through Supabase. Stage 3 hardening and any cloud/collaboration product work are excluded from these numbers.
